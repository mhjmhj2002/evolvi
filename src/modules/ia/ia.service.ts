import { IaLancamentoParsed } from './ia.schema.js';
import {
  FuncionalidadeUsoIa,
  UsoIaService,
  tokensDeUsageGemini,
  tokensDeUsageOpenAi,
} from './uso-ia.service.js';
import {
  MODELO_OPENROUTER_PADRAO,
  montarHeadersOpenRouter,
  montarUrlOpenRouter,
  normalizarModeloOpenRouter,
} from './openrouter.config.js';

/**
 * TASK-49 — Opções de telemetria aceitas pelos clientes de IA.
 * Quando `usuarioId` é informado, a chamada gera exatamente 1 linha em
 * `uso_ia_logs` (sucesso ou falha), sem nunca interromper o fluxo de negócio.
 */
export interface OpcoesTelemetriaIa {
  usuarioId?: string | null;
  funcionalidade?: FuncionalidadeUsoIa;
  loteId?: string | null;
  arquivoId?: string | null;
}

export interface ContaContexto {
  id: string;
  nome: string;
  tipo: string;
}

export interface CategoriaContexto {
  id: string;
  nome: string;
}

export interface ContextoUsuarioIA {
  contas: ContaContexto[];
  categorias: CategoriaContexto[];
  dataReferencia: string;
}

/**
 * Constrói o System Prompt e instruções completas para qualquer LLM
 * estruturar uma despesa/movimento em formato JSON estrito.
 */
export function buildIaSystemPrompt(contexto: ContextoUsuarioIA): string {
  const contasFormatadas = contexto.contas.length > 0
    ? contexto.contas.map(c => `- ID: "${c.id}", Nome: "${c.nome}", Tipo: "${c.tipo}"`).join('\n')
    : '(Nenhuma conta cadastrada)';

  const categoriasFormatadas = contexto.categorias.length > 0
    ? contexto.categorias.map(c => `- ID: "${c.id}", Nome: "${c.nome}"`).join('\n')
    : '(Nenhuma categoria cadastrada)';

  return `Você é o assistente inteligente de parsing financeiro do Evolvi.
Sua missão é extrair com precisão os dados de um lançamento financeiro fornecido em linguagem natural ou texto de comprovante.

DIRETRIZES FUNDAMENTAIS:
1. Data de referência de hoje: "${contexto.dataReferencia}". Se o usuário disser "ontem", "hoje" ou omitir a data, infira a data YYYY-MM-DD relativa a hoje.
2. Contas disponíveis do usuário:
${contasFormatadas}
Se o texto citar o nome ou tipo de conta (ex: Nubank, Itaú, Débito, Cartão), tente associar ao "contaId" correspondente. Se não encontrar, deixe contaId como null e informe "contaNomeSugerida".

3. Categorias disponíveis (POF):
${categoriasFormatadas}
Selecione a categoria mais condizente e preencha "categoriaId" e "categoriaNomeSugerida".

4. Anti-dupla contagem e Naturezas:
- "DESPESA": Compra, consumo, contas da casa, alimentação, combustível, etc.
- "RECEITA": Salário, rendimentos, pix recebido, vendas.
- "TRANSFERENCIA_PROPRIA": Transferência entre contas próprias ou pagamento de fatura de cartão de crédito.
- "APORTE_PATRIMONIAL": Aplicações financeiras, investimentos, depósitos em poupança, aportes em CDB/RDB/LCI/LCA/Tesouro Direto, compra de ações (NUNCA classifique como DESPESA!).
- Se for pagamento de fatura de cartão, "isPagamentoFatura" DEVE ser true e "natureza" = "TRANSFERENCIA_PROPRIA".
- Se houver parcelamento explícito (ex: "em 3x de R$ 50", "parcela 2 de 10"), preencha "parcelasTotal" e "parcelaAtual" se identificados.

FORMATO DE RESPOSTA OBRIGATÓRIO:
Retorne EXCLUSIVAMENTE um objeto JSON válido (sem tags markdown extras, sem explicações), conforme este schema:
{
  "descricao": "string concisa com o que foi comprado/pago",
  "valor": number (ex: 45.50 - ponto como separador decimal),
  "dataMovimento": "YYYY-MM-DD",
  "natureza": "DESPESA" | "RECEITA" | "TRANSFERENCIA_PROPRIA" | "APORTE_PATRIMONIAL",
  "contaId": "id-ou-null",
  "contaNomeSugerida": "string-ou-null",
  "categoriaId": "id-ou-null",
  "categoriaNomeSugerida": "string-ou-null",
  "isPagamentoFatura": boolean,
  "parcelasTotal": number | null,
  "parcelaAtual": number | null,
  "observacao": "string-ou-null",
  "confianca": number (entre 0 e 1, ex: 0.95)
}`;
}

/**
 * Parser heurístico / determinístico local (usado para fallback offline,
 * testes unitários, ou quando o texto for estruturado).
 */
export function parseLocalDeterministic(texto: string, contexto: ContextoUsuarioIA): IaLancamentoParsed {
  const textoLimpo = texto.trim();

  // 1. Extração do valor monetário (ex: R$ 1.250,00 ou R$ 45,50 ou 45.50 ou 45)
  let valor = 0;
  const regexValorPrefixo = /(?:R\$\s*|valor\s*:?\s*)(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2})?)/i;
  const matchPrefixo = textoLimpo.match(regexValorPrefixo);

  if (matchPrefixo) {
    const limpo = matchPrefixo[1].replace(/\./g, '').replace(',', '.');
    const parsedV = parseFloat(limpo);
    if (!isNaN(parsedV)) valor = parsedV;
  } else {
    const regexGenerica = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{1,2}|\b\d+\b)/;
    const matchGenerico = textoLimpo.match(regexGenerica);
    if (matchGenerico) {
      const limpo = matchGenerico[1].replace(/\./g, '').replace(',', '.');
      const parsedV = parseFloat(limpo);
      if (!isNaN(parsedV)) valor = parsedV;
    }
  }

  // 2. Data de referência
  let dataMovimento = contexto.dataReferencia;
  const lower = textoLimpo.toLowerCase();
  if (lower.includes('ontem')) {
    const d = new Date(`${contexto.dataReferencia}T12:00:00Z`);
    d.setDate(d.getDate() - 1);
    dataMovimento = d.toISOString().split('T')[0];
  } else {
    // Procura padrão DD/MM/AAAA ou DD/MM
    const matchData = textoLimpo.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
    if (matchData) {
      const dia = matchData[1];
      const mes = matchData[2];
      const ano = matchData[3] || contexto.dataReferencia.substring(0, 4);
      dataMovimento = `${ano}-${mes}-${dia}`;
    }
  }

  // 3. Detecção de Pagamento de Fatura / Transferência
  const isPagamentoFatura =
    lower.includes('fatura') ||
    lower.includes('pagamento do cartao') ||
    lower.includes('pagamento de cartao') ||
    lower.includes('pagamento do cartão') ||
    lower.includes('pagamento de cartão') ||
    lower.includes('pagamento efetuado') ||
    lower.includes('pagamento recebido') ||
    ((lower.includes('pag boleto') || lower.includes('pagamento de boleto') || lower.includes('pagto boleto')) &&
      (lower.includes('nu pagamentos') || lower.includes('nubank') || lower.includes('c6') || lower.includes('bradescard') || lower.includes('itaucard') || lower.includes('cartao') || lower.includes('cartão')));


  let natureza: 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL' = 'DESPESA';
  if (isPagamentoFatura || lower.includes('transferencia') || lower.includes('transferência') || lower.includes('transferi')) {
    natureza = 'TRANSFERENCIA_PROPRIA';
  } else if (
    lower.includes('aplicação') ||
    lower.includes('aplicacao') ||
    lower.includes('investimento') ||
    lower.includes('tesouro direto') ||
    lower.includes('deposito poupanca') ||
    lower.includes('depósito poupança') ||
    lower.includes('compra acoes') ||
    lower.includes('compra ações') ||
    /\b(cdb|rdb|lci|lca)\b/i.test(lower)
  ) {
    natureza = 'APORTE_PATRIMONIAL';
  } else if (lower.includes('recebi') || lower.includes('salario') || lower.includes('salário') || lower.includes('venda')) {
    natureza = 'RECEITA';
  }

  // 4. Detecção de Parcelas (ex: "em 3x", "3 parcelas", "2/10")
  let parcelasTotal: number | null = null;
  let parcelaAtual: number | null = null;
  const matchParcelas = lower.match(/(?:em\s*)?(\d+)\s*x/);
  if (matchParcelas) {
    parcelasTotal = parseInt(matchParcelas[1], 10);
    parcelaAtual = 1;
  }
  const matchFracao = lower.match(/(\d+)\s*\/\s*(\d+)/);
  if (matchFracao) {
    parcelaAtual = parseInt(matchFracao[1], 10);
    parcelasTotal = parseInt(matchFracao[2], 10);
  }

  // 5. Associação de Conta
  let contaId: string | null = null;
  let contaNomeSugerida: string | null = null;
  for (const c of contexto.contas) {
    if (lower.includes(c.nome.toLowerCase())) {
      contaId = c.id;
      contaNomeSugerida = c.nome;
      break;
    }
  }
  if (!contaId && contexto.contas.length > 0) {
    if (lower.includes('cartão') || lower.includes('cartao') || lower.includes('crédito') || lower.includes('credito')) {
      const cCartao = contexto.contas.find(c => c.tipo === 'CARTAO_CREDITO');
      if (cCartao) {
        contaId = cCartao.id;
        contaNomeSugerida = cCartao.nome;
      }
    } else {
      contaId = contexto.contas[0].id;
      contaNomeSugerida = contexto.contas[0].nome;
    }
  }

  // 6. Associação de Categoria
  let categoriaId: string | null = null;
  let categoriaNomeSugerida: string | null = null;
  for (const cat of contexto.categorias) {
    if (lower.includes(cat.nome.toLowerCase())) {
      categoriaId = cat.id;
      categoriaNomeSugerida = cat.nome;
      break;
    }
  }
  // Mapeamentos comuns se não achou exato
  if (!categoriaId && contexto.categorias.length > 0) {
    if (lower.includes('almoço') || lower.includes('almoco') || lower.includes('restaurante') || lower.includes('lanche') || lower.includes('mercado') || lower.includes('supermercado')) {
      const catAlim = contexto.categorias.find(c => c.nome.toLowerCase().includes('aliment') || c.nome.toLowerCase().includes('refei'));
      if (catAlim) {
        categoriaId = catAlim.id;
        categoriaNomeSugerida = catAlim.nome;
      }
    } else if (lower.includes('luz') || lower.includes('energia') || lower.includes('copel') || lower.includes('aluguel') || lower.includes('agua') || lower.includes('água') || lower.includes('internet')) {
      const catHab = contexto.categorias.find(c => c.nome.toLowerCase().includes('habita') || c.nome.toLowerCase().includes('residen') || c.nome.toLowerCase().includes('despesa'));
      if (catHab) {
        categoriaId = catHab.id;
        categoriaNomeSugerida = catHab.nome;
      }
    } else if (lower.includes('gasolina') || lower.includes('uber') || lower.includes('combustivel') || lower.includes('combustível')) {
      const catTransp = contexto.categorias.find(c => c.nome.toLowerCase().includes('transp'));
      if (catTransp) {
        categoriaId = catTransp.id;
        categoriaNomeSugerida = catTransp.nome;
      }
    }
  }

  // 7. Descrição limpa
  let descricao = textoLimpo;
  // Se for muito longa, corta para primeiras palavras significativas
  if (descricao.length > 100) {
    descricao = descricao.substring(0, 97) + '...';
  }

  return {
    descricao,
    valor: valor > 0 ? valor : 10.0,
    dataMovimento,
    natureza,
    contaId,
    contaNomeSugerida,
    categoriaId,
    categoriaNomeSugerida,
    isPagamentoFatura,
    parcelasTotal,
    parcelaAtual,
    observacao: 'Interpretado por assistente inteligente',
    confianca: 0.88,
  };
}

/**
 * Chamada à API oficial do Google Gemini (BYOK ou gerenciada)
 * TASK-49: quando `opcoes.usuarioId` é informado, registra 1 linha em `uso_ia_logs`.
 */
export async function callGeminiApi(
  apiKey: string,
  model: string = 'gemini-3.8-flash',
  promptSistema: string,
  textoUsuario: string,
  opcoes?: OpcoesTelemetriaIa
): Promise<IaLancamentoParsed> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${promptSistema}\n\nTexto do usuário a ser analisado:\n"""${textoUsuario}"""` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    }
  };

  return UsoIaService.registrarChamada({
    usuarioId: opcoes?.usuarioId,
    funcionalidade: opcoes?.funcionalidade || 'CATEGORIZACAO',
    provedor: 'GEMINI',
    modelo: model,
    loteId: opcoes?.loteId,
    arquivoId: opcoes?.arquivoId,
    extrairTokens: (r) => r.tokens,
    execucao: async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro na API do Gemini (${response.status}): ${errText}`);
      }

      const data = (await response.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('A resposta do Gemini não continha texto de saída.');
      }

      return {
        parsed: JSON.parse(rawText) as IaLancamentoParsed,
        tokens: tokensDeUsageGemini(data.usageMetadata),
      };
    },
  }).then((r) => r.parsed);
}

/**
 * Chamada à API do DeepSeek (OpenAI-compatible chat completions)
 * TASK-49: quando `opcoes.usuarioId` é informado, registra 1 linha em `uso_ia_logs`.
 */
export async function callDeepSeekApi(
  apiKey: string,
  model: string = 'deepseek-chat',
  promptSistema: string,
  textoUsuario: string,
  opcoes?: OpcoesTelemetriaIa
): Promise<IaLancamentoParsed> {
  const url = 'https://api.deepseek.com/chat/completions';

  const body = {
    model: model || 'deepseek-chat',
    messages: [
      { role: 'system', content: promptSistema },
      { role: 'user', content: `Texto a ser analisado:\n"""${textoUsuario}"""` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  };

  return UsoIaService.registrarChamada({
    usuarioId: opcoes?.usuarioId,
    funcionalidade: opcoes?.funcionalidade || 'CATEGORIZACAO',
    provedor: 'DEEPSEEK',
    modelo: model || 'deepseek-chat',
    loteId: opcoes?.loteId,
    arquivoId: opcoes?.arquivoId,
    extrairTokens: (r) => r.tokens,
    execucao: async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro na API do DeepSeek (${response.status}): ${errText}`);
      }

      const data = (await response.json()) as any;
      const rawText = data.choices?.[0]?.message?.content;
      if (!rawText) {
        throw new Error('A resposta do DeepSeek não continha texto de saída.');
      }

      return {
        parsed: JSON.parse(rawText) as IaLancamentoParsed,
        tokens: tokensDeUsageOpenAi(data.usage),
      };
    },
  }).then((r) => r.parsed);
}

/**
 * Chamada à API do OpenRouter (OpenAI-compatible chat completions)
 * TASK-49: quando `opcoes.usuarioId` é informado, registra 1 linha em `uso_ia_logs`.
 */
export async function callOpenRouterApi(
  apiKey: string,
  model: string = MODELO_OPENROUTER_PADRAO,
  promptSistema: string,
  textoUsuario: string,
  opcoes?: OpcoesTelemetriaIa
): Promise<IaLancamentoParsed> {
  // URL base, headers de atribuição e chave fallback vêm de `openrouter.config.ts`
  // (OPENROUTER_BASE_URL / OPENROUTER_HTTP_REFERER / OPENROUTER_X_TITLE / OPENROUTER_API_KEY).
  const url = montarUrlOpenRouter('/chat/completions');
  const modeloEfetivo = normalizarModeloOpenRouter(model);

  const body = {
    model: modeloEfetivo,
    messages: [
      { role: 'system', content: promptSistema },
      { role: 'user', content: `Texto a ser analisado:\n"""${textoUsuario}"""` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  };

  return UsoIaService.registrarChamada({
    usuarioId: opcoes?.usuarioId,
    funcionalidade: opcoes?.funcionalidade || 'CATEGORIZACAO',
    provedor: 'OPENROUTER',
    modelo: modeloEfetivo,
    loteId: opcoes?.loteId,
    arquivoId: opcoes?.arquivoId,
    extrairTokens: (r) => r.tokens,
    execucao: async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: montarHeadersOpenRouter(apiKey),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro na API do OpenRouter (${response.status}): ${errText}`);
      }

      const data = (await response.json()) as any;
      const rawText = data.choices?.[0]?.message?.content;
      if (!rawText) {
        throw new Error('A resposta do OpenRouter não continha texto de saída.');
      }

      return {
        parsed: JSON.parse(rawText) as IaLancamentoParsed,
        tokens: tokensDeUsageOpenAi(data.usage),
      };
    },
  }).then((r) => r.parsed);
}

