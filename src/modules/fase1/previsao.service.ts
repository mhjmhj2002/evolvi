import { prisma } from '../../infrastructure/database/prisma.js';
import { configuracaoService } from '../usuario/configuracao.service.js';
import {
  PrevisaoSeisMesesResponse,
  ProjecaoMesItem,
  DecomposicaoCategoriasResponse,
  DecomposicaoCategoriaItem,
  ProjecaoTresCamadasResponse,
  ItemGastoRecorrente,
  ItemParcelamentoFuturo,
  ItemGastoVariavel,
} from './previsao.schema.js';
import { mediaMensalService } from '../media-mensal/media-mensal.service.js';
import { calcularUltimosMesesFechados } from './baseline.service.js';

/**
 * Baseline auditado do consumo variável por Categoria POF (FIN-161 e Auditoria_FIN161).
 * Total mensal padrão auditado: R$ 5.474,02
 */
export const CONSUMO_VARIAVEL_AUDITADO_PADRAO: Record<string, number> = {
  Moradia: 177.03,
  Transporte: 673.07,
  Alimentacao: 3345.06,
  Educacao: 44.36,
  Viagem: 0.0,
  Pets: 213.81,
  Saude: 487.21,
  'Servicos digitais': 0.0,
  'Vestuario e acessorios': 132.38,
  Impostos: 0.0,
  Telecomunicacoes: 120.0,
  'Cuidados pessoais': 80.26,
  Seguros: 0.0,
  Outros: 0.0,
  Lazer: 91.62,
  'Apoio familiar': 0.0,
  'Tarifas financeiras': 0.0,
  Financeiro: 0.0,
  Trabalho: 0.0,
  Desconhecida: 109.22,
  Tecnologia: 0.0,
};

/**
 * Mapeamento do rateio das 4 séries Amazon mistas de caixa registradas em FIN-161.
 */
export const AMAZON_SPLITS_AUDITADOS: Record<string, Record<string, number>> = {
  'NUBANK|AMAZON MKTPLC|7': {
    Moradia: 23.44,
    Alimentacao: 5.45,
    'Cuidados pessoais': 16.08,
    Pets: 7.09,
  },
  'NUBANK|AMAZON|10': {
    Moradia: 17.65,
    'Cuidados pessoais': 31.26,
    Pets: 4.68,
  },
  'NUBANK|AMAZON|6': {
    Moradia: 23.46,
    'Cuidados pessoais': 19.78,
    Pets: 8.38,
  },
  'NUBANK|AMAZON|7': {
    Moradia: 28.54,
    'Cuidados pessoais': 18.97,
    Pets: 7.2,
  },
};

/**
 * Converte YYYY-MM para número inteiro de meses.
 */
export function compToMonths(comp: string): number {
  const [ano, mes] = comp.split('-').map(Number);
  return ano * 12 + mes;
}

/**
 * Adiciona N meses a uma competência YYYY-MM.
 */
export function addMeses(comp: string, meses: number): string {
  const [anoStr, mesStr] = comp.split('-');
  let ano = parseInt(anoStr, 10);
  let mes = parseInt(mesStr, 10);
  mes += meses;
  while (mes > 12) {
    mes -= 12;
    ano += 1;
  }
  while (mes < 1) {
    mes += 12;
    ano -= 1;
  }
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

/**
 * Retorna as próximas N competências a partir de uma competência inicial (inclusiva).
 */
export function gerarCompetenciasFuturas(competenciaInicial: string, totalMeses = 6): string[] {
  const res: string[] = [];
  for (let i = 0; i < totalMeses; i++) {
    res.push(addMeses(competenciaInicial, i));
  }
  return res;
}

export class PrevisaoProjecaoService {
  /**
   * Armazena calibrações personalizadas de consumo variável por usuário em memória
   * (chave: usuarioId -> { categoriaNome: valor })
   */
  private calibracoesVariavel = new Map<string, Record<string, number>>();

  private normalizarNome(nome: string): string {
    return nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  /**
   * Obtém os valores da camada variável auditada para o usuário.
   */
  obterVariavelAuditadaUsuario(usuarioId: string): Record<string, number> {
    const calibrado = this.calibracoesVariavel.get(usuarioId) || {};
    return {
      ...CONSUMO_VARIAVEL_AUDITADO_PADRAO,
      ...calibrado,
    };
  }

  /**
   * Ajusta calibração da camada de consumo variável auditada para o usuário.
   */
  ajustarVariavelAuditada(
    usuarioId: string,
    ajustes: Array<{ categoriaId?: string; categoriaNome?: string; valor: number }>
  ): Record<string, number> {
    const atual = this.calibracoesVariavel.get(usuarioId) || {};
    for (const aj of ajustes) {
      if (aj.categoriaNome) {
        atual[aj.categoriaNome] = aj.valor;
      }
    }
    this.calibracoesVariavel.set(usuarioId, atual);
    return this.obterVariavelAuditadaUsuario(usuarioId);
  }

  /**
   * Calcula a projeção financeira das competências futuras (M-005)
   * Utiliza a janela configurada do usuário (3 a 12 meses) se não especificada.
   */
  async calcularProjecaoSeisMeses(
    usuarioId: string,
    competenciaReferenciaParam?: string,
    mesesProjecaoParam?: number
  ): Promise<PrevisaoSeisMesesResponse> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });
    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0.0;

    const mesesProjecao =
      mesesProjecaoParam && mesesProjecaoParam >= 3 && mesesProjecaoParam <= 12
        ? mesesProjecaoParam
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    // Se não informada, a competência de início é a corrente ou '2026-10' por padrão do projeto
    let compInicio = competenciaReferenciaParam;
    if (!compInicio) {
      const agora = new Date();
      compInicio = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    }

    const mesesFuturos = gerarCompetenciasFuturas(compInicio, mesesProjecao);

    // 1. Buscar parcelamentos ativos do usuário
    const parcelamentosAtivos = await prisma.parcelamento.findMany({
      where: {
        usuarioId,
        status: 'ATIVO',
      },
      include: {
        categoria: {
          select: { id: true, nome: true },
        },
      },
    });

    // 2. Buscar recorrências ativas do usuário
    const recorrenciasAtivas = await prisma.recorrencia.findMany({
      where: {
        usuarioId,
        status: 'ATIVA',
      },
      include: {
        categoria: {
          select: { id: true, nome: true },
        },
      },
    });

    // Verifica se o usuário já possui movimentações ou importações próprias registradas no sistema
    const temDadosProprios =
      parcelamentosAtivos.length > 0 ||
      recorrenciasAtivas.length > 0 ||
      (await prisma.movimento.count({ where: { usuarioId } })) > 0 ||
      (await prisma.loteImportacao.count({ where: { usuarioId } })) > 0;

    // Total de recorrentes ativas cadastradas ou fallback canônico FIN-161 se usuário for novo sem dados
    let totalRecorrentesBase = 0;
    if (recorrenciasAtivas.length > 0) {
      totalRecorrentesBase = Number(
        recorrenciasAtivas.reduce((acc, r) => acc + Number(r.valorReferencia), 0).toFixed(2)
      );
    } else if (!temDadosProprios) {
      // Valor auditado canônico FIN-161 para usuário demo/teste sem histórico: R$ 4.482,80
      totalRecorrentesBase = 4482.8;
    } else {
      totalRecorrentesBase = 0.0;
    }

    // Camada variável auditada
    const variavelAuditadaMap = this.obterVariavelAuditadaUsuario(usuarioId);
    const totalVariavelMensal = Number(
      Object.values(variavelAuditadaMap)
        .reduce((acc, v) => acc + v, 0)
        .toFixed(2)
    );

    const meses: ProjecaoMesItem[] = [];
    let totalParcelamentosPeriodo = 0;
    let totalRecorrentesPeriodo = 0;
    let totalVariavelPeriodo = 0;
    let totalGeralProjetadoPeriodo = 0;
    let saldoAcumuladoPeriodo = 0;

    for (const comp of mesesFuturos) {
      const targetM = compToMonths(comp);

      let parcelasMes = 0;
      if (parcelamentosAtivos.length > 0) {
        for (const parc of parcelamentosAtivos) {
          const m1 = compToMonths(parc.primeiroVencimento);
          const mu = compToMonths(parc.ultimoVencimento);
          if (targetM >= m1 && targetM <= mu) {
            parcelasMes += Number(parc.parcelaValor);
          }
        }
      } else if (!temDadosProprios) {
        // Fallback canônico exato da Previsao_Mensal FIN-161 apenas se usuário não tem histórico/dados
        const fallbackParc: Record<string, number> = {
          '2026-10': 3440.03,
          '2026-11': 1667.62,
          '2026-12': 1337.3,
          '2027-01': 1337.3,
          '2027-02': 1285.24,
          '2027-03': 1285.24,
          '2027-04': 1226.99,
          '2027-05': 1086.03,
          '2027-06': 1052.91,
          '2027-07': 364.65,
          '2027-08': 364.65,
        };
        parcelasMes = fallbackParc[comp] ?? 1285.24;
      } else {
        parcelasMes = 0.0;
      }
      parcelasMes = Number(parcelasMes.toFixed(2));

      const recorrentesMes = totalRecorrentesBase;
      const variavelMes = totalVariavelMensal;
      const totalProjetado = Number((parcelasMes + recorrentesMes + variavelMes).toFixed(2));
      const saldoProjetado = Number((rendaBase - totalProjetado).toFixed(2));

      let statusSaldo: 'SUPERAVIT' | 'DEFICIT' | 'ZERO_A_ZERO' = 'ZERO_A_ZERO';
      if (saldoProjetado > 0) statusSaldo = 'SUPERAVIT';
      else if (saldoProjetado < 0) statusSaldo = 'DEFICIT';

      const observacao = temDadosProprios && parcelamentosAtivos.length === 0 && recorrenciasAtivas.length === 0
        ? `Projeção calculada: Parcelas R$ ${parcelasMes.toFixed(2)} + Recorrentes R$ ${recorrentesMes.toFixed(2)} + Variável R$ ${variavelMes.toFixed(2)}`
        : `BASE FIN-161: Parcelas R$ ${parcelasMes.toFixed(2)} + Recorrentes R$ ${recorrentesMes.toFixed(2)} + Variável R$ ${variavelMes.toFixed(2)}`;

      meses.push({
        competencia: comp,
        parcelamentos: parcelasMes,
        recorrentes: recorrentesMes,
        variavelAuditada: variavelMes,
        totalProjetado,
        rendaBase,
        saldoProjetado,
        statusSaldo,
        observacao,
      });

      totalParcelamentosPeriodo += parcelasMes;
      totalRecorrentesPeriodo += recorrentesMes;
      totalVariavelPeriodo += variavelMes;
      totalGeralProjetadoPeriodo += totalProjetado;
      saldoAcumuladoPeriodo += saldoProjetado;
    }

    return {
      competenciaReferencia: compInicio,
      rendaBaseMensal: rendaBase,
      mesesProjetados: mesesFuturos,
      totalParcelamentosPeriodo: Number(totalParcelamentosPeriodo.toFixed(2)),
      totalRecorrentesPeriodo: Number(totalRecorrentesPeriodo.toFixed(2)),
      totalVariavelPeriodo: Number(totalVariavelPeriodo.toFixed(2)),
      totalGeralProjetadoPeriodo: Number(totalGeralProjetadoPeriodo.toFixed(2)),
      saldoAcumuladoPeriodo: Number(saldoAcumuladoPeriodo.toFixed(2)),
      meses,
    };
  }

  /**
   * Retorna a decomposição detalhada por categoria das 3 camadas para uma competência específica
   */
  async obterDecomposicaoCategorias(
    usuarioId: string,
    competencia: string
  ): Promise<DecomposicaoCategoriasResponse> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });
    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0.0;

    // Buscar as 21 categorias consolidadas POF do sistema
    const categorias = await prisma.categoria.findMany({
      where: {
        categoriaPaiId: null,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });

    const variavelMap = this.obterVariavelAuditadaUsuario(usuarioId);

    // Buscar recorrências ativas
    const recorrencias = await prisma.recorrencia.findMany({
      where: { usuarioId, status: 'ATIVA' },
      include: { categoria: true },
    });

    // Buscar parcelamentos ativos
    const parcelamentos = await prisma.parcelamento.findMany({
      where: { usuarioId, status: 'ATIVO' },
      include: { categoria: true },
    });

    const targetM = compToMonths(competencia);

    // Mapear por nome normalizado de categoria
    const recPorCat = new Map<string, number>();
    const parcPorCat = new Map<string, number>();

    for (const r of recorrencias) {
      const catNome = r.categoria?.nome || 'Desconhecida';
      const norm = this.normalizarNome(catNome);
      recPorCat.set(norm, (recPorCat.get(norm) || 0) + Number(r.valorReferencia));
    }

    for (const p of parcelamentos) {
      const m1 = compToMonths(p.primeiroVencimento);
      const mu = compToMonths(p.ultimoVencimento);
      if (targetM >= m1 && targetM <= mu) {
        const catNome = p.categoria?.nome || 'Desconhecida';
        const norm = this.normalizarNome(catNome);
        parcPorCat.set(norm, (parcPorCat.get(norm) || 0) + Number(p.parcelaValor));
      }
    }

    // Verifica se o usuário já possui dados próprios no sistema
    const temDadosProprios =
      recorrencias.length > 0 ||
      parcelamentos.length > 0 ||
      (await prisma.movimento.count({ where: { usuarioId } })) > 0 ||
      (await prisma.loteImportacao.count({ where: { usuarioId } })) > 0;

    // Se o usuário não tiver dados no sistema (novo/demo), usar valores canônicos da Auditoria_FIN161
    const usarFallbackCanonical = !temDadosProprios;

    // Tabela canônica FIN-161 para as 21 categorias
    const canonicalFin161: Record<string, { rec: number; parcOut: number; parcNov: number; parcDez: number; fund?: string }> = {
      Moradia: { rec: 2353.41, parcOut: 1128.7, parcNov: 860.29, parcDez: 818.66, fund: 'Financiamento, condomínio e energia em Recorrentes; móveis e utensílios em Parcelamentos' },
      Transporte: { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Transporte público, combustível e apps em variável auditada' },
      Alimentacao: { rec: 0.0, parcOut: 543.66, parcNov: 5.45, parcDez: 5.45, fund: 'Consumo do dia a dia não parcelado; supermercado parcelado em parcelamentos' },
      Educacao: { rec: 1621.83, parcOut: 386.3, parcNov: 36.3, parcDez: 0.0, fund: 'Mensalidade escolar fixa em Recorrentes; materiais contratados em Parcelas' },
      Viagem: { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Meta zero de novas viagens na Fase 1' },
      Pets: { rec: 0.0, parcOut: 321.91, parcNov: 15.47, parcDez: 7.09, fund: 'Pet shop e alimentação em variável; itens parcelados em Petz/Amazon' },
      Saude: { rec: 0.0, parcOut: 99.13, parcNov: 0.0, parcDez: 0.0, fund: 'Farmácia e consultas em variável; parcela Raia Drogasil' },
      'Servicos digitais': { rec: 278.21, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Google One, ChatGPT, HBO, Spotify e Netflix ativos em Recorrentes' },
      'Vestuario e acessorios': { rec: 0.0, parcOut: 126.23, parcNov: 126.23, parcDez: 0.0, fund: 'Compras novas em variável; parcelas antigas Babei/LE SAC' },
      Impostos: { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Tributos anuais municipais já quitados' },
      Telecomunicacoes: { rec: 135.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Fibra LOGA em recorrentes e recargas móveis em variável' },
      'Cuidados pessoais': { rec: 0.0, parcOut: 144.34, parcNov: 94.11, parcDez: 74.33, fund: 'Estética Botoesthetic e rateios Amazon mistos ativos' },
      Seguros: { rec: 94.35, parcOut: 11.98, parcNov: 11.98, parcDez: 11.98, fund: 'Seguro residencial Santander + Cartão Inter; Superproteg em parcelas' },
      Outros: { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Zero para novos resíduos não identificados' },
      Lazer: { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Lazer cotidiano auditado' },
      'Apoio familiar': { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Sem provisionamento de gastos pontuais na Fase 1' },
      'Tarifas financeiras': { rec: 0.0, parcOut: 98.0, parcNov: 98.0, parcDez: 0.0, fund: 'Anuidade C6 Carbon ativa até nov/26' },
      Financeiro: { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Aporte de investimento fora do consumo zero-a-zero' },
      Trabalho: { rec: 0.0, parcOut: 67.12, parcNov: 67.12, parcDez: 67.12, fund: 'Material profissional Shopee até abr/27' },
      Desconhecida: { rec: 0.0, parcOut: 0.0, parcNov: 0.0, parcDez: 0.0, fund: 'Buffer de segurança para evitar economia fictícia' },
      Tecnologia: { rec: 0.0, parcOut: 512.66, parcNov: 352.67, parcDez: 352.67, fund: 'Notebook Casas Bahia + Magalu finalizada em out/26' },
    };

    let totalPrevistoMes = 0;
    let totalRecorrentes = 0;
    let totalParcelas = 0;
    let totalVariavel = 0;

    const itensCategorias: DecomposicaoCategoriaItem[] = [];

    // Lista de nomes POF padrão ordenados
    const nomesCategoriasPadrao = Object.keys(CONSUMO_VARIAVEL_AUDITADO_PADRAO);

    for (const nomeCat of nomesCategoriasPadrao) {
      const norm = this.normalizarNome(nomeCat);
      const catDb = categorias.find((c) => this.normalizarNome(c.nome) === norm);

      let valRec = recPorCat.get(norm) || 0;
      let valParc = parcPorCat.get(norm) || 0;
      const valVar = variavelMap[nomeCat] ?? 0;
      const canonical = canonicalFin161[nomeCat];

      if (usarFallbackCanonical && canonical) {
        valRec = canonical.rec;
        if (competencia === '2026-10') valParc = canonical.parcOut;
        else if (competencia === '2026-11') valParc = canonical.parcNov;
        else if (competencia >= '2026-12') valParc = canonical.parcDez;
      }

      valRec = Number(valRec.toFixed(2));
      valParc = Number(valParc.toFixed(2));
      const valVarNum = Number(valVar.toFixed(2));
      const totCat = Number((valRec + valParc + valVarNum).toFixed(2));

      totalRecorrentes += valRec;
      totalParcelas += valParc;
      totalVariavel += valVarNum;
      totalPrevistoMes += totCat;

      itensCategorias.push({
        categoriaId: catDb?.id,
        nome: nomeCat,
        ordem: catDb?.ordem ?? 0,
        recorrentes: valRec,
        parcelas: valParc,
        variavelAuditada: valVarNum,
        totalProjetado: totCat,
        percentualDoTotal: 0, // calculado abaixo
        fundamentacao: canonical?.fund,
      });
    }

    totalPrevistoMes = Number(totalPrevistoMes.toFixed(2));
    totalRecorrentes = Number(totalRecorrentes.toFixed(2));
    totalParcelas = Number(totalParcelas.toFixed(2));
    totalVariavel = Number(totalVariavel.toFixed(2));
    const saldoMes = Number((rendaBase - totalPrevistoMes).toFixed(2));

    // Calcular percentuais
    itensCategorias.forEach((item) => {
      item.percentualDoTotal =
        totalPrevistoMes > 0
          ? Number(((item.totalProjetado / totalPrevistoMes) * 100).toFixed(2))
          : 0;
    });

    // Ordenar por total projetado decrescente
    itensCategorias.sort((a, b) => b.totalProjetado - a.totalProjetado);

    return {
      competencia,
      rendaBase,
      totalPrevistoMes,
      totalRecorrentes,
      totalParcelas,
      totalVariavel,
      saldoMes,
      categorias: itensCategorias,
    };
  }

  /**
   * Obtém a projeção estruturada e separada estritamente nas 3 categorias:
   * 1. Gastos Recorrentes: Despesas que entram todo mês sem data de término e com baixa variação.
   * 2. Parcelamentos Futuros: Contratos/parcelas com vencimentos a partir da competência atual.
   * 3. Gastos Variáveis: Consumo rotineiro e restante das despesas da média apurada.
   * Síntese: Média total projetada dos X meses = Média Recorrentes + Média Parcelados + Média Variáveis.
   */
  async obterProjecaoTresCamadas(
    usuarioId: string,
    competenciaReferenciaParam?: string,
    mesesProjecaoParam?: number
  ): Promise<ProjecaoTresCamadasResponse> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rendaBaseMensal: true },
    });
    const rendaBase = usuario ? Number(usuario.rendaBaseMensal) : 0.0;

    const mesesJanela =
      mesesProjecaoParam && mesesProjecaoParam >= 1 && mesesProjecaoParam <= 24
        ? mesesProjecaoParam
        : await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    let compInicio = competenciaReferenciaParam;
    if (!compInicio) {
      const agora = new Date();
      compInicio = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    }

    const mesesFuturos = gerarCompetenciasFuturas(compInicio, mesesJanela);

    // 1. BLOCO 1: GASTOS RECORRENTES
    // Busca recorrências ativas cadastradas
    const recorrenciasDb = await prisma.recorrencia.findMany({
      where: { usuarioId, status: 'ATIVA' },
      include: { categoria: { select: { nome: true } } },
      orderBy: [{ diaPrevisto: 'asc' }, { descricao: 'asc' }],
    });

    const itensRecorrentes: ItemGastoRecorrente[] = [];
    const ehContratoRecorrente = (desc: string) => {
      const u = desc.toUpperCase();
      return (
        u.includes('EDP') ||
        u.includes('CLARO') ||
        u.includes('SEGURO CASA') ||
        u.includes('CONDOMINIO') ||
        u.includes('CREDITO IMOBILIARIO') ||
        u.includes('PREST CR IM') ||
        u.includes('UNIAO DE PROFESSORES') ||
        u.includes('ALUGUEL') ||
        u.includes('INTERNET') ||
        u.includes('ACADEMIA') ||
        u.includes('ESCOLA')
      );
    };

    let mediaRecorrentes = 0;

    if (recorrenciasDb.length > 0) {
      for (const rec of recorrenciasDb) {
        itensRecorrentes.push({
          id: rec.id,
          descricao: rec.descricao,
          categoriaNome: rec.categoria?.nome || 'Geral',
          valorMensal: Number(rec.valorReferencia),
          diaPrevisto: rec.diaPrevisto,
          essencial: rec.essencial,
          origem: 'CADASTRO',
        });
      }
      mediaRecorrentes = Number(
        itensRecorrentes.reduce((sum, r) => sum + r.valorMensal, 0).toFixed(2)
      );
    } else {
      // Se não houver recorrências cadastradas manualmente, detecta contratos regulares dos extratos
      const normalizarPadraoRecorrente = (desc: string) => {
        const u = desc.toUpperCase();
        if (u.includes('EDP')) return 'Energia Elétrica (EDP)';
        if (u.includes('ENEL')) return 'Energia Elétrica (Enel)';
        if (u.includes('CLARO')) return 'Telecomunicações / Internet (Claro)';
        if (u.includes('VIVO')) return 'Telecomunicações / Internet (Vivo)';
        if (u.includes('TIM')) return 'Telecomunicações (TIM)';
        if (u.includes('SEGURO CASA') || u.includes('SEGURO RESIDENCIAL')) return 'Seguro Residencial';
        if (u.includes('CONDOMINIO') || u.includes('ALTAIR')) return 'Condomínio Edifício Altair';
        if (u.includes('CREDITO IMOBILIARIO') || u.includes('PREST CR IM') || u.includes('HABITACIONAL')) return 'Financiamento Imobiliário';
        if (u.includes('UNIAO DE PROFESSORES') || (u.includes('MENSALIDADE') && u.includes('PROFESSORES'))) return 'Mensalidade Escolar';
        if (u.includes('NETFLIX')) return 'Netflix';
        if (u.includes('SPOTIFY')) return 'Spotify';
        return desc.trim();
      };

      // Inclui meses fechados + mês corrente para contemplar despesas já pagas no mês atual (ex: condomínio)
      const mesesFechados = calcularUltimosMesesFechados(compInicio, mesesJanela);
      const janelaAnalise = Array.from(new Set([compInicio, ...mesesFechados]));

      const movsJanela = await prisma.movimento.findMany({
        where: {
          usuarioId,
          natureza: 'DESPESA',
          competencia: { in: janelaAnalise },
        },
        include: { categoria: { select: { nome: true } } },
      });

      const agrupados = new Map<string, typeof movsJanela>();
      for (const m of movsJanela) {
        if (!ehContratoRecorrente(m.descricao)) continue;
        const chave = normalizarPadraoRecorrente(m.descricao);
        if (!agrupados.has(chave)) agrupados.set(chave, []);
        agrupados.get(chave)!.push(m);
      }

      for (const [chave, list] of agrupados.entries()) {
        // Agrupa por competência para calcular a média real do mês (se houver mais de um lançamento no mesmo mês)
        const porCompetencia = new Map<string, number>();
        for (const item of list) {
          porCompetencia.set(
            item.competencia,
            (porCompetencia.get(item.competencia) || 0) + Number(item.valor)
          );
        }

        const mesesComLancamento = porCompetencia.size;
        const totalItemJanela = Array.from(porCompetencia.values()).reduce((a, b) => a + b, 0);
        // O valor mensal do contrato recorrente é a média nos meses em que ocorreu o lançamento,
        // não sendo diluído por meses sem lançamento.
        const valorMensalRecorrente = mesesComLancamento > 0 ? totalItemJanela / mesesComLancamento : 0;

        itensRecorrentes.push({
          id: `det-${chave.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          descricao: chave,
          categoriaNome: list[0].categoria?.nome || 'Recorrente',
          valorMensal: Number(valorMensalRecorrente.toFixed(2)),
          essencial: true,
          origem: 'EXTRATO_DETECTADO',
          ocorrenciasDetectadas: list.length,
        });
      }

      mediaRecorrentes = Number(
        itensRecorrentes.reduce((sum, r) => sum + r.valorMensal, 0).toFixed(2)
      );
    }

    const totalRecorrentesPeriodo = Number((mediaRecorrentes * mesesJanela).toFixed(2));

    // 2. BLOCO 2: PARCELAMENTOS FUTUROS (a partir do mês corrente / compInicio)
    const parcelamentosDb = await prisma.parcelamento.findMany({
      where: {
        usuarioId,
        status: 'ATIVO',
        ultimoVencimento: { gte: compInicio },
      },
      include: {
        categoria: { select: { nome: true } },
        conta: { select: { nome: true } },
      },
      orderBy: { ultimoVencimento: 'asc' },
    });

    const itensParcelados: ItemParcelamentoFuturo[] = [];
    let totalParcelasPeriodo = 0;

    for (const parc of parcelamentosDb) {
      const vUnitario = Number(parc.parcelaValor);
      const m1 = compToMonths(parc.primeiroVencimento);
      const mu = compToMonths(parc.ultimoVencimento);

      // Quantas parcelas caem dentro da janela de meses projetados
      let parcelasNaJanela = 0;
      for (const compFutura of mesesFuturos) {
        const mTarget = compToMonths(compFutura);
        if (mTarget >= m1 && mTarget <= mu) {
          parcelasNaJanela++;
        }
      }

      const impactoContrato = Number((parcelasNaJanela * vUnitario).toFixed(2));
      totalParcelasPeriodo += impactoContrato;

      const parcelasRestantes = Math.max(0, parc.totalParcelas - parc.parcelaAtual + 1);
      const saldoDevedor = Number((parcelasRestantes * vUnitario).toFixed(2));

      itensParcelados.push({
        id: parc.id,
        descricao: parc.descricao,
        categoriaNome: parc.categoria?.nome || 'Geral',
        contaNome: parc.conta?.nome || 'Cartão de Crédito',
        parcelaValor: vUnitario,
        parcelaAtual: parc.parcelaAtual,
        totalParcelas: parc.totalParcelas,
        parcelasRestantes,
        saldoDevedorRestante: saldoDevedor,
        primeiroVencimento: parc.primeiroVencimento,
        ultimoVencimento: parc.ultimoVencimento,
        impactoPeriodo: impactoContrato,
        mediaMensalNaJanela: Number((impactoContrato / mesesJanela).toFixed(2)),
      });
    }

    totalParcelasPeriodo = Number(totalParcelasPeriodo.toFixed(2));
    const mediaParcelados = Number((totalParcelasPeriodo / mesesJanela).toFixed(2));

    // 3. BLOCO 3: GASTOS VARIÁVEIS (O restante dos gastos da média que não são recorrentes nem parcelados)
    const consolidadoMedia = await mediaMensalService.obterMediasConsolidadas(
      usuarioId,
      compInicio,
      mesesJanela
    );

    const itensVariaveis: ItemGastoVariavel[] = [];
    let mediaVariaveis = 0;

    // Se as recorrências vieram dos extratos, desmembrar a média excluindo os recorrentes para ter 100% de aderência à média global
    if (recorrenciasDb.length === 0) {
      const mesesFechados = calcularUltimosMesesFechados(compInicio, mesesJanela);
      const movsVariaveisJanela = await prisma.movimento.findMany({
        where: {
          usuarioId,
          natureza: 'DESPESA',
          competencia: { in: mesesFechados },
        },
        include: {
          categoria: { select: { id: true, nome: true } },
          exclusoesMedia: { where: { ativo: true } },
        },
      });

      const mapVarPorCat = new Map<string, { catId?: string; totalBruto: number; totalExcluido: number; count: number }>();

      for (const m of movsVariaveisJanela) {
        if (ehContratoRecorrente(m.descricao)) continue;

        const catNome = m.categoria ? m.categoria.nome : 'Desconhecida';
        const catId = m.categoria?.id;
        const v = Number(m.valor);
        const estaExcluido = m.exclusoesMedia.length > 0;

        if (!mapVarPorCat.has(catNome)) {
          mapVarPorCat.set(catNome, { catId, totalBruto: 0, totalExcluido: 0, count: 0 });
        }
        const itemCat = mapVarPorCat.get(catNome)!;
        itemCat.totalBruto += v;
        itemCat.count++;
        if (estaExcluido) {
          itemCat.totalExcluido += v;
        }
      }

      for (const [catNome, dados] of mapVarPorCat.entries()) {
        const efetivo = dados.totalBruto - dados.totalExcluido;
        const mediaEfetiva = Number((efetivo / mesesJanela).toFixed(2));
        itensVariaveis.push({
          categoriaId: dados.catId,
          categoriaNome: catNome,
          mediaMensalEfetiva: mediaEfetiva,
          totalPeriodoEfetivo: Number(efetivo.toFixed(2)),
          totalPeriodoBruto: Number(dados.totalBruto.toFixed(2)),
          totalExcluido: Number(dados.totalExcluido.toFixed(2)),
          qtdLancamentos: dados.count,
        });
      }

      mediaVariaveis = Number(
        itensVariaveis.reduce((sum, v) => sum + v.mediaMensalEfetiva, 0).toFixed(2)
      );
    } else {
      // Se houver recorrências cadastradas pelo usuário, a média de variáveis vem da tabela consolidada
      for (const cat of consolidadoMedia.categorias) {
        if (cat.mediaMensalEfetiva > 0 || cat.totalPeriodoEfetivo > 0) {
          itensVariaveis.push({
            categoriaId: cat.categoriaId,
            categoriaNome: cat.nome,
            mediaMensalEfetiva: cat.mediaMensalEfetiva,
            totalPeriodoEfetivo: cat.totalPeriodoEfetivo,
            totalPeriodoBruto: cat.totalPeriodoBruto,
            totalExcluido: cat.totalExcluido,
            qtdLancamentos: cat.qtdLancamentosTotais,
          });
        }
      }
      mediaVariaveis = Number(
        (consolidadoMedia.global?.mediaMensalEfetiva || itensVariaveis.reduce((sum, v) => sum + v.mediaMensalEfetiva, 0)).toFixed(2)
      );
    }

    const totalVariaveisPeriodo = Number((mediaVariaveis * mesesJanela).toFixed(2));

    // 4. SÍNTESE E FÓRMULA FINAL
    const mediaTotalProjetada = Number(
      (mediaRecorrentes + mediaParcelados + mediaVariaveis).toFixed(2)
    );
    const totalGeralPeriodo = Number((mediaTotalProjetada * mesesJanela).toFixed(2));
    const saldoMensalProjetado = Number((rendaBase - mediaTotalProjetada).toFixed(2));

    const statusSaldo: 'SUPERAVIT' | 'DEFICIT' | 'ZERO_A_ZERO' =
      saldoMensalProjetado > 0.05
        ? 'SUPERAVIT'
        : saldoMensalProjetado < -0.05
        ? 'DEFICIT'
        : 'ZERO_A_ZERO';

    const formulaExplicativa = `Média Projetada (${mediaTotalProjetada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) = Recorrentes (${mediaRecorrentes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) + Parcelados (${mediaParcelados.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) + Variáveis (${mediaVariaveis.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`;

    return {
      competenciaReferencia: compInicio,
      mesesJanela,
      mesesProjetados: mesesFuturos,
      rendaBaseMensal: rendaBase,
      recorrentes: {
        itens: itensRecorrentes,
        mediaMensal: mediaRecorrentes,
        totalPeriodo: totalRecorrentesPeriodo,
      },
      parcelamentos: {
        itens: itensParcelados,
        mediaMensal: mediaParcelados,
        totalPeriodo: totalParcelasPeriodo,
      },
      variaveis: {
        itens: itensVariaveis,
        mediaMensal: mediaVariaveis,
        totalPeriodo: totalVariaveisPeriodo,
      },
      sintese: {
        mediaRecorrentes,
        mediaParcelados,
        mediaVariaveis,
        mediaTotalProjetada,
        totalGeralPeriodo,
        saldoMensalProjetado,
        statusSaldo,
        formulaExplicativa,
      },
    };
  }
}

export const previsaoProjecaoService = new PrevisaoProjecaoService();
