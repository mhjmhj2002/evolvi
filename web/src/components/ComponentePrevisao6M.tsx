import React, { useState } from 'react';
import {
  PrevisaoSeisMesesResponse,
  DecomposicaoCategoriasResponse,
  apiService,
} from '../api.ts';
import {
  TrendingUp,
  Layers,
  Calendar,
  Sliders,
  BarChart3,
} from 'lucide-react';

interface ComponentePrevisao6MProps {
  previsao: PrevisaoSeisMesesResponse;
  decomposicaoInicial?: DecomposicaoCategoriasResponse;
  onAtualizar?: () => void;
}

export const ComponentePrevisao6M: React.FC<ComponentePrevisao6MProps> = ({
  previsao,
  decomposicaoInicial,
  onAtualizar,
}) => {
  const [competenciaSelecionada, setCompetenciaSelecionada] = useState<string>(
    previsao.meses[0]?.competencia || '2026-10'
  );
  const [decomposicao, setDecomposicao] = useState<DecomposicaoCategoriasResponse | undefined>(
    decomposicaoInicial
  );
  const [carregandoDecomposicao, setCarregandoDecomposicao] = useState(false);
  const [abaVisao, setAbaVisao] = useState<'grafico' | 'tabela' | 'decomposicao'>('grafico');

  // Ajuste rápido de variável auditada
  const [modalCalibrarAberto, setModalCalibrarAberto] = useState(false);
  const [catAjusteNome, setCatAjusteNome] = useState('Lazer');
  const [catAjusteValor, setCatAjusteValor] = useState('91.62');
  const [salvandoCalibracao, setSalvandoCalibracao] = useState(false);

  const carregarDecomposicao = async (comp: string) => {
    setCompetenciaSelecionada(comp);
    setCarregandoDecomposicao(true);
    try {
      const res = await apiService.getDecomposicaoCategorias(comp);
      if (res) setDecomposicao(res);
    } catch (err) {
      console.warn('Erro ao carregar decomposição da competência', err);
    } finally {
      setCarregandoDecomposicao(false);
    }
  };

  const handleSalvarCalibracao = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(catAjusteValor.replace(',', '.'));
    if (isNaN(val) || val < 0) return;

    setSalvandoCalibracao(true);
    try {
      await apiService.atualizarVariavelAuditada([
        { categoriaNome: catAjusteNome, valor: val },
      ]);
      setModalCalibrarAberto(false);
      if (onAtualizar) onAtualizar();
      await carregarDecomposicao(competenciaSelecionada);
    } catch (err) {
      console.warn('Erro ao salvar calibração', err);
    } finally {
      setSalvandoCalibracao(false);
    }
  };

  // Encontrar o maior total do período para cálculo proporcional de altura no gráfico
  const maxTotalProjetado = Math.max(
    previsao.rendaBaseMensal * 1.25,
    ...previsao.meses.map((m) => m.totalProjetado)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Card Header com identificação canônica M-005 */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
          borderLeft: '4px solid var(--brand-primary)',
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={20} color="var(--brand-primary)" />
            <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
              Motor de Previsão e Projeção 6M (Módulo M-005)
            </span>
          </div>
          <span
            style={{
              fontSize: '0.7rem',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--brand-primary)',
              padding: '2px 8px',
              borderRadius: '999px',
              fontWeight: 700,
            }}
          >
            FIN-161 3 Camadas
          </span>
        </div>

        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.45 }}>
          Decomposição do orçamento futuro em 3 camadas explicáveis e não sobrepostas:{' '}
          <strong style={{ color: 'var(--text-primary)' }}>1. Parcelas Ativas</strong> (compromisso conhecido),{' '}
          <strong style={{ color: 'var(--text-primary)' }}>2. Recorrentes Ativos</strong> (contratual) e{' '}
          <strong style={{ color: 'var(--text-primary)' }}>3. Consumo Variável Auditado</strong> (estimativa corrente sem sobreposição).
        </p>

        {/* Resumo rápido dos 6 meses */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            marginTop: '14px',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            padding: '10px',
            borderRadius: 'var(--radius-sm)',
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Renda Base</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {previsao.rendaBaseMensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Média Projetada 6M</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', color: 'var(--status-yellow)' }}>
              {(previsao.totalGeralProjetadoPeriodo / (previsao.meses.length || 1)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Déficit Acumulado</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.95rem', color: previsao.saldoAcumuladoPeriodo >= 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
              {previsao.saldoAcumuladoPeriodo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Switcher de Modos de Visualização */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '6px',
          background: 'rgba(30, 41, 59, 0.6)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={() => setAbaVisao('grafico')}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: abaVisao === 'grafico' ? 'var(--brand-primary)' : 'transparent',
            color: abaVisao === 'grafico' ? '#090d16' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <BarChart3 size={15} /> Projeção Gráfica
        </button>

        <button
          type="button"
          onClick={() => setAbaVisao('tabela')}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: abaVisao === 'tabela' ? 'var(--brand-primary)' : 'transparent',
            color: abaVisao === 'tabela' ? '#090d16' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <Calendar size={15} /> Tabela Mês a Mês
        </button>

        <button
          type="button"
          onClick={() => {
            setAbaVisao('decomposicao');
            if (!decomposicao) carregarDecomposicao(competenciaSelecionada);
          }}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: abaVisao === 'decomposicao' ? 'var(--brand-primary)' : 'transparent',
            color: abaVisao === 'decomposicao' ? '#090d16' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <Layers size={15} /> Decomposição POF
        </button>
      </div>

      {/* 3. VISÃO 1: GRÁFICO EMPILHADO DAS 3 CAMADAS E LINHA DE RENDA */}
      {abaVisao === 'grafico' && (
        <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
              Trajetória de Convergência (6 Meses Futuros)
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Meta Zero a Zero: R$ 11.000,00
            </span>
          </div>

          {/* Legenda das Camadas */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.73rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#ec4899' }} />
              <span>Parcelas Ativas (Conhecido)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#3b82f6' }} />
              <span>Recorrentes (Contratual)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#10b981' }} />
              <span>Variável Auditada (Estimativa)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '12px', height: '2px', backgroundColor: '#f59e0b' }} />
              <span>Renda Base (R$ 11k)</span>
            </div>
          </div>

          {/* Área de Gráfico de Barras Empilhadas */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${previsao.meses.length}, 1fr)`,
              gap: '8px',
              height: '220px',
              alignItems: 'flex-end',
              paddingTop: '20px',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--border-subtle)',
              position: 'relative',
            }}
          >
            {/* Linha horizontal tracejada indicando Renda Base R$ 11.000 */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: `${(previsao.rendaBaseMensal / maxTotalProjetado) * 100}%`,
                borderBottom: '2px dashed #f59e0b',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />

            {previsao.meses.map((m) => {
              const hTotal = (m.totalProjetado / maxTotalProjetado) * 100;
              const pctParc = (m.parcelamentos / m.totalProjetado) * 100;
              const pctRec = (m.recorrentes / m.totalProjetado) * 100;
              const pctVar = (m.variavelAuditada / m.totalProjetado) * 100;

              const isDeficit = m.saldoProjetado < 0;

              return (
                <div
                  key={m.competencia}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    height: '100%',
                    justifyContent: 'flex-end',
                    cursor: 'pointer',
                  }}
                  onClick={() => carregarDecomposicao(m.competencia)}
                  title={`Clique para inspecionar ${m.competencia}`}
                >
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, marginBottom: '4px', color: isDeficit ? 'var(--status-red)' : 'var(--status-green)' }}>
                    {m.saldoProjetado >= 0 ? `+R$ ${m.saldoProjetado.toFixed(0)}` : `-R$ ${Math.abs(m.saldoProjetado).toFixed(0)}`}
                  </div>

                  {/* Barra empilhada */}
                  <div
                    style={{
                      width: '80%',
                      maxWidth: '38px',
                      height: `${hTotal}%`,
                      display: 'flex',
                      flexDirection: 'column-reverse',
                      borderRadius: '4px 4px 0 0',
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: competenciaSelecionada === m.competencia ? '2px solid var(--brand-primary)' : 'none',
                    }}
                  >
                    {/* Camada Variável */}
                    <div style={{ height: `${pctVar}%`, backgroundColor: '#10b981' }} />
                    {/* Camada Recorrentes */}
                    <div style={{ height: `${pctRec}%`, backgroundColor: '#3b82f6' }} />
                    {/* Camada Parcelamentos */}
                    <div style={{ height: `${pctParc}%`, backgroundColor: '#ec4899' }} />
                  </div>

                  <div style={{ fontSize: '0.68rem', fontWeight: 600, marginTop: '6px', color: competenciaSelecionada === m.competencia ? 'var(--brand-primary)' : 'var(--text-secondary)' }}>
                    {m.competencia.split('-')[1]}/{m.competencia.split('-')[0].slice(2)}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Toque em uma coluna para visualizar a decomposição por Categoria POF daquela competência.
          </div>
        </div>
      )}

      {/* 4. VISÃO 2: TABELA MÊS A MÊS DETALHADA COM DÉFICIT/SUPERÁVIT */}
      {abaVisao === 'tabela' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {previsao.meses.map((m) => {
            const isDeficit = m.saldoProjetado < 0;

            return (
              <div
                key={m.competencia}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '14px',
                  borderLeft: isDeficit ? '4px solid var(--status-red)' : '4px solid var(--status-green)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={18} color="var(--brand-primary)" />
                    <span style={{ fontWeight: 800, fontSize: '0.98rem' }}>{m.competencia}</span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: isDeficit ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: isDeficit ? 'var(--status-red)' : 'var(--status-green)',
                    }}
                  >
                    {isDeficit ? `Déficit ${m.saldoProjetado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : `Sobra +${m.saldoProjetado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '6px',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.74rem',
                    textAlign: 'center',
                  }}
                >
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Parcelas</div>
                    <div style={{ fontWeight: 700, color: '#ec4899', marginTop: '2px' }}>
                      {m.parcelamentos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Recorrentes</div>
                    <div style={{ fontWeight: 700, color: '#3b82f6', marginTop: '2px' }}>
                      {m.recorrentes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Variável</div>
                    <div style={{ fontWeight: 700, color: '#10b981', marginTop: '2px' }}>
                      {m.variavelAuditada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Total Projetado</div>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                      {m.totalProjetado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    carregarDecomposicao(m.competencia);
                    setAbaVisao('decomposicao');
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--brand-primary)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textAlign: 'right',
                    padding: 0,
                  }}
                >
                  Ver Decomposição das 21 Categorias →
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. VISÃO 3: DECOMPOSIÇÃO POF POR CATEGORIA */}
      {abaVisao === 'decomposicao' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Seletor de Competência */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
              Decomposição de {competenciaSelecionada}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {previsao.meses.map((m) => (
                <button
                  key={m.competencia}
                  type="button"
                  onClick={() => carregarDecomposicao(m.competencia)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: competenciaSelecionada === m.competencia ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.05)',
                    color: competenciaSelecionada === m.competencia ? '#090d16' : 'var(--text-secondary)',
                  }}
                >
                  {m.competencia.split('-')[1]}
                </button>
              ))}
            </div>
          </div>

          {carregandoDecomposicao ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Carregando decomposição...
            </div>
          ) : decomposicao ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {decomposicao.categorias.map((cat) => (
                <div
                  key={cat.nome}
                  className="card"
                  style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{cat.nome}</span>
                      {cat.fundamentacao && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {cat.fundamentacao}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.95rem' }}>
                        {cat.totalProjetado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {cat.percentualDoTotal}% do total
                      </div>
                    </div>
                  </div>

                  {/* Detalhe das 3 camadas da categoria */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '4px',
                      backgroundColor: 'rgba(0, 0, 0, 0.2)',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.7rem',
                      textAlign: 'center',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Recorrente: </span>
                      <strong style={{ color: '#3b82f6' }}>R$ {cat.recorrentes.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Parcela: </span>
                      <strong style={{ color: '#ec4899' }}>R$ {cat.parcelas.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Variável: </span>
                      <strong style={{ color: '#10b981' }}>R$ {cat.variavelAuditada.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Botão para calibrar camada variável */}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setModalCalibrarAberto(true)}
            style={{ marginTop: '8px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            <Sliders size={16} /> Calibrar Estimativa de Consumo Variável
          </button>
        </div>
      )}

      {/* Modal de Calibração da Variável Auditada */}
      {modalCalibrarAberto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '380px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              background: '#0f172a',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>
              Calibrar Consumo Variável
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Ajuste a estimativa auditada de consumo corrente para uma categoria POF específica.
            </p>

            <form onSubmit={handleSalvarCalibracao} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Categoria POF
                </label>
                <select
                  value={catAjusteNome}
                  onChange={(e) => setCatAjusteNome(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '4px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="Alimentacao">Alimentação</option>
                  <option value="Transporte">Transporte</option>
                  <option value="Saude">Saúde</option>
                  <option value="Pets">Pets</option>
                  <option value="Moradia">Moradia</option>
                  <option value="Vestuario e acessorios">Vestuário e Acessórios</option>
                  <option value="Lazer">Lazer</option>
                  <option value="Telecomunicacoes">Telecomunicações</option>
                  <option value="Cuidados pessoais">Cuidados Pessoais</option>
                  <option value="Educacao">Educação</option>
                  <option value="Desconhecida">Desconhecida</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Novo Valor Mensal Auditado (R$)
                </label>
                <input
                  type="text"
                  value={catAjusteValor}
                  onChange={(e) => setCatAjusteValor(e.target.value)}
                  placeholder="Ex: 120.00"
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '4px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setModalCalibrarAberto(false)}
                  style={{ flex: 1 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={salvandoCalibracao}
                  style={{ flex: 1 }}
                >
                  {salvandoCalibracao ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
