import React from 'react';
import { CardSemaforoProps } from './types.ts';

export const CardSemaforo: React.FC<CardSemaforoProps> = ({
  status,
  title,
  subtitle,
  valor,
  percentual,
  benchmark,
  badgeText,
  children,
  onClick,
  className = '',
}) => {
  const statusClass =
    status === 'VERDE'
      ? 'status-verde'
      : status === 'AMARELO'
        ? 'status-amarelo'
        : 'status-vermelho';

  const badgeClass =
    status === 'VERDE'
      ? 'badge-verde'
      : status === 'AMARELO'
        ? 'badge-amarelo'
        : 'badge-vermelho';

  return (
    <div
      className={`card card-semaforo ${statusClass} ${className}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          {subtitle && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {subtitle}
            </p>
          )}
        </div>
        <span className={`badge ${badgeClass}`}>
          {badgeText || status}
        </span>
      </div>

      {(valor !== undefined || percentual !== undefined) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '12px' }}>
          {valor !== undefined && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {typeof valor === 'number'
                ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                : valor}
            </div>
          )}
          {percentual !== undefined && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{percentual}%</span>
              {benchmark !== undefined && <span> / ref {benchmark}%</span>}
            </div>
          )}
        </div>
      )}

      {children && <div style={{ marginTop: '12px' }}>{children}</div>}
    </div>
  );
};
