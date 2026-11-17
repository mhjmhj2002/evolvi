import React from 'react';
import {
  TermometroRenda,
  StatusBadge,
} from '../components/index.ts';
import {
  TrendingDown,
  ArrowUpRight,
  Calendar,
  Receipt,
  Sparkles,
  ShieldAlert,
  PiggyBank,
} from 'lucide-react';
import {
  UsuarioPerfil,
  BaselineResponse,
  HistoricoResumoResponse,
  ContaPagarItem,
} from '../api.ts';
import { NavTab } from '../components/types.ts';

interface TelaDashboardProps {
  perfil: UsuarioPerfil;
  baseline: BaselineResponse;
  totalGastoMes: number;
  contasPagar: ContaPagarItem[];
  dadosGraficoMensal: Array<{ competencia: string; totalReceitas: number; totalDespesas: number }>;
  historicoResumo: HistoricoResumoResponse;
  totalSuspeitasPendentes?: number;
  onNavigateTab: (tab: NavTab) => void;
  onOpenContasPagar: () => void;
  onOpenNovaTransacao: () => void;
}

export const TelaDashboard: React.FC<TelaDashboardProps> = ({
  perfil,
  baseline,
  totalGastoMes,
  contasPagar,
  dadosGraficoMensal,
  historicoResumo,
  totalSuspeitasPendentes = 0,
  onNavigateTab,
  onOpenContasPagar,
  onOpenNovaTransacao,
}) => {
  // Exibe exclusivamente contas a pagar da competência atual.
  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const proximosVencimentos = Array.from(
    new Map(
      contasPagar
        .filter((item) => item.status !== 'PAGO' && item.status !== 'CANCELADO')
        .map((item) => [
          `${item.id}-${item.dataVencimento || item.diaVencimento}`,
          item,
        ]),
    ).values(),
  )
    .filter((item) => !item.dataVencimento || item.dataVencimento.slice(0, 10) >= hojeIso || item.status !== 'PAGO')
    .sort((a, b) => (a.dataVencimento || '').localeCompare(b.dataVencimento || ''))
    .slice(0, 5)
    .map((item) => ({
      tipo: 'CONTA_PAGAR' as const,
      origemId: item.id,
      descricao: item.descricao,
      valor: Number(item.valor || 0),
      diaVencimento: item.diaVencimento,
      dataVencimentoPrevista: item.dataVencimento?.slice(0, 10) || '',
      categoria: item.categoria,
    }));

  const competenciaAtual = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const mesesJanela = baseline.meses_analisados?.length || perfil.mesesJanelaTemporal || 6;
  const maxFluxo = Math.max(
    ...dadosGraficoMensal.map((mes) => Math.max(mes.totalDespesas, mes.totalReceitas)),
    1,
  );
  // Economia acumulada = entradas menos gastos do período.
  const totalEconomizado = dadosGraficoMensal.reduce(
    (total, mes) => total + mes.totalReceitas - mes.totalDespesas,
    0,
  );

  const situacaoGeral =
    baseline.gap_zero_a_zero <= 0 ? 'EQUILIBRADO' : 'ATENCAO';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header com Boas-Vindas e Status da Fase 1 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Fase 1 • Zero a Zero
          </span>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
            Olá, {perfil.nome.split(' ')[0]}
          </h1>
        </div>
        <StatusBadge
          status={situacaoGeral === 'EQUILIBRADO' ? 'VERDE' : 'AMARELO'}
          label={situacaoGeral === 'EQUILIBRADO' ? 'Zero a Zero Atingido' : 'Gap a Eliminar'}
        />
      </div>

      {/* Banner de lançamentos com pendências */}
      {totalSuspeitasPendentes > 0 && (
        <div
          onClick={() => onNavigateTab('suspeitas')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(245, 158, 11, 0.12) 100%)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
            transition: 'transform 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(239, 68, 68, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--status-red)',
                flexShrink: 0,
              }}
            >
              <ShieldAlert size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {totalSuspeitasPendentes} lançamento(s) com pendência(s)
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Há lançamentos que precisam de uma conferência sua. Clique para revisar.
              </div>
            </div>
          </div>
          <ArrowUpRight size={18} color="var(--status-red)" />
        </div>
      )}

      {/* 2. Card do Termômetro de Renda Consumida no Mês */}
      <div className="card" style={{ padding: '18px' }}>
        <TermometroRenda
          rendaBase={perfil.rendaBaseMensal}
          totalGasto={totalGastoMes}
          label={`Consumo da Renda Base (${competenciaAtual})`}
          showDetails={true}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Saldo Disponível:
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '1.05rem',
            color: perfil.rendaBaseMensal - totalGastoMes >= 0 ? 'var(--status-green)' : 'var(--status-red)',
          }}>
            {(perfil.rendaBaseMensal - totalGastoMes).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </span>
        </div>
      </div>

      {/* 3. Card de Diagnóstico do Gap Baseline N=6 */}
      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.16) 0%, rgba(37, 99, 235, 0.08) 100%)',
          borderColor: 'rgba(56, 189, 248, 0.35)',
        }}
      >
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(56, 189, 248, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--brand-primary)',
            flexShrink: 0,
          }}
        >
          <TrendingDown size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Gap do Zero a Zero
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {baseline.gap_zero_a_zero > 0
                ? `+ ${baseline.gap_zero_a_zero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                : 'Equacionado'}
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Média dos últimos {mesesJanela} meses:{' '}
            <strong>
              {baseline.media_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </strong>{' '}
            ({baseline.pct_excesso_renda > 0 ? `+${baseline.pct_excesso_renda}% acima da renda` : 'dentro da renda'}).
          </div>
        </div>
      </div>

      {/* 4. Lista Rápida dos Próximos Vencimentos da Semana */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={18} color="var(--brand-primary)" />
            <h2 style={{ fontSize: '0.98rem', fontWeight: 700 }}>Próximos Vencimentos</h2>
          </div>
          <button
            type="button"
            onClick={onOpenContasPagar}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--brand-primary)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            Ver agenda <ArrowUpRight size={14} />
          </button>
        </div>

        {proximosVencimentos.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
            Nenhum compromisso pendente nesta semana.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {proximosVencimentos.map((item) => (
              <div
                key={`${item.tipo}-${item.origemId}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(30, 41, 59, 0.45)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Receipt size={18} color="var(--status-yellow)" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{item.descricao}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                      <span>Vencimento: Dia {item.diaVencimento} • {item.categoria?.nome || 'Geral'}</span>
                    </div>
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.92rem' }}>
                  {item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Visão visual de gastos e economias */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingDown size={18} color="var(--brand-primary)" />
            <h2 style={{ fontSize: '0.98rem', fontWeight: 700 }}>Como está seu dinheiro</h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('semaforo')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--brand-primary)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            Ver detalhes <ArrowUpRight size={14} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
          <div style={{ padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(34, 197, 94, 0.10)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Entradas no período</div>
            <strong style={{ fontSize: '1.05rem', color: 'var(--status-green)' }}>{historicoResumo.total_periodo_receitas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
          </div>
          <div style={{ padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(239, 68, 68, 0.10)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gastos no período</div>
            <strong style={{ fontSize: '1.05rem' }}>{historicoResumo.total_periodo_despesas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
          </div>
          <div style={{ padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(34, 197, 94, 0.10)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Economia acumulada</div>
            <strong style={{ fontSize: '1.05rem', color: totalEconomizado >= 0 ? 'var(--status-green)' : 'var(--status-red)' }}>{totalEconomizado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Receitas x gastos</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '170px' }}>
            {dadosGraficoMensal.slice(-6).map((mes) => (
              <div key={`fluxo-${mes.competencia}`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '5px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '3px', width: '100%', flex: 1 }}>
                  <div title={`Receitas: ${mes.totalReceitas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`} style={{ width: '40%', maxWidth: '22px', minHeight: '3px', height: `${Math.max((mes.totalReceitas / maxFluxo) * 100, 2)}%`, background: 'linear-gradient(180deg, var(--status-green), rgba(34, 197, 94, 0.35))', borderRadius: '4px 4px 1px 1px', cursor: 'help' }} />
                  <div title={`Gastos: ${mes.totalDespesas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`} style={{ width: '40%', maxWidth: '22px', minHeight: '3px', height: `${Math.max((mes.totalDespesas / maxFluxo) * 100, 2)}%`, background: 'linear-gradient(180deg, var(--status-red), rgba(239, 68, 68, 0.35))', borderRadius: '4px 4px 1px 1px', cursor: 'help' }} />
                </div>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(`${mes.competencia}-01T12:00:00`)).replace('.', '')}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}><span style={{ color: 'var(--status-green)' }}>● Receitas</span><span style={{ color: 'var(--status-red)' }}>● Gastos</span></div>
        </div>
      </div>

      {/* Botões de Ação Rápida */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        <button
          type="button"
          className="btn-primary"
          onClick={onOpenNovaTransacao}
          style={{ width: '100%' }}
        >
          <Sparkles size={18} /> Registrar Despesa / Pagamento
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('importacao')}
          style={{
            width: '100%',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(56, 189, 248, 0.15) 100%)',
            border: '1px solid rgba(129, 140, 248, 0.4)',
            color: '#c7d2fe',
            borderRadius: 'var(--radius-sm)',
            minHeight: '44px',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
          }}
        >
          <Sparkles size={18} color="var(--brand-primary)" /> Importar Faturas e Pastas com IA
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('investimentos')}
          style={{
            width: '100%',
            background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.18) 0%, rgba(56, 189, 248, 0.12) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            color: 'var(--brand-primary)',
            borderRadius: 'var(--radius-sm)',
            minHeight: '44px',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
          }}
        >
          <PiggyBank size={18} /> Ver Investimentos & Aportes (Fase 1 Light)
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('lancamentos')}
          style={{
            width: '100%',
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--brand-primary)',
            borderRadius: 'var(--radius-sm)',
            minHeight: '44px',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'background 0.2s ease',
          }}
        >
          <Receipt size={18} /> Ver Todos os Lançamentos (Extrato)
        </button>
      </div>
    </div>
  );
};
