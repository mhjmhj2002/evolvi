import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { env } from '../../../config/env.js';
import {
  importacaoEventBus,
  ImportacaoLoteRecepcionadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { UniversalStatementParser } from '../../conector/parsers/universal-statement.parser.js';
import {
  ArquivoConsolidadoIa,
  LancamentoConsolidadoIa,
  arquivoConsolidadoIaSchema,
} from './ia-extrator.schema.js';

import { PdfTextExtractor } from '../../conector/parsers/pdf-text-extractor.js';
import { C6InvoicePdfParser } from '../../conector/parsers/c6-invoice-pdf.parser.js';

export interface IIaExtratorClient {
  extrairTransacoes(params: {
    nomeArquivo: string;
    mimeType?: string | null;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
    };
  }): Promise<LancamentoConsolidadoIa[]>;
}

export class GeminiIaExtratorClient implements IIaExtratorClient {
  private apiKey?: string;
  private model: string;
  private universalParser: UniversalStatementParser;

  constructor(apiKey?: string, model: string = 'gemini-2.5-flash') {
    this.apiKey = apiKey || env.GEMINI_API_KEY;
    this.model = model;
    this.universalParser = new UniversalStatementParser();
  }

  public async extrairTransacoes(params: {
    nomeArquivo: string;
    mimeType?: string | null;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
    };
  }): Promise<LancamentoConsolidadoIa[]> {
    const { nomeArquivo, mimeType, conteudoBuffer, contexto } = params;

    // Se o arquivo for PDF e não possuir conteudoTexto fornecido, extraímos previamente via PdfTextExtractor
    let textoProcessado = params.conteudoTexto;
    const isPdf =
      (mimeType && mimeType.includes('pdf')) ||
      nomeArquivo.toLowerCase().endsWith('.pdf') ||
      conteudoBuffer.subarray(0, 5).toString('latin1') === '%PDF-';

    if (isPdf && !textoProcessado) {
      textoProcessado = PdfTextExtractor.extrairTexto(conteudoBuffer);
    }

    // 1. Se for formato estritamente estruturado padrão (OFX, CSV com cabeçalho bancário ou JSON estruturado),
    // é seguro extrair diretamente via parser determinístico
    const ext = path.extname(nomeArquivo).toLowerCase();
    const isEstruturadoPadrao =
      ext === '.ofx' ||
      ext === '.csv' ||
      ext === '.json' ||
      conteudoBuffer.includes('<OFX>') ||
      conteudoBuffer.includes('<BANKTRANLIST>');

    if (isEstruturadoPadrao) {
      const transacoesEstruturadas = this.extrairLocalDeterministic({
        ...params,
        conteudoTexto: textoProcessado,
      });
      if (transacoesEstruturadas.length > 0) {
        return transacoesEstruturadas;
      }
    }

    // 2. Se for fatura C6 em PDF com formatação reconhecida pelo parser especializado
    if (isPdf && textoProcessado && C6InvoicePdfParser.isC6Invoice(textoProcessado)) {
      const transacoesC6 = C6InvoicePdfParser.parse(textoProcessado, {
        dataReferencia: contexto.dataReferencia,
        categorias: contexto.categorias,
      });
      if (transacoesC6.length > 0) {
        return transacoesC6;
      }
    }

    // 3. Rigor Exclusivo da IA para documentos complexos / não-estruturados (PDFs, imagens, textos livres):
    // Se não houver chave de IA configurada, NÃO tentar adivinhar transações via código.
    if (!this.apiKey) {
      throw new Error(
        'A IA não conseguiu processar este documento. Verifique se a chave de IA está configurada ou se o documento é legível.'
      );
    }

    // Se temos apiKey do Gemini, tentamos chamada multimodal ou text
    try {
      return await this.chamarGeminiApi(
        nomeArquivo,
        mimeType,
        conteudoBuffer,
        contexto,
        textoProcessado
      );
    } catch (err: unknown) {
      const detalhe = err instanceof Error ? err.message : String(err);
      console.error(
        `[GeminiIaExtratorClient] Falha na extração por IA para "${nomeArquivo}": ${detalhe}`
      );
      // NUNCA fazer fallback heurístico cego para documentos complexos/não estruturados.
      throw new Error(`A IA não conseguiu processar este documento. Motivo: ${detalhe}`);
    }
  }

  private async chamarGeminiApi(
    nomeArquivo: string,
    mimeType: string | null | undefined,
    conteudoBuffer: Buffer,
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
    },
    textoProcessado?: string
  ): Promise<LancamentoConsolidadoIa[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const promptSistema = `Você é o extrator inteligente e especialista financeiro do sistema Evolvi.
Sua missão é extrair rigorosamente TODAS as transações financeiras (despesas, receitas, faturas, pagamentos, transferências) contidas no documento ou extrato anexo.

DIRETRIZES FUNDAMENTAIS:
1. Extração Exaustiva: Não omita nenhuma linha ou lançamento. Cada compra, débito, crédito ou movimentação deve gerar um item no array "transacoes".
2. Anti-dupla contagem:
   - Se for pagamento de fatura de cartão de crédito (ex: "PAGTO FATURA", "PGTO CARTAO", "PAGAMENTO DE FATURA"), defina "natureza" = "TRANSFERENCIA_PROPRIA" e "isPagamentoFatura" = true.
   - Para compras ou despesas normais: "natureza" = "DESPESA".
   - Para salários, rendimentos, pix recebido ou entradas: "natureza" = "RECEITA".
3. Formato da Data: "YYYY-MM-DD". Se o documento trouxer apenas DD/MM ou DD/MM/AAAA, converta para YYYY-MM-DD usando o ano de referência ("${contexto.dataReferencia.substring(0, 4)}").
4. Formato de Valor: número decimal positivo (ponto como separador, ex: 125.50).
5. Parcelamento: Se houver indicação de parcela (ex: "01/03", "3/10", "parcela 2 de 5"), preencha "parcelaAtual" e "totalParcelas".
6. Contas disponíveis do usuário:
${contexto.contas.map((c) => `- "${c.nome}" (Tipo: ${c.tipo})`).join('\n') || '(Nenhuma cadastrada)'}
Se o documento for de uma instituição específica (ex: Nubank, Itaú, Inter), sugira a conta em "contaSugerida" e o tipo ("CARTAO_CREDITO" ou "CONTA_CORRENTE") em "tipoConta".
7. Categorias disponíveis (POF):
${contexto.categorias.map((c) => `- "${c.nome}"`).join('\n') || '(Nenhuma cadastrada)'}
Preencha "categoriaSugerida" com a categoria mais aderente.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON puro):
{
  "transacoes": [
    {
      "dataMovimento": "YYYY-MM-DD",
      "descricao": "string concisa",
      "valor": 99.90,
      "natureza": "DESPESA" | "RECEITA" | "TRANSFERENCIA_PROPRIA" | "APORTE_PATRIMONIAL",
      "contaSugerida": "string ou null",
      "tipoConta": "CONTA_CORRENTE" | "CARTAO_CREDITO" | null,
      "categoriaSugerida": "string ou null",
      "parcelaAtual": number ou null,
      "totalParcelas": number ou null,
      "isPagamentoFatura": boolean,
      "observacao": "string ou null",
      "confianca": number
    }
  ]
}`;

    const effectiveMime = mimeType || this.inferirMimeType(nomeArquivo);

    let parts: any[] = [];
    const isTextual =
      Boolean(textoProcessado) ||
      effectiveMime.includes('text') ||
      effectiveMime.includes('csv') ||
      effectiveMime.includes('json') ||
      effectiveMime.includes('ofx') ||
      nomeArquivo.endsWith('.csv') ||
      nomeArquivo.endsWith('.ofx') ||
      nomeArquivo.endsWith('.txt');

    if (isTextual) {
      const texto = textoProcessado || conteudoBuffer.toString('utf-8');
      parts = [
        {
          text: `${promptSistema}\n\nDocumento a analisar ("${nomeArquivo}"):\n"""\n${texto}\n"""`,
        },
      ];
    } else {
      // Imagens ou PDFs sem texto extraído (multimodal inlineData base64)
      const base64Data = conteudoBuffer.toString('base64');
      parts = [
        { text: promptSistema },
        {
          inlineData: {
            mimeType: effectiveMime,
            data: base64Data,
          },
        },
      ];
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro na API Gemini (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('A resposta do Gemini não continha texto de saída.');
    }

    const parsedJson = JSON.parse(rawText);
    const lista = Array.isArray(parsedJson) ? parsedJson : parsedJson.transacoes || [];

    return lista.map((t: any) => ({
      dataMovimento: t.dataMovimento || contexto.dataReferencia,
      descricao: String(t.descricao || 'Lançamento extraído'),
      valor: Math.abs(Number(t.valor) || 0),
      natureza: t.natureza || 'DESPESA',
      contaSugerida: t.contaSugerida || null,
      tipoConta: t.tipoConta || null,
      categoriaSugerida: t.categoriaSugerida || null,
      parcelaAtual: t.parcelaAtual ? Number(t.parcelaAtual) : null,
      totalParcelas: t.totalParcelas ? Number(t.totalParcelas) : null,
      isPagamentoFatura: Boolean(t.isPagamentoFatura),
      observacao: t.observacao || null,
      confianca: Number(t.confianca ?? 0.95),
    }));
  }

  public extrairLocalDeterministic(params: {
    nomeArquivo: string;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
    };
  }): LancamentoConsolidadoIa[] {
    const { nomeArquivo, conteudoBuffer, contexto } = params;
    const ext = path.extname(nomeArquivo).toLowerCase();
    const isPdf =
      ext === '.pdf' ||
      conteudoBuffer.subarray(0, 5).toString('latin1') === '%PDF-';

    let texto = params.conteudoTexto;
    if (!texto && isPdf) {
      texto = PdfTextExtractor.extrairTexto(conteudoBuffer);
    }
    if (!texto && !isPdf) {
      texto = conteudoBuffer.toString('utf-8');
    }
    texto = texto || '';

    // 1. Tentar parser especializado para Fatura C6 Bank
    if (C6InvoicePdfParser.isC6Invoice(texto)) {
      const transacoesC6 = C6InvoicePdfParser.parse(texto, {
        dataReferencia: contexto.dataReferencia,
        categorias: contexto.categorias,
      });
      if (transacoesC6.length > 0) {
        return transacoesC6;
      }
    }

    // 2. Tentar parser universal (OFX, CSV, JSON)
    if (ext === '.ofx' || ext === '.csv' || ext === '.json' || texto.includes('<OFX>') || texto.includes(';')) {
      const parseRes = this.universalParser.parse(texto, nomeArquivo);
      if (parseRes.transacoes.length > 0) {
        return parseRes.transacoes.map((t) => {
          let natureza: 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL' = (t.natureza as any) || 'DESPESA';
          const descLower = t.descricao.toLowerCase();
          if (t.isPagamentoFatura || descLower.includes('fatura') || descLower.includes('pagamento do cartao')) {
            natureza = 'TRANSFERENCIA_PROPRIA';
          } else if (descLower.includes('salario') || descLower.includes('salário') || descLower.includes('pix recebido') || descLower.includes('ted recebida') || descLower.includes('rendimento')) {
            natureza = 'RECEITA';
          } else if (descLower.includes('restaurante') || descLower.includes('mercado') || descLower.includes('lanche') || descLower.includes('aluguel') || descLower.includes('uber') || descLower.includes('gasolina') || descLower.includes('compra')) {
            natureza = 'DESPESA';
          }

          return {
            dataMovimento: t.data,
            descricao: t.descricao,
            valor: t.valor,
            natureza,
            contaSugerida: parseRes.contaSugerida?.nome || this.deduzirNomeContaPorArquivo(nomeArquivo),
            tipoConta: (parseRes.contaSugerida?.tipo as any) || this.deduzirTipoContaPorArquivo(nomeArquivo),
            categoriaSugerida: t.categoriaSugerida || this.deduzirCategoria(t.descricao, contexto.categorias),
            parcelaAtual: null,
            totalParcelas: null,
            isPagamentoFatura: Boolean(t.isPagamentoFatura),
            observacao: t.memo || 'Extraído via parser estruturado local',
            confianca: 0.98,
          };
        });
      }
    }

    // Formatos não estruturados que não casaram com parsers estritos acima não devem
    // sofrer adivinhações por regex ou fallbacks cegos de código.
    return [];
  }

  private inferirMimeType(nome: string): string {
    const ext = path.extname(nome).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.csv':
        return 'text/csv';
      case '.json':
        return 'application/json';
      case '.ofx':
        return 'application/x-ofx';
      default:
        return 'text/plain';
    }
  }

  private deduzirNomeContaPorArquivo(nome: string): string {
    const lower = nome.toLowerCase();
    if (lower.includes('nubank')) return 'Nubank';
    if (lower.includes('itau') || lower.includes('itaú')) return 'Itaú Unibanco';
    if (lower.includes('inter')) return 'Banco Inter';
    if (lower.includes('santander')) return 'Santander';
    if (lower.includes('bradesco')) return 'Bradesco';
    if (lower.includes('caixa')) return 'Caixa Econômica';
    if (lower.includes('bb') || lower.includes('brasil')) return 'Banco do Brasil';
    return 'Conta Bancária';
  }

  private deduzirTipoContaPorArquivo(nome: string): 'CARTAO_CREDITO' | 'CONTA_CORRENTE' {
    const lower = nome.toLowerCase();
    if (
      lower.includes('fatura') ||
      lower.includes('cartao') ||
      lower.includes('cartão') ||
      lower.includes('credit')
    ) {
      return 'CARTAO_CREDITO';
    }
    return 'CONTA_CORRENTE';
  }

  private deduzirCategoria(
    texto: string,
    categorias: { id: string; nome: string }[]
  ): string | null {
    const lower = texto.toLowerCase();
    if (lower.includes('almoço') || lower.includes('mercado') || lower.includes('lanche') || lower.includes('restaurante')) {
      const c = categorias.find((cat) => cat.nome.toLowerCase().includes('aliment'));
      if (c) return c.nome;
    }
    if (lower.includes('uber') || lower.includes('gasolina') || lower.includes('posto') || lower.includes('combustivel')) {
      const c = categorias.find((cat) => cat.nome.toLowerCase().includes('transp'));
      if (c) return c.nome;
    }
    if (lower.includes('aluguel') || lower.includes('condom') || lower.includes('energia') || lower.includes('copel') || lower.includes('luz')) {
      const c = categorias.find((cat) => cat.nome.toLowerCase().includes('habita'));
      if (c) return c.nome;
    }
    return categorias.length > 0 ? categorias[0].nome : null;
  }
}
