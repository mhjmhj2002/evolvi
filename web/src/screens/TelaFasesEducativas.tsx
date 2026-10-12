import React from 'react';
import { StatusBadge } from '../components/index.ts';
import {
  Shield,
  Rocket,
  Lock,
  TrendingUp,
  PiggyBank,
  Compass,
} from 'lucide-react';

export const TelaFasesEducativas: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header */}
      <div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Jornada de Evolução Financeira
        </span>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
          Pilares e Próximas Fases
        </h1>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          O Evolvi organiza a saúde financeira em 3 etapas sequenciais e inegociáveis. Você só avança após consolidar a fase anterior.
        </p>
      </div>

      {/* Fase 1: Atual */}
      <div
        className="card"
        style={{
          borderLeft: '4px solid var(--brand-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(19, 29, 50, 0.72) 100%)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(56, 189, 248, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--brand-primary)',
                fontWeight: 800,
              }}
            >
              1
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Fase 1: Zero a Zero</h2>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Sair do endividamento e equilibrar despesas</div>
            </div>
          </div>
          <StatusBadge status="VERDE" label="Fase Ativa" />
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Diagnóstico dos últimos 6 meses com Semáforo POF, controle anti-dupla contagem entre cartão e dinheiro, cronograma diário de vencimentos e plano de metas rígido para que as despesas totais caibam 100% na renda base líquida.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
          <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '4px', backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)' }}>
            ✓ Eliminação de juros rotativos
          </span>
          <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '4px', backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)' }}>
            ✓ Média móvel N=6
          </span>
          <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '4px', backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)' }}>
            ✓ Equacionamento orçamentário
          </span>
        </div>
      </div>

      {/* Fase 2: Reserva de Emergência (Em Desenvolvimento) */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: '1px dashed var(--border-card)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(129, 140, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--brand-secondary)',
              }}
            >
              <Shield size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Fase 2: Reserva de Emergência</h2>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Fazer dinheiro sobrar e colchão de segurança</div>
            </div>
          </div>
          <StatusBadge status="DEV" label="Em Desenvolvimento" />
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Assim que o orçamento fechar no Zero a Zero com folga mensal, esta fase ajudará você a acumular e proteger uma reserva equivalente a <strong>6 meses do custo de vida essencial</strong> em ativos com liquidez imediata (Tesouro Selic / CDB 100% CDI).
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
          <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
              <PiggyBank size={16} color="var(--brand-secondary)" /> Meta Sugerida
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              6x despesas essenciais apuradas na Fase 1
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
              <Lock size={16} color="var(--text-muted)" /> Desbloqueio
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Após eliminação completa do Gap Zero a Zero
            </div>
          </div>
        </div>
      </div>

      {/* Fase 3: Investimentos (Em Desenvolvimento) */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: '1px dashed var(--border-card)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--status-green)',
              }}
            >
              <Rocket size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Fase 3: Investimentos</h2>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Alocação patrimonial e longo prazo</div>
            </div>
          </div>
          <StatusBadge status="DEV" label="Em Desenvolvimento" />
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Com dívidas zeradas e reserva consolidada, o investidor inicia a alocação diversificada e orientada à independência financeira: títulos prefixados/IPCA+, fundos imobiliários e renda variável no Brasil e exterior.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
          <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
              <TrendingUp size={16} color="var(--status-green)" /> Carteira Teórica
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Rebalanceamento inteligente e juros compostos
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
              <Compass size={16} color="var(--brand-primary)" /> Filosofia
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Alocação disciplinada sem apostas especulativas
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
