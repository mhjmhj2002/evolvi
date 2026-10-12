import React, { useState } from 'react';
import {
  CronogramaVencimentosResponse,
  ParcelamentosResponse,
  ItemCronogramaVencimento,
  PrevisaoSeisMesesResponse,
  DecomposicaoCategoriasResponse,
  mockPrevisaoSeisMeses,
} from '../api.ts';
import { StatusBadge, ComponentePrevisao6M } from '../components/index.ts';
import {
  CheckCircle2,
  Circle,
  PlusCircle,
  TrendingUp,
} from 'lucide-react';

interface TelaCompromissosProps {
  cronograma: CronogramaVencimentosResponse;
  parcelamentos: ParcelamentosResponse;
  previsao?: PrevisaoSeisMesesResponse;
  decomposicao?: DecomposicaoCategoriasResponse;
  onRegistrarPagamento?: (item: ItemCronogramaVencimento) => void;
  onNovoCompromisso?: () => void;
  onAtualizarPrevisao?: () => void;
}

export const TelaCompromissos: React.FC<TelaCompromissosProps> = ({
  cronograma,
  parcelamentos,
  previsao = mockPrevisaoSeisMeses,
  decomposicao,
  onRegistrarPagamento,
  onNovoCompromisso,
  onAtualizarPrevisao,
}) => {
  // Controle local de checkboxes de contas já quitadas no mês
  const [pagos, setPagos] = useState<{ [id: string]: boolean }>({});
  const [tabInterna, setTabInterna] = useState<'vencimentos' | 'dividas' | 'projecao'>('vencimentos');

  const togglePago = (id: string, item: ItemCronogramaVencimento) => {
    const novoStatus = !pagos[id];
    setPagos((prev) => ({ ...prev, [id]: novoStatus }));
    if (novoStatus && onRegistrarPagamento) {
      onRegistrarPagamento(item);
    }
  };

  const totalQuitado = cronograma.itens
    .filter((i) => pagos[i.origemId])
    .reduce((sum, i) => sum + i.valor, 0);

  const totalPendente = cronograma.totalPrevistoMes - totalQuitado;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header */}
      <div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Planejamento de Caixa & Dívidas
        </span>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
          Vencimentos & Parcelamentos
        </h1>
      </div>

      {/* 2. Switcher entre Vencimentos, Dívidas e Projeção 6M */}
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
          onClick={() => setTabInterna('vencimentos')}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: tabInterna === 'vencimentos' ? 'var(--brand-primary)' : 'transparent',
            color: tabInterna === 'vencimentos' ? '#090d16' : 'var(--text-secondary)',
          }}
        >
          Cronograma
        </button>
        <button
          type="button"
          onClick={() => setTabInterna('dividas')}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: tabInterna === 'dividas' ? 'var(--brand-primary)' : 'transparent',
            color: tabInterna === 'dividas' ? '#090d16' : 'var(--text-secondary)',
          }}
        >
          Dívidas Ativas
        </button>
        <button
          type="button"
          onClick={() => setTabInterna('projecao')}
          style={{
            padding: '8px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: tabInterna === 'projecao' ? 'var(--brand-primary)' : 'transparent',
            color: tabInterna === 'projecao' ? '#090d16' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
        >
          <TrendingUp size={14} /> Projeção 6M
        </button>
      </div>

      {/* 3. Cards de Resumo */}
      {tabInterna === 'vencimentos' ? (
        <div
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            textAlign: 'center',
            padding: '14px 10px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total Previsto</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', marginTop: '4px' }}>
              {cronograma.totalPrevistoMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Já Quitado</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', marginTop: '4px', color: 'var(--status-green)' }}>
              {totalQuitado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Restante a Pagar</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', marginTop: '4px', color: 'var(--status-yellow)' }}>
              {totalPendente.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
            textAlign: 'center',
            padding: '16px 12px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Saldo Devedor Total</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.15rem', marginTop: '4px', color: 'var(--status-red)' }}>
              {parcelamentos.saldoDevedorTotalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Parcelamentos Ativos</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.15rem', marginTop: '4px', color: 'var(--text-primary)' }}>
              {parcelamentos.totalParcelamentosAtivos} contratos
            </div>
          </div>
        </div>
      )}

      {/* CONTEÚDO 1: LINHA DO TEMPO DOS PRÓXIMOS VENCIMENTOS */}
      {tabInterna === 'vencimentos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Cronograma Ordenado por Dia
            </span>
            <span className="badge badge-blue">{cronograma.competencia}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {cronograma.itens.map((item) => {
              const estaPago = Boolean(pagos[item.origemId]);

              return (
                <div
                  key={`${item.tipo}-${item.origemId}`}
                  className="card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    opacity: estaPago ? 0.6 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={() => togglePago(item.origemId, item)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        color: estaPago ? 'var(--status-green)' : 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={estaPago ? 'Marcar como não pago' : 'Marcar como pago'}
                    >
                      {estaPago ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                    </button>

                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '0.92rem',
                          textDecoration: estaPago ? 'line-through' : 'none',
                          color: estaPago ? 'var(--text-muted)' : 'var(--text-primary)',
                        }}
                      >
                        {item.descricao}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Dia {item.diaVencimento} • {item.categoria?.nome || 'Geral'}
                        {item.conta && ` • ${item.conta.nome}`}
                        {item.essencial && ' • Essencial'}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        fontSize: '1rem',
                        color: estaPago ? 'var(--status-green)' : 'var(--text-primary)',
                      }}
                    >
                      {item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                    {item.parcelamentoInfo && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Restante: {item.parcelamentoInfo.saldoDevedorRestanteAposMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CONTEÚDO 2: SEÇÃO DE DÍVIDAS E PARCELAMENTOS ATIVOS */}
      {tabInterna === 'dividas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Mapeamento completo de dívidas de curto e médio prazo em cartões de crédito e financiamentos.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {parcelamentos.parcelamentos.map((parc) => {
              const progressoPct = Math.round((parc.parcelaAtual / parc.totalParcelas) * 100);

              return (
                <div
                  key={parc.id}
                  className="card"
                  style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: '0.98rem', fontWeight: 700 }}>{parc.descricao}</h3>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {parc.conta?.nome || 'Cartão de Crédito'} • {parc.categoria?.nome || 'Geral'}
                      </div>
                    </div>
                    <StatusBadge
                      status={parc.status === 'ATIVO' ? 'AMARELO' : 'VERDE'}
                      label={parc.status}
                    />
                  </div>

                  {/* Barra de Progresso de Amortização */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Parcela {parc.parcelaAtual} de {parc.totalParcelas} ({progressoPct}% amortizado)
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Final: {parc.ultimoVencimento}
                      </span>
                    </div>
                    <div className="termometro-track" style={{ height: '8px' }}>
                      <div
                        className="termometro-fill status-amarelo"
                        style={{ width: `${progressoPct}%` }}
                      />
                    </div>
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
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Parcela Mensal</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem' }}>
                        {parc.parcelaValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Saldo Devedor Restante</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', color: 'var(--status-red)' }}>
                        {parc.saldoDevedorRestante.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CONTEÚDO 3: MOTOR DE PREVISÃO E PROJEÇÃO 6M (M-005 - TASK-14) */}
      {tabInterna === 'projecao' && (
        <ComponentePrevisao6M
          previsao={previsao}
          decomposicaoInicial={decomposicao}
          onAtualizar={onAtualizarPrevisao}
        />
      )}

      {onNovoCompromisso && (
        <button
          type="button"
          className="btn-primary"
          onClick={onNovoCompromisso}
          style={{ marginTop: '8px', width: '100%' }}
        >
          <PlusCircle size={18} /> Adicionar Nova Conta ou Parcelamento
        </button>
      )}
    </div>
  );
};
