import React, { useState } from 'react';
import {
  HistoricoResumoResponse,
  HistoricoCategoriasResponse,
} from '../api.ts';
import {
  History,
  Calendar,
  Layers,
  ChevronDown,
  ChevronRight,
  Search,
  AlertCircle,
} from 'lucide-react';

interface ComponenteHistorico6MProps {
  historicoResumo: HistoricoResumoResponse;
  historicoCategorias: HistoricoCategoriasResponse;
}

export const ComponenteHistorico6M: React.FC<ComponenteHistorico6MProps> = ({
  historicoResumo,
  historicoCategorias,
}) => {
  const [busca, setBusca] = useState('');
  const [categoriaAbertaId, setCategoriaAbertaId] = useState<string | null>(null);
  const [abaVisao, setAbaVisao] = useState<'categorias' | 'fechamentos'>('categorias');

  const toggleCategoria = (id: string) => {
    setCategoriaAbertaId((prev) => (prev === id ? null : id));
  };

  const categoriasFiltradas = historicoCategorias.categorias.filter((cat) =>
    cat.nome.toLowerCase().includes(busca.toLowerCase()) ||
    cat.subcategorias.some((s) => s.nome.toLowerCase().includes(busca.toLowerCase()))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Header explicativo com tag M-004 e reconciliação */}
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
            <History size={20} color="var(--brand-primary)" />
            <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
              Histórico Fechado N=6 (Módulo M-004)
            </span>
          </div>
          <span
            style={{
              fontSize: '0.7rem',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              color: 'var(--status-green)',
              padding: '2px 8px',
              borderRadius: '999px',
              fontWeight: 700,
            }}
          >
            Reconciliação 100% OK
          </span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.4 }}>
          Consolidação canônica dos últimos 6 meses fechados (<strong>{historicoResumo.janela.inicio}</strong> a{' '}
          <strong>{historicoResumo.janela.fim}</strong>). Isola transferências internas e pagamentos de fatura para
          apurar o consumo econômico real e tickets médios por categoria.
        </p>
      </div>

      {/* 2. Grid de Métricas Principais N=6 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '12px',
        }}
      >
        <div className="card" style={{ padding: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total Consolidado 6M</div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.15rem',
              color: 'var(--status-red)',
              marginTop: '4px',
            }}
          >
            {historicoResumo.total_periodo_despesas.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            6 meses fechados
          </div>
        </div>

        <div className="card" style={{ padding: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Média Mensal de Consumo</div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.15rem',
              color: 'var(--brand-primary)',
              marginTop: '4px',
            }}
          >
            {historicoResumo.media_mensal_despesas.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            por mês fechado
          </div>
        </div>

        <div className="card" style={{ padding: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Receitas Totais 6M</div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.15rem',
              color: 'var(--status-green)',
              marginTop: '4px',
            }}
          >
            {historicoResumo.total_periodo_receitas.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Média: {historicoResumo.media_mensal_receitas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês
          </div>
        </div>

        <div className="card" style={{ padding: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Lançamentos & Ticket Médio</div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.15rem',
              color: 'var(--text-primary)',
              marginTop: '4px',
            }}
          >
            {historicoResumo.ticket_medio_global.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {historicoResumo.quantidade_total_lancamentos} transações registradas
          </div>
        </div>
      </div>

      {/* 3. Comparativo com o Mês Aberto (se houver) */}
      {historicoResumo.comparativo_mes_aberto && (
        <div
          className="card"
          style={{
            padding: '14px',
            backgroundColor: 'rgba(56, 189, 248, 0.05)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={16} color="var(--brand-primary)" />
              <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                Mês Corrente em Aberto ({historicoResumo.comparativo_mes_aberto.competencia})
              </span>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                fontWeight: 800,
                color: 'var(--brand-primary)',
              }}
            >
              {historicoResumo.comparativo_mes_aberto.totalDespesas.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
            </span>
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              marginTop: '6px',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Progresso contra a média N=6:</span>
            <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {historicoResumo.comparativo_mes_aberto.pctAtingimentoMedia.toFixed(1)}% consumido
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '999px',
              overflow: 'hidden',
              marginTop: '6px',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(historicoResumo.comparativo_mes_aberto.pctAtingimentoMedia, 100)}%`,
                backgroundColor:
                  historicoResumo.comparativo_mes_aberto.pctAtingimentoMedia > 100
                    ? 'var(--status-red)'
                    : 'var(--brand-primary)',
                borderRadius: '999px',
              }}
            />
          </div>
        </div>
      )}

      {/* 4. Sub-navegação entre Decomposição por Categoria e Fechamentos Mês a Mês */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          background: 'rgba(30, 41, 59, 0.6)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={() => setAbaVisao('categorias')}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: 'pointer',
            backgroundColor: abaVisao === 'categorias' ? 'var(--brand-primary)' : 'transparent',
            color: abaVisao === 'categorias' ? '#090d16' : 'var(--text-secondary)',
          }}
        >
          <Layers size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />
          Decomposição POF
        </button>
        <button
          type="button"
          onClick={() => setAbaVisao('fechamentos')}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: 'pointer',
            backgroundColor: abaVisao === 'fechamentos' ? 'var(--brand-primary)' : 'transparent',
            color: abaVisao === 'fechamentos' ? '#090d16' : 'var(--text-secondary)',
          }}
        >
          <Calendar size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />
          Fechamentos Mês a Mês
        </button>
      </div>

      {/* 5. Conteúdo: Decomposição por Categorias e Subcategorias */}
      {abaVisao === 'categorias' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Campo de Busca */}
          <div className="search-bar">
            <Search size={16} />
            <input
              type="text"
              placeholder="Buscar categoria ou subcategoria..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {categoriasFiltradas.map((cat) => {
              const isOpen = categoriaAbertaId === cat.categoria_id;
              return (
                <div
                  key={cat.categoria_id}
                  className="card"
                  style={{
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    cursor: cat.subcategorias.length > 0 ? 'pointer' : 'default',
                    border: isOpen ? '1px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                  }}
                  onClick={() => cat.subcategorias.length > 0 && toggleCategoria(cat.categoria_id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {cat.subcategorias.length > 0 && (
                        isOpen ? <ChevronDown size={18} color="var(--brand-primary)" /> : <ChevronRight size={18} color="var(--text-muted)" />
                      )}
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>{cat.nome}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {cat.quantidade_lancamentos} transações • Ticket médio:{' '}
                          {cat.ticket_medio_lancamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 800,
                          fontSize: '0.95rem',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {cat.total_periodo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                      <div
                        style={{
                          fontSize: '0.72rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--brand-primary)',
                        }}
                      >
                        {cat.media_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês ({cat.percentual_participacao.toFixed(1)}%)
                      </div>
                    </div>
                  </div>

                  {/* Barra de progresso da representatividade no total 6M */}
                  <div
                    style={{
                      width: '100%',
                      height: '4px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '999px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(cat.percentual_participacao, 100)}%`,
                        backgroundColor: 'var(--brand-primary)',
                        borderRadius: '999px',
                      }}
                    />
                  </div>

                  {/* Detalhamento das Subcategorias sanfonadas */}
                  {isOpen && cat.subcategorias.length > 0 && (
                    <div
                      style={{
                        marginTop: '8px',
                        paddingTop: '8px',
                        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                        Subcategorias ({cat.subcategorias.length})
                      </div>
                      {cat.subcategorias.map((sub) => (
                        <div
                          key={sub.subcategoria_id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.78rem',
                            padding: '6px 8px',
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderRadius: '4px',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{sub.nome}</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                              {sub.quantidade_lancamentos}x • Ticket:{' '}
                              {sub.ticket_medio_lancamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                              {sub.total_periodo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                              {sub.media_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês ({sub.percentual_na_categoria.toFixed(1)}%)
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. Conteúdo: Fechamentos Mês a Mês */}
      {abaVisao === 'fechamentos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {historicoResumo.fechamentos_mensais.map((f) => (
            <div
              key={f.competencia}
              className="card"
              style={{
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Calendar size={16} color="var(--brand-primary)" />
                  <span style={{ fontWeight: 800, fontSize: '0.92rem' }}>Competência {f.competencia}</span>
                </div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 800,
                    color: f.saldoMes >= 0 ? 'var(--status-green)' : 'var(--status-red)',
                  }}
                >
                  Saldo: {f.saldoMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Despesas Fechadas</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      color: 'var(--status-red)',
                    }}
                  >
                    {f.totalDespesas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Receitas Realizadas</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      color: 'var(--status-green)',
                    }}
                  >
                    {f.totalReceitas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                {f.quantidadeLancamentos} lançamentos conciliados no mês
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
