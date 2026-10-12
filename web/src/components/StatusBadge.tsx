import React from 'react';
import { StatusBadgeProps } from './types.ts';

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  let badgeClass = 'badge-verde';
  let defaultLabel = 'Ideal';

  if (status === 'AMARELO') {
    badgeClass = 'badge-amarelo';
    defaultLabel = 'Atenção';
  } else if (status === 'VERMELHO') {
    badgeClass = 'badge-vermelho';
    defaultLabel = 'Crítico';
  } else if (status === 'DEV') {
    badgeClass = 'badge-blue';
    defaultLabel = 'Em Breve';
  } else if (status === 'INFO') {
    badgeClass = 'badge-blue';
    defaultLabel = 'Info';
  }

  return (
    <span className={`badge ${badgeClass}`}>
      {label || defaultLabel}
    </span>
  );
};
