import React from 'react';
import {
  TermometroRenda,
  CardSemaforo,
  StatusBadge,
} from '../components/index.ts';
import {
  TrendingDown,
  ArrowUpRight,
  Calendar,
  AlertCircle,
  CreditCard,
  Receipt,
  Sparkles,
} from 'lucide-react';
import {
  UsuarioPerfil,
  BaselineResponse,
  SemaforoResponse,
  CronogramaVencimentosResponse,
} from '../api.ts';

interface TelaDashboardProps {
  perfil: UsuarioPerfil;
  baseline: BaselineResponse;
  semaforo: SemaforoResponse;
  cronograma: CronogramaVencimentosResponse;
  totalGastoMes: number;
  onNavigateTab: (tab: 'dashboard' | 'lancamentos' | 'semaforo' | 'compromissos' | 'cadastros' | 'fases') => void;
  onOpenNovaTransacao: () => void;
}

export const TelaDashboard: React.FC<TelaDashboardProps> = ({
  perfil,
  baseline,
  semaforo,
  cronograma,
  totalGastoMes,
  onNavigateTab,
  onOpenNovaTransacao,
}) => {
  // Próximos 3 vencimentos mais urgentes do cronograma
  const proximosVencimentos = cronograma.itens.slice(0, 3);

  // Top categorias em alerta (vermelho primeiro, depois amarelo)
  const categoriasEmAlerta = [...semaforo.categorias]
    .sort((a, b) => {
      const orderMap = { VERMELHO: 0, AMARELO: 1, VERDE: 2 };
      if (orderMap[a.status_semaforo] !== orderMap[b.status_semaforo]) {
        return orderMap[a.status_semaforo] - orderMap[b.status_semaforo];
      }
      return b.diferenca_pp - a.diferenca_pp;
    })
    .slice(0, 5);

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

      {/* 2. Card do Termômetro de Renda Consumida no Mês */}
      <div className="card" style={{ padding: '18px' }}>
        <TermometroRenda
          rendaBase={perfil.rendaBaseMensal}
          totalGasto={totalGastoMes}
          label="Consumo da Renda Base (Mês Atual)"
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
            Média mensal N=6:{' '}
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
            onClick={() => onNavigateTab('compromissos')}
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
                  {item.tipo === 'PARCELAMENTO' ? (
                    <CreditCard size={18} color="var(--brand-secondary)" />
                  ) : (
                    <Receipt size={18} color="var(--status-yellow)" />
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{item.descricao}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Vencimento: Dia {item.diaVencimento} • {item.categoria?.nome || 'Geral'}
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

      {/* 5. Top 5 Categorias em Atenção / Alerta */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} color="var(--status-yellow)" />
            <h2 style={{ fontSize: '0.98rem', fontWeight: 700 }}>Top 5 Categorias em Alerta</h2>
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
            Diagnóstico completo <ArrowUpRight size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {categoriasEmAlerta.map((cat) => (
            <CardSemaforo
              key={cat.categoria_id}
              status={cat.status_semaforo}
              title={cat.nome}
              subtitle={`Média mensal: ${cat.gasto_medio_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
              percentual={cat.pct_gasto_atual}
              benchmark={cat.referencia_normalizada_pct}
              badgeText={
                cat.status_semaforo === 'VERMELHO'
                  ? `Excesso (+${cat.diferenca_pp.toFixed(1)} p.p.)`
                  : cat.status_semaforo === 'AMARELO'
                  ? `Atenção (+${cat.diferenca_pp.toFixed(1)} p.p.)`
                  : 'Equilibrado'
              }
            />
          ))}
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
