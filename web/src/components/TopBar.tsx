import React from 'react';
import { ShieldAlert, LogOut, ShieldCheck, UserCheck, User, Eye, PiggyBank, Bell } from 'lucide-react';
import type { TopBarProps } from './types.ts';
import { useAuth } from '../context/AuthContext.tsx';

export const TopBar: React.FC<TopBarProps> = ({
  onGoHome,
  totalSuspeitasPendentes,
  totalAlertasPendentes,
  onOpenSuspeitas,
  onOpenInvestimentos,
  onOpenAlertas,
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
      <button
        type="button"
        className="top-bar-brand top-bar-home-button"
        onClick={onGoHome}
        aria-label="Voltar para o Dashboard"
        title="Voltar para o Dashboard"
      >
        <div className="top-bar-logo">E</div>
        <span className="top-bar-title">Evolvi</span>
      </button>

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
                  ? `${totalSuspeitasPendentes} lançamento(s) com pendência(s)`
                  : 'Lançamentos com pendências'
              }
              aria-label="Lançamentos com pendências"
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

          {onOpenAlertas && (
            <button
              type="button"
              className="btn-alertas-header"
              onClick={onOpenAlertas}
              title={
                totalAlertasPendentes && totalAlertasPendentes > 0
                  ? `${totalAlertasPendentes} alerta(s) pendente(s)`
                  : 'Central de Alertas'
              }
              aria-label="Alertas"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background:
                  totalAlertasPendentes && totalAlertasPendentes > 0
                    ? 'rgba(234, 179, 8, 0.15)'
                    : 'rgba(51, 65, 85, 0.4)',
                border:
                  totalAlertasPendentes && totalAlertasPendentes > 0
                    ? '1px solid rgba(234, 179, 8, 0.4)'
                    : '1px solid var(--border-subtle)',
                color:
                  totalAlertasPendentes && totalAlertasPendentes > 0
                    ? 'var(--status-yellow)'
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
              <Bell size={16} />
              <span className="suspeitas-text" style={{ fontSize: '0.78rem' }}>
                Alertas
              </span>
              {totalAlertasPendentes !== undefined && totalAlertasPendentes > 0 && (
                <span
                  style={{
                    backgroundColor: 'var(--status-yellow)',
                    color: '#000',
                    borderRadius: '999px',
                    padding: '1px 6px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    minWidth: '18px',
                    textAlign: 'center',
                  }}
                >
                  {totalAlertasPendentes}
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
