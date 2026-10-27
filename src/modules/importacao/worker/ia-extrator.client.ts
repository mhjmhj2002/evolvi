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
import { SantanderStatementPdfParser } from '../../conector/parsers/santander-statement-pdf.parser.js';
import { CryptoService } from '../../../infrastructure/security/crypto.service.js';
import {
  TokensIa,
  UsoIaService,
  tokensDeUsageGemini,
  tokensDeUsageOpenAi,
} from '../../ia/uso-ia.service.js';
import {
  IA_CAPACIDADES_MEDIA,
  IaCapacidadeMedia,
  obterCapacidadeMedia,
} from '../../ia/capacidades-media.js';
import {
  MODELO_OPENROUTER_PADRAO,
  mensagemProvedorNaoSuportado,
  montarHeadersOpenRouter,
  montarUrlOpenRouter,
  normalizarModeloOpenRouter,
  obterConfigOpenRouter,
  provedorSuportadoNoFluxo,
} from '../../ia/openrouter.config.js';

// Reexportado para preservar a API pública histórica do módulo.
export type { IaCapacidadeMedia };
export { IA_CAPACIDADES_MEDIA };

export interface IIaExtratorClient {
  extrairTransacoes(params: {
    nomeArquivo: string;
    mimeType?: string | null;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    usuarioId?: string;
    provedorIa?: string;
    modeloIa?: string;
    /** Vínculo opcional do log de consumo de IA com o lote de importação (TASK-49). */
    loteId?: string;
    /** Vínculo opcional do log de consumo de IA com o arquivo importado (TASK-49). */
    arquivoId?: string;
    /**
     * TASK-50: handoff explícito do id da linha criada em `uso_ia_logs`, permitindo
     * correlacionar de forma determinística a tentativa do arquivo ao log de telemetria.
     */
    aoRegistrarUsoIa?: (usoIaLogId: string | null) => void;
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    };
  }): Promise<LancamentoConsolidadoIa[]>;
}

export class GeminiIaExtratorClient implements IIaExtratorClient {
  private apiKey?: string;
  private model: string;
  private universalParser: UniversalStatementParser;

  public static isArquivoVisual(nomeArquivo: string, mimeType?: string | null): boolean {
    const ext = path.extname(nomeArquivo).toLowerCase();
    const visualExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff'];
    if (visualExts.includes(ext)) {
      return true;
    }
    if (mimeType && mimeType.startsWith('image/')) {
      return true;
    }
    return false;
  }

  public static suportaMidiaVisual(provedorIa?: string | null): boolean {
    const capacidade = obterCapacidadeMedia(provedorIa || 'GEMINI');
    return capacidade ? capacidade.suportaImagens : false;
  }

  constructor(apiKey?: string, model: string = 'gemini-3.8-flash') {
    this.apiKey = apiKey || env.GEMINI_API_KEY;
    this.model = model;
    this.universalParser = new UniversalStatementParser();
  }

  public async extrairTransacoes(params: {
    nomeArquivo: string;
    mimeType?: string | null;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    usuarioId?: string;
    provedorIa?: string;
    modeloIa?: string;
    loteId?: string;
    arquivoId?: string;
    /** TASK-50: handoff do id do log criado em `uso_ia_logs`. */
    aoRegistrarUsoIa?: (usoIaLogId: string | null) => void;
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
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

      // Se for CSV estruturado válido porém sem lançamentos (ex: somente cabeçalho), retorna array vazio
      if (ext === '.csv' || ext === '.json' || ext === '.ofx') {
        const texto = textoProcessado || conteudoBuffer.toString('utf-8');
        const linhas = texto.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (linhas.length <= 1) {
          return [];
        }
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

    // 2.1. Se for extrato Santander em PDF com formatação reconhecida pelo parser especializado
    if (isPdf && textoProcessado && SantanderStatementPdfParser.isSantanderStatement(textoProcessado)) {
      const transacoesSantander = SantanderStatementPdfParser.parse(textoProcessado, {
        dataReferencia: contexto.dataReferencia,
        categorias: contexto.categorias,
        nomeTitular: contexto.nomeTitular,
      });
      if (transacoesSantander.length > 0) {
        return transacoesSantander;
      }
    }

    // 3. Se for fatura em PDF com consumo zero explícito (ex: Mercado Pago R$ 0,00)
    if (isPdf && textoProcessado) {
      const isFaturaZerada =
        /voc[eê]\s+n[aã]o\s+consumiu\s+nada/i.test(textoProcessado) ||
        /total\s+(a\s+pagar|da\s+fatura)[\s\S]{0,50}r\$\s*0[,.]00/i.test(textoProcessado) ||
        /n[aã]o\s+h[aá]\s+gastos\s+pendentes/i.test(textoProcessado);
      if (isFaturaZerada) {
        return [];
      }
    }

    // 4. Rigor Exclusivo da IA para documentos complexos / não-estruturados (PDFs, imagens, textos livres):
    // Se o usuário especificou um provedor ou se precisa de chave do usuário no banco:
    let apiKeyEfetiva: string | undefined = undefined;
    let modeloEfetivo = params.modeloIa || this.model;
    let provedorEfetivo = params.provedorIa;

    if (params.usuarioId) {
      const configUsuario = params.provedorIa
        ? await prisma.configuracaoIaUsuario.findUnique({
            where: {
              usuarioId_provedor: {
                usuarioId: params.usuarioId,
                provedor: params.provedorIa,
              },
            },
          })
        : await prisma.configuracaoIaUsuario.findFirst({
            where: { usuarioId: params.usuarioId },
            orderBy: { atualizadoEm: 'desc' },
          });

      if (configUsuario) {
        try {
          apiKeyEfetiva = CryptoService.decrypt({
            ciphertext: configUsuario.apiKeyCifrada,
            iv: configUsuario.ivHex,
            tag: configUsuario.tagHex,
          });
          modeloEfetivo = params.modeloIa || configUsuario.modelo || modeloEfetivo;
          provedorEfetivo = configUsuario.provedor;
        } catch (err) {
          console.error('[GeminiIaExtratorClient] Erro ao decifrar chave do usuário:', err);
        }
      }
    }

    // Se ainda não tiver provedor definido pelo usuário ou banco, o padrão do sistema é GEMINI
    if (!provedorEfetivo) {
      provedorEfetivo = 'GEMINI';
    }

    provedorEfetivo = provedorEfetivo.trim().toUpperCase();

    // Provedores sem implementação neste fluxo (OPENAI/ANTHROPIC) NÃO devem cair
    // silenciosamente no Gemini — erro explícito e acionável.
    if (!provedorSuportadoNoFluxo(provedorEfetivo)) {
      throw new Error(mensagemProvedorNaoSuportado(provedorEfetivo));
    }

    // Auto-sanitização: Se o modelo solicitado ou recuperado do perfil for o descontinuado gemini-2.5-flash, atualiza para gemini-3.8-flash
    if (provedorEfetivo === 'GEMINI' && modeloEfetivo === 'gemini-2.5-flash') {
      modeloEfetivo = 'gemini-3.8-flash';
    }

    // Modelo do OpenRouter normalizado (exige o formato `vendor/model`).
    if (provedorEfetivo === 'OPENROUTER') {
      modeloEfetivo = normalizarModeloOpenRouter(modeloEfetivo);
    }

    // NUNCA fazer fallback para chave de GEMINI se o provedor for DEEPSEEK ou outro provedor selecionado!
    if (!apiKeyEfetiva && provedorEfetivo === 'GEMINI' && !params.provedorIa) {
      apiKeyEfetiva = this.apiKey;
    } else if (!apiKeyEfetiva && params.provedorIa === 'GEMINI') {
      apiKeyEfetiva = this.apiKey;
    } else if (!apiKeyEfetiva && provedorEfetivo === 'OPENROUTER') {
      // Paridade com GEMINI_API_KEY: chave de servidor (OPENROUTER_API_KEY) como fallback.
      apiKeyEfetiva = obterConfigOpenRouter().apiKeyServidor || undefined;
    }

    if (!apiKeyEfetiva) {
      throw new Error(
        `A IA não conseguiu processar este documento. Verifique se a chave de IA para o provedor ${provedorEfetivo} está devidamente cadastrada e ativa no seu perfil.`
      );
    }

    // 4.1. Validação de Compatibilidade de Mídia:
    // Se for arquivo visual (imagem) e o modelo não for multimodal (ex: DeepSeek), interrompe sem enviar bytes brutos
    if (GeminiIaExtratorClient.isArquivoVisual(nomeArquivo, mimeType) && !GeminiIaExtratorClient.suportaMidiaVisual(provedorEfetivo)) {
      throw new Error(
        `Arquivo não processado: O modelo selecionado (${provedorEfetivo}) não oferece suporte a imagens (.jpg/.png). Reprocesse individualmente selecionando o Google Gemini.`
      );
    }

    // Se temos apiKey, tentamos chamada de IA para o provedor selecionado.
    // TASK-49: toda chamada de IA gera EXATAMENTE 1 registro em `uso_ia_logs`
    // (sucesso ou falha). Qualquer erro de telemetria é engolido internamente
    // pelo UsoIaService, nunca interrompendo a importação.
    const chamada: () => Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> =
      provedorEfetivo === 'DEEPSEEK'
        ? () =>
            this.chamarDeepSeekApi(
              nomeArquivo,
              conteudoBuffer,
              contexto,
              textoProcessado,
              apiKeyEfetiva,
              modeloEfetivo
            )
        : provedorEfetivo === 'OPENROUTER'
          ? () =>
              this.chamarOpenRouterApi(
                nomeArquivo,
                mimeType,
                conteudoBuffer,
                contexto,
                textoProcessado,
                apiKeyEfetiva,
                modeloEfetivo
              )
          : () =>
              this.chamarGeminiApi(
                nomeArquivo,
                mimeType,
                conteudoBuffer,
                contexto,
                textoProcessado,
                apiKeyEfetiva,
                modeloEfetivo
              );

    try {
      const resultado = await UsoIaService.registrarChamada({
        usuarioId: params.usuarioId,
        funcionalidade: 'EXTRACAO_EXTRATO',
        provedor: provedorEfetivo,
        modelo: modeloEfetivo,
        loteId: params.loteId,
        arquivoId: params.arquivoId,
        execucao: chamada,
        extrairTokens: (r) => r.tokens,
        // TASK-50: handoff explícito do id do log para a tentativa do arquivo.
        aoRegistrar: (logId) => params.aoRegistrarUsoIa?.(logId),
      });

      return resultado.transacoes;
    } catch (err: unknown) {
      const detalhe = err instanceof Error ? err.message : String(err);
      console.error(
        `[GeminiIaExtratorClient] Falha na extração por IA (${provedorEfetivo}) para "${nomeArquivo}": ${detalhe}`
      );
      // NUNCA fazer fallback heurístico cego para documentos complexos/não estruturados.
      throw new Error(`A IA (${provedorEfetivo}) não conseguiu processar este documento. Motivo: ${detalhe}`);
    }
  }

  private async chamarDeepSeekApi(
    nomeArquivo: string,
    conteudoBuffer: Buffer,
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    },
    textoProcessado?: string,
    apiKeyOverride?: string,
    modelOverride?: string
  ): Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> {
    const key = apiKeyOverride || this.apiKey;
    const mod = modelOverride || 'deepseek-chat';
    const url = 'https://api.deepseek.com/chat/completions';

    const texto = textoProcessado || conteudoBuffer.toString('utf-8');
    if (!texto || texto.trim().length === 0) {
      throw new Error('Não foi possível extrair texto legível deste documento para enviar ao DeepSeek.');
    }

    const titularInfo = contexto.nomeTitular ? `Nome do titular da conta: "${contexto.nomeTitular}".` : '';

    const contasFormatadas = contexto.contas
      .map((c) => {
        let det = `- "${c.nome}" (Tipo: ${c.tipo}`;
        if (c.agencia) det += `, Agência: ${c.agencia}`;
        if (c.numeroConta) det += `, Conta: ${c.numeroConta}`;
        det += ')';
        return det;
      })
      .join('\n') || '(Nenhuma cadastrada)';

    const promptSistema = `Você é o extrator inteligente e especialista financeiro do sistema Evolvi.
Sua missão é extrair rigorosamente TODAS as transações financeiras (despesas, receitas, faturas, pagamentos, transferências) contidas no documento ou extrato anexo.
${titularInfo}

DIRETRIZES FUNDAMENTAIS:
1. Extração Exaustiva: Não omita nenhuma linha ou lançamento financeiro real. Cada compra, débito, crédito ou movimentação deve gerar um item no array "transacoes".
2. Anti-dupla contagem e Mesma Titularidade:
   - Se for pagamento de fatura de cartão de crédito em extrato bancário de conta corrente (ex: "PAGTO FATURA", "PGTO CARTAO", "PAGAMENTO DE FATURA"): defina "natureza" = "TRANSFERENCIA_PROPRIA" e "isPagamentoFatura" = true.
   - LINHAS INFORMATIVAS DE PAGAMENTO EM FATURA DE CARTÃO (BUG-13): Em faturas de cartão de crédito, linhas como "PAGAMENTO RECEBIDO", "CRÉDITO DE PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO" são compensações informativas da fatura e NÃO geram movimentação de caixa (pois o débito ocorre na conta corrente). Defina "natureza" = "TRANSFERENCIA_PROPRIA", "isPagamentoFatura" = true e "observacao" = "Informativo de quitação em fatura de cartão".
   - Créditos de salário ou proventos de empresa (ex: "TED CONTA SALARIO", "CRED SALARIO", "PLR", "REMUNERACAO", "FOLHA DE PAGAMENTO", "BONUS SALARIAL") são SEMPRE RECEITA operacional, mesmo quando o nome do titular constar na linha como favorecido/remetente da conta salário.
   - Se for transferência entre contas correntes/poupança, PIX ou TED cujo remetente/pagador for o próprio titular${contexto.nomeTitular ? ` (ex: "${contexto.nomeTitular}")` : ''} (exceto folha de pagamento/conta salário/PLR), ou se for resgate de aplicação/investimento próprio (ex: "RESGATE DE CDB", "RESGATE POUPANCA", "RESGATE INVESTIMENTO"): defina categoricamente "natureza" = "TRANSFERENCIA_PROPRIA" (NUNCA classifique como RECEITA!).
   - Para aplicações financeiras, aportes, investimentos e compras de ativos (ex: "APLICAÇÃO", "APLICACAO", "CDB", "RDB", "LCI", "LCA", "TESOURO DIRETO", "DEPOSITO POUPANCA", "COMPRA ACOES", "INVESTIMENTO"): defina categoricamente "natureza" = "APORTE_PATRIMONIAL" (NUNCA classifique como DESPESA!).
   - Para compras ou despesas normais: "natureza" = "DESPESA".
   - Para salários, PLR, rendimentos de aplicações, transferências recebidas de terceiros: "natureza" = "RECEITA".
3. Formato da Data e Regra de Ouro para Cartões:
   - Formato estrito: "YYYY-MM-DD". Se o documento trouxer apenas DD/MM ou DD/MM/AAAA, converta para YYYY-MM-DD usando o ano de referência ("${contexto.dataReferencia.substring(0, 4)}").
   - REGRA PARA FATURAS DE CARTÃO DE CRÉDITO:
     * Para COMPRAS À VISTA (sem parcelas) ocorridas no ciclo recente da fatura: a "dataMovimento" DEVE ser a data exata da transação (compra).
     * Para COMPRAS PARCELADAS (ex: "Parcela 2/10", "01/03", "5 de 6"): a exigibilidade financeira e o débito desta parcela ocorrem na fatura atual. Portanto, a "dataMovimento" deve ser atribuída ao mês e ano da fatura (usando o dia de fechamento/vencimento ou dataReferencia "${contexto.dataReferencia}"), preservando a data da compra original no texto da descrição/observação. NUNCA aloque uma parcela cobrada na fatura atual para um mês ou ano anterior!
4. Formato de Valor: número decimal estritamente positivo (ponto como separador, ex: 125.50). Desconsidere ou não inclua linhas informativas com valor R$ 0,00 ou cupons de 100% de desconto.
5. Parcelamento: Se houver indicação de parcela (ex: "01/03", "3/10", "parcela 2 de 5"), preencha "parcelaAtual" e "totalParcelas".
6. Contas disponíveis do usuário:
${contasFormatadas}
Se o documento for de uma instituição específica (ex: Santander, Nubank, Itaú, Inter, C6), sugira a conta em "contaSugerida" e o tipo ("CARTAO_CREDITO" ou "CONTA_CORRENTE") em "tipoConta". Correlacione número da conta ou agência quando disponíveis.
Identificação precisa da conta/cartão (BUG-16):
- Se for extrato de conta corrente e houver número da conta/agência legível no cabeçalho ou metadados, extraia apenas os dígitos em "numeroConta" (ex: "010830489" ou "24220973" ou "123456").
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
7. Categorias disponíveis (POF):
${contexto.categorias.map((c) => `- "${c.nome}"`).join('\n') || '(Nenhuma cadastrada)'}
Preencha "categoriaSugerida" com a categoria mais aderente.
8. Código Identificador da Transação (idOrigem):
- Se o extrato/fatura apresentar código de transação, identificador único, "Nº Documento", "Documento", "NSU", "ID Transação" ou código de autenticação correspondente ao lançamento, extraia esse valor no campo "idOrigem". Isso é crucial para diferenciar e rastrear lançamentos únicos! Se não houver, preencha null.

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
      "numeroConta": "string ou null",
      "digitosCartao": "string ou null",
      "categoriaSugerida": "string ou null",
      "parcelaAtual": number ou null,
      "totalParcelas": number ou null,
      "idOrigem": "string ou null",
      "isPagamentoFatura": boolean,
      "observacao": "string ou null",
      "confianca": number
    }
  ]
}`;

    const body = {
      model: mod,
      messages: [
        { role: 'system', content: promptSistema },
        {
          role: 'user',
          content: `Documento a analisar ("${nomeArquivo}"):\n"""\n${texto}\n"""`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 8192,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro na API DeepSeek (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawText = data.choices?.[0]?.message?.content;
    if (!rawText) {
      throw new Error('A resposta do DeepSeek não continha texto de saída.');
    }
    // TASK-49: contagem real de tokens devolvida pelo provedor (usage)
    const tokens = tokensDeUsageOpenAi(data.usage);

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      // Se a resposta foi truncada perto do final do JSON, recuperamos todos os objetos completos de transacoes
      const matches = Array.from(rawText.matchAll(/\{[^{}]*"dataMovimento"[^{}]*\}/g));
      if (matches.length > 0) {
        const transacoesRecuperadas: any[] = [];
        for (const m of matches as RegExpMatchArray[]) {
          try {
            transacoesRecuperadas.push(JSON.parse(m[0]));
          } catch {
            // Ignora fragmento
          }
        }
        if (transacoesRecuperadas.length > 0) {
          parsedJson = { transacoes: transacoesRecuperadas };
        }
      }
      if (!parsedJson) {
        throw new Error(`A resposta do DeepSeek gerou JSON incompleto ou inválido: ${rawText.slice(-100)}`);
      }
    }
    const lista = Array.isArray(parsedJson) ? parsedJson : parsedJson.transacoes || [];

    const transacoes = lista
      .map((t: any) => ({
        dataMovimento: t.dataMovimento || contexto.dataReferencia,
        descricao: String(t.descricao || 'Lançamento extraído'),
        valor: Math.abs(Number(t.valor) || 0),
        natureza: t.natureza || 'DESPESA',
        contaSugerida: t.contaSugerida || null,
        tipoConta: t.tipoConta || null,
        categoriaSugerida: t.categoriaSugerida || null,
        parcelaAtual: t.parcelaAtual ? Number(t.parcelaAtual) : null,
        totalParcelas: t.totalParcelas ? Number(t.totalParcelas) : null,
        idOrigem: t.idOrigem ? String(t.idOrigem) : null,
        isPagamentoFatura: Boolean(t.isPagamentoFatura),
        observacao: t.observacao || null,
        confianca: Number(t.confianca ?? 0.95),
      }))
      .filter((t: LancamentoConsolidadoIa) => t.valor > 0);

    return { transacoes, tokens };
  }

  private async chamarOpenRouterApi(
    nomeArquivo: string,
    mimeType: string | null | undefined,
    conteudoBuffer: Buffer,
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    },
    textoProcessado?: string,
    apiKeyOverride?: string,
    modelOverride?: string
  ): Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> {
    // API compatível com OpenAI (chat completions). URL base e headers de
    // atribuição vêm de `openrouter.config.ts` (OPENROUTER_BASE_URL/HTTP_REFERER/X_TITLE).
    const key = apiKeyOverride || this.apiKey;
    const mod = normalizarModeloOpenRouter(modelOverride || MODELO_OPENROUTER_PADRAO);
    const url = montarUrlOpenRouter('/chat/completions');

    const effectiveMime = mimeType || this.inferirMimeType(nomeArquivo);
    const capacidade = obterCapacidadeMedia('OPENROUTER');

    const isImagem = GeminiIaExtratorClient.isArquivoVisual(nomeArquivo, mimeType);
    const isPdf =
      effectiveMime.includes('pdf') ||
      nomeArquivo.toLowerCase().endsWith('.pdf') ||
      conteudoBuffer.subarray(0, 5).toString('latin1') === '%PDF-';

    // Texto legível disponível (extraído previamente ou conteúdo textual de fato).
    const textoLegivel = textoProcessado && textoProcessado.trim().length > 0 ? textoProcessado : null;

    // PDF sem texto extraído ⇒ binário NÃO pode ser enviado como texto UTF-8.
    if (isPdf && !textoLegivel && !capacidade?.suportaPdfsNaoEstruturados) {
      throw new Error(
        'Este PDF não possui texto legível e o provedor OPENROUTER está configurado sem suporte a PDFs não estruturados. Reprocesse selecionando o Google Gemini.'
      );
    }

    if (!isImagem && !isPdf && !textoLegivel) {
      const bruto = conteudoBuffer.toString('utf-8').trim();
      if (bruto.length === 0 || bruto.includes('\uFFFD')) {
        throw new Error('Não foi possível extrair texto legível deste documento para enviar ao OpenRouter.');
      }
    }

    // Conteúdo binário (imagem/PDF não estruturado) nunca é enviado como string UTF-8.
    const conteudoBinario = isImagem || (isPdf && !textoLegivel);
    const texto = textoLegivel || (conteudoBinario ? null : conteudoBuffer.toString('utf-8'));

    const titularInfo = contexto.nomeTitular ? `Nome do titular da conta: "${contexto.nomeTitular}".` : '';

    const contasFormatadas = contexto.contas
      .map((c) => {
        let det = `- "${c.nome}" (Tipo: ${c.tipo}`;
        if (c.agencia) det += `, Agência: ${c.agencia}`;
        if (c.numeroConta) det += `, Conta: ${c.numeroConta}`;
        det += ')';
        return det;
      })
      .join('\n') || '(Nenhuma cadastrada)';

    const promptSistema = `Você é o extrator inteligente e especialista financeiro do sistema Evolvi.
Sua missão é extrair rigorosamente TODAS as transações financeiras (despesas, receitas, faturas, pagamentos, transferências) contidas no documento ou extrato anexo.
${titularInfo}

DIRETRIZES FUNDAMENTAIS:
1. Extração Exaustiva: Não omita nenhuma linha ou lançamento financeiro real. Cada compra, débito, crédito ou movimentação deve gerar um item no array "transacoes".
2. Anti-dupla contagem e Mesma Titularidade:
   - Se for pagamento de fatura de cartão de crédito em extrato bancário de conta corrente (ex: "PAGTO FATURA", "PGTO CARTAO", "PAGAMENTO DE FATURA"): defina "natureza" = "TRANSFERENCIA_PROPRIA" e "isPagamentoFatura" = true.
   - LINHAS INFORMATIVAS DE PAGAMENTO EM FATURA DE CARTÃO (BUG-13): Em faturas de cartão de crédito, linhas como "PAGAMENTO RECEBIDO", "CRÉDITO DE PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO" são compensações informativas da fatura e NÃO geram movimentação de caixa (pois o débito ocorre na conta corrente). Defina "natureza" = "TRANSFERENCIA_PROPRIA", "isPagamentoFatura" = true e "observacao" = "Informativo de quitação em fatura de cartão".
   - Créditos de salário ou proventos de empresa (ex: "TED CONTA SALARIO", "CRED SALARIO", "PLR", "REMUNERACAO", "FOLHA DE PAGAMENTO", "BONUS SALARIAL") são SEMPRE RECEITA operacional, mesmo quando o nome do titular constar na linha como favorecido/remetente da conta salário.
   - Se for transferência entre contas correntes/poupança, PIX ou TED cujo remetente/pagador for o próprio titular${contexto.nomeTitular ? ` (ex: "${contexto.nomeTitular}")` : ''} (exceto folha de pagamento/conta salário/PLR), ou se for resgate de aplicação/investimento próprio (ex: "RESGATE DE CDB", "RESGATE POUPANCA", "RESGATE INVESTIMENTO"): defina categoricamente "natureza" = "TRANSFERENCIA_PROPRIA" (NUNCA classifique como RECEITA!).
   - Para aplicações financeiras, aportes, investimentos e compras de ativos (ex: "APLICAÇÃO", "APLICACAO", "CDB", "RDB", "LCI", "LCA", "TESOURO DIRETO", "DEPOSITO POUPANCA", "COMPRA ACOES", "INVESTIMENTO"): defina categoricamente "natureza" = "APORTE_PATRIMONIAL" (NUNCA classifique como DESPESA!).
   - Para compras ou despesas normais: "natureza" = "DESPESA".
   - Para salários, PLR, rendimentos de aplicações, transferências recebidas de terceiros: "natureza" = "RECEITA".
3. Formato da Data e Regra de Ouro para Cartões:
   - Formato estrito: "YYYY-MM-DD". Se o documento trouxer apenas DD/MM ou DD/MM/AAAA, converta para YYYY-MM-DD usando o ano de referência ("${contexto.dataReferencia.substring(0, 4)}").
   - REGRA PARA FATURAS DE CARTÃO DE CRÉDITO:
     * Para COMPRAS À VISTA (sem parcelas) ocorridas no ciclo recente da fatura: a "dataMovimento" DEVE ser a data exata da transação (compra).
     * Para COMPRAS PARCELADAS (ex: "Parcela 2/10", "01/03", "5 de 6"): a exigibilidade financeira e o débito desta parcela ocorrem na fatura atual. Portanto, a "dataMovimento" deve ser atribuída ao mês e ano da fatura (usando o dia de fechamento/vencimento ou dataReferencia "${contexto.dataReferencia}"), preservando a data da compra original no texto da descrição/observação. NUNCA aloque uma parcela cobrada na fatura atual para um mês ou ano anterior!
4. Formato de Valor: número decimal estritamente positivo (ponto como separador, ex: 125.50). Desconsidere ou não inclua linhas informativas com valor R$ 0,00 ou cupons de 100% de desconto.
5. Parcelamento: Se houver indicação de parcela (ex: "01/03", "3/10", "parcela 2 de 5"), preencha "parcelaAtual" e "totalParcelas".
6. Contas disponíveis do usuário:
${contasFormatadas}
Se o documento for de uma instituição específica (ex: Santander, Nubank, Itaú, Inter, C6), sugira a conta em "contaSugerida" e o tipo ("CARTAO_CREDITO" ou "CONTA_CORRENTE") em "tipoConta". Correlacione número da conta ou agência quando disponíveis.
Identificação precisa da conta/cartão (BUG-16):
- Se for extrato de conta corrente e houver número da conta/agência legível no cabeçalho ou metadados, extraia apenas os dígitos em "numeroConta" (ex: "010830489" ou "24220973" ou "123456").
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
7. Categorias disponíveis (POF):
${contexto.categorias.map((c) => `- "${c.nome}"`).join('\n') || '(Nenhuma cadastrada)'}
Preencha "categoriaSugerida" com a categoria mais aderente.
8. Código Identificador da Transação (idOrigem):
- Se o extrato/fatura apresentar código de transação, identificador único, "Nº Documento", "Documento", "NSU", "ID Transação" ou código de autenticação correspondente ao lançamento, extraia esse valor no campo "idOrigem". Isso é crucial para diferenciar e rastrear lançamentos únicos! Se não houver, preencha null.

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
      "numeroConta": "string ou null",
      "digitosCartao": "string ou null",
      "categoriaSugerida": "string ou null",
      "parcelaAtual": number ou null,
      "totalParcelas": number ou null,
      "idOrigem": "string ou null",
      "isPagamentoFatura": boolean,
      "observacao": "string ou null",
      "confianca": number
    }
  ]
}`;

    // Conteúdo da mensagem do usuário (formato OpenAI-compatible).
    // Texto puro ⇒ string; imagem/PDF não estruturado ⇒ array multimodal com
    // `image_url` (data URL base64) ou `file` (data URL base64 application/pdf).
    const base64 = conteudoBuffer.toString('base64');
    let conteudoUsuario: any;

    if (isImagem) {
      const mimeImagem = mimeType && mimeType.startsWith('image/') ? mimeType : effectiveMime;
      conteudoUsuario = [
        {
          type: 'text',
          text: `${promptSistema}\n\nDocumento a analisar ("${nomeArquivo}"): analise a imagem anexa.`,
        },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeImagem};base64,${base64}` },
        },
      ];
    } else if (isPdf && !textoLegivel) {
      // OpenRouter suporta PDFs em base64 via content type `file` (parse nativo ou OCR interno).
      conteudoUsuario = [
        {
          type: 'text',
          text: `${promptSistema}\n\nDocumento a analisar ("${nomeArquivo}"): analise o PDF anexo.`,
        },
        {
          type: 'file',
          file: {
            filename: nomeArquivo,
            file_data: `data:application/pdf;base64,${base64}`,
          },
        },
      ];
    } else {
      conteudoUsuario = `Documento a analisar ("${nomeArquivo}"):\n"""\n${texto}\n"""`;
    }

    const body = {
      model: mod,
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: conteudoUsuario },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 8192,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: montarHeadersOpenRouter(key),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro na API OpenRouter (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawText = data.choices?.[0]?.message?.content;
    if (!rawText) {
      throw new Error('A resposta do OpenRouter não continha texto de saída.');
    }
    // TASK-49: contagem real de tokens devolvida pelo provedor (usage)
    const tokens = tokensDeUsageOpenAi(data.usage);

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      const matches = Array.from(rawText.matchAll(/\{[^{}]*"dataMovimento"[^{}]*\}/g));
      if (matches.length > 0) {
        const transacoesRecuperadas: any[] = [];
        for (const m of matches as RegExpMatchArray[]) {
          try {
            transacoesRecuperadas.push(JSON.parse(m[0]));
          } catch {
            // Ignora fragmento
          }
        }
        if (transacoesRecuperadas.length > 0) {
          parsedJson = { transacoes: transacoesRecuperadas };
        }
      }
      if (!parsedJson) {
        throw new Error(`A resposta do OpenRouter gerou JSON incompleto ou inválido: ${rawText.slice(-100)}`);
      }
    }
    const lista = Array.isArray(parsedJson) ? parsedJson : parsedJson.transacoes || [];

    const transacoes = lista
      .map((t: any) => ({
        dataMovimento: t.dataMovimento || contexto.dataReferencia,
        descricao: String(t.descricao || 'Lançamento extraído'),
        valor: Math.abs(Number(t.valor) || 0),
        natureza: t.natureza || 'DESPESA',
        contaSugerida: t.contaSugerida || null,
        tipoConta: t.tipoConta || null,
        categoriaSugerida: t.categoriaSugerida || null,
        parcelaAtual: t.parcelaAtual ? Number(t.parcelaAtual) : null,
        totalParcelas: t.totalParcelas ? Number(t.totalParcelas) : null,
        idOrigem: t.idOrigem ? String(t.idOrigem) : null,
        isPagamentoFatura: Boolean(t.isPagamentoFatura),
        observacao: t.observacao || null,
        confianca: Number(t.confianca ?? 0.95),
      }))
      .filter((t: LancamentoConsolidadoIa) => t.valor > 0);

    return { transacoes, tokens };
  }

  private async chamarGeminiApi(
    nomeArquivo: string,
    mimeType: string | null | undefined,
    conteudoBuffer: Buffer,
    contexto: {
      contas: { id: string; nome: string; tipo: string; numeroConta?: string | null; agencia?: string | null }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    },
    textoProcessado?: string,
    apiKeyOverride?: string,
    modelOverride?: string
  ): Promise<{ transacoes: LancamentoConsolidadoIa[]; tokens: TokensIa }> {
    const key = apiKeyOverride || this.apiKey;
    const mod = modelOverride || this.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${key}`;

    const titularInfo = contexto.nomeTitular ? `Nome do titular da conta: "${contexto.nomeTitular}".` : '';

    const contasFormatadas = contexto.contas
      .map((c) => {
        let det = `- "${c.nome}" (Tipo: ${c.tipo}`;
        if (c.agencia) det += `, Agência: ${c.agencia}`;
        if (c.numeroConta) det += `, Conta: ${c.numeroConta}`;
        det += ')';
        return det;
      })
      .join('\n') || '(Nenhuma cadastrada)';

    const promptSistema = `Você é o extrator inteligente e especialista financeiro do sistema Evolvi.
Sua missão é extrair rigorosamente TODAS as transações financeiras (despesas, receitas, faturas, pagamentos, transferências) contidas no documento ou extrato anexo.
${titularInfo}

DIRETRIZES FUNDAMENTAIS:
1. Extração Exaustiva: Não omita nenhuma linha ou lançamento financeiro real. Cada compra, débito, crédito ou movimentação deve gerar um item no array "transacoes".
2. Anti-dupla contagem e Mesma Titularidade:
   - Se for pagamento de fatura de cartão de crédito em extrato bancário de conta corrente (ex: "PAGTO FATURA", "PGTO CARTAO", "PAGAMENTO DE FATURA"): defina "natureza" = "TRANSFERENCIA_PROPRIA" e "isPagamentoFatura" = true.
   - LINHAS INFORMATIVAS DE PAGAMENTO EM FATURA DE CARTÃO (BUG-13): Em faturas de cartão de crédito, linhas como "PAGAMENTO RECEBIDO", "CRÉDITO DE PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO" são compensações informativas da fatura e NÃO geram movimentação de caixa (pois o débito ocorre na conta corrente). Defina "natureza" = "TRANSFERENCIA_PROPRIA", "isPagamentoFatura" = true e "observacao" = "Informativo de quitação em fatura de cartão".
   - Créditos de salário ou proventos de empresa (ex: "TED CONTA SALARIO", "CRED SALARIO", "PLR", "REMUNERACAO", "FOLHA DE PAGAMENTO", "BONUS SALARIAL") são SEMPRE RECEITA operacional, mesmo quando o nome do titular constar na linha como favorecido/remetente da conta salário.
   - Se for transferência entre contas correntes/poupança, PIX ou TED cujo remetente/pagador for o próprio titular${contexto.nomeTitular ? ` (ex: "${contexto.nomeTitular}")` : ''} (exceto folha de pagamento/conta salário/PLR), ou se for resgate de aplicação/investimento próprio (ex: "RESGATE DE CDB", "RESGATE POUPANCA", "RESGATE INVESTIMENTO"): defina categoricamente "natureza" = "TRANSFERENCIA_PROPRIA" (NUNCA classifique como RECEITA!).
   - Para aplicações financeiras, aportes, investimentos e compras de ativos (ex: "APLICAÇÃO", "APLICACAO", "CDB", "RDB", "LCI", "LCA", "TESOURO DIRETO", "DEPOSITO POUPANCA", "COMPRA ACOES", "INVESTIMENTO"): defina categoricamente "natureza" = "APORTE_PATRIMONIAL" (NUNCA classifique como DESPESA!).
   - Para compras ou despesas normais: "natureza" = "DESPESA".
   - Para salários, PLR, rendimentos de aplicações, transferências recebidas de terceiros: "natureza" = "RECEITA".
3. Formato da Data e Regra de Ouro para Cartões:
   - Formato estrito: "YYYY-MM-DD". Se o documento trouxer apenas DD/MM ou DD/MM/AAAA, converta para YYYY-MM-DD usando o ano de referência ("${contexto.dataReferencia.substring(0, 4)}").
   - REGRA PARA FATURAS DE CARTÃO DE CRÉDITO:
     * Para COMPRAS À VISTA (sem parcelas) ocorridas no ciclo recente da fatura: a "dataMovimento" DEVE ser a data exata da transação (compra).
     * Para COMPRAS PARCELADAS (ex: "Parcela 2/10", "01/03", "5 de 6"): a exigibilidade financeira e o débito desta parcela ocorrem na fatura atual. Portanto, a "dataMovimento" deve ser atribuída ao mês e ano da fatura (usando o dia de fechamento/vencimento ou dataReferencia "${contexto.dataReferencia}"), preservando a data da compra original no texto da descrição/observação. NUNCA aloque uma parcela cobrada na fatura atual para um mês ou ano anterior!
4. Formato de Valor: número decimal estritamente positivo (ponto como separador, ex: 125.50). Desconsidere ou não inclua linhas informativas com valor R$ 0,00 ou cupons de 100% de desconto.
5. Parcelamento: Se houver indicação de parcela (ex: "01/03", "3/10", "parcela 2 de 5"), preencha "parcelaAtual" e "totalParcelas".
6. Contas disponíveis do usuário:
${contasFormatadas}
Se o documento for de uma instituição específica (ex: Santander, Nubank, Itaú, Inter, C6), sugira a conta em "contaSugerida" e o tipo ("CARTAO_CREDITO" ou "CONTA_CORRENTE") em "tipoConta". Correlacione número da conta ou agência quando disponíveis.
Identificação precisa da conta/cartão (BUG-16):
- Se for extrato de conta corrente e houver número da conta/agência legível no cabeçalho ou metadados, extraia apenas os dígitos em "numeroConta" (ex: "010830489" ou "24220973" ou "123456").
- Se for fatura de cartão de crédito e houver indicação do final do cartão/dígitos (ex: "Final 2458", "Cartão 7936"), extraia os últimos dígitos (normalmente 4 dígitos) em "digitosCartao".
7. Categorias disponíveis (POF):
${contexto.categorias.map((c) => `- "${c.nome}"`).join('\n') || '(Nenhuma cadastrada)'}
Preencha "categoriaSugerida" com a categoria mais aderente.
8. Código Identificador da Transação (idOrigem):
- Se o extrato/fatura apresentar código de transação, identificador único, "Nº Documento", "Documento", "NSU", "ID Transação" ou código de autenticação correspondente ao lançamento, extraia esse valor no campo "idOrigem". Isso é crucial para diferenciar e rastrear lançamentos únicos! Se não houver, preencha null.

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
      "numeroConta": "string ou null",
      "digitosCartao": "string ou null",
      "categoriaSugerida": "string ou null",
      "parcelaAtual": number ou null,
      "totalParcelas": number ou null,
      "idOrigem": "string ou null",
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

    // TASK-49: contagem real de tokens devolvida pelo Gemini (usageMetadata)
    const tokens = tokensDeUsageGemini(data.usageMetadata);

    const parsedJson = JSON.parse(rawText);
    const lista = Array.isArray(parsedJson) ? parsedJson : parsedJson.transacoes || [];

    const transacoes = lista
      .map((t: any) => ({
        dataMovimento: t.dataMovimento || contexto.dataReferencia,
        descricao: String(t.descricao || 'Lançamento extraído'),
        valor: Math.abs(Number(t.valor) || 0),
        natureza: t.natureza || 'DESPESA',
        contaSugerida: t.contaSugerida || null,
        tipoConta: t.tipoConta || null,
        categoriaSugerida: t.categoriaSugerida || null,
        parcelaAtual: t.parcelaAtual ? Number(t.parcelaAtual) : null,
        totalParcelas: t.totalParcelas ? Number(t.totalParcelas) : null,
        idOrigem: t.idOrigem ? String(t.idOrigem) : null,
        isPagamentoFatura: Boolean(t.isPagamentoFatura),
        observacao: t.observacao || null,
        confianca: Number(t.confianca ?? 0.95),
      }))
      .filter((t: LancamentoConsolidadoIa) => t.valor > 0);

    return { transacoes, tokens };
  }

  public extrairLocalDeterministic(params: {
    nomeArquivo: string;
    conteudoBuffer: Buffer;
    conteudoTexto?: string;
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
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

    // 1.1. Tentar parser especializado para Extrato Santander
    if (SantanderStatementPdfParser.isSantanderStatement(texto)) {
      const transacoesSantander = SantanderStatementPdfParser.parse(texto, {
        dataReferencia: contexto.dataReferencia,
        categorias: contexto.categorias,
        nomeTitular: contexto.nomeTitular,
      });
      if (transacoesSantander.length > 0) {
        return transacoesSantander;
      }
    }

    // 2. Tentar parser universal (OFX, CSV, JSON)
    if (ext === '.ofx' || ext === '.csv' || ext === '.json' || texto.includes('<OFX>') || texto.includes(';')) {
      const parseRes = this.universalParser.parse(texto, nomeArquivo);
      if (parseRes.transacoes.length > 0) {
        return parseRes.transacoes.map((t) => {
          let natureza: 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL' = (t.natureza as any) || 'DESPESA';
          const descLower = t.descricao.toLowerCase();
          const nomeTitular = contexto.nomeTitular;
          let isTransferenciaPropriaTitular = false;
          if (nomeTitular) {
            const partesNome = nomeTitular
              .trim()
              .split(/\s+/)
              .filter((p) => p.length >= 3);
            const containsNomeCompleto = t.descricao.toUpperCase().includes(nomeTitular.toUpperCase());
            const containsPartesSignificativas =
              partesNome.length >= 2 &&
              partesNome.every((p) => t.descricao.toUpperCase().includes(p.toUpperCase()));

            if (containsNomeCompleto || containsPartesSignificativas) {
              isTransferenciaPropriaTitular = true;
            }
          }

          if (t.isPagamentoFatura || descLower.includes('fatura') || descLower.includes('pagamento do cartao')) {
            natureza = 'TRANSFERENCIA_PROPRIA';
          } else if (isTransferenciaPropriaTitular) {
            natureza = 'TRANSFERENCIA_PROPRIA';
          } else if (
            descLower.includes('aplicação') ||
            descLower.includes('aplicacao') ||
            descLower.includes('investimento') ||
            descLower.includes('tesouro direto') ||
            descLower.includes('deposito poupanca') ||
            descLower.includes('depósito poupança') ||
            descLower.includes('deposito poupança') ||
            descLower.includes('depósito poupanca') ||
            descLower.includes('compra acoes') ||
            descLower.includes('compra ações') ||
            /\b(cdb|rdb|lci|lca)\b/i.test(descLower)
          ) {
            natureza = 'APORTE_PATRIMONIAL';
          } else if (
            descLower.includes('salario') ||
            descLower.includes('salário') ||
            descLower.includes('conta salario') ||
            descLower.includes('conta salário') ||
            descLower.includes('plr') ||
            descLower.includes('remuneracao') ||
            descLower.includes('remuneração') ||
            descLower.includes('pix recebido') ||
            descLower.includes('ted recebida') ||
            descLower.includes('rendimento')
          ) {
            natureza = 'RECEITA';
          } else if (descLower.includes('restaurante') || descLower.includes('mercado') || descLower.includes('lanche') || descLower.includes('aluguel') || descLower.includes('uber') || descLower.includes('gasolina') || descLower.includes('compra')) {
            natureza = 'DESPESA';
          }

          const tipoContaDeduzido = (parseRes.contaSugerida?.tipo as any) || this.deduzirTipoContaPorArquivo(nomeArquivo);
          const isLinhaInformativaFaturaCartao =
            tipoContaDeduzido === 'CARTAO_CREDITO' &&
            (t.isPagamentoFatura ||
              /pag(amento)?\s*(de)?\s*(fat(ura)?|cart[aã]o)|pagamento\s*recebido|cr[eé]dito\s*pagamento/i.test(
                t.descricao
              ));

          let observacao = t.memo || 'Extraído via parser estruturado local';
          if (isLinhaInformativaFaturaCartao) {
            observacao = 'Linha informativa de quitação em fatura de cartão';
          }

          return {
            dataMovimento: t.data,
            descricao: t.descricao,
            valor: t.valor,
            natureza,
            contaSugerida: parseRes.contaSugerida?.nome || this.deduzirNomeContaPorArquivo(nomeArquivo),
            tipoConta: tipoContaDeduzido,
            numeroConta: parseRes.contaSugerida?.numeroConta || null,
            digitosCartao: parseRes.contaSugerida?.digitosCartao || null,
            categoriaSugerida: t.categoriaSugerida || this.deduzirCategoria(t.descricao, contexto.categorias),
            parcelaAtual: null,
            totalParcelas: null,
            idOrigem: t.idExterno || null,
            isPagamentoFatura: Boolean(t.isPagamentoFatura || isLinhaInformativaFaturaCartao),
            observacao,
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
    if (lower.includes('nubank') || lower.includes('nu_') || lower.startsWith('nu')) return 'Nubank';
    if (lower.includes('itau') || lower.includes('itaú')) return 'Itaú Unibanco';
    if (lower.includes('inter')) return 'Banco Inter';
    if (lower.includes('c6')) return 'C6 Bank';
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
