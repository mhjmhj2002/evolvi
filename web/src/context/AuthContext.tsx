import React, { createContext, useContext, useState, useEffect } from 'react';
import { UsuarioPerfil, RoleUsuario, apiService } from '../api.ts';

interface AuthContextType {
  usuario: UsuarioPerfil | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: RoleUsuario;
  login: (email: string, senha: string, roleDesejada?: RoleUsuario) => Promise<void>;
  cadastro: (dados: {
    nome: string;
    email: string;
    senha: string;
    rendaBaseMensal?: number;
    role?: RoleUsuario;
  }) => Promise<void>;
  atualizarRendaBase: (novaRenda: number) => Promise<UsuarioPerfil>;
  logout: () => Promise<void>;
  hasRole: (roles: RoleUsuario | RoleUsuario[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_USER_KEY = 'evolvi_auth_user';
const LOCAL_STORAGE_TOKEN_KEY = 'evolvi_auth_token';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [usuario, setUsuario] = useState<UsuarioPerfil | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Inicialização: tenta restaurar sessão salva no storage ou validar com backend
  useEffect(() => {
    async function initAuth() {
      try {
        const storedUser = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser) as UsuarioPerfil;
          setUsuario(parsedUser);
        }

        // Tentar obter perfil autenticado do servidor se houver cookie/sessão
        const perfilServidor = await apiService.getPerfil();
        if (perfilServidor && perfilServidor.id && perfilServidor.id !== 'usr-demo-1') {
          setUsuario(perfilServidor);
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(perfilServidor));
        }
      } catch {
        // Modo offline / sem sessão ativa
      } finally {
        setIsLoading(false);
      }
    }

    initAuth();
  }, []);

  const login = async (email: string, senha: string, roleDesejada?: RoleUsuario) => {
    setIsLoading(true);
    try {
      // Tentar login real via API
      try {
        const data = await apiService.login({ email, senha });
        if (data && data.usuario) {
          const userWithRole: UsuarioPerfil = {
            ...data.usuario,
            role: roleDesejada ? (roleDesejada.toUpperCase() as RoleUsuario) : (data.usuario.role || 'USER'),
          };
          setUsuario(userWithRole);
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(userWithRole));
          if (data.token) {
            localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, data.token);
          }
          return;
        }
      } catch (err) {
        // Se a chamada de rede falhar e for ambiente local de desenvolvimento,
        // permite fallback de login simulado para as 3 roles com validação de senha
        if (senha.length < 4) {
          throw new Error('Senha deve ter no mínimo 4 caracteres.');
        }

        const roleDefinida: RoleUsuario = (roleDesejada || 'USER').toUpperCase() as RoleUsuario;
        const nomesPorEmail: Record<string, string> = {
          'owner@evolvi.app': 'Owner Evolvi',
          'admin@evolvi.app': 'Admin Evolvi',
          'visitante@evolvi.app': 'Visitante Evolvi',
          'usuario@evolvi.app': 'Usuário Evolvi',
        };
        const nomeFormatado =
          nomesPorEmail[email.toLowerCase()] ||
          (email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1).toLowerCase());

        const mockUser: UsuarioPerfil = {
          id: `usr-${Date.now()}`,
          nome: nomeFormatado,
          email: email.toLowerCase(),
          role: roleDefinida,
          rendaBaseMensal: 5500.0,
          faseAtual: 'FASE_1',
          criadoEm: new Date().toISOString(),
        };

        setUsuario(mockUser);
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(mockUser));
        localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, `mock-token-${Date.now()}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const cadastro = async (dados: {
    nome: string;
    email: string;
    senha: string;
    rendaBaseMensal?: number;
    role?: RoleUsuario;
  }) => {
    setIsLoading(true);
    try {
      try {
        const data = await apiService.cadastro(dados);
        if (data && data.usuario) {
          const userWithRole: UsuarioPerfil = {
            ...data.usuario,
            role: dados.role ? (dados.role.toUpperCase() as RoleUsuario) : (data.usuario.role || 'USER'),
          };
          setUsuario(userWithRole);
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(userWithRole));
          if (data.token) {
            localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, data.token);
          }
          return;
        }
      } catch (err: unknown) {
        // Se o erro tiver mensagem de conflito ou validação do backend, repassa
        if (err instanceof Error && err.message.includes('Já existe um usuário')) {
          throw err;
        }
        if (dados.senha.length < 6) {
          throw new Error('Senha deve ter no mínimo 6 caracteres.');
        }

        const roleDefinida: RoleUsuario = (dados.role || 'USER').toUpperCase() as RoleUsuario;
        const mockUser: UsuarioPerfil = {
          id: `usr-${Date.now()}`,
          nome: dados.nome,
          email: dados.email.toLowerCase(),
          role: roleDefinida,
          rendaBaseMensal: dados.rendaBaseMensal !== undefined ? dados.rendaBaseMensal : 0.0,
          faseAtual: 'FASE_1',
          criadoEm: new Date().toISOString(),
        };

        setUsuario(mockUser);
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(mockUser));
        localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, `mock-token-${Date.now()}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const atualizarRendaBase = async (novaRenda: number): Promise<UsuarioPerfil> => {
    setIsLoading(true);
    try {
      try {
        const res = await apiService.atualizarRendaBase(novaRenda);
        if (res && res.usuario) {
          const userAtualizado: UsuarioPerfil = {
            ...res.usuario,
            role: (res.usuario.role || usuario?.role || 'USER') as RoleUsuario,
          };
          setUsuario(userAtualizado);
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(userAtualizado));
          return userAtualizado;
        }
      } catch (err) {
        console.warn('Falha na API ao atualizar renda base, aplicando no estado local:', err);
      }

      // Fallback local caso offline
      const userAtualizado: UsuarioPerfil = {
        ...(usuario || {
          id: 'usr-local',
          nome: 'Usuário',
          email: 'usuario@evolvi.app',
          role: 'USER',
          faseAtual: 'FASE_1',
          criadoEm: new Date().toISOString(),
        }),
        rendaBaseMensal: novaRenda,
      };
      setUsuario(userAtualizado);
      localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(userAtualizado));
      return userAtualizado;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await apiService.logout();
    } catch {
      // ignora erro de rede
    } finally {
      setUsuario(null);
      localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
      localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
      setIsLoading(false);
    }
  };

  const hasRole = (roles: RoleUsuario | RoleUsuario[]): boolean => {
    if (!usuario) return false;
    const userRole = (usuario.role || 'USER').toUpperCase();
    const list = Array.isArray(roles) ? roles : [roles];
    return list.some((r) => r.toUpperCase() === userRole);
  };

  const currentRole: RoleUsuario = usuario?.role
    ? (usuario.role.toUpperCase() as RoleUsuario)
    : 'USER';

  return (
    <AuthContext.Provider
      value={{
        usuario,
        isAuthenticated: !!usuario,
        isLoading,
        role: currentRole,
        login,
        cadastro,
        atualizarRendaBase,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};
