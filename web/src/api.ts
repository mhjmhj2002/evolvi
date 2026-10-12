/**
 * Cliente de API tipado para o frontend web do Evolvi.
 * Oferece métodos com fallback elegante caso o backend esteja desconectado ou em modo sandbox.
 */

export type RoleUsuario =
  | 'OWNER'
  | 'ADMIN'
  | 'USER'
  | 'VISITANTE'
  | 'owner'
  | 'admin'
  | 'user'
  | 'visitante';

export interface UsuarioPerfil {
  id: string;
  nome: string;
  email: string;
  role?: RoleUsuario;
  rendaBaseMensal: number;
  mesesJanelaTemporal?: number;
  faseAtual: string | number;
  criadoEm: string;
}

export interface ConfiguracaoUsuarioResponse {
  mesesJanelaTemporal: number;
  limites: {
    minimo: number;
    maximo: number;
    padrao: number;
  };
  atualizadoEm?: string;
  message?: string;
}

export interface RendaMedia6MResponse {
  media6m: number;
  mesesJanela?: number;
  totalReceitas: number;
  mesesFechados: string[];
  totaisPorMes: Record<string, number>;
  rendaAtual: number;
  complementoSugerido: number;
}

export interface CategoriaSemaforoItem {
  categoria_id: string;
  nome: string;
  ordem: number;
  gasto_medio_mensal: number;
  pct_gasto_atual: number;
  referencia_normalizada_pct: number;
  diferenca_pp: number;
  status_semaforo: 'VERDE' | 'AMARELO' | 'VERMELHO';
}

export interface SemaforoResponse {
  total_categorias: number;
  renda_base: number;
  media_mensal_total: number;
  meses_analisados: string[];
  categorias: CategoriaSemaforoItem[];
}

export interface BaselineResponse {
  renda_base: number;
  meses_analisados: string[];
  total_periodo: number;
  media_mensal: number;
  gap_zero_a_zero: number;
  pct_excesso_renda: number;
  detalhes_categorias: {
    categoria_id: string;
    nome: string;
    total_periodo: number;
    media_mensal: number;
  }[];
}

// Tipos para Histórico 6M (M-004) e Análise de Consumo
export interface HistoricoFechamentoMes {
  competencia: string;
  totalDespesas: number;
  totalReceitas: number;
  saldoMes: number;
  quantidadeLancamentos: number;
}

export interface HistoricoSubcategoriaItem {
  subcategoria_id: string;
  nome: string;
  total_periodo: number;
  media_mensal: number;
  percentual_na_categoria: number;
  quantidade_lancamentos: number;
  ticket_medio_lancamento: number;
}

export interface HistoricoCategoriaItem {
  categoria_id: string;
  nome: string;
  ordem: number;
  total_periodo: number;
  media_mensal: number;
  percentual_participacao: number;
  quantidade_lancamentos: number;
  ticket_medio_lancamento: number;
  subcategorias: HistoricoSubcategoriaItem[];
  mes_aberto_valor: number;
  mes_aberto_diff_media: number;
}

export interface HistoricoResumoResponse {
  janela: {
    inicio: string;
    fim: string;
    total_meses: number;
    meses_fechados: string[];
    competencia_aberta?: string;
  };
  renda_base_mensal: number;
  total_periodo_despesas: number;
  media_mensal_despesas: number;
  total_periodo_receitas: number;
  media_mensal_receitas: number;
  quantidade_total_lancamentos: number;
  ticket_medio_global: number;
  fechamentos_mensais: HistoricoFechamentoMes[];
  comparativo_mes_aberto?: {
    competencia: string;
    totalDespesas: number;
    totalReceitas: number;
    diferencaDespesaVsMedia: number;
    pctAtingimentoMedia: number;
  };
}

export interface HistoricoCategoriasResponse {
  janela: {
    inicio: string;
    fim: string;
    meses_fechados: string[];
  };
  total_periodo: number;
  media_mensal: number;
  categorias: HistoricoCategoriaItem[];
}

// Tipos para Previsão e Projeção 6M (M-005 - TASK-14)
export interface ProjecaoMesItem {
  competencia: string;
  parcelamentos: number;
  recorrentes: number;
  variavelAuditada: number;
  totalProjetado: number;
  rendaBase: number;
  saldoProjetado: number;
  statusSaldo: 'SUPERAVIT' | 'DEFICIT' | 'ZERO_A_ZERO';
  observacao?: string;
}

export interface PrevisaoSeisMesesResponse {
  competenciaReferencia: string;
  rendaBaseMensal: number;
  mesesProjetados: string[];
  totalParcelamentosPeriodo: number;
  totalRecorrentesPeriodo: number;
  totalVariavelPeriodo: number;
  totalGeralProjetadoPeriodo: number;
  saldoAcumuladoPeriodo: number;
  meses: ProjecaoMesItem[];
}

export interface DecomposicaoCategoriaItem {
  categoriaId?: string;
  nome: string;
  ordem?: number;
  recorrentes: number;
  parcelas: number;
  variavelAuditada: number;
  totalProjetado: number;
  percentualDoTotal: number;
  fundamentacao?: string;
}

export interface DecomposicaoCategoriasResponse {
  competencia: string;
  rendaBase: number;
  totalPrevistoMes: number;
  totalRecorrentes: number;
  totalParcelas: number;
  totalVariavel: number;
  saldoMes: number;
  categorias: DecomposicaoCategoriaItem[];
}

export interface MetaItemResponse {
  id?: string;
  categoria_id: string;
  nome_categoria: string;
  ordem: number;
  baseline_mensal: number;
  meta_proposta: number;
  reducao_proposta: number;
  condicao_acao?: string | null;
  status_semaforo: 'VERDE' | 'AMARELO' | 'VERMELHO';
}

export interface PlanoMetasResponse {
  competencia: string;
  renda_base: number;
  total_baseline: number;
  total_meta_proposta: number;
  total_reducao_proposta: number;
  gap_pos_meta: number;
  equacionado: boolean;
  metas: MetaItemResponse[];
}

export interface ItemCronogramaVencimento {
  tipo: 'RECORRENCIA' | 'PARCELAMENTO';
  origemId: string;
  descricao: string;
  valor: number;
  diaVencimento: number;
  dataVencimentoPrevista: string;
  essencial?: boolean;
  categoria?: { id: string; nome: string } | null;
  conta?: { id: string; nome: string; tipo: string } | null;
  parcelamentoInfo?: {
    parcelaAtualNoMes: number;
    totalParcelas: number;
    saldoDevedorRestanteAposMes: number;
  };
}

export interface CronogramaVencimentosResponse {
  competencia: string;
  totalPrevistoMes: number;
  totalRecorrencias: number;
  totalParcelamentos: number;
  itens: ItemCronogramaVencimento[];
}

export interface ParcelamentoItem {
  id: string;
  descricao: string;
  valorTotal: number;
  parcelaValor: number;
  parcelaAtual: number;
  totalParcelas: number;
  primeiroVencimento: string;
  ultimoVencimento: string;
  status: 'ATIVO' | 'QUITADO' | 'CANCELADO';
  saldoDevedorRestante: number;
  parcelasRestantes: number;
  conta?: { id: string; nome: string; tipo: string } | null;
  categoria?: { id: string; nome: string } | null;
}

export interface ParcelamentosResponse {
  saldoDevedorTotalGeral: number;
  totalParcelamentosAtivos: number;
  parcelamentos: ParcelamentoItem[];
}

export interface ContaItem {
  id: string;
  nome: string;
  tipo: 'CONTA_CORRENTE' | 'CARTAO_CREDITO' | 'DINHEIRO_FISICO' | 'INVESTIMENTO_RESERVA';
  diaFechamento?: number | null;
  diaVencimento?: number | null;
  saldoInicial: number;
  ativo: boolean;
}

export interface CategoriaTreeItem {
  id: string;
  nome: string;
  ordem: number;
  pesoBrutoReferencia: number;
  referenciaNormalizadaPct: number;
  subcategorias: Array<{
    id: string;
    nome: string;
    descricao?: string | null;
  }>;
}

export interface MovimentoItem {
  id: string;
  contaId: string;
  conta?: { id: string; nome: string; tipo: string };
  categoriaId?: string | null;
  categoria?: { id: string; nome: string; categoriaPaiId?: string | null } | null;
  dataMovimento: string;
  competencia: string;
  descricao: string;
  valor: number;
  natureza: 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL';
  status: 'PENDENTE' | 'CONCILIADO' | 'CANCELADO';
  chaveDedupe?: string;
  observacao?: string | null;
}

export interface MovimentosResponse {
  resumo: {
    totalReceitas: number;
    totalDespesasConsumo: number;
    totalTransferenciasProprias: number;
    totalAportesPatrimoniais: number;
    saldoOperacionalConsumo: number;
  };
  movimentos: MovimentoItem[];
}

// DADOS DE REFERÊNCIA / DEMONSTRAÇÃO (SANDBOX/MOCK)
export const mockPerfil: UsuarioPerfil = {
  id: 'usr-demo-1',
  nome: 'Usuário Evolvi',
  email: 'usuario@evolvi.app',
  role: 'OWNER',
  rendaBaseMensal: 5500.0,
  faseAtual: 'FASE_1',
  criadoEm: '2026-10-01T00:00:00.000Z',
};

export const mockBaseline: BaselineResponse = {
  renda_base: 5500.0,
  meses_analisados: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  total_periodo: 34800.0,
  media_mensal: 5800.0,
  gap_zero_a_zero: 300.0,
  pct_excesso_renda: 5.45,
  detalhes_categorias: [
    { categoria_id: 'cat-1', nome: 'Alimentação no Domicílio', total_periodo: 5700.0, media_mensal: 950.0 },
    { categoria_id: 'cat-2', nome: 'Habitação e Utilidades', total_periodo: 11880.0, media_mensal: 1980.0 },
    { categoria_id: 'cat-3', nome: 'Transporte Individual e Combustível', total_periodo: 5520.0, media_mensal: 920.0 },
    { categoria_id: 'cat-4', nome: 'Alimentação Fora do Domicílio', total_periodo: 3120.0, media_mensal: 520.0 },
    { categoria_id: 'cat-5', nome: 'Despesas com Veículo Próprio', total_periodo: 3840.0, media_mensal: 640.0 },
    { categoria_id: 'cat-6', nome: 'Saúde e Cuidados Pessoais', total_periodo: 1860.0, media_mensal: 310.0 },
  ],
};

export const mockSemaforo: SemaforoResponse = {
  total_categorias: 21,
  renda_base: 5500.0,
  media_mensal_total: 5800.0,
  meses_analisados: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  categorias: [
    {
      categoria_id: 'cat-transp',
      nome: 'Transporte Individual e Combustível',
      ordem: 1,
      gasto_medio_mensal: 920.0,
      pct_gasto_atual: 15.86,
      referencia_normalizada_pct: 9.5,
      diferenca_pp: 6.36,
      status_semaforo: 'VERMELHO',
    },
    {
      categoria_id: 'cat-veic',
      nome: 'Despesas com Veículo Próprio',
      ordem: 2,
      gasto_medio_mensal: 640.0,
      pct_gasto_atual: 11.03,
      referencia_normalizada_pct: 4.5,
      diferenca_pp: 6.53,
      status_semaforo: 'VERMELHO',
    },
    {
      categoria_id: 'cat-hab',
      nome: 'Habitação e Utilidades',
      ordem: 3,
      gasto_medio_mensal: 1980.0,
      pct_gasto_atual: 34.14,
      referencia_normalizada_pct: 32.0,
      diferenca_pp: 2.14,
      status_semaforo: 'AMARELO',
    },
    {
      categoria_id: 'cat-alim-fora',
      nome: 'Alimentação Fora do Domicílio',
      ordem: 4,
      gasto_medio_mensal: 520.0,
      pct_gasto_atual: 8.97,
      referencia_normalizada_pct: 5.8,
      diferenca_pp: 3.17,
      status_semaforo: 'AMARELO',
    },
    {
      categoria_id: 'cat-alim-dom',
      nome: 'Alimentação no Domicílio',
      ordem: 5,
      gasto_medio_mensal: 950.0,
      pct_gasto_atual: 16.38,
      referencia_normalizada_pct: 17.5,
      diferenca_pp: -1.12,
      status_semaforo: 'VERDE',
    },
    {
      categoria_id: 'cat-saude',
      nome: 'Saúde e Cuidados Pessoais',
      ordem: 6,
      gasto_medio_mensal: 310.0,
      pct_gasto_atual: 5.34,
      referencia_normalizada_pct: 6.5,
      diferenca_pp: -1.16,
      status_semaforo: 'VERDE',
    },
    {
      categoria_id: 'cat-educ',
      nome: 'Educação e Livros',
      ordem: 7,
      gasto_medio_mensal: 180.0,
      pct_gasto_atual: 3.1,
      referencia_normalizada_pct: 4.2,
      diferenca_pp: -1.1,
      status_semaforo: 'VERDE',
    },
    {
      categoria_id: 'cat-vest',
      nome: 'Vestuário e Calçados',
      ordem: 8,
      gasto_medio_mensal: 120.0,
      pct_gasto_atual: 2.07,
      referencia_normalizada_pct: 3.0,
      diferenca_pp: -0.93,
      status_semaforo: 'VERDE',
    },
  ],
};

export const mockPlanoMetas: PlanoMetasResponse = {
  competencia: 'PLANO_PADRAO',
  renda_base: 5500.0,
  total_baseline: 5800.0,
  total_meta_proposta: 5500.0,
  total_reducao_proposta: 300.0,
  gap_pos_meta: 0.0,
  equacionado: true,
  metas: [
    {
      categoria_id: 'cat-transp',
      nome_categoria: 'Transporte Individual e Combustível',
      ordem: 1,
      baseline_mensal: 920.0,
      meta_proposta: 780.0,
      reducao_proposta: 140.0,
      condicao_acao: 'Limitar viagens por aplicativo e alternar com transporte coletivo',
      status_semaforo: 'VERMELHO',
    },
    {
      categoria_id: 'cat-alim-fora',
      nome_categoria: 'Alimentação Fora do Domicílio',
      ordem: 2,
      baseline_mensal: 520.0,
      meta_proposta: 360.0,
      reducao_proposta: 160.0,
      condicao_acao: 'Reduzir pedidos de delivery para no máximo 1 vez por semana',
      status_semaforo: 'AMARELO',
    },
    {
      categoria_id: 'cat-hab',
      nome_categoria: 'Habitação e Utilidades',
      ordem: 3,
      baseline_mensal: 1980.0,
      meta_proposta: 1980.0,
      reducao_proposta: 0.0,
      condicao_acao: 'Manter contas essenciais em dia sem acréscimo de juros',
      status_semaforo: 'AMARELO',
    },
    {
      categoria_id: 'cat-alim-dom',
      nome_categoria: 'Alimentação no Domicílio',
      ordem: 4,
      baseline_mensal: 950.0,
      meta_proposta: 950.0,
      reducao_proposta: 0.0,
      condicao_acao: 'Planejar lista de compras quinzenal',
      status_semaforo: 'VERDE',
    },
  ],
};

export const mockCronogramaVencimentos: CronogramaVencimentosResponse = {
  competencia: '2026-10',
  totalPrevistoMes: 2185.7,
  totalRecorrencias: 1245.7,
  totalParcelamentos: 940.0,
  itens: [
    {
      tipo: 'RECORRENCIA',
      origemId: 'rec-1',
      descricao: 'Aluguel do Imóvel',
      valor: 1100.0,
      diaVencimento: 5,
      dataVencimentoPrevista: '2026-10-05',
      essencial: true,
      categoria: { id: 'cat-hab', nome: 'Habitação e Utilidades' },
    },
    {
      tipo: 'PARCELAMENTO',
      origemId: 'parc-1',
      descricao: 'Smartphone Samsung (3/10)',
      valor: 340.0,
      diaVencimento: 12,
      dataVencimentoPrevista: '2026-10-12',
      conta: { id: 'cta-card', nome: 'Cartão Nubank Platinum', tipo: 'CARTAO_CREDITO' },
      categoria: { id: 'cat-outro', nome: 'Equipamentos e Tecnologia' },
      parcelamentoInfo: {
        parcelaAtualNoMes: 3,
        totalParcelas: 10,
        saldoDevedorRestanteAposMes: 2380.0,
      },
    },
    {
      tipo: 'PARCELAMENTO',
      origemId: 'parc-2',
      descricao: 'Revisão e Pneus Carro (2/4)',
      valor: 600.0,
      diaVencimento: 15,
      dataVencimentoPrevista: '2026-10-15',
      conta: { id: 'cta-card', nome: 'Cartão Nubank Platinum', tipo: 'CARTAO_CREDITO' },
      categoria: { id: 'cat-veic', nome: 'Despesas com Veículo Próprio' },
      parcelamentoInfo: {
        parcelaAtualNoMes: 2,
        totalParcelas: 4,
        saldoDevedorRestanteAposMes: 1200.0,
      },
    },
    {
      tipo: 'RECORRENCIA',
      origemId: 'rec-2',
      descricao: 'Energia Elétrica (Enel)',
      valor: 145.7,
      diaVencimento: 20,
      dataVencimentoPrevista: '2026-10-20',
      essencial: true,
      categoria: { id: 'cat-hab', nome: 'Habitação e Utilidades' },
    },
  ],
};

export const mockParcelamentos: ParcelamentosResponse = {
  saldoDevedorTotalGeral: 3580.0,
  totalParcelamentosAtivos: 2,
  parcelamentos: [
    {
      id: 'parc-1',
      descricao: 'Smartphone Samsung',
      valorTotal: 3400.0,
      parcelaValor: 340.0,
      parcelaAtual: 3,
      totalParcelas: 10,
      primeiroVencimento: '2026-08',
      ultimoVencimento: '2027-05',
      status: 'ATIVO',
      saldoDevedorRestante: 2380.0,
      parcelasRestantes: 7,
      conta: { id: 'cta-card', nome: 'Cartão Nubank Platinum', tipo: 'CARTAO_CREDITO' },
      categoria: { id: 'cat-outro', nome: 'Equipamentos e Tecnologia' },
    },
    {
      id: 'parc-2',
      descricao: 'Revisão e Pneus Carro',
      valorTotal: 2400.0,
      parcelaValor: 600.0,
      parcelaAtual: 2,
      totalParcelas: 4,
      primeiroVencimento: '2026-09',
      ultimoVencimento: '2026-12',
      status: 'ATIVO',
      saldoDevedorRestante: 1200.0,
      parcelasRestantes: 2,
      conta: { id: 'cta-card', nome: 'Cartão Nubank Platinum', tipo: 'CARTAO_CREDITO' },
      categoria: { id: 'cat-veic', nome: 'Despesas com Veículo Próprio' },
    },
  ],
};

export const mockContas: ContaItem[] = [
  {
    id: 'cta-cc',
    nome: 'Conta Corrente Principal',
    tipo: 'CONTA_CORRENTE',
    saldoInicial: 1250.0,
    ativo: true,
  },
  {
    id: 'cta-card',
    nome: 'Cartão Nubank Platinum',
    tipo: 'CARTAO_CREDITO',
    diaFechamento: 5,
    diaVencimento: 12,
    saldoInicial: 0,
    ativo: true,
  },
];

async function apiFetch<T>(url: string, options?: RequestInit, fallback?: T): Promise<T> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      credentials: 'include',
    });

    if (!res.ok) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Falha na requisição [${res.status}]: ${res.statusText}`);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw err;
  }
}

export const mockHistoricoResumo: HistoricoResumoResponse = {
  janela: {
    inicio: '2026-03',
    fim: '2026-08',
    total_meses: 6,
    meses_fechados: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
    competencia_aberta: '2026-09',
  },
  renda_base_mensal: 11000.0,
  total_periodo_despesas: 99692.71,
  media_mensal_despesas: 16615.45,
  total_periodo_receitas: 115992.72,
  media_mensal_receitas: 19332.12,
  quantidade_total_lancamentos: 862,
  ticket_medio_global: 115.65,
  fechamentos_mensais: [
    { competencia: '2026-03', totalDespesas: 19751.77, totalReceitas: 7227.93, saldoMes: -12523.84, quantidadeLancamentos: 142 },
    { competencia: '2026-04', totalDespesas: 10404.10, totalReceitas: 9525.17, saldoMes: -878.93, quantidadeLancamentos: 118 },
    { competencia: '2026-05', totalDespesas: 22006.60, totalReceitas: 42680.75, saldoMes: 20674.15, quantidadeLancamentos: 175 },
    { competencia: '2026-06', totalDespesas: 19075.43, totalReceitas: 1264.44, saldoMes: -17810.99, quantidadeLancamentos: 164 },
    { competencia: '2026-07', totalDespesas: 14449.26, totalReceitas: 47589.33, saldoMes: 33140.07, quantidadeLancamentos: 138 },
    { competencia: '2026-08', totalDespesas: 14005.55, totalReceitas: 7705.10, saldoMes: -6300.45, quantidadeLancamentos: 125 },
  ],
  comparativo_mes_aberto: {
    competencia: '2026-09',
    totalDespesas: 5069.10,
    totalReceitas: 6001.43,
    diferencaDespesaVsMedia: -11546.35,
    pctAtingimentoMedia: 30.51,
  },
};

export const mockHistoricoCategorias: HistoricoCategoriasResponse = {
  janela: {
    inicio: '2026-03',
    fim: '2026-08',
    meses_fechados: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
  },
  total_periodo: 99692.71,
  media_mensal: 16615.45,
  categorias: [
    {
      categoria_id: 'cat-moradia',
      nome: 'Moradia',
      ordem: 1,
      total_periodo: 24402.23,
      media_mensal: 4067.04,
      percentual_participacao: 24.48,
      quantidade_lancamentos: 52,
      ticket_medio_lancamento: 469.27,
      mes_aberto_valor: 660.16,
      mes_aberto_diff_media: -3406.88,
      subcategorias: [
        { subcategoria_id: 'sub-fin-imob', nome: 'Financiamento imobiliario', total_periodo: 8405.04, media_mensal: 1400.84, percentual_na_categoria: 34.44, quantidade_lancamentos: 6, ticket_medio_lancamento: 1400.84 },
        { subcategoria_id: 'sub-manut-res', nome: 'Manutencao residencial', total_periodo: 5845.85, media_mensal: 974.31, percentual_na_categoria: 23.96, quantidade_lancamentos: 24, ticket_medio_lancamento: 243.58 },
        { subcategoria_id: 'sub-condom', nome: 'Condominio', total_periodo: 4085.40, media_mensal: 680.90, percentual_na_categoria: 16.74, quantidade_lancamentos: 6, ticket_medio_lancamento: 680.90 },
        { subcategoria_id: 'sub-energia', nome: 'Energia eletrica', total_periodo: 3063.87, media_mensal: 510.65, percentual_na_categoria: 12.56, quantidade_lancamentos: 8, ticket_medio_lancamento: 382.98 },
      ],
    },
    {
      categoria_id: 'cat-alimentacao',
      nome: 'Alimentacao',
      ordem: 2,
      total_periodo: 21260.91,
      media_mensal: 3543.48,
      percentual_participacao: 21.33,
      quantidade_lancamentos: 245,
      ticket_medio_lancamento: 86.78,
      mes_aberto_valor: 490.82,
      mes_aberto_diff_media: -3052.66,
      subcategorias: [
        { subcategoria_id: 'sub-super', nome: 'Supermercado', total_periodo: 8340.40, media_mensal: 1390.07, percentual_na_categoria: 39.23, quantidade_lancamentos: 82, ticket_medio_lancamento: 101.71 },
        { subcategoria_id: 'sub-refeicao', nome: 'Refeicao fora', total_periodo: 4339.07, media_mensal: 723.18, percentual_na_categoria: 20.41, quantidade_lancamentos: 63, ticket_medio_lancamento: 68.87 },
        { subcategoria_id: 'sub-delivery', nome: 'Delivery', total_periodo: 3745.87, media_mensal: 624.31, percentual_na_categoria: 17.62, quantidade_lancamentos: 58, ticket_medio_lancamento: 64.58 },
      ],
    },
    {
      categoria_id: 'cat-viagem',
      nome: 'Viagem',
      ordem: 3,
      total_periodo: 12845.50,
      media_mensal: 2140.92,
      percentual_participacao: 12.89,
      quantidade_lancamentos: 14,
      ticket_medio_lancamento: 917.54,
      mes_aberto_valor: 0.0,
      mes_aberto_diff_media: -2140.92,
      subcategorias: [
        { subcategoria_id: 'sub-passagem', nome: 'Passagem aerea', total_periodo: 11722.16, media_mensal: 1953.69, percentual_na_categoria: 91.26, quantidade_lancamentos: 5, ticket_medio_lancamento: 2344.43 },
      ],
    },
    {
      categoria_id: 'cat-educacao',
      nome: 'Educacao',
      ordem: 4,
      total_periodo: 11783.41,
      media_mensal: 1963.90,
      percentual_participacao: 11.82,
      quantidade_lancamentos: 15,
      ticket_medio_lancamento: 785.56,
      mes_aberto_valor: 1621.83,
      mes_aberto_diff_media: -342.07,
      subcategorias: [
        { subcategoria_id: 'sub-mensalidade', nome: 'Mensalidade', total_periodo: 11480.98, media_mensal: 1913.50, percentual_na_categoria: 97.43, quantidade_lancamentos: 11, ticket_medio_lancamento: 1043.73 },
      ],
    },
    {
      categoria_id: 'cat-transporte',
      nome: 'Transporte',
      ordem: 5,
      total_periodo: 8335.09,
      media_mensal: 1389.18,
      percentual_participacao: 8.36,
      quantidade_lancamentos: 326,
      ticket_medio_lancamento: 25.57,
      mes_aberto_valor: 112.57,
      mes_aberto_diff_media: -1276.61,
      subcategorias: [
        { subcategoria_id: 'sub-app', nome: 'Transporte por aplicativo', total_periodo: 3655.25, media_mensal: 609.21, percentual_na_categoria: 43.85, quantidade_lancamentos: 304, ticket_medio_lancamento: 12.02 },
      ],
    },
  ],
};

export const mockPrevisaoSeisMeses: PrevisaoSeisMesesResponse = {
  competenciaReferencia: '2026-10',
  rendaBaseMensal: 11000.0,
  mesesProjetados: ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'],
  totalParcelamentosPeriodo: 10352.73,
  totalRecorrentesPeriodo: 26896.8,
  totalVariavelPeriodo: 32844.12,
  totalGeralProjetadoPeriodo: 70093.65,
  saldoAcumuladoPeriodo: -4093.65,
  meses: [
    {
      competencia: '2026-10',
      parcelamentos: 3440.03,
      recorrentes: 4482.8,
      variavelAuditada: 5474.02,
      totalProjetado: 13396.85,
      rendaBase: 11000.0,
      saldoProjetado: -2396.85,
      statusSaldo: 'DEFICIT',
      observacao: 'BASE FIN-161: Parcelas R$ 3.440,03 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02',
    },
    {
      competencia: '2026-11',
      parcelamentos: 1667.62,
      recorrentes: 4482.8,
      variavelAuditada: 5474.02,
      totalProjetado: 11624.44,
      rendaBase: 11000.0,
      saldoProjetado: -624.44,
      statusSaldo: 'DEFICIT',
      observacao: 'BASE FIN-161: Parcelas R$ 1.667,62 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02',
    },
    {
      competencia: '2026-12',
      parcelamentos: 1337.3,
      recorrentes: 4482.8,
      variavelAuditada: 5474.02,
      totalProjetado: 11294.12,
      rendaBase: 11000.0,
      saldoProjetado: -294.12,
      statusSaldo: 'DEFICIT',
      observacao: 'BASE FIN-161: Parcelas R$ 1.337,30 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02',
    },
    {
      competencia: '2027-01',
      parcelamentos: 1337.3,
      recorrentes: 4482.8,
      variavelAuditada: 5474.02,
      totalProjetado: 11294.12,
      rendaBase: 11000.0,
      saldoProjetado: -294.12,
      statusSaldo: 'DEFICIT',
      observacao: 'BASE FIN-161: Parcelas R$ 1.337,30 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02',
    },
    {
      competencia: '2027-02',
      parcelamentos: 1285.24,
      recorrentes: 4482.8,
      variavelAuditada: 5474.02,
      totalProjetado: 11242.06,
      rendaBase: 11000.0,
      saldoProjetado: -242.06,
      statusSaldo: 'DEFICIT',
      observacao: 'BASE FIN-161: Parcelas R$ 1.285,24 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02',
    },
    {
      competencia: '2027-03',
      parcelamentos: 1285.24,
      recorrentes: 4482.8,
      variavelAuditada: 5474.02,
      totalProjetado: 11242.06,
      rendaBase: 11000.0,
      saldoProjetado: -242.06,
      statusSaldo: 'DEFICIT',
      observacao: 'BASE FIN-161: Parcelas R$ 1.285,24 + Recorrentes R$ 4.482,80 + Variável R$ 5.474,02',
    },
  ],
};

export const mockDecomposicaoCategorias: DecomposicaoCategoriasResponse = {
  competencia: '2026-10',
  rendaBase: 11000.0,
  totalPrevistoMes: 13396.85,
  totalRecorrentes: 4482.8,
  totalParcelas: 3440.03,
  totalVariavel: 5474.02,
  saldoMes: -2396.85,
  categorias: [
    {
      nome: 'Alimentacao',
      recorrentes: 0.0,
      parcelas: 543.66,
      variavelAuditada: 3345.06,
      totalProjetado: 3888.72,
      percentualDoTotal: 29.03,
      fundamentacao: 'Consumo do dia a dia não parcelado; supermercado parcelado em parcelamentos',
    },
    {
      nome: 'Moradia',
      recorrentes: 2353.41,
      parcelas: 1128.7,
      variavelAuditada: 177.03,
      totalProjetado: 3659.14,
      percentualDoTotal: 27.31,
      fundamentacao: 'Financiamento, condomínio e energia em Recorrentes; móveis e utensílios em Parcelamentos',
    },
    {
      nome: 'Educacao',
      recorrentes: 1621.83,
      parcelas: 386.3,
      variavelAuditada: 44.36,
      totalProjetado: 2052.49,
      percentualDoTotal: 15.32,
      fundamentacao: 'Mensalidade escolar fixa em Recorrentes; materiais contratados em Parcelas',
    },
    {
      nome: 'Transporte',
      recorrentes: 0.0,
      parcelas: 0.0,
      variavelAuditada: 673.07,
      totalProjetado: 673.07,
      percentualDoTotal: 5.02,
      fundamentacao: 'Transporte público, combustível e apps em variável auditada',
    },
    {
      nome: 'Saude',
      recorrentes: 0.0,
      parcelas: 99.13,
      variavelAuditada: 487.21,
      totalProjetado: 586.34,
      percentualDoTotal: 4.38,
      fundamentacao: 'Farmácia e consultas em variável; parcela Raia Drogasil',
    },
    {
      nome: 'Pets',
      recorrentes: 0.0,
      parcelas: 321.91,
      variavelAuditada: 213.81,
      totalProjetado: 535.72,
      percentualDoTotal: 4.0,
      fundamentacao: 'Pet shop e alimentação em variável; itens parcelados em Petz/Amazon',
    },
    {
      nome: 'Tecnologia',
      recorrentes: 0.0,
      parcelas: 512.66,
      variavelAuditada: 0.0,
      totalProjetado: 512.66,
      percentualDoTotal: 3.83,
      fundamentacao: 'Notebook Casas Bahia + Magalu finalizada em out/26',
    },
  ],
};

export const apiService = {
  async getPerfil(): Promise<UsuarioPerfil> {
    const data = await apiFetch<{ usuario: UsuarioPerfil }>(
      '/api/usuario/perfil',
      undefined,
      { usuario: mockPerfil }
    );
    return data.usuario;
  },

  async getPrevisaoSeisMeses(competencia?: string, mesesProjecao = 6): Promise<PrevisaoSeisMesesResponse> {
    const params = new URLSearchParams();
    if (competencia) params.append('competenciaReferencia', competencia);
    if (mesesProjecao) params.append('mesesProjecao', String(mesesProjecao));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<PrevisaoSeisMesesResponse>(
      `/api/fase1/previsao/seis-meses${query}`,
      undefined,
      mockPrevisaoSeisMeses
    );
  },

  async getDecomposicaoCategorias(competencia: string): Promise<DecomposicaoCategoriasResponse> {
    return apiFetch<DecomposicaoCategoriasResponse>(
      `/api/fase1/previsao/decomposicao-categorias?competencia=${competencia}`,
      undefined,
      mockDecomposicaoCategorias
    );
  },

  async atualizarVariavelAuditada(ajustes: Array<{ categoriaId?: string; categoriaNome?: string; valor: number }>): Promise<any> {
    return apiFetch('/api/fase1/previsao/variavel-auditada', {
      method: 'PUT',
      body: JSON.stringify({ ajustes }),
    });
  },

  async getBaseline(competencia?: string): Promise<BaselineResponse> {
    const query = competencia ? `?competenciaReferencia=${competencia}` : '';
    return apiFetch<BaselineResponse>(`/api/fase1/baseline${query}`, undefined, mockBaseline);
  },

  async getHistoricoResumo(competencia?: string, mesesJanela = 6): Promise<HistoricoResumoResponse> {
    const params = new URLSearchParams();
    if (competencia) params.append('competenciaReferencia', competencia);
    if (mesesJanela) params.append('mesesJanela', String(mesesJanela));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<HistoricoResumoResponse>(
      `/api/fase1/historico/resumo${query}`,
      undefined,
      mockHistoricoResumo
    );
  },

  async getHistoricoCategorias(competencia?: string, mesesJanela = 6): Promise<HistoricoCategoriasResponse> {
    const params = new URLSearchParams();
    if (competencia) params.append('competenciaReferencia', competencia);
    if (mesesJanela) params.append('mesesJanela', String(mesesJanela));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<HistoricoCategoriasResponse>(
      `/api/fase1/historico/categorias${query}`,
      undefined,
      mockHistoricoCategorias
    );
  },

  async getSemaforo(competencia?: string): Promise<SemaforoResponse> {
    const query = competencia ? `?competenciaReferencia=${competencia}` : '';
    return apiFetch<SemaforoResponse>(`/api/fase1/semaforo${query}`, undefined, mockSemaforo);
  },

  async getPlanoMetas(competencia?: string): Promise<PlanoMetasResponse> {
    const query = competencia ? `?competencia=${competencia}` : '';
    return apiFetch<PlanoMetasResponse>(`/api/fase1/metas${query}`, undefined, mockPlanoMetas);
  },

  async salvarMetas(payload: { competencia?: string; metas: Array<{ categoriaId: string; metaProposta: number; condicaoAcao?: string | null }> }): Promise<PlanoMetasResponse> {
    return apiFetch<PlanoMetasResponse>('/api/fase1/metas', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, mockPlanoMetas);
  },

  async getVencimentos(competencia: string): Promise<CronogramaVencimentosResponse> {
    return apiFetch<CronogramaVencimentosResponse>(
      `/api/compromissos/vencimentos?competencia=${competencia}`,
      undefined,
      mockCronogramaVencimentos
    );
  },

  async getParcelamentos(): Promise<ParcelamentosResponse> {
    return apiFetch<ParcelamentosResponse>(
      '/api/parcelamentos',
      undefined,
      mockParcelamentos
    );
  },

  async getContas(): Promise<ContaItem[]> {
    const data = await apiFetch<{ contas: ContaItem[] }>(
      '/api/contas',
      undefined,
      { contas: mockContas }
    );
    return data.contas;
  },

  async getCategorias(): Promise<CategoriaTreeItem[]> {
    const data = await apiFetch<{ categorias: CategoriaTreeItem[] }>(
      '/api/categorias',
      undefined,
      {
        categorias: [
          { id: 'cat-alim-dom', nome: 'Alimentação no Domicílio', ordem: 1, pesoBrutoReferencia: 17.5, referenciaNormalizadaPct: 17.5, subcategorias: [] },
          { id: 'cat-hab', nome: 'Habitação e Utilidades', ordem: 2, pesoBrutoReferencia: 32.0, referenciaNormalizadaPct: 32.0, subcategorias: [] },
          { id: 'cat-transp', nome: 'Transporte Individual e Combustível', ordem: 3, pesoBrutoReferencia: 9.5, referenciaNormalizadaPct: 9.5, subcategorias: [] },
          { id: 'cat-alim-fora', nome: 'Alimentação Fora do Domicílio', ordem: 4, pesoBrutoReferencia: 5.8, referenciaNormalizadaPct: 5.8, subcategorias: [] },
          { id: 'cat-saude', nome: 'Saúde e Cuidados Pessoais', ordem: 5, pesoBrutoReferencia: 6.5, referenciaNormalizadaPct: 6.5, subcategorias: [] },
        ],
      }
    );
    return data.categorias;
  },

  async getMovimentos(competencia?: string): Promise<MovimentosResponse> {
    const query = competencia ? `?competencia=${competencia}` : '';
    return apiFetch<MovimentosResponse>(
      `/api/movimentos${query}`,
      undefined,
      {
        resumo: {
          totalReceitas: 5500.0,
          totalDespesasConsumo: 4820.0,
          totalTransferenciasProprias: 0,
          totalAportesPatrimoniais: 0,
          saldoOperacionalConsumo: 680.0,
        },
        movimentos: [],
      }
    );
  },

  async criarMovimento(payload: {
    contaId: string;
    categoriaId?: string;
    dataMovimento: string;
    descricao: string;
    valor: number;
    natureza: 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL';
    status: 'PENDENTE' | 'CONCILIADO';
    contaDestinoId?: string;
    isPagamentoFatura?: boolean;
    observacao?: string;
  }): Promise<{ message: string; movimento: MovimentoItem }> {
    return apiFetch<{ message: string; movimento: MovimentoItem }>('/api/movimentos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async cadastro(payload: {
    nome: string;
    email: string;
    senha: string;
    rendaBaseMensal?: number;
    role?: RoleUsuario;
  }): Promise<{ usuario: UsuarioPerfil; token: string }> {
    const res = await fetch('/api/auth/cadastro', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || `Erro no cadastro (${res.status})`);
    }

    return (await res.json()) as { usuario: UsuarioPerfil; token: string };
  },

  async login(payload: { email: string; senha: string }): Promise<{ usuario: UsuarioPerfil; token: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || `Erro no login (${res.status})`);
    }

    return (await res.json()) as { usuario: UsuarioPerfil; token: string };
  },

  async atualizarRendaBase(rendaBaseMensal: number): Promise<{ message: string; usuario: UsuarioPerfil }> {
    return apiFetch<{ message: string; usuario: UsuarioPerfil }>('/api/usuario/renda-base', {
      method: 'PUT',
      body: JSON.stringify({ rendaBaseMensal }),
    });
  },

  async getConfiguracoes(): Promise<ConfiguracaoUsuarioResponse> {
    try {
      return await apiFetch<ConfiguracaoUsuarioResponse>('/api/usuario/configuracoes');
    } catch {
      return {
        mesesJanelaTemporal: 6,
        limites: { minimo: 3, maximo: 12, padrao: 6 },
      };
    }
  },

  async atualizarConfiguracoes(mesesJanelaTemporal: number): Promise<ConfiguracaoUsuarioResponse> {
    return apiFetch<ConfiguracaoUsuarioResponse>('/api/usuario/configuracoes', {
      method: 'PUT',
      body: JSON.stringify({ mesesJanelaTemporal }),
    });
  },

  async getRendaMedia6M(competencia?: string, meses?: number): Promise<RendaMedia6MResponse> {
    const params = new URLSearchParams();
    if (competencia) params.append('competencia', competencia);
    if (meses) params.append('meses', meses.toString());

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<RendaMedia6MResponse>(`/api/usuario/renda-media-6m${queryString}`);
  },

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignora erro se backend estiver offline
    }
  },

  async getContextoIa(): Promise<{ contexto: any; promptExportavel: string }> {
    return apiFetch<{ contexto: any; promptExportavel: string }>('/api/ia/contexto');
  },

  async parseIa(payload: {
    texto: string;
    modo: 'CREDITOS' | 'API_PROPRIA' | 'EXTERNO';
    provedor?: 'GEMINI' | 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER';
    modelo?: string;
    apiKey?: string;
  }): Promise<{
    modo: string;
    lancamento: {
      descricao: string;
      valor: number;
      dataMovimento: string;
      natureza: 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL';
      contaId?: string | null;
      contaNomeSugerida?: string | null;
      categoriaId?: string | null;
      categoriaNomeSugerida?: string | null;
      isPagamentoFatura?: boolean;
      parcelasTotal?: number | null;
      parcelaAtual?: number | null;
      observacao?: string | null;
      confianca?: number;
    };
    aviso?: string;
    creditosConsumidos?: number;
  }> {
    return apiFetch('/api/ia/parse', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async testarApiKeyIa(payload: {
    provedor: 'GEMINI' | 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER';
    apiKey: string;
    modelo?: string;
  }): Promise<{ sucesso: boolean; message: string }> {
    return apiFetch('/api/ia/testar-conexao', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Módulo de Conectores Bancários e Open Finance (TASK-15)
  async getInstituicoesBancarias(): Promise<{ instituicoes: InstituicaoBancariaItem[] }> {
    try {
      return await apiFetch<{ instituicoes: InstituicaoBancariaItem[] }>('/api/conectores/instituicoes');
    } catch {
      return {
        instituicoes: [
          { codigo: 'CON-HUB', nome: 'Hub Open Finance Brasil (Genérico)', corPrimaria: '#0284c7' },
          { codigo: '341', nome: 'Itaú Unibanco', compe: '341', corPrimaria: '#ec7000' },
          { codigo: '033', nome: 'Santander', compe: '033', corPrimaria: '#cc0000' },
          { codigo: '077', nome: 'Banco Inter', compe: '077', corPrimaria: '#ff7a00' },
          { codigo: '260', nome: 'Nubank', compe: '260', corPrimaria: '#820ad1' },
          { codigo: '735', nome: 'Banco Neon', compe: '735', corPrimaria: '#00e5ff' },
          { codigo: '290', nome: 'PagBank (PagSeguro)', compe: '290', corPrimaria: '#00a868' },
          { codigo: '001', nome: 'Banco do Brasil', compe: '001', corPrimaria: '#fbf800' },
          { codigo: '104', nome: 'Caixa Econômica Federal', compe: '104', corPrimaria: '#005ca9' },
          { codigo: '237', nome: 'Banco Bradesco', compe: '237', corPrimaria: '#cc092f' },
          { codigo: '021', nome: 'Banestes', compe: '021', corPrimaria: '#004b93' },
        ],
      };
    }
  },

  async getConexoesBancarias(): Promise<{ conexoes: ConexaoBancariaItem[] }> {
    try {
      return await apiFetch<{ conexoes: ConexaoBancariaItem[] }>('/api/conectores/conexoes');
    } catch {
      return { conexoes: [] };
    }
  },

  async conectarBanco(payload: {
    instituicaoCodigo: string;
    credentials?: Record<string, unknown>;
  }): Promise<{ conexao: ConexaoBancariaItem; authResult: any }> {
    return apiFetch('/api/conectores/conexoes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async sincronizarBanco(
    conexaoId: string,
    payload?: { dataInicio?: string; dataFim?: string }
  ): Promise<{
    conexaoId: string;
    instituicaoNome: string;
    contasProcessadas: any[];
    resumo: { novosMovimentosInseridos: number; movimentosIgnoradosDedupe: number };
  }> {
    return apiFetch(`/api/conectores/conexoes/${conexaoId}/sincronizar`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  async desconectarBanco(conexaoId: string): Promise<{ message: string; conexao: ConexaoBancariaItem }> {
    return apiFetch(`/api/conectores/conexoes/${conexaoId}`, {
      method: 'DELETE',
    });
  },

  async importarExtratoManual(payload: {
    contaId: string;
    content: string;
    filename?: string;
  }): Promise<{
    message: string;
    resultado: {
      totalRecebidas: number;
      novosInseridos: number;
      duplicadasIgnoradas: number;
      pagamentosFaturaConvertidos: number;
      formato: string;
      erros: Array<{ index: number; motivo: string }>;
    };
  }> {
    return apiFetch('/api/conectores/importar-extrato', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export interface InstituicaoBancariaItem {
  codigo: string;
  nome: string;
  compe?: string;
  corPrimaria?: string;
}

export interface ConexaoBancariaItem {
  id: string;
  usuarioId: string;
  instituicaoCodigo: string;
  instituicaoNome: string;
  compe?: string | null;
  status: 'CONECTADO' | 'EXPIRADO' | 'ERRO_AUTENTICACAO' | 'REVOGADO';
  consentimentoId?: string | null;
  consentimentoExpiraEm?: string | null;
  ultimaSincronizacaoEm?: string | null;
  mensagemErro?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

