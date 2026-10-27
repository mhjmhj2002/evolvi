import { prisma } from '../../infrastructure/database/prisma.js';
import { classificadorCombinatorioService } from './classificador-combinatorio.service.js';
import { extrairRaizComerciante } from './movimento.util.js';
import {
  ValidacaoDeduplicacaoService,
  ValidacaoDeduplicacaoResultado,
} from './validacao-deduplicacao.service.js';

/**
 * Versão corrente do catálogo de regras determinísticas de negócio de movimentos.
 * Incrementar este número sempre que novas regras de classificação forem adicionadas
 * ou corrigidas no sistema.
 * Versão 2: BUG-09 (Salário / Proventos / PLR universal)
 * Versão 3: TASK-43 (Inteligência Combinatória Nome + Dia da Semana e trava manual do usuário)
 * Versão 4: BUG-15 (Malha Fina de Deduplicação Inteligente: ordinais estritos, travessões, anagramas e hierarquia)
 * Versão 5: TASK-44 (Reconhecimento de Aportes/Investimentos e Isolamento dos Gastos da Fase 1)
 * Versão 6: BUG-16 & TASK-47 (Identificadores unívocos de conta/cartão e deduplicação de baixa materialidade)
 * Versão 7: TASK-48 (Identificação retrospectiva de transferências próprias entre contas do mesmo titular)
 * Versão 8: Regras consolidadas de transferências próprias e reconciliação
 * Versão 9: Alinhamento determinístico da competência financeira de compras parceladas de cartão (Parcela X/Y) à fatura de cobrança
 * Versão 10: BUG-22 (Resolução automática de duplicatas óbvias R1 e R2, sem poluir a Central de Suspeitas)
 */
export const VERSAO_REGRAS_MOVIMENTOS_ATUAL = 10;

/**
 * Helper determinístico para inferir a competência (YYYY-MM) de cobrança da fatura
 * a partir do identificador de origem do documento (origemDocumento) de cartão de crédito.
 */
export function inferirCompetenciaFaturaDocumento(origemDocumento?: string | null): string | null {
  if (!origemDocumento) return null;
  const orig = origemDocumento.trim();

  // Apenas arquivos ou lotes associados a faturas de cartão de crédito
  const isDocFatura = /fatura|nubank/i.test(orig) && !/extrato/i.test(orig);
  if (!isDocFatura) return null;

  // 1. YYYY-MM explícito no nome (ex: Fatura_Nubank_2026-09.pdf, Nubank_2026-10-16.pdf, Mercado_Pago_Fatura_2026-04.pdf)
  const m1 = orig.match(/(202[0-9])-(0[1-9]|1[0-2])/);
  if (m1) return `${m1[1]}-${m1[2]}`;

  // 2. Prefixo de mês MM-Fatura (ex: 09-Fatura-CPF-1.pdf, 05-Fatura-CPF-4.pdf, 01-Fatura-CPF-8.pdf)
  const m2 = orig.match(/^(?:IA_LOTE_)?(0[1-9]|1[0-2])-Fatura/i);
  if (m2) return `2026-${m2[1]}`;

  // 3. Padrão Santander/outros MMYYYY (ex: Fatura_102026_MANUEL_9694_VISA_00166927211456.PDF)
  const m3 = orig.match(/Fatura_(0[1-9]|1[0-2])(202[0-9])/i);
  if (m3) return `${m3[2]}-${m3[1]}`;

  // 4. Arquivos do fechamento de Outubro/2026 sem data no nome: Fatura-CPF.pdf, Fatura.pdf, FATURA MENSAL.pdf
  if (/Fatura-CPF\.pdf|IA_LOTE_Fatura\.pdf$|FATURA\s*MENSAL/i.test(orig)) {
    return '2026-10';
  }

  // 5. Outros padrões de cartão (ex: inter-6-Fatura-1.pdf -> 2026-06)
  const m5 = orig.match(/inter-(0?[1-9]|1[0-2])-Fatura/i);
  if (m5) return `2026-${m5[1].padStart(2, '0')}`;

  return null;
}

/**
 * Regex universal para identificação de proventos, remuneração, folha de pagamento,
 * contas salário e PLR (Participação nos Lucros e Resultados / Bônus).
 * Conforme convenção Febraban/BACEN, mesmo que o titular conste como favorecido/remetente,
 * a liquidação através de conta salário ou TED de folha representa RECEITA legítima.
 */
export const REGEX_PROVENTOS_SALARIO_PLR =
  /ted\s*conta\s*sal[aá]rio|cred\s*(ted\s*)?sal[aá]rio|folha\s*pag(amento)?|remunera[cç][aã]o|pagamento\s*de\s*sal[aá]rio|(?:\b|^)plr(?:\b|$)|participa[cç][aã]o\s*lucros|b[oô]nus\s*salarial|abono\s*salarial|13[oº]?\s*sal[aá]rio|sal[aá]rio\s*mensal/i;

/**
 * Regex universal para identificação de aportes patrimoniais e aplicações financeiras.
 * Lançamentos de saída com termos evidentes de CDB, RDB, LCI, LCA, Tesouro Direto, Poupança ou Investimento
 * devem ser classificados como APORTE_PATRIMONIAL, expurgando-os do cômputo de despesas da Fase 1.
 */
export const REGEX_APORTES_INVESTIMENTOS =
  /aplica[cç][aã]o\s*(de)?\s*(cdb|rdb|lci|lca|tesouro|fundo|investimento|financeira|a[cç][oõ]es)?|(?:\b|^)(cdb|rdb|lci|lca)(?:\b|$)|tesouro\s*direto|dep[oó]sito\s*poupan[cç]a|(?:\b|^)poupan[cç]a(?:\b|$)|compra\s*(de\s*)?(a[cç][oõ]es|fii|fiis|ativos)|subscri[cç][aã]o\s*(de\s*)?(a[cç][oõ]es|fii|fiis)?|(?:\b|^)investimento(?:\b|$)|(?:\b|^)aporte(?:\b|$)/i;

export interface RecalculoMovimentosResultado {
  usuarioId: string;
  versaoAnterior: number;
  versaoAplicada: number;
  recalculado: boolean;
  totalMovimentosAvaliados: number;
  totalConvertidosParaReceita: number;
  totalConvertidosParaAportePatrimonial?: number;
  totalConvertidosParaTransferenciaPropria?: number;
  totalCategoriasRefinadasCombinatorio?: number;
  totalParcelasAlinhadasCompetenciaFatura?: number;
  resultadoDeduplicacao?: ValidacaoDeduplicacaoResultado;
  erros?: string[];
}

export class MovimentoRecalculoService {
  /**
   * Verifica se o usuário autenticado precisa de saneamento e recálculo de movimentos
   * com base na versão das regras já aplicadas ou sob demanda explícita (ex: após importação).
   */
  public static async verificarERecalcularSeNecessario(
    usuarioId: string,
    forcar: boolean = false
  ): Promise<RecalculoMovimentosResultado> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, nome: true, versaoRegrasMovimentos: true },
    });

    if (!usuario) {
      throw new Error(`Usuário [${usuarioId}] não encontrado.`);
    }

    const versaoAnterior = usuario.versaoRegrasMovimentos ?? 1;

    // Se já estiver na versão atual ou superior e não for forçado, não reprocessa
    if (!forcar && versaoAnterior >= VERSAO_REGRAS_MOVIMENTOS_ATUAL) {
      return {
        usuarioId,
        versaoAnterior,
        versaoAplicada: versaoAnterior,
        recalculado: false,
        totalMovimentosAvaliados: 0,
        totalConvertidosParaReceita: 0,
        totalCategoriasRefinadasCombinatorio: 0,
      };
    }

    // Executa recálculo estritamente isolado para o usuário
    return await this.executarRecalculoParaUsuario(usuarioId, versaoAnterior);
  }

  /**
   * Executa a rotina de saneamento para o usuário e atualiza versaoRegrasMovimentos no banco.
   * Isolamento Multi-tenant estrito: filtros sempre fixados no usuarioId.
   * REGRA DE OURO (TASK-43): Registros com categoriaFixadaPeloUsuario === true são intocáveis.
   */
  public static async executarRecalculoParaUsuario(
    usuarioId: string,
    versaoAnterior: number = 1
  ): Promise<RecalculoMovimentosResultado> {
    // 1. Busca todos os movimentos do usuário que estejam como TRANSFERENCIA_PROPRIA
    // mas cuja descrição atenda ao padrão universal de salários/proventos/PLR (BUG-09)
    // TASK-45: Registros com validadoDedupe = 'S' e categoriaFixadaPeloUsuario = true foram validados pelo usuário e não devem ser reprocessados
    const movimentosCandidatos = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: 'TRANSFERENCIA_PROPRIA',
        NOT: {
          validadoDedupe: 'S',
          categoriaFixadaPeloUsuario: true,
        },
      },
    });

    const idsParaConverterReceita: string[] = [];

    for (const mov of movimentosCandidatos) {
      if (REGEX_PROVENTOS_SALARIO_PLR.test(mov.descricao)) {
        idsParaConverterReceita.push(mov.id);
      }
    }

    // 2. Reconhecimento Retrospectivo de Aportes/Investimentos (TASK-44):
    // Busca movimentos do usuário classificados como DESPESA onde a categoria NÃO foi fixada pelo usuário
    // e cuja descrição contenha termos inequívocos de aplicação de CDB, tesouro, poupança ou investimentos.
    // TASK-45: Registros validados soberanamente pelo usuário (validadoDedupe = 'S' e categoriaFixadaPeloUsuario = true) são intocáveis.
    const despesasCandidatasAporte = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: 'DESPESA',
        categoriaFixadaPeloUsuario: false,
        NOT: {
          validadoDedupe: 'S',
        },
      },
      select: {
        id: true,
        descricao: true,
      },
    });

    const idsParaConverterAporte: string[] = [];
    for (const mov of despesasCandidatasAporte) {
      if (REGEX_APORTES_INVESTIMENTOS.test(mov.descricao)) {
        idsParaConverterAporte.push(mov.id);
      }
    }

    // 3. Reconhecimento Retrospectivo de Transferências Próprias do Titular (TASK-48):
    // Busca movimentos do usuário classificados erroneamente como DESPESA ou RECEITA
    // cuja descrição contenha o nome do titular (exceto proventos/salário/PLR já tratados)
    // ou resgates/pagamentos de fatura, convertendo-os para TRANSFERENCIA_PROPRIA.
    // 2. Extrai nomes/titularidades conhecidas do usuário (nome de perfil e titulares nos nomes de contas cadastradas)
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nome: true },
    });
    const nomeTitular = usuario?.nome?.trim();

    // Busca titulares identificados nos nomes das contas do usuário, ex: "Inter Final 3788 (MANUEL A H JARA)"
    const contasUsuario = await prisma.conta.findMany({
      where: { usuarioId },
      select: { nome: true },
    });
    const titularesConhecidos = new Set<string>();
    if (nomeTitular) {
      titularesConhecidos.add(nomeTitular.toUpperCase());
    }
    for (const c of contasUsuario) {
      const matchParen = c.nome.match(/\(([^)]+)\)/);
      if (matchParen) {
        const titularConta = matchParen[1].trim().toUpperCase();
        if (titularConta.length >= 5) {
          titularesConhecidos.add(titularConta);
        }
      }
    }

    const idsParaConverterTransferenciaPropria: string[] = [];
    // Busca movimentos do usuário classificados como DESPESA ou RECEITA que não foram fixados manualmente pelo usuário
    const movimentosCandidatosTransf = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: { in: ['DESPESA', 'RECEITA'] },
        categoriaFixadaPeloUsuario: false,
      },
      select: {
        id: true,
        descricao: true,
        observacao: true,
      },
    });

    const regexTermosTransfPropria =
      /transfer[êe]ncia\s+(?:entre\s+contas|de\s+mesma\s+titularidade)|transf\s+mesma\s+titularidade|mesma\s+titularidade|pr[óo]prio\s+titular|contas\s+pr[óo]prias|pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|fatura\s*cart[aã]o|debito\s*automatico\s*fatura|pag\s*fatura/i;

    for (const mov of movimentosCandidatosTransf) {
      // Regra de Ouro: Proventos de salário, conta salário ou PLR legítimos NUNCA são convertidos
      if (REGEX_PROVENTOS_SALARIO_PLR.test(mov.descricao) || REGEX_PROVENTOS_SALARIO_PLR.test(mov.observacao || '')) {
        continue;
      }

      let isTransferenciaPropria = false;

      // 1. Checagem por termos inequívocos na descrição ou observação do extrato
      if (regexTermosTransfPropria.test(mov.descricao) || regexTermosTransfPropria.test(mov.observacao || '')) {
        isTransferenciaPropria = true;
      }

      // 2. Checagem por correspondência do nome do titular cadastrado ou titulares das contas próprias
      if (!isTransferenciaPropria) {
        const descUpper = mov.descricao.toUpperCase();
        for (const titular of titularesConhecidos) {
          const partesNome = titular.split(/\s+/).filter((p) => p.length >= 3);
          const containsNomeCompleto = descUpper.includes(titular);
          const containsPartesSignificativas =
            partesNome.length >= 2 &&
            partesNome.every((p) => descUpper.includes(p));

          if (containsNomeCompleto || containsPartesSignificativas) {
            isTransferenciaPropria = true;
            break;
          }
        }
      }

      if (isTransferenciaPropria) {
        idsParaConverterTransferenciaPropria.push(mov.id);
      }
    }

    // 3. Inteligência Combinatória (TASK-43):
    // Busca movimentos do usuário onde a categoria NÃO foi fixada manualmente pelo usuário
    // e avalia se o classificador combinatório oferece sugestão refinada de alta confiança.
    // TASK-45: Se o registro já foi validado pelo usuário soberanamente, não é alterado
    const movimentosParaRefinar = await prisma.movimento.findMany({
      where: {
        usuarioId,
        categoriaFixadaPeloUsuario: false,
        NOT: {
          validadoDedupe: 'S',
        },
      },
      select: {
        id: true,
        descricao: true,
        dataMovimento: true,
        valor: true,
        categoriaId: true,
      },
    });

    // Cache local de categorias resolvidas por nome para evitar queries excessivas no loop
    const cacheCategoriasPorNome = new Map<string, string | null>();

    const resolverCategoriaId = async (nomeBusca: string): Promise<string | null> => {
      const chave = nomeBusca.toLowerCase().trim();
      if (cacheCategoriasPorNome.has(chave)) {
        return cacheCategoriasPorNome.get(chave) || null;
      }

      const nomeSemAcento = nomeBusca.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      let cat = await prisma.categoria.findFirst({
        where: {
          OR: [
            { usuarioId, nome: { equals: nomeBusca, mode: 'insensitive' } },
            { usuarioId: null, nome: { equals: nomeBusca, mode: 'insensitive' } },
            { usuarioId, nome: { equals: nomeSemAcento, mode: 'insensitive' } },
            { usuarioId: null, nome: { equals: nomeSemAcento, mode: 'insensitive' } },
          ],
        },
      });

      if (!cat) {
        cat = await prisma.categoria.findFirst({
          where: {
            OR: [
              { usuarioId, nome: { contains: nomeBusca, mode: 'insensitive' } },
              { usuarioId: null, nome: { contains: nomeBusca, mode: 'insensitive' } },
              { usuarioId, nome: { contains: nomeSemAcento, mode: 'insensitive' } },
              { usuarioId: null, nome: { contains: nomeSemAcento, mode: 'insensitive' } },
            ],
          },
        });
      }

      const idEncontrado = cat ? cat.id : null;
      cacheCategoriasPorNome.set(chave, idEncontrado);
      return idEncontrado;
    };

    // Carrega regras de vendedor do próprio usuário para aplicar durante o recálculo
    const regrasVendedorUsuario = await prisma.regraVendedorCategoria.findMany({
      where: { usuarioId },
    });
    const mapaRegrasVendedor = new Map<string, string>();
    for (const r of regrasVendedorUsuario) {
      mapaRegrasVendedor.set(r.termoVendedor.toLowerCase().trim(), r.categoriaId);
    }

    const atualizacoesCategoria: Array<{ id: string; categoriaId: string; fixada?: boolean }> = [];

    for (const mov of movimentosParaRefinar) {
      const raiz = extrairRaizComerciante(mov.descricao)?.toLowerCase().trim();
      let categoriaIdDestino: string | null = null;
      let fixadaPelaRegra = false;

      // 1. Prioridade: Regra explícita de vendedor definida pelo usuário
      if (raiz && mapaRegrasVendedor.has(raiz)) {
        categoriaIdDestino = mapaRegrasVendedor.get(raiz)!;
        fixadaPelaRegra = true;
      }

      // 2. Classificador Combinatório (TASK-43)
      if (!categoriaIdDestino) {
        const inferencia = classificadorCombinatorioService.inferirCategoria(
          mov.descricao,
          mov.dataMovimento,
          Number(mov.valor)
        );

        if (inferencia && inferencia.confianca >= 0.90) {
          categoriaIdDestino = await resolverCategoriaId(inferencia.categoriaSugerida);
        }
      }

      if (categoriaIdDestino && categoriaIdDestino !== mov.categoriaId) {
        atualizacoesCategoria.push({
          id: mov.id,
          categoriaId: categoriaIdDestino,
          fixada: fixadaPelaRegra,
        });
      }
    }

    // 4. Alinhamento de Competência Financeira de Compras Parceladas de Cartão (Versão 9):
    // Quando uma compra é parcelada (Parcela X/Y), a exigibilidade financeira e o desembolso da parcela
    // pertencem à fatura onde ela é cobrada. Se ela foi gravada com competência antiga (data da compra original),
    // realocamos para o mês e ano da fatura (dia 10 ou dia da data de fechamento), gerando nova chave dedupe determinística.
    const despesasCartaoComOrigem = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: 'DESPESA',
        origemDocumento: { not: null },
      },
      select: {
        id: true,
        contaId: true,
        dataMovimento: true,
        competencia: true,
        descricao: true,
        valor: true,
        origemDocumento: true,
        idOrigem: true,
        observacao: true,
      },
    });

    const atualizacoesParcelasFatura: Array<{
      id: string;
      novaData: Date;
      novaCompetencia: string;
      novaChaveDedupe: string;
      novaObservacao?: string;
    }> = [];

    for (const mov of despesasCartaoComOrigem) {
      const compFatura = inferirCompetenciaFaturaDocumento(mov.origemDocumento);
      if (!compFatura || compFatura === mov.competencia) {
        continue;
      }

      const matchParc = mov.descricao.match(/(?:parcela\s+)?(\d+)\s*(?:\/|\s+de\s+)\s*(\d+)/i);
      if (!matchParc) continue;
      const parcAtual = parseInt(matchParc[1], 10);
      const totalParc = parseInt(matchParc[2], 10);
      if (totalParc <= 1) continue;

      const dataStrOriginal = mov.dataMovimento.toISOString().substring(0, 10);
      const diaOriginal = dataStrOriginal.substring(8, 10);
      const diaCompetencia = diaOriginal || '10';
      const novaData = new Date(`${compFatura}-${diaCompetencia}T00:00:00.000Z`);

      const novaChaveDedupe = `DEDUPE_PARC_${mov.contaId}_${compFatura}_${Number(mov.valor).toFixed(2)}_${mov.descricao.trim().toLowerCase()}`;

      let novaObservacao = mov.observacao || '';
      if (!novaObservacao.includes('Compra original')) {
        novaObservacao = novaObservacao
          ? `${novaObservacao} (Compra original parcelada em ${dataStrOriginal})`
          : `Compra original parcelada em ${dataStrOriginal}`;
      }

      atualizacoesParcelasFatura.push({
        id: mov.id,
        novaData,
        novaCompetencia: compFatura,
        novaChaveDedupe,
        novaObservacao,
      });
    }

    let totalConvertidos = 0;
    let totalConvertidosAporte = 0;
    let totalConvertidosTransfPropria = 0;
    let totalCategoriasRefinadas = 0;
    let totalParcelasAlinhadas = 0;

    await prisma.$transaction(async (tx) => {
      // Atualiza naturezas de proventos/salário identificados
      if (idsParaConverterReceita.length > 0) {
        const updateResult = await tx.movimento.updateMany({
          where: {
            id: { in: idsParaConverterReceita },
            usuarioId, // Dupla garantia multi-tenant dentro da transação
          },
          data: {
            natureza: 'RECEITA',
          },
        });
        totalConvertidos = updateResult.count;
      }

      // Atualiza naturezas de aportes/investimentos identificados (TASK-44)
      if (idsParaConverterAporte.length > 0) {
        const updateResultAporte = await tx.movimento.updateMany({
          where: {
            id: { in: idsParaConverterAporte },
            usuarioId, // Dupla garantia multi-tenant dentro da transação
          },
          data: {
            natureza: 'APORTE_PATRIMONIAL',
          },
        });
        totalConvertidosAporte = updateResultAporte.count;
      }

      // Atualiza naturezas de transferências próprias do titular identificadas (TASK-48)
      if (idsParaConverterTransferenciaPropria.length > 0) {
        const updateResultTransf = await tx.movimento.updateMany({
          where: {
            id: { in: idsParaConverterTransferenciaPropria },
            usuarioId, // Dupla garantia multi-tenant dentro da transação
          },
          data: {
            natureza: 'TRANSFERENCIA_PROPRIA',
          },
        });
        totalConvertidosTransfPropria = updateResultTransf.count;

        // Auto-resolve suspeitas de categorização pendentes para transferências próprias
        await tx.suspeitaMovimento.updateMany({
          where: {
            usuarioId,
            status: 'PENDENTE',
            tipo: 'SUSPEITA_CATEGORIZACAO',
            movimentoId: { in: idsParaConverterTransferenciaPropria },
          },
          data: {
            status: 'RESOLVIDO',
            acaoAplicada: 'CONVERTER_TRANSFERENCIA_PROPRIA',
            resolvidoEm: new Date(),
          },
        });
      }

      // Aplica atualização refinada das categorias identificadas (regras de vendedor ou combinatórias)
      for (const item of atualizacoesCategoria) {
        await tx.movimento.update({
          where: { id: item.id },
          data: {
            categoriaId: item.categoriaId,
            ...(item.fixada && {
              categoriaFixadaPeloUsuario: true,
              validadoDedupe: 'S',
            }),
          },
        });
        totalCategoriasRefinadas++;
      }

      // Aplica alinhamento de competência de compras parceladas de cartão (Versão 9)
      for (const item of atualizacoesParcelasFatura) {
        await tx.movimento.update({
          where: { id: item.id },
          data: {
            dataMovimento: item.novaData,
            competencia: item.novaCompetencia,
            chaveDedupe: item.novaChaveDedupe,
            observacao: item.novaObservacao,
          },
        });
        totalParcelasAlinhadas++;
      }

      // Atualiza a versão de regras aplicada no cadastro do usuário
      const versaoFinal = Math.max(versaoAnterior, VERSAO_REGRAS_MOVIMENTOS_ATUAL);
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          versaoRegrasMovimentos: versaoFinal,
        },
      });
    });

    // 5. Malha Fina de Deduplicação Inteligente (BUG-15):
    // Como a nova versão atualizou regras de deduplicação semântica, executa malha fina
    // completa com reprocessarTudo para reavaliar todos os movimentos contra duplicatas.
    let resultadoDeduplicacao: ValidacaoDeduplicacaoResultado | undefined;
    try {
      resultadoDeduplicacao = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId, {
        reprocessarTudo: true,
      });
    } catch (err) {
      console.error(
        `[MovimentoRecalculoService] Erro ao executar malha fina de deduplicação para usuário [${usuarioId}]:`,
        err
      );
    }

    return {
      usuarioId,
      versaoAnterior,
      versaoAplicada: Math.max(versaoAnterior, VERSAO_REGRAS_MOVIMENTOS_ATUAL),
      recalculado: true,
      totalMovimentosAvaliados:
        movimentosCandidatos.length +
        despesasCandidatasAporte.length +
        movimentosParaRefinar.length +
        despesasCartaoComOrigem.length,
      totalConvertidosParaReceita: totalConvertidos,
      totalConvertidosParaAportePatrimonial: totalConvertidosAporte,
      totalConvertidosParaTransferenciaPropria: totalConvertidosTransfPropria,
      totalCategoriasRefinadasCombinatorio: totalCategoriasRefinadas,
      totalParcelasAlinhadasCompetenciaFatura: totalParcelasAlinhadas,
      resultadoDeduplicacao,
    };
  }
}
