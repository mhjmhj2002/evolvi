import React, { useState, useEffect, useRef } from 'react';
import {
  StatusBadge,
  ComponenteHistorico6M,
} from '../components/index.ts';
import {
  BaselineResponse,
  SemaforoResponse,
  PlanoMetasResponse,
  HistoricoResumoResponse,
  HistoricoCategoriasResponse,
  mockHistoricoResumo,
  mockHistoricoCategorias,
  CategoriaSemaforoItem,
  MovimentoItem,
  apiService,
} from '../api.ts';
import { formatarDataIso } from '../utils/data.ts';
import {
  Target,
  CheckCircle2,
  Info,
  Save,
  Search,
  ChevronDown,
  ChevronRight,
  Calendar,
  Layers,
  ArrowUpRight,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react';

interface TelaDiagnosticoProps {
  baseline: BaselineResponse;
  semaforo: SemaforoResponse;
  planoMetas: PlanoMetasResponse;
  historicoResumo?: HistoricoResumoResponse;
  historicoCategorias?: HistoricoCategoriasResponse;
  onMetasAtualizadas?: (novoPlano: PlanoMetasResponse) => void;
  onNavigateTab?: (tab: any) => void;
}

export const TelaDiagnostico: React.FC<TelaDiagnosticoProps> = ({
  baseline,
  semaforo: initialSemaforo,
  planoMetas,
  historicoResumo = mockHistoricoResumo,
  historicoCategorias = mockHistoricoCategorias,
  onMetasAtualizadas,
  onNavigateTab,
}) => {
  const [subTab, setSubTab] = useState<'historico' | 'semaforo' | 'metas'>('historico');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [busca, setBusca] = useState<string>('');

  // Estados dinâmicos para a Grid do Semáforo
  const [competenciaSelecionada, setCompetenciaSelecionada] = useState<string>(
    initialSemaforo.competencia_analisada || '2026-10'
  );
  const [janelaMeses, setJanelaMeses] = useState<number>(initialSemaforo.meses_janela || 6);
  const [semaforoAtual, setSemaforoAtual] = useState<SemaforoResponse>(initialSemaforo);
  const [carregandoSemaforo, setCarregandoSemaforo] = useState<boolean>(false);

  // Controle de expansão de categoria na Grid Master-Detail
  const [categoriaExpandidaId, setCategoriaExpandidaId] = useState<string | null>(null);
  const [lancamentosCategoria, setLancamentosCategoria] = useState<{ [catId: string]: MovimentoItem[] }>({});
  const [carregandoLancamentos, setCarregandoLancamentos] = useState<{ [catId: string]: boolean }>({});

  const foiEditadoManualmente = useRef(false);

  // Sincronizar se initialSemaforo mudar
  useEffect(() => {
    setSemaforoAtual(initialSemaforo);
  }, [initialSemaforo]);

  // Recarregar semáforo ao alterar competência ou janela de meses
  const carregarDadosSemaforo = async (comp: string, janela: number) => {
    setCarregandoSemaforo(true);
    try {
      const res = await apiService.getSemaforo(comp, janela);
      setSemaforoAtual(res);
      // Limpa cache de lançamentos para forçar re-busca com nova competência
      setLancamentosCategoria({});
    } catch (err) {
      console.error('Erro ao recarregar dados do semáforo:', err);
    } finally {
      setCarregandoSemaforo(false);
    }
  };

  // Toggle expansão e carregar lançamentos detalhados da categoria para o mês
  const handleToggleCategoria = async (catId: string) => {
    if (categoriaExpandidaId === catId) {
      setCategoriaExpandidaId(null);
      return;
    }

    setCategoriaExpandidaId(catId);

    // Se já estiver em cache para a competência atual, não re-busca
    if (lancamentosCategoria[catId]) {
      return;
    }

    setCarregandoLancamentos((prev) => ({ ...prev, [catId]: true }));
    try {
      const res = await apiService.getMovimentos({
        competencia: competenciaSelecionada,
        categoriaRaizId: catId,
        natureza: 'DESPESA',
      });
      setLancamentosCategoria((prev) => ({ ...prev, [catId]: res.movimentos || [] }));
    } catch (err) {
      console.error(`Erro ao buscar lançamentos da categoria ${catId}:`, err);
      setLancamentosCategoria((prev) => ({ ...prev, [catId]: [] }));
    } finally {
      setCarregandoLancamentos((prev) => ({ ...prev, [catId]: false }));
    }
  };

  // Estado editável para Plano de Metas
  const [metasEditadas, setMetasEditadas] = useState<{ [catId: string]: number }>(() => {
    const map: { [id: string]: number } = {};
    planoMetas.metas.forEach((m) => {
      map[m.categoria_id] = m.meta_proposta;
    });
    return map;
  });

  // Atualizar metasEditadas se planoMetas for recarregado do backend e o usuário não tiver edição dirty
  useEffect(() => {
    if (!foiEditadoManualmente.current) {
      const map: { [id: string]: number } = {};
      planoMetas.metas.forEach((m) => {
        map[m.categoria_id] = m.meta_proposta;
      });
      setMetasEditadas(map);
    }
  }, [planoMetas]);

  const [salvando, setSalvando] = useState<boolean>(false);
  const [mensagemFeedback, setMensagemFeedback] = useState<string | null>(null);

  // Filtragem das categorias do semáforo
  const categoriasFiltradas = (semaforoAtual.categorias || []).filter((cat) => {
    const matchStatus =
      filtroStatus === 'TODOS' || cat.status_semaforo === filtroStatus;
    const matchBusca =
      cat.nome.toLowerCase().includes(busca.toLowerCase());
    return matchStatus && matchBusca;
  });

  // Cálculos dinâmicos da aba de metas
  const totalMetaAtual: number = Object.values(metasEditadas).reduce((acc: number, v: number) => acc + (Number(v) || 0), 0);
  const totalReducaoCalculada = Math.max(0, baseline.media_mensal - totalMetaAtual);
  const gapPosMetaCalculado = Math.max(0, totalMetaAtual - baseline.renda_base);
  const estaEquacionado = totalMetaAtual <= baseline.renda_base;

  const handleSalvarMetas = async () => {
    setSalvando(true);
    setMensagemFeedback(null);
    try {
      const payloadMetas = planoMetas.metas.map((m) => ({
        categoriaId: m.categoria_id,
        metaProposta: metasEditadas[m.categoria_id] !== undefined ? metasEditadas[m.categoria_id] : m.meta_proposta,
        condicaoAcao: m.condicao_acao,
      }));

      const res = await apiService.salvarMetas({
        competencia: planoMetas.competencia,
        metas: payloadMetas,
      });

      if (onMetasAtualizadas) {
        onMetasAtualizadas(res);
      }
      foiEditadoManualmente.current = false;
      setMensagemFeedback('Metas salvas com sucesso no plano do Zero a Zero!');
    } catch {
      setMensagemFeedback('Erro ao persistir metas. Verifique a validação.');
    } finally {
      setSalvando(false);
      setTimeout(() => setMensagemFeedback(null), 4000);
    }
  };

  // Lista de competências para seleção (mês corrente e anteriores)
  const opcoesCompetencia = [
    '2026-11',
    '2026-10',
    '2026-09',
    '2026-08',
    '2026-07',
    '2026-06',
    '2026-05',
    '2026-04',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header com Sub-Navegação */}
      <div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Diagnóstico e Planejamento da Fase 1
        </span>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
          Semáforo POF & Metas
        </h1>
      </div>

      {/* 2. Switcher entre Histórico 6M, Semáforo e Plano de Metas */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '6px',
          background: 'rgba(30, 41, 59, 0.6)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={() => setSubTab('historico')}
          style={{
            padding: '8px 4px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: subTab === 'historico' ? 'var(--brand-primary)' : 'transparent',
            color: subTab === 'historico' ? '#090d16' : 'var(--text-secondary)',
          }}
        >
          Histórico 6M
        </button>
        <button
          type="button"
          onClick={() => setSubTab('semaforo')}
          style={{
            padding: '8px 4px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: subTab === 'semaforo' ? 'var(--brand-primary)' : 'transparent',
            color: subTab === 'semaforo' ? '#090d16' : 'var(--text-secondary)',
          }}
        >
          Semáforo POF
        </button>
        <button
          type="button"
          onClick={() => setSubTab('metas')}
          style={{
            padding: '8px 4px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: subTab === 'metas' ? 'var(--brand-primary)' : 'transparent',
            color: subTab === 'metas' ? '#090d16' : 'var(--text-secondary)',
          }}
        >
          Plano de Metas
        </button>
      </div>

      {/* CONTEÚDO SUB-ABA: HISTÓRICO 6M (M-004) */}
      {subTab === 'historico' && (
        <ComponenteHistorico6M
          historicoResumo={historicoResumo}
          historicoCategorias={historicoCategorias}
        />
      )}

      {/* 3. Resumo Global do Baseline N=6 (visível no Semáforo e Metas) */}
      {subTab !== 'historico' && (
        <div
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '10px',
            textAlign: 'center',
            padding: '14px 10px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Média Mensal N=6</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', marginTop: '4px' }}>
              {baseline.media_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Renda Base</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', marginTop: '4px', color: 'var(--brand-primary)' }}>
              {baseline.renda_base.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Gap a Eliminar</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '1rem',
                marginTop: '4px',
                color: baseline.gap_zero_a_zero <= 0 ? 'var(--status-green)' : 'var(--status-red)',
              }}
            >
              {baseline.gap_zero_a_zero <= 0
                ? 'R$ 0,00'
                : baseline.gap_zero_a_zero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
        </div>
      )}

      {/* CONTEÚDO SUB-ABA 1: SEMÁFORO POF & GRID ANALÍTICA */}
      {subTab === 'semaforo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Card Explicativo da Metodologia e Origem dos Benchmarks */}
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
              borderLeft: '4px solid var(--brand-primary)',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Info size={18} color="var(--brand-primary)" />
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                Origem dos Percentuais de Referência (Benchmarks POF / IBGE)
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.45 }}>
              Os percentuais de referência são derivados da <strong>POF (Pesquisa de Orçamentos Familiares) do IBGE</strong> (com corte no perfil de despesas de consumo das famílias do Sudeste e ponderações complementares da cesta IPCA). Eles representam a participação estatística esperada de cada categoria no orçamento total e servem como <strong>guia comparativo</strong> para apontar desvios (semáforo) e calcular o teto de gastos ideal com base no seu salário.
            </p>
          </div>

          {/* Barra de Filtros, Janela de Média e Competência */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: 'rgba(30, 41, 59, 0.5)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              {/* Seletor de Competência do Mês */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={16} color="var(--brand-primary)" />
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Mês de Análise:
                </span>
                <select
                  value={competenciaSelecionada}
                  onChange={(e) => {
                    const novaComp = e.target.value;
                    setCompetenciaSelecionada(novaComp);
                    carregarDadosSemaforo(novaComp, janelaMeses);
                  }}
                  className="form-select"
                  style={{
                    height: '34px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    padding: '0 8px',
                    width: '110px',
                  }}
                >
                  {opcoesCompetencia.map((comp) => (
                    <option key={comp} value={comp}>
                      {comp}
                    </option>
                  ))}
                </select>
              </div>

              {/* Seletor da Janela de Média Móvel (3, 6, 9, 12 meses) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SlidersHorizontal size={16} color="var(--brand-primary)" />
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Comparar c/ Média:
                </span>
                <div style={{ display: 'inline-flex', gap: '4px' }}>
                  {[3, 6, 9, 12].map((meses) => (
                    <button
                      key={meses}
                      type="button"
                      onClick={() => {
                        setJanelaMeses(meses);
                        carregarDadosSemaforo(competenciaSelecionada, meses);
                      }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid',
                        borderColor:
                          janelaMeses === meses ? 'var(--brand-primary)' : 'var(--border-subtle)',
                        background:
                          janelaMeses === meses
                            ? 'var(--brand-primary)'
                            : 'rgba(255, 255, 255, 0.05)',
                        color:
                          janelaMeses === meses ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {meses}M
                    </button>
                  ))}
                </div>
              </div>

              {/* Resumo Rápido da Renda / Teto */}
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  marginLeft: 'auto',
                }}
              >
                Salário Base Ref.:{' '}
                <strong style={{ color: 'var(--status-green)', fontFamily: 'var(--font-mono)' }}>
                  {semaforoAtual.renda_base.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </strong>
              </div>
            </div>

            {/* Barra de Busca e Filtro de Status Semáforo */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar categoria na grid..."
                  className="form-input"
                  style={{ paddingLeft: '36px', height: '36px', fontSize: '0.82rem' }}
                />
              </div>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="form-select"
                style={{ width: '120px', height: '36px', fontSize: '0.82rem' }}
              >
                <option value="TODOS">Todos</option>
                <option value="VERMELHO">Vermelho</option>
                <option value="AMARELO">Amarelo</option>
                <option value="VERDE">Verde</option>
              </select>
            </div>
          </div>

          {/* Grid de Lançamentos por Categoria para o Mês Selecionado */}
          {carregandoSemaforo ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '40px 0',
                gap: '8px',
                color: 'var(--brand-primary)',
              }}
            >
              <Loader2 className="animate-spin" size={24} />
              <span style={{ fontSize: '0.85rem' }}>Calculando semáforo e médias...</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {categoriasFiltradas.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '30px 0',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                  }}
                >
                  Nenhuma categoria encontrada para o filtro selecionado.
                </div>
              ) : (
                categoriasFiltradas.map((cat: CategoriaSemaforoItem) => {
                  const isExpandida = categoriaExpandidaId === cat.categoria_id;
                  const lancamentos = lancamentosCategoria[cat.categoria_id] || [];
                  const carregandoDetalhe = carregandoLancamentos[cat.categoria_id];

                  const statusClass =
                    cat.status_semaforo === 'VERDE'
                      ? 'status-verde'
                      : cat.status_semaforo === 'AMARELO'
                      ? 'status-amarelo'
                      : 'status-vermelho';

                  const badgeClass =
                    cat.status_semaforo === 'VERDE'
                      ? 'badge-verde'
                      : cat.status_semaforo === 'AMARELO'
                      ? 'badge-amarelo'
                      : 'badge-vermelho';

                  const badgeText =
                    cat.status_semaforo === 'VERMELHO'
                      ? `Excesso (+${cat.diferenca_pp.toFixed(1)} p.p.)`
                      : cat.status_semaforo === 'AMARELO'
                      ? `Atenção (+${cat.diferenca_pp.toFixed(1)} p.p.)`
                      : `Equilibrado (${cat.diferenca_pp >= 0 ? '+' : ''}${cat.diferenca_pp.toFixed(1)} p.p.)`;

                  return (
                    <div
                      key={cat.categoria_id}
                      className={`card card-semaforo ${statusClass}`}
                      style={{
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        borderLeft: `4px solid ${
                          cat.status_semaforo === 'VERDE'
                            ? 'var(--status-green)'
                            : cat.status_semaforo === 'AMARELO'
                            ? 'var(--status-yellow)'
                            : 'var(--status-red)'
                        }`,
                      }}
                    >
                      {/* Linha Principal da Grid Master */}
                      <div
                        onClick={() => handleToggleCategoria(cat.categoria_id)}
                        style={{
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        {/* Cabeçalho da Categoria com Nome, Status e Botão de Expansão */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div
                              style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                background: 'rgba(255, 255, 255, 0.06)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {isExpandida ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </div>
                            <div>
                              <h3
                                style={{
                                  fontSize: '0.95rem',
                                  fontWeight: 700,
                                  color: 'var(--text-primary)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                {cat.nome}
                                <span
                                  style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 500,
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  (Ref: {cat.referencia_normalizada_pct.toFixed(1)}%)
                                </span>
                              </h3>
                            </div>
                          </div>

                          <span className={`badge ${badgeClass}`} style={{ fontSize: '0.72rem' }}>
                            {badgeText}
                          </span>
                        </div>

                        {/* Colunas Comparativas em Grid */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                            gap: '8px',
                            background: 'rgba(15, 23, 42, 0.4)',
                            padding: '10px',
                            borderRadius: 'var(--radius-sm)',
                            marginTop: '4px',
                          }}
                        >
                          {/* 1. Total Gasto no Mês */}
                          <div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                              Total no Mês ({competenciaSelecionada})
                            </div>
                            <div
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.98rem',
                                fontWeight: 700,
                                color:
                                  (cat.gasto_mes_atual ?? 0) > (cat.valor_referencia_esperado ?? 0)
                                    ? 'var(--status-red)'
                                    : 'var(--text-primary)',
                                marginTop: '2px',
                              }}
                            >
                              {(cat.gasto_mes_atual ?? 0).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              <strong>{(cat.pct_mes_atual ?? 0).toFixed(1)}%</strong> da renda
                            </div>
                          </div>

                          {/* 2. Valor Esperado (Salário x % Ref POF) */}
                          <div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                              Esperado (Salário x Ref)
                            </div>
                            <div
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.98rem',
                                fontWeight: 600,
                                color: 'var(--status-green)',
                                marginTop: '2px',
                              }}
                            >
                              {(cat.valor_referencia_esperado ?? 0).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              Teto ref: {cat.referencia_normalizada_pct.toFixed(1)}%
                            </div>
                          </div>

                          {/* 3. Média dos Últimos X Meses */}
                          <div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                              Média ({janelaMeses} meses)
                            </div>
                            <div
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.98rem',
                                fontWeight: 600,
                                color: 'var(--brand-primary)',
                                marginTop: '2px',
                              }}
                            >
                              {cat.gasto_medio_mensal.toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              {cat.pct_gasto_atual.toFixed(1)}% do consumo
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* DETALHE EXPANDIDO: LANÇAMENTOS REAIS DA CATEGORIA NO MÊS */}
                      {isExpandida && (
                        <div
                          style={{
                            marginTop: '6px',
                            borderTop: '1px dashed var(--border-subtle)',
                            paddingTop: '10px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '8px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                              }}
                            >
                              <Layers size={14} /> Lançamentos de {cat.nome} em {competenciaSelecionada}:
                            </span>
                            {onNavigateTab && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onNavigateTab('lancamentos');
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--brand-primary)',
                                  fontSize: '0.72rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  fontWeight: 600,
                                }}
                              >
                                Ver no Extrato <ArrowUpRight size={12} />
                              </button>
                            )}
                          </div>

                          {carregandoDetalhe ? (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '16px 0',
                                justifyContent: 'center',
                                color: 'var(--text-muted)',
                                fontSize: '0.8rem',
                              }}
                            >
                              <Loader2 className="animate-spin" size={16} />
                              Carregando lançamentos...
                            </div>
                          ) : lancamentos.length === 0 ? (
                            <div
                              style={{
                                padding: '12px',
                                textAlign: 'center',
                                color: 'var(--text-muted)',
                                fontSize: '0.78rem',
                                background: 'rgba(0,0,0,0.2)',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              Nenhum lançamento registrado nesta categoria para a competência{' '}
                              <strong>{competenciaSelecionada}</strong>.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {lancamentos.map((mov) => (
                                <div
                                  key={mov.id}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '8px 10px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: 'rgba(0, 0, 0, 0.25)',
                                    fontSize: '0.8rem',
                                  }}
                                >
                                  <div>
                                    <div
                                      style={{
                                        fontWeight: 600,
                                        color: 'var(--text-primary)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                      }}
                                    >
                                      {mov.descricao}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: '0.7rem',
                                        color: 'var(--text-muted)',
                                        marginTop: '2px',
                                      }}
                                    >
                                      {formatarDataIso(mov.dataMovimento)}
                                      {mov.categoria && mov.categoria.nome !== cat.nome && (
                                        <span> • {mov.categoria.nome}</span>
                                      )}
                                      {mov.conta && <span> • {mov.conta.nome}</span>}
                                    </div>
                                  </div>

                                  <div
                                    style={{
                                      fontFamily: 'var(--font-mono)',
                                      fontWeight: 700,
                                      color: 'var(--status-red)',
                                      fontSize: '0.85rem',
                                    }}
                                  >
                                    -
                                    {Number(mov.valor).toLocaleString('pt-BR', {
                                      style: 'currency',
                                      currency: 'BRL',
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* CONTEÚDO SUB-ABA 2: PLANO DE METAS */}
      {subTab === 'metas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Card de Equacionamento Orçamentário */}
          <div
            className="card"
            style={{
              borderLeft: `4px solid ${estaEquacionado ? 'var(--status-green)' : 'var(--status-red)'}`,
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Target size={20} color={estaEquacionado ? 'var(--status-green)' : 'var(--status-red)'} />
                <span style={{ fontWeight: 700, fontSize: '0.98rem' }}>Equacionamento do Plano</span>
              </div>
              <StatusBadge
                status={estaEquacionado ? 'VERDE' : 'VERMELHO'}
                label={estaEquacionado ? 'Equacionado (<= Renda)' : 'Inviável (> Renda)'}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
              <div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Total Meta Proposta</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.05rem', marginTop: '2px' }}>
                  {totalMetaAtual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Redução Total Proposta</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.05rem', marginTop: '2px', color: 'var(--status-green)' }}>
                  {totalReducaoCalculada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </div>
              </div>
            </div>
            {!estaEquacionado && (
              <div style={{ marginTop: '10px', fontSize: '0.78rem', color: 'var(--status-red)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Info size={14} /> Reduza ainda mais R$ {gapPosMetaCalculado.toFixed(2)} para caber rigorosamente na sua renda base de R$ {baseline.renda_base.toFixed(2)}.
              </div>
            )}
          </div>

          {mensagemFeedback && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid var(--status-green-border)',
                color: 'var(--status-green)',
                fontSize: '0.85rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 size={16} /> {mensagemFeedback}
            </div>
          )}

          {/* Lista de Metas por Categoria */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {planoMetas.metas.map((item) => {
              const valorProposto = metasEditadas[item.categoria_id] !== undefined ? metasEditadas[item.categoria_id] : item.meta_proposta;
              const reducao = Math.max(0, item.baseline_mensal - valorProposto);

              return (
                <div
                  key={item.categoria_id}
                  className="card"
                  style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>{item.nome_categoria}</h3>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        Baseline N=6: {item.baseline_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                    </div>
                    <StatusBadge status={item.status_semaforo} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px', alignItems: 'center' }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Meta Proposta (R$)</label>
                      <input
                        type="number"
                        step="10"
                        min="0"
                        value={valorProposto}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          foiEditadoManualmente.current = true;
                          setMetasEditadas((prev) => ({ ...prev, [item.categoria_id]: val }));
                        }}
                        className="form-input"
                        style={{ height: '38px', fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Corte Previsto</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.92rem', color: reducao > 0 ? 'var(--status-green)' : 'var(--text-secondary)' }}>
                        - {reducao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                    </div>
                  </div>

                  {item.condicao_acao && (
                    <div
                      style={{
                        fontSize: '0.76rem',
                        color: 'var(--text-secondary)',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        fontStyle: 'italic',
                      }}
                    >
                      Nota de ação: {item.condicao_acao}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleSalvarMetas}
            disabled={salvando}
            style={{ marginTop: '8px', width: '100%' }}
          >
            <Save size={18} /> {salvando ? 'Salvando...' : 'Salvar Plano de Metas'}
          </button>
        </div>
      )}
    </div>
  );
};
