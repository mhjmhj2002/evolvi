import React from 'react';
import { Layers, ShieldAlert, Sparkles, LogOut, ShieldCheck, UserCheck, User, Eye } from 'lucide-react';
import type { TopBarProps } from './types.ts';
import { useAuth } from '../context/AuthContext.tsx';

export const TopBar: React.FC<TopBarProps> = ({ faseAtiva, onSelectFase }) => {
  const { usuario, role, logout } = useAuth();

  const getRoleIcon = () => {
    switch (role) {
      case 'OWNER':
        return <ShieldCheck size={12} />;
      case 'ADMIN':
        return <UserCheck size={12} />;
      case 'VISITANTE':
        return <Eye size={12} />;
      default:
        return <User size={12} />;
    }
  };

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <div className="top-bar-logo">E</div>
        <span className="top-bar-title">Evolvi</span>
      </div>

      <div className="phase-selector-container" role="tablist" aria-label="Seletor de Fases Evolutivas">
        <button
          type="button"
          role="tab"
          aria-selected={faseAtiva === 'FASE_1'}
          className={`phase-pill ${faseAtiva === 'FASE_1' ? 'active' : ''}`}
          onClick={() => onSelectFase?.('FASE_1')}
          title="Fase 1: Zero a Zero (Ativa)"
        >
          <Layers size={14} />
          <span>Fase 1</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={faseAtiva === 'FASE_2'}
          className={`phase-pill disabled ${faseAtiva === 'FASE_2' ? 'active' : ''}`}
          onClick={() => onSelectFase?.('FASE_2')}
          title="Fase 2: Reserva de Emergência (Em Desenvolvimento)"
        >
          <ShieldAlert size={14} />
          <span>Fase 2</span>
          <span className="badge-dev">Dev</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={faseAtiva === 'FASE_3'}
          className={`phase-pill disabled ${faseAtiva === 'FASE_3' ? 'active' : ''}`}
          onClick={() => onSelectFase?.('FASE_3')}
          title="Fase 3: Investimentos (Em Desenvolvimento)"
        >
          <Sparkles size={14} />
          <span>Fase 3</span>
          <span className="badge-dev">Dev</span>
        </button>
      </div>

      {usuario && (
        <div className="top-bar-user-area">
          <div className="user-role-badge" title={`Autenticado como ${usuario.email} (${role})`}>
            {getRoleIcon()}
            <span className="role-label">{role}</span>
          </div>

          <button
            type="button"
            className="btn-logout"
            onClick={() => logout()}
            title="Sair do sistema (Logout)"
            aria-label="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      )}
    </header>
  );
};
