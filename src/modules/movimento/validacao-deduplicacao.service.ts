import { prisma } from '../../infrastructure/database/prisma.js';
import { extrairRaizComerciante } from './movimento.util.js';

export interface ValidacaoDeduplicacaoResultado {
  usuarioId: string;
  totalAvaliados: number;
  totalDuplicatasExcluidas: number;
  totalValidadosMarcados: number;
  detalhesExclusoes: Array<{
    idExcluido: string;
    idPreservado: string;
    descricaoExcluida: string;
    descricaoPreservada: string;
    dataMovimento: string;
    valor: number;
    motivo: string;
  }>;
}

/**
 * Normaliza e simplifica uma descrição textual para comparação heurística de duplicatas.
 * Remove pontuação, acentuação, hífen, espaços múltiplos e termos de preenchimento.
 */
export function normalizarDescricaoComparacao(texto: string): string {
  if (!texto) return '';

  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[\s\-_–—.,;:/\\|*#@!?()[\]{}'"]+/g, ' ') // substitui pontuações, hífens, en-dash e em-dash por espaço
    .trim();
}

/**
 * Calcula a similaridade textual (0.0 a 1.0) entre duas descrições baseando-se
 * na sobreposição de tokens/palavras e n-grams de caracteres normalizados.
 * Retorna 1.0 para strings idênticas e 0.0 para strings completamente disjuntas.
 */
export function calcularSimilaridadeTexto(textoA: string, textoB: string): number {
  if (!textoA && !textoB) return 1.0;
  if (!textoA || !textoB) return 0.0;

  const normA = normalizarDescricaoComparacao(textoA);
  const normB = normalizarDescricaoComparacao(textoB);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  // 1. Similaridade por Tokens (Jaccard)
  const tokensA = new Set(normA.split(' ').filter(Boolean));
  const tokensB = new Set(normB.split(' ').filter(Boolean));
  const comunsTokens = [...tokensA].filter((t) => tokensB.has(t));
  const uniaoTokens = new Set([...tokensA, ...tokensB]).size;
  const simTokens = uniaoTokens > 0 ? comunsTokens.length / uniaoTokens : 0;

  // 2. Similaridade por Bigrams de Caracteres (Dice's Coefficient)
  const gerarBigramas = (str: string): Set<string> => {
    const s = str.replace(/\s+/g, '');
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2));
    }
    return bigrams;
  };

  const bigramasA = gerarBigramas(normA);
  const bigramasB = gerarBigramas(normB);
  let comunsBigramas = 0;
  for (const bg of bigramasA) {
    if (bigramasB.has(bg)) comunsBigramas++;
  }
  const totalBigramas = bigramasA.size + bigramasB.size;
  const simBigramas = totalBigramas > 0 ? (2 * comunsBigramas) / totalBigramas : 0;

  // Retorna a melhor correspondência ponderada
  return Math.max(simTokens, simBigramas);
}

/**
 * Normaliza o nome ou chave de instituição para detectar correspondência entre contas
 * (ex: "Santander" === "Santander", "Conta Bancária" com Nubank ou Inter).
 */
export function normalizarInstituicao(nomeConta: string): string {
  const norm = (nomeConta || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/santander/i.test(norm)) return 'santander';
  if (/nubank|nu\s*pagamentos/i.test(norm)) return 'nubank';
  if (/inter|banco\s*inter/i.test(norm)) return 'inter';
  if (/itau|itaú/i.test(norm)) return 'itau';
  if (/c6|c6\s*bank/i.test(norm)) return 'c6';
  if (/mercado\s*pago/i.test(norm)) return 'mercadopago';
  if (/neon/i.test(norm)) return 'neon';
  if (/pagbank|pagseguro/i.test(norm)) return 'pagbank';
  if (/picpay/i.test(norm)) return 'picpay';

  // Se for genérico como "Conta Bancária" ou "Conta Corrente", retorna o próprio texto normalizado
  return norm.trim();
}

/**
 * Avalia se duas contas pertencem à mesma instituição financeira ou se uma delas
 * é um nome genérico ("Conta Bancária", "Conta Corrente") preenchido a partir de arquivo da instituição.
 * BUG-16 & TASK-47: Também verifica equivalência estrita por numeroConta ou digitosCartao.
 */
export function saoMesmaInstituicaoOuEquivalente(
  contaA: { nome: string; numeroConta?: string | null; digitosCartao?: string | null },
  origemDocA: string | null | undefined,
  contaB: { nome: string; numeroConta?: string | null; digitosCartao?: string | null },
  origemDocB: string | null | undefined
): boolean {
  // 1. Identificação inequívoca por número de conta corrente (suporta com ou sem dígito verificador)
  if (contaA.numeroConta && contaB.numeroConta) {
    const rawA = contaA.numeroConta.trim();
    const rawB = contaB.numeroConta.trim();
    const numA = rawA.replace(/\D/g, '');
    const numB = rawB.replace(/\D/g, '');
    const baseA = rawA.split(/[-–—]/)[0].replace(/\D/g, '');
    const baseB = rawB.split(/[-–—]/)[0].replace(/\D/g, '');

    if ((numA && numB && numA === numB) || (baseA && baseB && baseA === baseB)) {
      return true;
    }
  }

  // 2. Identificação inequívoca por dígitos de cartão
  if (contaA.digitosCartao && contaB.digitosCartao) {
    const digA = contaA.digitosCartao.replace(/\D/g, '');
    const digB = contaB.digitosCartao.replace(/\D/g, '');
    if (digA && digB && digA === digB) {
      return true;
    }
  }

  const instA = normalizarInstituicao(contaA.nome);
  const instB = normalizarInstituicao(contaB.nome);

  // 3. Instituições diretas iguais
  if (instA && instB && instA === instB) {
    return true;
  }

  // 4. Se uma conta é genérica (ex: "conta bancaria", "conta corrente"), inferir instituição pelo nome do arquivo
  const inferirInstituicaoPorArquivo = (origemDoc: string | null | undefined): string | null => {
    if (!origemDoc) return null;
    const o = origemDoc.toLowerCase();
    if (o.includes('santander')) return 'santander';
    if (o.includes('nubank') || o.includes('nu_') || o.includes('nu-')) return 'nubank';
    if (o.includes('inter')) return 'inter';
    if (o.includes('itau')) return 'itau';
    if (o.includes('c6')) return 'c6';
    if (o.includes('mercado_pago')) return 'mercadopago';
    return null;
  };

  const instOrigemA = inferirInstituicaoPorArquivo(origemDocA) || instA;
  const instOrigemB = inferirInstituicaoPorArquivo(origemDocB) || instB;

  if (instOrigemA && instOrigemB && instOrigemA === instOrigemB) {
    return true;
  }

  // 5. TASK-47: Se uma das contas tem nome genérico ("conta bancaria", "conta corrente", "cartao de credito")
  // e ambas se originam do mesmo arquivo ou o arquivo de uma remete à mesma instituição da outra
  const isGenerica = (nome: string) => {
    const n = (nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return n.includes('conta bancaria') || n.includes('conta corrente') || n.includes('cartao de credito');
  };

  if (origemDocA && origemDocB && origemDocA.trim().toLowerCase() === origemDocB.trim().toLowerCase()) {
    return true;
  }

  if (isGenerica(contaA.nome) && instB && instOrigemA === instB) {
    return true;
  }

  if (isGenerica(contaB.nome) && instA && instOrigemB === instA) {
    return true;
  }

  return false;
}

// Regex para validar estritamente numerais romanos reais (I a XII) ou ordinais numéricos (1 a 99)
// Válidos: I, II, III, IV, V, VI, VII, VIII, IX, X, XI, XII ou 1..99
// Inválidos: siglas de palavras ou estados como "UP", "SP", "RJ", "ME", "LTDA", "TED", "DOC", "IM"
const REGEX_NUMERAL_ROMANO_VALIDO = /^(?:XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I|[1-9]\d?)$/i;

/**
 * Extrai identificador distintivo de transação, como:
 * - Sufixo de recargas ou identificadores com asterisco (ex: "RECARGAPAY *TIM12" -> "TIM12", "RECARGAPAY *TIM23" -> "TIM23")
 * - Identificadores de parcelamento (ex: "Parcela 1/4" -> "PARCELA_1/4")
 * - Numerais romanos e ordinais estritos no final (ex: "BARRACA DO JULIO I" -> "I")
 * - Códigos numéricos de terminal/filial/NSU no final (ex: "DROGASIL2952" -> "2952", "DROGASIL1828" -> "1828")
 */
export function extrairIdentificadorDistintivo(texto: string): string | null {
  if (!texto) return null;

  // 1. Identificador de parcela: ex: 'LATAM AIR*0000 - Parcela 1/4' ou 'DECATHLON (Parcela 02 de 03)'
  const matchParcela = texto.match(/parcela\s+(\d+)\s*(?:\/|\s+de\s+)\s*(\d+)/i);
  if (matchParcela) {
    const pAtual = parseInt(matchParcela[1], 10);
    const pTotal = parseInt(matchParcela[2], 10);
    return `PARCELA_${pAtual}/${pTotal}`;
  }

  // 2. Sufixo alfanumérico ou código de recarga/terminal após asterisco:
  // Ex: 'RECARGAPAY *TIM12' -> 'TIM12', 'RECARGAPAY *TIM23' -> 'TIM23', 'Recargapay *Claro06' -> 'CLARO06'
  const matchAsterisco = texto.match(/\*([a-zA-Z0-9]+)\b/);
  if (matchAsterisco) {
    return matchAsterisco[1].toUpperCase();
  }

  // 3. Sufixo numérico identificador de terminal/filial no final da descrição:
  // Ex: 'DROGASIL2952' vs 'DROGASIL1828'
  const matchSufixoAlfanum = texto.match(/(?:^|\s|[a-zA-Z])(\d{2,})\s*$/);
  if (matchSufixoAlfanum) {
    return matchSufixoAlfanum[1];
  }

  // 4. Numeral romano ou ordinal simples no final (ex: 'BARRACA DO JULIO I' vs 'BARRACA DO JULIO II')
  const matchOrdinal = texto.match(/\s+([a-zA-Z\d]+)\s*$/);
  if (matchOrdinal) {
    const cand = matchOrdinal[1].toUpperCase();
    if (REGEX_NUMERAL_ROMANO_VALIDO.test(cand)) {
      return cand;
    }
  }

  return null;
}

/**
 * Avalia se duas descrições possuem códigos, terminais ou identificadores comprovadamente distintos
 * (ex: RECARGAPAY *TIM12 vs RECARGAPAY *TIM23, ou BARRACA DO JULIO vs BARRACA DO JULIO I).
 */
export function saoDistintosPorIdentificador(descA: string, descB: string): boolean {
  const idA = extrairIdentificadorDistintivo(descA);
  const idB = extrairIdentificadorDistintivo(descB);

  // Se ambos têm códigos identificadores e eles são diferentes
  if (idA && idB && idA !== idB) {
    return true;
  }

  // Se um possui código/ordinal comprovado e o outro não
  if ((idA && !idB) || (!idA && idB)) {
    return true;
  }

  return false;
}

/**
 * Avalia se dois lançamentos com a mesma data, mesmo valor e mesma natureza são semanticamente
 * a mesma transação duplicada (por exemplo, originados de formatos diferentes ou variações de hífen/pontuação).
 *
 * PRESERVAÇÃO ESTRITA: Compras reais com sufixos ou algarismos ordinais comprovadamente distintos
 * (ex: "BARRACA DO JULIO" vs "BARRACA DO JULIO I", ou "RECARGAPAY *TIM12" vs "RECARGAPAY *TIM23")
 * no mesmo dia NÃO são consideradas duplicatas!
 */
export function saoDuplicatasSemanticas(
  mA: { descricao: string; observacao?: string | null; valor?: number | any },
  mB: { descricao: string; observacao?: string | null; valor?: number | any }
): boolean {
  const descA = mA.descricao.trim();
  const descB = mB.descricao.trim();

  // 1. Se as descrições forem idênticas (mesmo com case diferente)
  if (descA.toLowerCase() === descB.toLowerCase()) {
    return true;
  }

  // 2. Trava de identificador distintivo: se possuem códigos, terminais ou ordinais distintos,
  // são transações legítimas e distintas (ex: recargas de celulares diferentes, parcelas diferentes)
  if (saoDistintosPorIdentificador(descA, descB)) {
    return false;
  }

  // 3. Normalização sem pontuações/hífens/travessões
  const normA = normalizarDescricaoComparacao(descA);
  const normB = normalizarDescricaoComparacao(descB);

  // Se forem iguais após remover hífens/pontuação (ex: "PIX ENVIADO - 24213012 Hudson" vs "PIX ENVIADO 24213012 Hudson")
  if (normA === normB) {
    return true;
  }

  // 4. Checagem de anagrama exato de tokens / palavras reordenadas
  // Ex: "OPERACOES CREDITO IMOBILIARIO PREST CR IM" vs "PREST CR IM - OPERACOES CREDITO IMOBILIARIO"
  const tokensListaA = normA.split(' ').filter(Boolean);
  const tokensListaB = normB.split(' ').filter(Boolean);

  if (tokensListaA.length > 0 && tokensListaA.length === tokensListaB.length) {
    const ordenadoA = [...tokensListaA].sort().join(' ');
    const ordenadoB = [...tokensListaB].sort().join(' ');
    if (ordenadoA === ordenadoB) {
      return true;
    }
  }

  // 5. Comparação por raiz de comerciante e sufixos geográficos
  // Se ambas reduzem à mesma raiz de comerciante e os termos geográficos são variações (ex: "Vila Velha" vs "Vila Velha Bra")
  const raizA = extrairRaizComerciante(descA).toLowerCase();
  const raizB = extrairRaizComerciante(descB).toLowerCase();

  const tokensA = new Set(normA.split(' ').filter(Boolean));
  const tokensB = new Set(normB.split(' ').filter(Boolean));
  const comuns = [...tokensA].filter((t) => tokensB.has(t));
  const totalDistintos = new Set([...tokensA, ...tokensB]).size;
  const similarity = totalDistintos > 0 ? comuns.length / totalDistintos : 0;

  if (raizA && raizB && raizA === raizB) {
    // Mesma raiz de comerciante (ex: "Mp *mariadefatima", "Leomar Schunk")
    return true;
  }

  // 6. Proventos e Eventos de Investimentos (ex: "* Prov * Rendimento 1 Hglg11" vs "Rendimento HGLG11 - Crédito Evento B3")
  const ehEventoInvestimento = (t: string) => /rendimento|provento|prov\b|dividendo|jcp\b|evento b3|b3/i.test(t);
  if (ehEventoInvestimento(normA) && ehEventoInvestimento(normB)) {
    const extrairTicker = (t: string) => t.match(/\b([a-zA-Z]{4}\d{1,2}[a-zA-Z]?)\b/i)?.[1]?.toUpperCase();
    const tickerA = extrairTicker(normA);
    const tickerB = extrairTicker(normB);
    if (tickerA && tickerB && tickerA === tickerB) {
      return true;
    }
  }

  // TASK-47: Lançamentos de baixa materialidade (valor < 50.00) com alta similaridade de tokens (>= 0.70)
  // na mesma data e natureza (já garantido pelo filtro da malha fina) são duplicatas evidentes de importação
  // (ex: "PADARIA DINIZ VILA VELHA" vs "PADARIA DINIZ - VILA VELHA BRA").
  const valorNum = mA.valor ? Number(mA.valor) : (mB.valor ? Number(mB.valor) : null);
  if (valorNum !== null && !isNaN(valorNum) && Math.abs(valorNum) < 50.0) {
    if (similarity >= 0.7) {
      return true;
    }
  }

  // 7. Pagamentos de Fatura e Liquidações Bancárias Equivalentes (ex: "Pagamento efetuado" vs "Pagamento efetuado - BANCO C6 S.A.")
  const ehPagamentoA = /pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|pag\s*fatura/i.test(descA);
  const ehPagamentoB = /pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|pag\s*fatura/i.test(descB);
  if (ehPagamentoA && ehPagamentoB) {
    // Se ambos são termos de liquidação/pagamento de fatura e um contém a base do outro (ex: "Pagamento efetuado")
    if (normA.startsWith('pagamento efetuado') && normB.startsWith('pagamento efetuado')) {
      return true;
    }
    if (normA.includes(normB) || normB.includes(normA)) {
      return true;
    }
  }

  // 8. Casos de substrings estritas contidas (ex: uma IA extraiu com detalhe adicional como comprovante/taxa)
  // Ex: "TED RECEBIDA - PAGTO SEGURO DESEMPREGO OPERACOES CREDITO IMOBILIARIO" vs "TED RECEBIDA PAGTO SEGURO DESEMPREGO"
  // Ex: "REMUNERACAO BASICA POUPANCA TAXA = 0,173 %" vs "REMUNERACAO BASICA POUPANCA"
  // Ex: "PAGAMENTO CARTAO CREDITO BCE 14/08 10:12 CARTAO VISA" vs "PAGAMENTO CARTAO CREDITO BCE - CARTAO VISA"
  const palavrasA = normA.split(' ').filter((p) => p.length > 2);
  const palavrasB = normB.split(' ').filter((p) => p.length > 2);

  if (palavrasA.length >= 2 && palavrasB.length >= 2) {
    const aContemQuaseTudoDeB = palavrasB.every((p) => normA.includes(p));
    const bContemQuaseTudoDeA = palavrasA.every((p) => normB.includes(p));

    if (aContemQuaseTudoDeB || bContemQuaseTudoDeA) {
      return true;
    }
  }

  // BUG-22: Regra R2 - Se a similaridade textual (ponderada por tokens e bigramas) for maior que 50% (> 0.50)
  // e as descrições não forem distintas por identificador/ordinal estrito
  const simGlobal = calcularSimilaridadeTexto(descA, descB);
  if (simGlobal > 0.50) {
    return true;
  }

  return false;
}

export class ValidacaoDeduplicacaoService {
  /**
   * Executa a malha fina de deduplicação para os movimentos de um usuário.
   * Regras:
   * 1. Busca lançamentos com validadoDedupe = 'N'
   * 2. Cruza com outros lançamentos de mesma data (YYYY-MM-DD), mesmo valor e mesma natureza
   * 3. Confirma se pertencem à mesma instituição financeira e têm correspondência semântica
   * 4. Mantém o registro mais completo / mais antigo e exclui o duplicado excedente
   * 5. Marca todos os movimentos analisados com validadoDedupe = 'S'
   */
  public static async executarMalhaFinaParaUsuario(
    usuarioId: string,
    opcoes?: { reprocessarTudo?: boolean }
  ): Promise<ValidacaoDeduplicacaoResultado> {
    const resultado: ValidacaoDeduplicacaoResultado = {
      usuarioId,
      totalAvaliados: 0,
      totalDuplicatasExcluidas: 0,
      totalValidadosMarcados: 0,
      detalhesExclusoes: [],
    };

    // Se reprocessarTudo for solicitado, redefine validadoDedupe para 'N',
    // EXCETO para lançamentos com categoriaFixadaPeloUsuario === true (validados manualmente pelo usuário - TASK-45)
    if (opcoes?.reprocessarTudo) {
      await prisma.movimento.updateMany({
        where: {
          usuarioId,
          categoriaFixadaPeloUsuario: false,
        },
        data: { validadoDedupe: 'N' },
      });
    }

    // 1. Busca todos os movimentos não validados do usuário
    const pendentes = await prisma.movimento.findMany({
      where: {
        usuarioId,
        validadoDedupe: 'N',
      },
      include: {
        conta: {
          select: { id: true, nome: true, tipo: true, numeroConta: true, digitosCartao: true },
        },
        categoria: {
          select: { id: true, nome: true },
        },
      },
      orderBy: { dataMovimento: 'asc' },
    });

    resultado.totalAvaliados = pendentes.length;
    if (pendentes.length === 0) {
      return resultado;
    }

    const idsExcluidos = new Set<string>();
    const idsValidadosParaAtualizar = new Set<string>();

    for (const mov of pendentes) {
      if (idsExcluidos.has(mov.id)) {
        continue;
      }

      // Busca concorrentes com mesma data e mesmo valor para este usuário
      const dataInicio = new Date(mov.dataMovimento);
      dataInicio.setUTCHours(0, 0, 0, 0);
      const dataFim = new Date(mov.dataMovimento);
      dataFim.setUTCHours(23, 59, 59, 999);

      const concorrentes = await prisma.movimento.findMany({
        where: {
          usuarioId,
          dataMovimento: {
            gte: dataInicio,
            lte: dataFim,
          },
          valor: mov.valor,
          natureza: mov.natureza,
          id: { not: mov.id },
        },
        include: {
          conta: {
            select: { id: true, nome: true, tipo: true, numeroConta: true, digitosCartao: true },
          },
          categoria: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { criadoEm: 'asc' },
      });

      // Se não há concorrentes com mesma data e valor, marca como validado diretamente
      if (concorrentes.length === 0) {
        idsValidadosParaAtualizar.add(mov.id);
        continue;
      }

      // Analisa concorrentes na malha fina
      let duplicataEncontrada: (typeof concorrentes)[0] | null = null;

      for (const conc of concorrentes) {
        if (idsExcluidos.has(conc.id)) {
          continue;
        }

        // Verifica instituição ou mesma conta (R1)
        const mesmaConta = mov.contaId === conc.contaId;
        const mesmaInstituicao = mesmaConta || saoMesmaInstituicaoOuEquivalente(
          mov.conta,
          mov.origemDocumento,
          conc.conta,
          conc.origemDocumento
        );

        if (!mesmaInstituicao) {
          continue;
        }

        // Se possuem identificador comprovadamente distinto (ex: BARRACA DO JULIO vs BARRACA DO JULIO I, recargas diferentes, parcelas diferentes),
        // são transações legítimas e NÃO duplicatas
        if (saoDistintosPorIdentificador(mov.descricao, conc.descricao)) {
          continue;
        }

        // Verifica equivalência semântica:
        // R1: Mesma conta + mesma data + mesmo valor
        // R2: Descrição com similaridade semântica / textual > 50%
        const atendeR1 = mesmaConta;
        const atendeR2 = saoDuplicatasSemanticas(mov, conc);

        if (atendeR1 || atendeR2) {
          duplicataEncontrada = conc;
          break;
        }
      }

      if (duplicataEncontrada) {
        // Decide qual manter:
        // 1. Prioriza o que tem categoria fixada manualmente pelo usuário
        // 2. Prioriza o que tem categoria específica (não nula e diferente de 'Outros')
        // 3. Prioriza o que tem mais dados (observação preenchida)
        // 4. Prioriza o mais antigo
        let preservar = mov;
        let descartar = duplicataEncontrada;

        const catMovEspecifica = Boolean(mov.categoriaId && mov.categoria?.nome?.toLowerCase() !== 'outros');
        const catConcEspecifica = Boolean(duplicataEncontrada.categoriaId && duplicataEncontrada.categoria?.nome?.toLowerCase() !== 'outros');

        if (duplicataEncontrada.categoriaFixadaPeloUsuario && !mov.categoriaFixadaPeloUsuario) {
          preservar = duplicataEncontrada;
          descartar = mov;
        } else if (
          !duplicataEncontrada.categoriaFixadaPeloUsuario &&
          mov.categoriaFixadaPeloUsuario
        ) {
          preservar = mov;
          descartar = duplicataEncontrada;
        } else if (catConcEspecifica && !catMovEspecifica) {
          preservar = duplicataEncontrada;
          descartar = mov;
        } else if (catMovEspecifica && !catConcEspecifica) {
          preservar = mov;
          descartar = duplicataEncontrada;
        } else if (duplicataEncontrada.observacao && !mov.observacao) {
          preservar = duplicataEncontrada;
          descartar = mov;
        } else if (!duplicataEncontrada.observacao && mov.observacao) {
          preservar = mov;
          descartar = duplicataEncontrada;
        } else if (duplicataEncontrada.criadoEm < mov.criadoEm) {
          preservar = duplicataEncontrada;
          descartar = mov;
        }

        // Exclui atomicamente o descartar
        await prisma.$transaction(async (tx) => {
          if (descartar.transferenciaVinculoId) {
            await tx.movimento.updateMany({
              where: { id: { in: [descartar.id, descartar.transferenciaVinculoId] } },
              data: { transferenciaVinculoId: null },
            });
          }

          // Limpa quaisquer suspeitas pendentes associadas ao par ou ao registro descartado
          await tx.suspeitaMovimento.deleteMany({
            where: {
              OR: [
                { movimentoId: descartar.id },
                { movimentoSecundarioId: descartar.id },
                {
                  AND: [
                    { movimentoId: preservar.id },
                    { tipo: 'SUSPEITA_DUPLICATA' },
                  ],
                },
              ],
            },
          });

          await tx.movimento.deleteMany({
            where: { id: descartar.id },
          });

          // Atualiza o registro preservado para validadoDedupe = 'S'
          // e herda a categoria do descartado caso o preservado não possua categoria específica
          const dadosAtualizacaoPreservado: any = { validadoDedupe: 'S' };
          if (!preservar.categoriaId && descartar.categoriaId) {
            dadosAtualizacaoPreservado.categoriaId = descartar.categoriaId;
          }

          await tx.movimento.updateMany({
            where: { id: preservar.id },
            data: dadosAtualizacaoPreservado,
          });
        });

        idsExcluidos.add(descartar.id);
        idsValidadosParaAtualizar.delete(descartar.id);
        idsValidadosParaAtualizar.add(preservar.id);

        resultado.totalDuplicatasExcluidas++;
        resultado.detalhesExclusoes.push({
          idExcluido: descartar.id,
          idPreservado: preservar.id,
          descricaoExcluida: descartar.descricao,
          descricaoPreservada: preservar.descricao,
          dataMovimento: preservar.dataMovimento.toISOString().slice(0, 10),
          valor: Number(preservar.valor),
          motivo: `Duplicata detectada pela malha fina (mesma data, valor, instituição e semântica equivalente).`,
        });
      } else {
        // Nenhuma duplicata confirmada -> marca como validado
        idsValidadosParaAtualizar.add(mov.id);
      }
    }

    // Atualiza em lote todos os IDs verificados que restaram ativos
    const idsParaMarcarS = [...idsValidadosParaAtualizar].filter((id) => !idsExcluidos.has(id));
    if (idsParaMarcarS.length > 0) {
      const updateResult = await prisma.movimento.updateMany({
        where: {
          id: { in: idsParaMarcarS },
          usuarioId, // Multi-tenant seguro
        },
        data: {
          validadoDedupe: 'S',
        },
      });
      resultado.totalValidadosMarcados = updateResult.count;
    }

    return resultado;
  }
}
