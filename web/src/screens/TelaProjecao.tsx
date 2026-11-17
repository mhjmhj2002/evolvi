import React from 'react';
import { TrendingUp } from 'lucide-react';
import { ComponentePrevisao6M } from '../components/index.ts';
import { DecomposicaoCategoriasResponse, PrevisaoSeisMesesResponse } from '../api.ts';

interface TelaProjecaoProps {
  previsao: PrevisaoSeisMesesResponse;
  decomposicao: DecomposicaoCategoriasResponse;
  onAtualizar: () => void;
}

export const TelaProjecao: React.FC<TelaProjecaoProps> = ({ previsao, decomposicao, onAtualizar }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Planejamento de consumo futuro</span>
      <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <TrendingUp size={24} color="var(--brand-primary)" /> Projeção
      </h1>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
        Estimativa dos próximos meses baseada no histórico de consumo e nos compromissos já conhecidos.
      </p>
    </div>
    <ComponentePrevisao6M previsao={previsao} decomposicaoInicial={decomposicao} onAtualizar={onAtualizar} />
  </div>
);
