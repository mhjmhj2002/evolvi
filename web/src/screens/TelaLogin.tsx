import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { RoleUsuario } from '../api.ts';
import {
  Lock,
  Mail,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Sparkles,
  UserCheck,
  User,
  DollarSign,
  UserPlus,
  LogIn,
  CheckCircle2,
} from 'lucide-react';

export const TelaLogin: React.FC = () => {
  const { login, cadastro } = useAuth();
  const [modo, setModo] = useState<'login' | 'cadastro'>('login');

  // Campos do formulário
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [rendaBaseMensal, setRendaBaseMensal] = useState('');
  const [roleSelecionada, setRoleSelecionada] = useState<RoleUsuario>('USER');

  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setSucesso(null);

    if (modo === 'cadastro') {
      if (!nome.trim()) {
        setErro('Por favor informe seu nome completo.');
        return;
      }
      if (!email.trim() || !senha) {
        setErro('Por favor preencha e-mail e senha.');
        return;
      }
      if (senha.length < 6) {
        setErro('A senha deve ter no mínimo 6 caracteres.');
        return;
      }
      if (senha !== confirmarSenha) {
        setErro('As senhas não conferem. Por favor redigite a confirmação.');
        return;
      }

      const rendaNum = rendaBaseMensal ? parseFloat(rendaBaseMensal.replace(',', '.')) : 0;
      if (isNaN(rendaNum) || rendaNum < 0) {
        setErro('Informe um valor de renda base válido (ex: 4500.00).');
        return;
      }

      try {
        setLoading(true);
        await cadastro({
          nome: nome.trim(),
          email: email.trim().toLowerCase(),
          senha,
          rendaBaseMensal: rendaNum,
          role: roleSelecionada,
        });
        setSucesso('Conta criada e autenticada com sucesso! Redirecionando...');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Falha ao realizar cadastro.';
        setErro(message);
      } finally {
        setLoading(false);
      }
    } else {
      // Modo Login
      if (!email || !senha) {
        setErro('Por favor preencha e-mail e senha.');
        return;
      }

      try {
        setLoading(true);
        await login(email, senha, roleSelecionada);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Falha ao autenticar usuário.';
        setErro(message);
      } finally {
        setLoading(false);
      }
    }
  };

  const preencherDemo = (perfilRole: RoleUsuario) => {
    setModo('login');
    setRoleSelecionada(perfilRole);
    if (perfilRole === 'OWNER') {
      setEmail('owner@evolvi.app');
      setSenha('EvolviOwner2026!');
    } else if (perfilRole === 'ADMIN') {
      setEmail('admin@evolvi.app');
      setSenha('EvolviAdmin2026!');
    } else if (perfilRole === 'VISITANTE') {
      setEmail('visitante@evolvi.app');
      setSenha('EvolviVisitante2026!');
    } else {
      setEmail('usuario@evolvi.app');
      setSenha('EvolviUser2026!');
    }
    setErro(null);
    setSucesso(null);
  };

  const alternarModo = (novoModo: 'login' | 'cadastro') => {
    setModo(novoModo);
    setErro(null);
    setSucesso(null);
  };

  return (
    <div className="login-screen-container">
      <div className="login-card">
        {/* Header / Brand */}
        <div className="login-brand-header">
          <div className="login-logo-badge">
            <Sparkles size={28} className="login-logo-icon" />
          </div>
          <h1 className="login-title">Evolvi</h1>
          <p className="login-subtitle">
            Sistema de Gestão Financeira Inteligente — Fase 1 (Zero a Zero)
          </p>
        </div>

        {/* Abas Alternadoras: Entrar vs Criar Conta */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab-btn ${modo === 'login' ? 'active' : ''}`}
            onClick={() => alternarModo('login')}
          >
            <LogIn size={16} />
            <span>Entrar</span>
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${modo === 'cadastro' ? 'active' : ''}`}
            onClick={() => alternarModo('cadastro')}
          >
            <UserPlus size={16} />
            <span>Criar Nova Conta</span>
          </button>
        </div>

        {/* Alerta de erro */}
        {erro && (
          <div className="login-error-alert" role="alert">
            <AlertCircle size={18} />
            <span>{erro}</span>
          </div>
        )}

        {/* Alerta de sucesso */}
        {sucesso && (
          <div className="login-success-alert" role="status">
            <CheckCircle2 size={18} />
            <span>{sucesso}</span>
          </div>
        )}

        {/* Formulário de Login / Cadastro */}
        <form onSubmit={handleSubmit} className="login-form">
          {modo === 'cadastro' && (
            <div className="form-group">
              <label className="form-label" htmlFor="input-nome">
                Nome Completo
              </label>
              <div className="input-icon-wrapper">
                <User size={18} className="input-field-icon" />
                <input
                  id="input-nome"
                  type="text"
                  className="form-input with-icon"
                  placeholder="Ex: Maria Silva"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required={modo === 'cadastro'}
                  autoComplete="name"
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="input-email">
              E-mail
            </label>
            <div className="input-icon-wrapper">
              <Mail size={18} className="input-field-icon" />
              <input
                id="input-email"
                type="email"
                className="form-input with-icon"
                placeholder="seu.email@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="input-senha">
              {modo === 'cadastro' ? 'Criar Senha (mín. 6 caracteres)' : 'Senha de Acesso'}
            </label>
            <div className="input-icon-wrapper">
              <Lock size={18} className="input-field-icon" />
              <input
                id="input-senha"
                type="password"
                className="form-input with-icon"
                placeholder="••••••••••••"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                autoComplete={modo === 'cadastro' ? 'new-password' : 'current-password'}
              />
            </div>
          </div>

          {modo === 'cadastro' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="input-confirmar-senha">
                  Confirmar Senha
                </label>
                <div className="input-icon-wrapper">
                  <Lock size={18} className="input-field-icon" />
                  <input
                    id="input-confirmar-senha"
                    type="password"
                    className="form-input with-icon"
                    placeholder="Repita a senha"
                    value={confirmarSenha}
                    onChange={(e) => setConfirmarSenha(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="input-renda">
                  Renda Base Mensal Estimada (R$)
                </label>
                <div className="input-icon-wrapper">
                  <DollarSign size={18} className="input-field-icon" />
                  <input
                    id="input-renda"
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input with-icon"
                    placeholder="Ex: 5000.00"
                    value={rendaBaseMensal}
                    onChange={(e) => setRendaBaseMensal(e.target.value)}
                  />
                </div>
                <span className="role-helper-text">
                  Utilizada para calcular o Semáforo e Diagnóstico de Gastos (opcional).
                </span>
              </div>
            </>
          )}

          {/* Seleção de Role / Perfil de Acesso */}
          <div className="form-group">
            <label className="form-label">
              Papel / Role de Acesso (RBAC)
            </label>
            <div className="role-selector-group">
              <button
                type="button"
                className={`role-select-chip ${roleSelecionada === 'OWNER' ? 'active' : ''}`}
                onClick={() => setRoleSelecionada('OWNER')}
              >
                <ShieldCheck size={14} />
                <span>Owner</span>
              </button>

              <button
                type="button"
                className={`role-select-chip ${roleSelecionada === 'ADMIN' ? 'active' : ''}`}
                onClick={() => setRoleSelecionada('ADMIN')}
              >
                <UserCheck size={14} />
                <span>Admin</span>
              </button>

              <button
                type="button"
                className={`role-select-chip ${roleSelecionada === 'USER' ? 'active' : ''}`}
                onClick={() => setRoleSelecionada('USER')}
              >
                <span>User</span>
              </button>

              <button
                type="button"
                className={`role-select-chip ${roleSelecionada === 'VISITANTE' ? 'active' : ''}`}
                onClick={() => setRoleSelecionada('VISITANTE')}
              >
                <span>Visitante</span>
              </button>
            </div>
            <span className="role-helper-text">
              Sessão autenticada válida por 24 horas (expiração parametrizável).
            </span>
          </div>

          <button
            type="submit"
            className="btn-primary login-submit-btn"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="spinner" />
                <span>{modo === 'cadastro' ? 'Criando conta...' : 'Autenticando...'}</span>
              </>
            ) : (
              <span>{modo === 'cadastro' ? 'Concluir Cadastro e Entrar' : 'Entrar no Sistema'}</span>
            )}
          </button>
        </form>

        {/* Botões de Acesso Rápido / Demonstração (apenas no modo Login) */}
        {modo === 'login' && (
          <div className="login-demo-section">
            <div className="demo-divider">
              <span>Acesso Rápido para Avaliação</span>
            </div>
            <div className="demo-buttons-grid">
              <button
                type="button"
                className="btn-demo-quick"
                onClick={() => preencherDemo('OWNER')}
              >
                Demo Owner
              </button>
              <button
                type="button"
                className="btn-demo-quick"
                onClick={() => preencherDemo('ADMIN')}
              >
                Demo Admin
              </button>
              <button
                type="button"
                className="btn-demo-quick"
                onClick={() => preencherDemo('USER')}
              >
                Demo User
              </button>
              <button
                type="button"
                className="btn-demo-quick"
                onClick={() => preencherDemo('VISITANTE')}
              >
                Demo Visitante
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
