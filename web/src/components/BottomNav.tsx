import React from 'react';
import { LayoutDashboard, Activity, CalendarClock, Compass, Plus, UserCog } from 'lucide-react';
import { BottomNavProps } from './types.ts';

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenNewTransaction,
}) => {
  return (
    <nav className="bottom-nav" aria-label="Navegação Principal Mobile">
      <button
        type="button"
        className={`bottom-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
        onClick={() => onSelectTab('dashboard')}
      >
        <div className="nav-icon-wrapper">
          <LayoutDashboard size={20} />
        </div>
        <span>Início</span>
      </button>

      <button
        type="button"
        className={`bottom-nav-item ${activeTab === 'semaforo' ? 'active' : ''}`}
        onClick={() => onSelectTab('semaforo')}
      >
        <div className="nav-icon-wrapper">
          <Activity size={20} />
        </div>
        <span>Semáforo</span>
      </button>

      {/* Floating Center Action Button - ergonomia celular */}
      <button
        type="button"
        className="bottom-nav-action-btn"
        onClick={onOpenNewTransaction}
        aria-label="Adicionar Lançamento"
        title="Novo Lançamento"
      >
        <Plus size={26} strokeWidth={2.6} />
      </button>

      <button
        type="button"
        className={`bottom-nav-item ${activeTab === 'compromissos' ? 'active' : ''}`}
        onClick={() => onSelectTab('compromissos')}
      >
        <div className="nav-icon-wrapper">
          <CalendarClock size={20} />
        </div>
        <span>Contas</span>
      </button>

      <button
        type="button"
        className={`bottom-nav-item ${activeTab === 'cadastros' ? 'active' : ''}`}
        onClick={() => onSelectTab('cadastros')}
      >
        <div className="nav-icon-wrapper">
          <UserCog size={20} />
        </div>
        <span>Cadastros</span>
      </button>

      <button
        type="button"
        className={`bottom-nav-item ${activeTab === 'fases' ? 'active' : ''}`}
        onClick={() => onSelectTab('fases')}
      >
        <div className="nav-icon-wrapper">
          <Compass size={20} />
        </div>
        <span>Fases</span>
      </button>
    </nav>
  );
};
