import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { UsuarioPerfil, ContaItem, CategoriaTreeItem, apiService } from '../api.ts';
import {
  DollarSign,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Wallet,
  Tags,
  Sliders,
  ShieldCheck,
  User,
  Info,
  Landmark,
  Calculator,
  TrendingUp,
  RefreshCw,
  Calendar,
  Settings2,
} from 'lucide-react';
import { GerenciadorConectoresBancarios } from '../components/GerenciadorConectoresBancarios.tsx';

interface TelaCadastrosProps {
  perfil: UsuarioPerfil;
  contas: ContaItem[];
  categorias: CategoriaTreeItem[];
  onRendaAtualizada?: (novaRenda: number) => void;
  onExtratoImportado?: () => void;
}

export const TelaCadastros: React.FC<TelaCadastrosProps> = ({
  perfil,
  contas,
  categorias,
  onRendaAtualizada,
  onExtratoImportado,
}) => {
  const { atualizarRendaBase } = useAuth();

  // Sub-abas do menu de cadastros
  const [subAba, setSubAba] = useState<'renda' | 'contas' | 'categorias' | 'bancos' | 'configuracoes'>('renda');

  // Estado do formulário de renda base com Média N-Meses e Complemento Editável (TASK-26 e TASK-27)
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [media6m, setMedia6m] = useState<number>(0);
  const [mesesJanela, setMesesJanela] = useState<string[]>([]);
  const [mesesConfigurados, setMesesConfigurados] = useState<number>(6);
  const [complemento, setComplemento] = useState<string>('0.00');
  const [salvando, setSalvando] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Estado de Configurações da Janela Temporal (TASK-27)
  const [mesesInput, setMesesInput] = useState<number>(6);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [configSucesso, setConfigSucesso] = useState<string | null>(null);
  const [configErro, setConfigErro] = useState<string | null>(null);

  // Carregar configurações do usuário
  const carregarConfiguracao = async () => {
    try {
      const cfg = await apiService.getConfiguracoes();
      if (cfg && cfg.mesesJanelaTemporal) {
        setMesesConfigurados(cfg.mesesJanelaTemporal);
        setMesesInput(cfg.mesesJanelaTemporal);
      }
    } catch {
      setMesesConfigurados(6);
      setMesesInput(6);
    }
  };

  // Carregar média real de entradas ao montar tela ou alternar para aba renda
  const carregarMedia6M = async () => {
    try {
      setLoadingMedia(true);
      const res = await apiService.getRendaMedia6M();
      setMedia6m(res.media6m);
      setMesesJanela(res.mesesFechados);
      if (res.mesesJanela) {
        setMesesConfigurados(res.mesesJanela);
      }

      // Se o usuário já possui rendaBaseMensal, derivar o complemento inicial correspondente:
      // rendaBase = media6m + complemento => complemento = rendaBase - media6m
      const rendaAtual = perfil.rendaBaseMensal || 0;
      const compInicial = Number((rendaAtual - res.media6m).toFixed(2));
      setComplemento(compInicial.toString());
    } catch {
      // Fallback em caso de modo offline ou erro
      const fallbackMedia = 0;
      setMedia6m(fallbackMedia);
      const rendaAtual = perfil.rendaBaseMensal || 0;
      setComplemento(rendaAtual.toString());
    } finally {
      setLoadingMedia(false);
    }
  };

  useEffect(() => {
    carregarConfiguracao();
  }, []);

  useEffect(() => {
    if (subAba === 'renda') {
      carregarMedia6M();
    }
  }, [subAba]);

  // Cálculo reativo da Renda Real Total Resultante: Média 6M + Complemento
  const compNum = parseFloat(complemento.replace(',', '.')) || 0;
  const rendaCalculada = Number(Math.max(0, media6m + compNum).toFixed(2));

  const handleSalvarRenda = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagemSucesso(null);
    setMensagemErro(null);

    if (isNaN(compNum)) {
      setMensagemErro('Informe um valor de complemento/ajuste válido (número positivo ou negativo).');
      return;
    }

    if (rendaCalculada <= 0 && media6m === 0 && compNum === 0) {
      setMensagemErro('A renda líquida resultante deve ser informada (maior que zero).');
      return;
    }

    try {
      setSalvando(true);
      await atualizarRendaBase(rendaCalculada);
      if (onRendaAtualizada) {
        onRendaAtualizada(rendaCalculada);
      }
      setMensagemSucesso(
        `Renda líquida de R$ ${rendaCalculada.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} gravada com sucesso! Semáforo e Diagnóstico foram recalculados.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao atualizar renda base.';
      setMensagemErro(msg);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Cabeçalho */}
      <div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Configurações & Parâmetros do Usuário
        </span>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
          Menu de Cadastros
        </h1>
      </div>

      {/* 2. Navegação entre Sub-abas de Cadastros */}
      <div className="auth-tabs" style={{ marginBottom: '8px' }}>
        <button
          type="button"
          className={`auth-tab-btn ${subAba === 'renda' ? 'active' : ''}`}
          onClick={() => setSubAba('renda')}
        >
          <Sliders size={16} />
          <span>Renda Base</span>
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${subAba === 'contas' ? 'active' : ''}`}
          onClick={() => setSubAba('contas')}
        >
          <Wallet size={16} />
          <span>Contas ({contas.length})</span>
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${subAba === 'categorias' ? 'active' : ''}`}
          onClick={() => setSubAba('categorias')}
        >
          <Tags size={16} />
          <span>Categorias ({categorias.length})</span>
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${subAba === 'bancos' ? 'active' : ''}`}
          onClick={() => setSubAba('bancos')}
        >
          <Landmark size={16} />
          <span>Open Finance & Bancos</span>
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${subAba === 'configuracoes' ? 'active' : ''}`}
          onClick={() => setSubAba('configuracoes')}
        >
          <Settings2 size={16} />
          <span>Janela Temporal ({mesesConfigurados}M)</span>
        </button>
      </div>

      {/* 3. Conteúdo da Sub-aba: Renda Base */}
      {subAba === 'renda' && (
        <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="login-logo-badge" style={{ width: 44, height: 44, margin: 0 }}>
              <DollarSign size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                Ajuste de Renda Base Mensal
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                Referência líquida mensal usada no diagnóstico Zero a Zero e semáforo
              </p>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              fontSize: '0.84rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.45,
            }}
          >
            <Info size={18} style={{ color: 'var(--brand-primary)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              A <strong>Renda Base</strong> é o parâmetro mestre do método Evolvi na Fase 1. Ela define o teto do seu
              termômetro de consumo e estabelece a referência ideal de percentuais por grupo de gastos essenciais.
            </div>
          </div>

          {mensagemSucesso && (
            <div className="login-success-alert" role="status">
              <CheckCircle2 size={18} />
              <span>{mensagemSucesso}</span>
            </div>
          )}

          {mensagemErro && (
            <div className="login-error-alert" role="alert">
              <AlertCircle size={18} />
              <span>{mensagemErro}</span>
            </div>
          )}

          <form onSubmit={handleSalvarRenda} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* 1. Campo Fixo / Readonly: Média dos Últimos N Meses Fechados */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ margin: 0 }}>
                  1. Média de Entradas ({mesesConfigurados} Meses Fechados — Somente Leitura)
                </label>
                <button
                  type="button"
                  onClick={carregarMedia6M}
                  disabled={loadingMedia}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--brand-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.75rem',
                    padding: 0,
                  }}
                  title="Recalcular média com base nos extratos e movimentos"
                >
                  <RefreshCw size={13} className={loadingMedia ? 'spinner' : ''} />
                  <span>Recalcular</span>
                </button>
              </div>

              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  opacity: 0.95,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <TrendingUp size={20} style={{ color: 'var(--brand-primary)' }} />
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      R$ {media6m.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {mesesJanela.length > 0
                        ? `Janela ${mesesConfigurados}M: ${mesesJanela[0]} a ${mesesJanela[mesesJanela.length - 1]}`
                        : `Média de receitas dos últimos ${mesesConfigurados} meses`}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  Automático ({mesesConfigurados}M)
                </span>
              </div>
              <span className="role-helper-text">
                Calculado a partir de receitas conciliadas nos {mesesConfigurados} meses fechados, expurgando transferências entre contas próprias.
              </span>
            </div>

            {/* 2. Campo Editável: Complemento / Ajuste de Renda */}
            <div className="form-group">
              <label className="form-label" htmlFor="input-ajuste-complemento">
                2. Complemento / Ajuste Editável (R$)
              </label>
              <div className="input-icon-wrapper">
                <Calculator size={18} className="input-field-icon" />
                <input
                  id="input-ajuste-complemento"
                  type="number"
                  step="0.01"
                  className="form-input with-icon"
                  placeholder="Ex: 1000.00 ou -500.00"
                  value={complemento}
                  onChange={(e) => setComplemento(e.target.value)}
                  required
                />
              </div>
              <span className="role-helper-text">
                Permite valores positivos (acréscimo) ou negativos (redução) para refletir sua renda real planejada.
              </span>
            </div>

            {/* 3. Prévia em Tempo Real: Renda Real Total Resultante */}
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--status-green)' }}>
                  3. Renda Real Total Resultante (Prévia)
                </span>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Média 6M + Complemento
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  R$ {rendaCalculada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  / mês
                </div>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '12px' }}>
                <span>Média: R$ {media6m.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                <span>
                  Ajuste: {compNum >= 0 ? '+' : ''}
                  R$ {compNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button
                type="submit"
                className="btn-primary login-submit-btn"
                disabled={salvando}
                style={{ flex: 1 }}
              >
                {salvando ? (
                  <>
                    <Loader2 size={18} className="spinner" />
                    <span>Salvando Alterações...</span>
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    <span>Salvar Renda Real Total</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Dados cadastrais do usuário logado */}
          <div
            style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <User size={14} />
              <span>Titular: <strong style={{ color: 'var(--text-secondary)' }}>{perfil.nome}</strong> ({perfil.email})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={14} />
              <span>Perfil de Acesso: <strong style={{ color: 'var(--brand-primary)' }}>{perfil.role || 'USER'}</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* 4. Conteúdo da Sub-aba: Contas */}
      {subAba === 'contas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Contas bancárias, carteiras e cartões configurados:
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            {contas.map((c) => (
              <div
                key={c.id}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '14px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{c.nome}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Tipo: {c.tipo} {c.diaFechamento ? `• Fecha dia ${c.diaFechamento} / Vence dia ${c.diaVencimento}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Saldo Inicial</div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    R$ {Number(c.saldoInicial).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Conteúdo da Sub-aba: Categorias */}
      {subAba === 'categorias' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Estrutura hierárquica de categorias e pesos de referência:
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            {categorias.map((cat) => (
              <div
                key={cat.id}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{cat.nome}</div>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: 'var(--brand-primary)',
                      background: 'rgba(56, 189, 248, 0.1)',
                      padding: '4px 8px',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    Meta Ref: {cat.referenciaNormalizadaPct}%
                  </span>
                </div>
                {cat.subcategorias && cat.subcategorias.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {cat.subcategorias.map((sub) => (
                      <span
                        key={sub.id}
                        style={{
                          fontSize: '0.75rem',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-subtle)',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {sub.nome}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Conteúdo da Sub-aba: Conectores Bancários & Open Finance */}
      {subAba === 'bancos' && (
        <GerenciadorConectoresBancarios
          contas={contas}
          onExtratoImportado={onExtratoImportado}
        />
      )}

      {/* 7. Conteúdo da Sub-aba: Janela Temporal Parametrizável (TASK-27) */}
      {subAba === 'configuracoes' && (
        <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="login-logo-badge" style={{ width: 44, height: 44, margin: 0 }}>
              <Calendar size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                Janela Temporal de Análise e Integração
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                Configuração transversal dos horizontes de meses para diagnósticos, histórico, previsões e Open Finance
              </p>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              fontSize: '0.84rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.45,
            }}
          >
            <Info size={18} style={{ color: 'var(--brand-primary)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              Este parâmetro define a profundidade histórica dos cálculos em todo o sistema Evolvi:
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                <li><strong>Diagnóstico Baseline & Semáforo:</strong> média móvel ponderada das despesas nos últimos {mesesInput} meses fechados.</li>
                <li><strong>Histórico de Consumo (M-004):</strong> horizonte fechado de meses para consolidação analítica e tickets médios.</li>
                <li><strong>Previsão e Projeção (M-005):</strong> quantidade de competências futuras simuladas no orçamento.</li>
                <li><strong>Média de Entradas:</strong> média de receitas operacionais líquidas conciliadas.</li>
                <li><strong>Conectores Open Finance:</strong> período retroativo padrão de carga e sincronização de movimentações financeiras.</li>
              </ul>
            </div>
          </div>

          {configSucesso && (
            <div className="login-success-alert" role="status">
              <CheckCircle2 size={18} />
              <span>{configSucesso}</span>
            </div>
          )}

          {configErro && (
            <div className="login-error-alert" role="alert">
              <AlertCircle size={18} />
              <span>{configErro}</span>
            </div>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setConfigSucesso(null);
              setConfigErro(null);

              if (mesesInput < 3 || mesesInput > 12) {
                setConfigErro('A janela temporal deve estar estritamente entre 3 e 12 meses.');
                return;
              }

              try {
                setSalvandoConfig(true);
                const res = await apiService.atualizarConfiguracoes(mesesInput);
                setMesesConfigurados(res.mesesJanelaTemporal);
                setConfigSucesso(
                  `Janela temporal configurada para ${res.mesesJanelaTemporal} meses com sucesso! Diagnósticos, previsões e sincronizações bancárias foram recalibrados.`
                );
                // Atualizar também a média para refletir a nova janela
                await carregarMedia6M();
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Falha ao salvar configuração.';
                setConfigErro(msg);
              } finally {
                setSalvandoConfig(false);
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
          >
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="form-label" style={{ margin: 0, fontWeight: 700 }}>
                  Quantidade de Meses da Janela: <span style={{ color: 'var(--brand-primary)', fontSize: '1.1rem' }}>{mesesInput} meses</span>
                </label>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-elevated)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  Limites: 3 a 12 meses (Padrão: 6)
                </span>
              </div>

              {/* Slider ergonômico */}
              <input
                type="range"
                min="3"
                max="12"
                step="1"
                value={mesesInput}
                onChange={(e) => setMesesInput(parseInt(e.target.value, 10))}
                style={{
                  width: '100%',
                  cursor: 'pointer',
                  accentColor: 'var(--brand-primary)',
                  marginBottom: '10px',
                }}
              />

              {/* Botões rápidos de seleção ergonômica */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[3, 6, 9, 12].map((opcao) => (
                  <button
                    key={opcao}
                    type="button"
                    onClick={() => setMesesInput(opcao)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: mesesInput === opcao ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                      background: mesesInput === opcao ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-elevated)',
                      color: mesesInput === opcao ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      fontWeight: mesesInput === opcao ? 700 : 500,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                  >
                    <span>{opcao} Meses</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {opcao === 3 ? 'Trimestral' : opcao === 6 ? 'Semestral (Padrão)' : opcao === 9 ? '9 Meses' : 'Anual'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={salvandoConfig}
              className="btn-primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '12px',
                fontSize: '0.95rem',
                fontWeight: 700,
              }}
            >
              {salvandoConfig ? (
                <>
                  <Loader2 size={18} className="spinner" />
                  <span>Salvando Janela...</span>
                </>
              ) : (
                <>
                  <Save size={18} />
                  <span>Aplicar Janela de {mesesInput} Meses</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
