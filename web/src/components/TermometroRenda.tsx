import React from 'react';
import { TermometroRendaProps } from './types.ts';

export const TermometroRenda: React.FC<TermometroRendaProps> = ({
  rendaBase,
  totalGasto,
  label = 'Comprometimento da Renda Base',
  showDetails = true,
}) => {
  const percentual = rendaBase > 0 ? (totalGasto / rendaBase) * 100 : 0;
  const saldoRestante = rendaBase - totalGasto;

  let statusClass = 'status-verde';
  if (percentual > 100) {
    statusClass = 'status-vermelho';
  } else if (percentual >= 85) {
    statusClass = 'status-amarelo';
  }

  const fillWidth = Math.min(Math.max(percentual, 0), 100);

  return (
    <div className="card termometro-container">
      <div className="termometro-header">
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: percentual > 100 ? 'var(--status-red)' : 'var(--text-primary)' }}>
          {percentual.toFixed(1)}%
        </span>
      </div>

      <div className="termometro-track">
        <div
          className={`termometro-fill ${statusClass}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>

      {showDetails && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '0.8rem' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Gasto: </span>
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {totalGasto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </strong>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Renda: </span>
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {rendaBase.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </strong>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Saldo: </span>
            <strong
              style={{
                fontFamily: 'var(--font-mono)',
                color: saldoRestante >= 0 ? 'var(--status-green)' : 'var(--status-red)',
              }}
            >
              {saldoRestante.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
};
