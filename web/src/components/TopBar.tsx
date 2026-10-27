import React from 'react';
import { Layers, ShieldAlert, Sparkles, LogOut, ShieldCheck, UserCheck, User, Eye, PiggyBank } from 'lucide-react';
import type { TopBarProps } from './types.ts';
import { useAuth } from '../context/AuthContext.tsx';

export const TopBar: React.FC<TopBarProps> = ({
  faseAtiva,
  onSelectFase,
  totalSuspeitasPendentes,
  onOpenSuspeitas,
  onOpenInvestimentos,
}) => {
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
          {onOpenInvestimentos && (
            <button
              type="button"
              className="btn-investimentos-header"
              onClick={onOpenInvestimentos}
              title="Aplicações & Registro de Aportes (Fase 1 Light)"
              aria-label="Investimentos"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: 'var(--brand-primary)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 700,
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <PiggyBank size={16} />
              <span className="suspeitas-text" style={{ fontSize: '0.78rem' }}>
                Aportes
              </span>
            </button>
          )}

          {onOpenSuspeitas && (
            <button
              type="button"
              className="btn-suspeitas-badge"
              onClick={onOpenSuspeitas}
              title={
                totalSuspeitasPendentes && totalSuspeitasPendentes > 0
                  ? `${totalSuspeitasPendentes} divergência(s) pendente(s) na Central de Validação`
                  : 'Central de Validação de Suspeitas (Malha Fina)'
              }
              aria-label="Central de Validação"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background:
                  totalSuspeitasPendentes && totalSuspeitasPendentes > 0
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(51, 65, 85, 0.4)',
                border:
                  totalSuspeitasPendentes && totalSuspeitasPendentes > 0
                    ? '1px solid rgba(239, 68, 68, 0.4)'
                    : '1px solid var(--border-subtle)',
                color:
                  totalSuspeitasPendentes && totalSuspeitasPendentes > 0
                    ? 'var(--status-red)'
                    : 'var(--text-secondary)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 700,
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <ShieldAlert size={16} />
              <span className="suspeitas-text" style={{ fontSize: '0.78rem' }}>
                Validação
              </span>
              {totalSuspeitasPendentes !== undefined && totalSuspeitasPendentes > 0 && (
                <span
                  style={{
                    backgroundColor: 'var(--status-red)',
                    color: '#fff',
                    borderRadius: '999px',
                    padding: '1px 6px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    minWidth: '18px',
                    textAlign: 'center',
                  }}
                >
                  {totalSuspeitasPendentes}
                </span>
              )}
            </button>
          )}

          <div className="top-bar-user-info" title={`Logado como ${usuario.nome} (${usuario.email})`}>
            <span className="user-name">{usuario.nome}</span>
            <div className="user-role-badge" title={`Perfil: ${role}`}>
              {getRoleIcon()}
              <span className="role-label">{role}</span>
            </div>
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
