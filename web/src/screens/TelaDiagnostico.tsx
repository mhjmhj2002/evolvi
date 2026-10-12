import React, { useState } from 'react';
import {
  CardSemaforo,
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
  apiService,
} from '../api.ts';
import {
  Target,
  CheckCircle2,
  Info,
  Save,
  Search,
} from 'lucide-react';

interface TelaDiagnosticoProps {
  baseline: BaselineResponse;
  semaforo: SemaforoResponse;
  planoMetas: PlanoMetasResponse;
  historicoResumo?: HistoricoResumoResponse;
  historicoCategorias?: HistoricoCategoriasResponse;
  onMetasAtualizadas?: (novoPlano: PlanoMetasResponse) => void;
}

export const TelaDiagnostico: React.FC<TelaDiagnosticoProps> = ({
  baseline,
  semaforo,
  planoMetas,
  historicoResumo = mockHistoricoResumo,
  historicoCategorias = mockHistoricoCategorias,
  onMetasAtualizadas,
}) => {
  const [subTab, setSubTab] = useState<'historico' | 'semaforo' | 'metas'>('historico');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [busca, setBusca] = useState<string>('');

  // Estado editável para Plano de Metas
  const [metasEditadas, setMetasEditadas] = useState<{ [catId: string]: number }>(() => {
    const map: { [id: string]: number } = {};
    planoMetas.metas.forEach((m) => {
      map[m.categoria_id] = m.meta_proposta;
    });
    return map;
  });

  const [salvando, setSalvando] = useState<boolean>(false);
  const [mensagemFeedback, setMensagemFeedback] = useState<string | null>(null);

  // Filtragem das categorias do semáforo
  const categoriasFiltradas = semaforo.categorias.filter((cat) => {
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
      setMensagemFeedback('Metas salvas com sucesso no plano do Zero a Zero!');
    } catch {
      setMensagemFeedback('Erro ao persistir metas. Verifique a validação.');
    } finally {
      setSalvando(false);
      setTimeout(() => setMensagemFeedback(null), 4000);
    }
  };

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

      {/* CONTEÚDO SUB-ABA 1: SEMÁFORO POF */}
      {subTab === 'semaforo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Barra de Filtros e Busca */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar categoria..."
                className="form-input"
                style={{ paddingLeft: '36px', height: '40px', fontSize: '0.85rem' }}
              />
            </div>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="form-select"
              style={{ width: '130px', height: '40px', fontSize: '0.85rem' }}
            >
              <option value="TODOS">Todos</option>
              <option value="VERMELHO">Vermelho</option>
              <option value="AMARELO">Amarelo</option>
              <option value="VERDE">Verde</option>
            </select>
          </div>

          {/* Lista de Categorias do Semáforo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {categoriasFiltradas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Nenhuma categoria encontrada para o filtro selecionado.
              </div>
            ) : (
              categoriasFiltradas.map((cat: CategoriaSemaforoItem) => (
                <CardSemaforo
                  key={cat.categoria_id}
                  status={cat.status_semaforo}
                  title={cat.nome}
                  valor={cat.gasto_medio_mensal}
                  percentual={cat.pct_gasto_atual}
                  benchmark={cat.referencia_normalizada_pct}
                  badgeText={
                    cat.status_semaforo === 'VERMELHO'
                      ? `Excesso (+${cat.diferenca_pp.toFixed(1)} p.p.)`
                      : cat.status_semaforo === 'AMARELO'
                      ? `Atenção (+${cat.diferenca_pp.toFixed(1)} p.p.)`
                      : `No Padrão (${cat.diferenca_pp >= 0 ? '+' : ''}${cat.diferenca_pp.toFixed(1)} p.p.)`
                  }
                />
              ))
            )}
          </div>
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
