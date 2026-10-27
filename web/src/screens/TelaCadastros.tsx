import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { UsuarioPerfil, ContaItem, CategoriaTreeItem, RegraVendedorItem, apiService } from '../api.ts';
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
  Sparkles,
  Store,
  Trash2,
  Plus,
  Edit2,
  ArrowRightLeft,
  X,
  Check,
  CreditCard,
} from 'lucide-react';
import { GerenciadorConectoresBancarios } from '../components/GerenciadorConectoresBancarios.tsx';
import { ConfiguracaoIaCard } from '../components/ConfiguracaoIaCard.tsx';

interface TelaCadastrosProps {
  perfil: UsuarioPerfil;
  contas: ContaItem[];
  categorias: CategoriaTreeItem[];
  onContasAtualizadas?: () => void;
  onRendaAtualizada?: (novaRenda: number) => void;
  onExtratoImportado?: () => void;
  subAbaInicial?: 'renda' | 'contas' | 'categorias' | 'bancos' | 'ia' | 'configuracoes';
}

export const TelaCadastros: React.FC<TelaCadastrosProps> = ({
  perfil,
  contas,
  categorias,
  onContasAtualizadas,
  onRendaAtualizada,
  onExtratoImportado,
  subAbaInicial = 'renda',
}) => {
  const { atualizarRendaBase } = useAuth();

  // Sub-abas do menu de cadastros
  const [subAba, setSubAba] = useState<'renda' | 'contas' | 'categorias' | 'bancos' | 'ia' | 'configuracoes'>(subAbaInicial);

  // Estados para CRUD de Contas e Resolução de Dependências
  const [modalContaAberto, setModalContaAberto] = useState(false);
  const [contaEmEdicao, setContaEmEdicao] = useState<ContaItem | null>(null);
  const [formNomeConta, setFormNomeConta] = useState('');
  const [formTipoConta, setFormTipoConta] = useState<'CONTA_CORRENTE' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | 'CARTEIRA_DINHEIRO'>('CONTA_CORRENTE');
  const [formSaldoInicial, setFormSaldoInicial] = useState('0.00');
  const [formDiaFechamento, setFormDiaFechamento] = useState<string>('1');
  const [formDiaVencimento, setFormDiaVencimento] = useState<string>('10');
  const [salvandoConta, setSalvandoConta] = useState(false);
  const [erroConta, setErroConta] = useState<string | null>(null);

  // Modal de Exclusão / Resolução de Dependências
  const [modalExclusaoContaAberto, setModalExclusaoContaAberto] = useState(false);
  const [contaParaExcluir, setContaParaExcluir] = useState<ContaItem | null>(null);
  const [carregandoDependencias, setCarregandoDependencias] = useState(false);
  const [dependenciasConta, setDependenciasConta] = useState<any | null>(null);
  const [contaDestinoMigracao, setContaDestinoMigracao] = useState<string>('');
  const [processandoAcaoConta, setProcessandoAcaoConta] = useState(false);
  const [erroAcaoConta, setErroAcaoConta] = useState<string | null>(null);
  const [sucessoAcaoConta, setSucessoAcaoConta] = useState<string | null>(null);

  // Estado do formulário de renda base com Média N-Meses e Complemento Editável (TASK-26 e TASK-27)
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [media6m, setMedia6m] = useState<number>(0);
  const [mesesJanela, setMesesJanela] = useState<string[]>([]);
  const [mesesConfigurados, setMesesConfigurados] = useState<number>(6);
  const [complemento, setComplemento] = useState<string>('0.00');
  const [salvando, setSalvando] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Estado de Configurações da Janela Temporal e Intervalo de Sincronização (TASK-27 e TASK-28)
  const [mesesInput, setMesesInput] = useState<number>(6);
  const [intervaloSyncInput, setIntervaloSyncInput] = useState<number>(6);
  const [intervaloSyncConfigurado, setIntervaloSyncConfigurado] = useState<number>(6);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [configSucesso, setConfigSucesso] = useState<string | null>(null);
  const [configErro, setConfigErro] = useState<string | null>(null);

  // Estado do Catálogo de Regras de Lojas / Vendedor
  const [regrasVendedor, setRegrasVendedor] = useState<RegraVendedorItem[]>([]);
  const [loadingRegrasVendedor, setLoadingRegrasVendedor] = useState(false);
  const [excluindoRegraId, setExcluindoRegraId] = useState<string | null>(null);

  const carregarRegrasVendedor = async () => {
    try {
      setLoadingRegrasVendedor(true);
      const res = await apiService.getRegrasVendedor();
      setRegrasVendedor(res.regras || []);
    } catch (err) {
      console.warn('Erro ao carregar regras de vendedor:', err);
    } finally {
      setLoadingRegrasVendedor(false);
    }
  };

  // Funções de manipulação do CRUD de Contas
  const abrirNovaConta = () => {
    setContaEmEdicao(null);
    setFormNomeConta('');
    setFormTipoConta('CONTA_CORRENTE');
    setFormSaldoInicial('0.00');
    setFormDiaFechamento('1');
    setFormDiaVencimento('10');
    setErroConta(null);
    setModalContaAberto(true);
  };

  const abrirEditarConta = (c: ContaItem) => {
    setContaEmEdicao(c);
    setFormNomeConta(c.nome);
    setFormTipoConta((c.tipo as any) || 'CONTA_CORRENTE');
    setFormSaldoInicial(Number(c.saldoInicial || 0).toFixed(2));
    setFormDiaFechamento(c.diaFechamento ? String(c.diaFechamento) : '1');
    setFormDiaVencimento(c.diaVencimento ? String(c.diaVencimento) : '10');
    setErroConta(null);
    setModalContaAberto(true);
  };

  const handleSalvarConta = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroConta(null);

    const nomeTrim = formNomeConta.trim();
    if (!nomeTrim) {
      setErroConta('O nome da conta é obrigatório.');
      return;
    }

    const saldoNum = parseFloat(formSaldoInicial.replace(',', '.')) || 0;
    const isCartao = formTipoConta === 'CARTAO_CREDITO';
    const diaF = isCartao ? parseInt(formDiaFechamento, 10) : undefined;
    const diaV = isCartao ? parseInt(formDiaVencimento, 10) : undefined;

    if (isCartao && (!diaF || !diaV)) {
      setErroConta('Dia de fechamento e vencimento são obrigatórios para cartão de crédito.');
      return;
    }

    try {
      setSalvandoConta(true);
      if (contaEmEdicao) {
        await apiService.atualizarConta(contaEmEdicao.id, {
          nome: nomeTrim,
          tipo: formTipoConta,
          saldoInicial: saldoNum,
          diaFechamento: diaF ?? null,
          diaVencimento: diaV ?? null,
        });
      } else {
        await apiService.criarConta({
          nome: nomeTrim,
          tipo: formTipoConta,
          saldoInicial: saldoNum,
          diaFechamento: diaF ?? null,
          diaVencimento: diaV ?? null,
        });
      }

      setModalContaAberto(false);
      if (onContasAtualizadas) {
        await onContasAtualizadas();
      }
    } catch (err: any) {
      setErroConta(err.message || 'Erro ao salvar conta.');
    } finally {
      setSalvandoConta(false);
    }
  };

  const abrirModalExclusao = async (c: ContaItem) => {
    setContaParaExcluir(c);
    setCarregandoDependencias(true);
    setDependenciasConta(null);
    setErroAcaoConta(null);
    setSucessoAcaoConta(null);
    // Filtrar outra conta qualquer como padrão de destino
    const outra = contas.find((item) => item.id !== c.id);
    setContaDestinoMigracao(outra ? outra.id : '');
    setModalExclusaoContaAberto(true);

    try {
      const deps = await apiService.getDependenciasConta(c.id);
      setDependenciasConta(deps);
    } catch (err: any) {
      setErroAcaoConta(err.message || 'Erro ao carregar dependências da conta.');
    } finally {
      setCarregandoDependencias(false);
    }
  };

  const handleExcluirContaDireta = async () => {
    if (!contaParaExcluir) return;
    try {
      setProcessandoAcaoConta(true);
      setErroAcaoConta(null);
      await apiService.excluirConta(contaParaExcluir.id);
      setSucessoAcaoConta('Conta excluída com sucesso!');
      if (onContasAtualizadas) {
        await onContasAtualizadas();
      }
      setTimeout(() => {
        setModalExclusaoContaAberto(false);
      }, 700);
    } catch (err: any) {
      setErroAcaoConta(err.message || 'Não foi possível excluir a conta.');
    } finally {
      setProcessandoAcaoConta(false);
    }
  };

  const handleMigrarMovimentos = async () => {
    if (!contaParaExcluir) return;
    if (!contaDestinoMigracao) {
      setErroAcaoConta('Selecione uma conta de destino para transferir os lançamentos.');
      return;
    }

    try {
      setProcessandoAcaoConta(true);
      setErroAcaoConta(null);
      const res = await apiService.migrarMovimentosConta(contaParaExcluir.id, contaDestinoMigracao);
      // Recarregar dependências
      const deps = await apiService.getDependenciasConta(contaParaExcluir.id);
      setDependenciasConta(deps);
      setSucessoAcaoConta(res.message || 'Lançamentos migrados com sucesso!');
      if (onContasAtualizadas) {
        await onContasAtualizadas();
      }
    } catch (err: any) {
      setErroAcaoConta(err.message || 'Erro ao migrar lançamentos.');
    } finally {
      setProcessandoAcaoConta(false);
    }
  };

  const handleExcluirLançamentosDaConta = async () => {
    if (!contaParaExcluir) return;
    const confirmou = window.confirm(
      `ATENÇÃO: Deseja realmente excluir TODOS os lançamentos vinculados à conta "${contaParaExcluir.nome}"? Esta ação removerá os registros para liberar a exclusão da conta.`
    );
    if (!confirmou) return;

    try {
      setProcessandoAcaoConta(true);
      setErroAcaoConta(null);
      const res = await apiService.excluirMovimentosConta(contaParaExcluir.id);
      const deps = await apiService.getDependenciasConta(contaParaExcluir.id);
      setDependenciasConta(deps);
      setSucessoAcaoConta(res.message || 'Lançamentos excluídos com sucesso.');
      if (onContasAtualizadas) {
        await onContasAtualizadas();
      }
    } catch (err: any) {
      setErroAcaoConta(err.message || 'Erro ao excluir lançamentos da conta.');
    } finally {
      setProcessandoAcaoConta(false);
    }
  };

  const handleExcluirRegraVendedor = async (id: string) => {
    try {
      setExcluindoRegraId(id);
      await apiService.excluirRegraVendedor(id);
      setRegrasVendedor((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      alert(err.message || 'Erro ao remover regra de loja');
    } finally {
      setExcluindoRegraId(null);
    }
  };

  useEffect(() => {
    if (subAba === 'categorias') {
      carregarRegrasVendedor();
    }
  }, [subAba]);

  // Carregar configurações do usuário
  const carregarConfiguracao = async () => {
    try {
      const cfg = await apiService.getConfiguracoes();
      if (cfg && cfg.mesesJanelaTemporal) {
        setMesesConfigurados(cfg.mesesJanelaTemporal);
        setMesesInput(cfg.mesesJanelaTemporal);
      }
      if (cfg && cfg.intervaloSincronizacaoHoras) {
        setIntervaloSyncConfigurado(cfg.intervaloSincronizacaoHoras);
        setIntervaloSyncInput(cfg.intervaloSincronizacaoHoras);
      }
    } catch {
      setMesesConfigurados(6);
      setMesesInput(6);
      setIntervaloSyncConfigurado(6);
      setIntervaloSyncInput(6);
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
  }, [perfil.id]);

  useEffect(() => {
    if (subAba === 'renda') {
      carregarMedia6M();
    }
  }, [subAba, perfil.id, perfil.rendaBaseMensal]);

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
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <Landmark size={16} />
          <span>Open Finance & Bancos</span>
          <span
            style={{
              fontSize: '0.66rem',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '999px',
              background: 'rgba(234, 179, 8, 0.18)',
              color: 'var(--status-yellow, #eab308)',
              border: '1px solid rgba(234, 179, 8, 0.35)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Em breve
          </span>
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${subAba === 'ia' ? 'active' : ''}`}
          onClick={() => setSubAba('ia')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <Sparkles size={16} />
          <span>Configurar IA</span>
          <span
            style={{
              fontSize: '0.66rem',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '999px',
              background: 'rgba(56, 189, 248, 0.18)',
              color: 'var(--brand-primary, #38bdf8)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
            }}
          >
            LLM
          </span>
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${subAba === 'configuracoes' ? 'active' : ''}`}
          onClick={() => setSubAba('configuracoes')}
        >
          <Settings2 size={16} />
          <span>Parâmetros ({mesesConfigurados}M / {intervaloSyncConfigurado}h)</span>
        </button>
      </div>

      {/* Sub-aba: Configuração de IA & Modelos */}
      {subAba === 'ia' && (
        <ConfiguracaoIaCard />
      )}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Contas Bancárias, Carteiras e Cartões ({contas.length})
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Gerencie suas contas ativas. Para excluir uma conta, valide dependências e transfira ou exclua seus lançamentos.
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={abrirNovaConta}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '0.82rem',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
              }}
            >
              <Plus size={16} />
              <span>Nova Conta</span>
            </button>
          </div>

          <div style={{ display: 'grid', gap: '10px' }}>
            {contas.length === 0 ? (
              <div
                style={{
                  padding: '30px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                }}
              >
                Nenhuma conta cadastrada ainda. Clique no botão acima para adicionar sua primeira conta.
              </div>
            ) : (
              contas.map((c) => (
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
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 'var(--radius-sm)',
                        background: c.tipo === 'CARTAO_CREDITO' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                        color: c.tipo === 'CARTAO_CREDITO' ? 'var(--status-red, #ef4444)' : 'var(--brand-primary, #38bdf8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {c.tipo === 'CARTAO_CREDITO' ? <CreditCard size={18} /> : <Wallet size={18} />}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{c.nome}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Tipo: <strong style={{ color: 'var(--text-secondary)' }}>{c.tipo}</strong>{' '}
                        {c.diaFechamento ? `• Fecha dia ${c.diaFechamento} / Vence dia ${c.diaVencimento}` : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Saldo Inicial</div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                        R$ {Number(c.saldoInicial).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => abrirEditarConta(c)}
                        title="Editar Conta"
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '6px',
                          color: 'var(--text-secondary)',
                          padding: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s',
                        }}
                      >
                        <Edit2 size={15} />
                      </button>

                      <button
                        type="button"
                        onClick={() => abrirModalExclusao(c)}
                        title="Excluir Conta"
                        style={{
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          borderRadius: '6px',
                          color: 'var(--status-red, #ef4444)',
                          padding: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s',
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Modal de Criação / Edição de Conta */}
          {modalContaAberto && (
            <div
              className="bottom-sheet-backdrop"
              onClick={() => setModalContaAberto(false)}
              style={{ zIndex: 120 }}
            >
              <div
                className="bottom-sheet"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '480px', gap: '16px' }}
              >
                <div className="bottom-sheet-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Wallet size={18} color="var(--brand-primary)" />
                    <span className="bottom-sheet-title">
                      {contaEmEdicao ? 'Editar Conta' : 'Nova Conta'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="bottom-sheet-close"
                    onClick={() => setModalContaAberto(false)}
                  >
                    <X size={18} />
                  </button>
                </div>

                {erroConta && (
                  <div className="login-error-alert" role="alert">
                    <AlertCircle size={16} />
                    <span>{erroConta}</span>
                  </div>
                )}

                <form onSubmit={handleSalvarConta} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="input-conta-nome">
                      Nome da Conta *
                    </label>
                    <input
                      id="input-conta-nome"
                      type="text"
                      className="form-input"
                      placeholder="Ex: Nubank, Cartão C6, Carteira"
                      value={formNomeConta}
                      onChange={(e) => setFormNomeConta(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="select-conta-tipo">
                      Tipo de Conta *
                    </label>
                    <select
                      id="select-conta-tipo"
                      className="form-input"
                      value={formTipoConta}
                      onChange={(e) => setFormTipoConta(e.target.value as any)}
                    >
                      <option value="CONTA_CORRENTE">Conta Corrente</option>
                      <option value="CARTAO_CREDITO">Cartão de Crédito</option>
                      <option value="INVESTIMENTO">Investimento / Reserva</option>
                      <option value="CARTEIRA_DINHEIRO">Carteira / Dinheiro Físico</option>
                    </select>
                  </div>

                  {formTipoConta === 'CARTAO_CREDITO' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="input-dia-fechamento">
                          Dia Fechamento *
                        </label>
                        <input
                          id="input-dia-fechamento"
                          type="number"
                          min="1"
                          max="31"
                          className="form-input"
                          value={formDiaFechamento}
                          onChange={(e) => setFormDiaFechamento(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="input-dia-vencimento">
                          Dia Vencimento *
                        </label>
                        <input
                          id="input-dia-vencimento"
                          type="number"
                          min="1"
                          max="31"
                          className="form-input"
                          value={formDiaVencimento}
                          onChange={(e) => setFormDiaVencimento(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label" htmlFor="input-saldo-inicial">
                      Saldo Inicial (R$)
                    </label>
                    <input
                      id="input-saldo-inicial"
                      type="number"
                      step="0.01"
                      className="form-input"
                      placeholder="0.00"
                      value={formSaldoInicial}
                      onChange={(e) => setFormSaldoInicial(e.target.value)}
                    />
                    <span className="role-helper-text">
                      Referência de partida para conferência do saldo.
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setModalContaAberto(false)}
                      style={{ flex: 1 }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={salvandoConta}
                      style={{ flex: 1 }}
                    >
                      {salvandoConta ? (
                        <>
                          <Loader2 size={16} className="spinner" />
                          <span>Salvando...</span>
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          <span>Salvar Conta</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal de Exclusão de Conta com Validação de Dependências e Opção de Migração */}
          {modalExclusaoContaAberto && contaParaExcluir && (
            <div
              className="bottom-sheet-backdrop"
              onClick={() => setModalExclusaoContaAberto(false)}
              style={{ zIndex: 120 }}
            >
              <div
                className="bottom-sheet"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '540px', gap: '16px', maxHeight: '90vh', overflowY: 'auto' }}
              >
                <div className="bottom-sheet-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={20} color="var(--status-red, #ef4444)" />
                    <span className="bottom-sheet-title" style={{ color: 'var(--status-red, #ef4444)' }}>
                      Excluir Conta: {contaParaExcluir.nome}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="bottom-sheet-close"
                    onClick={() => setModalExclusaoContaAberto(false)}
                  >
                    <X size={18} />
                  </button>
                </div>

                {erroAcaoConta && (
                  <div className="login-error-alert" role="alert">
                    <AlertCircle size={16} />
                    <span>{erroAcaoConta}</span>
                  </div>
                )}

                {sucessoAcaoConta && (
                  <div className="login-success-alert" role="status">
                    <CheckCircle2 size={16} />
                    <span>{sucessoAcaoConta}</span>
                  </div>
                )}

                {carregandoDependencias ? (
                  <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Loader2 size={24} className="spinner" style={{ margin: '0 auto 8px auto' }} />
                    Verificando dependências e lançamentos vinculados...
                  </div>
                ) : dependenciasConta ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {dependenciasConta.podeExcluirDiretamente ? (
                      <div
                        style={{
                          background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-green)', fontWeight: 600 }}>
                          <CheckCircle2 size={18} />
                          Nenhum lançamento ou parcelamento vinculado
                        </div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                          Esta conta está sem registros ativos e pode ser removida com segurança sem afetar suas médias e históricos.
                        </p>
                      </div>
                    ) : (
                      <div
                        style={{
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-red, #ef4444)', fontWeight: 700, fontSize: '0.9rem' }}>
                          <AlertCircle size={18} />
                          Existem registros vinculados a esta conta!
                        </div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                          A conta possui <strong>{dependenciasConta.totalMovimentos} lançamento(s)</strong> e{' '}
                          <strong>{dependenciasConta.totalParcelamentos} parcelamento(s)</strong>.
                          O sistema protege a integridade dos seus dados e não permite a exclusão direta enquanto houver registros vinculados.
                        </p>
                      </div>
                    )}

                    {/* Resumo de Lançamentos Vinculados */}
                    {dependenciasConta.totalMovimentos > 0 && (
                      <div
                        style={{
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '10px 12px',
                          maxHeight: '160px',
                          overflowY: 'auto',
                          fontSize: '0.78rem',
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                          Lançamentos Vinculados (mostrando até 100):
                        </div>
                        <div style={{ display: 'grid', gap: '6px' }}>
                          {dependenciasConta.movimentos.map((m: any) => (
                            <div
                              key={m.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                                paddingBottom: '4px',
                              }}
                            >
                              <span style={{ color: 'var(--text-primary)' }}>{m.descricao}</span>
                              <span style={{ fontWeight: 600, color: m.natureza === 'RECEITA' ? 'var(--status-green)' : 'var(--text-primary)' }}>
                                R$ {Number(m.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Opções de Resolução de Dependências se houver registros vinculados */}
                    {!dependenciasConta.podeExcluirDiretamente && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          Opções para viabilizar a exclusão:
                        </div>

                        {/* Opção 1: Migrar Lançamentos para outra conta */}
                        <div
                          style={{
                            background: 'rgba(56, 189, 248, 0.06)',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '12px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand-primary)', fontWeight: 600, fontSize: '0.85rem' }}>
                            <ArrowRightLeft size={16} />
                            Opção A: Transferir lançamentos para outra conta
                          </div>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                            Reatribui todos os lançamentos e parcelamentos para outra conta existente do seu perfil, liberando a exclusão desta conta sem perder o histórico financeiro.
                          </p>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select
                              className="form-input"
                              value={contaDestinoMigracao}
                              onChange={(e) => setContaDestinoMigracao(e.target.value)}
                              style={{ flex: 1, minWidth: '180px', padding: '6px 10px', fontSize: '0.82rem' }}
                            >
                              <option value="">Selecione a conta de destino...</option>
                              {contas
                                .filter((item) => item.id !== contaParaExcluir.id)
                                .map((dest) => (
                                  <option key={dest.id} value={dest.id}>
                                    {dest.nome} ({dest.tipo})
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={processandoAcaoConta || !contaDestinoMigracao}
                              onClick={handleMigrarMovimentos}
                              style={{
                                padding: '6px 12px',
                                fontSize: '0.8rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              {processandoAcaoConta ? <Loader2 size={14} className="spinner" /> : <Check size={14} />}
                              <span>Transferir Lançamentos</span>
                            </button>
                          </div>
                        </div>

                        {/* Opção 2: Excluir Lançamentos Vinculados */}
                        <div
                          style={{
                            background: 'rgba(239, 68, 68, 0.05)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '12px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-red, #ef4444)', fontWeight: 600, fontSize: '0.85rem' }}>
                            <Trash2 size={16} />
                            Opção B: Excluir todos os lançamentos vinculados primeiro
                          </div>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                            Caso a conta tenha sido cadastrada por engano ou contenha lançamentos errados de importação, você pode remover os lançamentos dela em lote.
                          </p>
                          <button
                            type="button"
                            onClick={handleExcluirLançamentosDaConta}
                            disabled={processandoAcaoConta}
                            style={{
                              alignSelf: 'flex-start',
                              background: 'transparent',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: 'var(--status-red, #ef4444)',
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.78rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            {processandoAcaoConta ? <Loader2 size={14} className="spinner" /> : <Trash2 size={14} />}
                            <span>Excluir {dependenciasConta.totalMovimentos} Lançamentos Vinculados</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Botão de Exclusão da Conta (habilitado somente se podeExcluirDiretamente) */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setModalExclusaoContaAberto(false)}
                      >
                        Fechar
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!dependenciasConta.podeExcluirDiretamente || processandoAcaoConta}
                        onClick={handleExcluirContaDireta}
                        style={{
                          background: dependenciasConta.podeExcluirDiretamente ? 'var(--status-red, #ef4444)' : undefined,
                          borderColor: dependenciasConta.podeExcluirDiretamente ? 'var(--status-red, #ef4444)' : undefined,
                        }}
                      >
                        {processandoAcaoConta ? (
                          <>
                            <Loader2 size={16} className="spinner" />
                            <span>Excluindo Conta...</span>
                          </>
                        ) : (
                          <>
                            <Trash2 size={16} />
                            <span>Excluir Conta Definitivamente</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
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

          {/* Seção: Catálogo de Lojas & Regras Automáticas de Categorização */}
          <div
            style={{
              marginTop: '16px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '8px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    color: 'var(--brand-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Store size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.98rem', fontWeight: 700, margin: 0 }}>
                    Catálogo de Lojas & Vendedores
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Regras memorizadas para categorizar automaticamente lançamentos de nomes conhecidos (ex: importações, faturas e validações)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={carregarRegrasVendedor}
                disabled={loadingRegrasVendedor}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 10px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.75rem',
                }}
              >
                <RefreshCw size={12} className={loadingRegrasVendedor ? 'spin' : ''} />
                Atualizar
              </button>
            </div>

            {loadingRegrasVendedor ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Loader2 size={20} className="spin" style={{ margin: '0 auto 8px auto' }} />
                Carregando catálogo de lojas...
              </div>
            ) : regrasVendedor.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                }}
              >
                Nenhuma regra de loja salva ainda. Ao categorizar um lançamento na <strong>Central de Suspeitas</strong> ou ao editar um lançamento com a opção <em>"Cadastrar regra no catálogo"</em>, o nome do estabelecimento será salvo aqui automaticamente.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {regrasVendedor.map((regra) => (
                  <div
                    key={regra.id}
                    style={{
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          color: 'var(--text-primary)',
                          background: 'rgba(255, 255, 255, 0.05)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {regra.termoVendedor}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        → aloca em{' '}
                        <strong style={{ color: 'var(--brand-primary)' }}>
                          {regra.categoriaPaiNome ? `${regra.categoriaPaiNome} > ` : ''}
                          {regra.categoriaNome || 'Categoria Desconhecida'}
                        </strong>
                      </span>
                      {regra.totalAplicacoes > 0 && (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--text-muted)',
                            background: 'rgba(255, 255, 255, 0.03)',
                            padding: '2px 6px',
                            borderRadius: '10px',
                          }}
                        >
                          Aplicada {regra.totalAplicacoes}x
                        </span>
                      )}
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => handleExcluirRegraVendedor(regra.id)}
                        disabled={excluindoRegraId === regra.id}
                        title="Remover regra do catálogo (para exceções ou reclassificações futuras)"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-danger, #ef4444)',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          opacity: excluindoRegraId === regra.id ? 0.5 : 0.8,
                        }}
                      >
                        {excluindoRegraId === regra.id ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

      {/* 7. Conteúdo da Sub-aba: Parâmetros do Sistema (TASK-27 & TASK-28) */}
      {subAba === 'configuracoes' && (
        <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="login-logo-badge" style={{ width: 44, height: 44, margin: 0 }}>
              <Calendar size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                Parâmetros do Sistema & Sincronização
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                Configuração transversal da Janela Temporal e do Agendamento (Schedule) Open Finance
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
              Estes parâmetros determinam a periodicidade e a profundidade de dados em todo o Evolvi:
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                <li><strong>Janela Temporal:</strong> profundidade de {mesesInput} meses para média móvel do Baseline, Semáforo, histórico e projeções orçamentárias.</li>
                <li><strong>Schedule Open Finance:</strong> frequência automatizada a cada {intervaloSyncInput} horas para busca de transações e saldos nas instituições conectadas.</li>
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

              if (intervaloSyncInput < 1 || intervaloSyncInput > 48) {
                setConfigErro('O intervalo de sincronização Open Finance deve estar entre 1 e 48 horas.');
                return;
              }

              try {
                setSalvandoConfig(true);
                const res = await apiService.atualizarConfiguracoes({
                  mesesJanelaTemporal: mesesInput,
                  intervaloSincronizacaoHoras: intervaloSyncInput,
                });
                setMesesConfigurados(res.mesesJanelaTemporal);
                if (res.intervaloSincronizacaoHoras) {
                  setIntervaloSyncConfigurado(res.intervaloSincronizacaoHoras);
                }
                setConfigSucesso(
                  `Configurações salvas com sucesso! Janela: ${res.mesesJanelaTemporal}M | Sincronização: a cada ${res.intervaloSincronizacaoHoras ?? intervaloSyncInput}h.`
                );
                // Atualizar também a média para refletir a nova janela
                await carregarMedia6M();
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Falha ao salvar configurações.';
                setConfigErro(msg);
              } finally {
                setSalvandoConfig(false);
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
          >
            {/* 1. Janela Temporal Parametrizável */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="form-label" style={{ margin: 0, fontWeight: 700 }}>
                  1. Quantidade de Meses da Janela: <span style={{ color: 'var(--brand-primary)', fontSize: '1.1rem' }}>{mesesInput} meses</span>
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

              {/* Slider ergonômico da janela */}
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

              {/* Botões rápidos da janela */}
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

            {/* 2. Intervalo de Sincronização Open Finance (TASK-28) */}
            <div className="form-group" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="form-label" style={{ margin: 0, fontWeight: 700 }}>
                  2. Periodicidade do Scheduler Open Finance: <span style={{ color: 'var(--brand-primary)', fontSize: '1.1rem' }}>A cada {intervaloSyncInput} horas</span>
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
                  Limites: 1 a 48 horas (Padrão: 6h)
                </span>
              </div>

              {/* Slider ergonômico do intervalo */}
              <input
                type="range"
                min="1"
                max="48"
                step="1"
                value={intervaloSyncInput}
                onChange={(e) => setIntervaloSyncInput(parseInt(e.target.value, 10))}
                style={{
                  width: '100%',
                  cursor: 'pointer',
                  accentColor: 'var(--brand-primary)',
                  marginBottom: '10px',
                }}
              />

              {/* Botões rápidos do intervalo */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[1, 3, 6, 12, 24].map((opcao) => (
                  <button
                    key={opcao}
                    type="button"
                    onClick={() => setIntervaloSyncInput(opcao)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: intervaloSyncInput === opcao ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                      background: intervaloSyncInput === opcao ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-elevated)',
                      color: intervaloSyncInput === opcao ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      fontWeight: intervaloSyncInput === opcao ? 700 : 500,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                  >
                    <span>{opcao}h</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {opcao === 1 ? 'Horária' : opcao === 6 ? 'Padrão (6h)' : opcao === 24 ? 'Diária' : `${opcao} horas`}
                    </span>
                  </button>
                ))}
              </div>
              <span className="role-helper-text" style={{ marginTop: '8px' }}>
                Configuração de frequência para quando as integrações bancárias automáticas forem liberadas. (Módulo automático atualmente pausado em espera da fase de monetização).
              </span>
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
                  <span>Salvando Parâmetros...</span>
                </>
              ) : (
                <>
                  <Save size={18} />
                  <span>Salvar Parâmetros do Sistema</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
