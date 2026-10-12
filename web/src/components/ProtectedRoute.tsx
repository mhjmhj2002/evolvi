import React from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { RoleUsuario } from '../api.ts';
import { TelaLogin } from '../screens/TelaLogin.tsx';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: RoleUsuario[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { isAuthenticated, isLoading, role } = useAuth();

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-secondary)',
          gap: '12px',
        }}
      >
        <Loader2 size={32} className="spinner" style={{ color: 'var(--brand-primary)' }} />
        <span>Validando sessão segura...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <TelaLogin />;
  }

  // Se houver restrição de roles específica para este bloco/rota
  if (allowedRoles && allowedRoles.length > 0) {
    const normalizedUserRole = (role || 'USER').toUpperCase();
    const hasPermission = allowedRoles.some((r) => r.toUpperCase() === normalizedUserRole);

    if (!hasPermission) {
      return (
        <div
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--status-red)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <h2>Acesso Não Autorizado</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Seu perfil ({role}) não tem permissão para visualizar este recurso restrito.
          </p>
        </div>
      );
    }
  }

  return <>{children}</>;
};
