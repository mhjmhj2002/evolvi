import React, { useState, useEffect } from 'react';
import {
  apiService,
  InstituicaoBancariaItem,
  ConexaoBancariaItem,
  ContaItem,
} from '../api.ts';
import {
  Landmark,
  RefreshCw,
  PlusCircle,
  FileUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Trash2,
  ArrowLeft,
  Server,
  Layers,
  Lock,
  Sparkles,
  Clock,
  Info,
} from 'lucide-react';

interface GerenciadorConectoresBancariosProps {
  contas: ContaItem[];
  onExtratoImportado?: () => void;
}

type FluxoBancario = 'conexoes' | 'conectar' | 'importar' | 'worker';

export const GerenciadorConectoresBancarios: React.FC<GerenciadorConectoresBancariosProps> = ({
  contas,
  onExtratoImportado,
}) => {
  const [instituicoes, setInstituicoes] = useState<InstituicaoBancariaItem[]>([]);
  const [conexoes, setConexoes] = useState<ConexaoBancariaItem[]>([]);
  const [dadosBrutos, setDadosBrutos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [sincronizandoId, setSincronizandoId] = useState<string | null>(null);
  const [executandoWorker, setExecutandoWorker] = useState(false);
  const [modoOpenFinance, setModoOpenFinance] = useState<'mock' | 'real'>('mock');

  // Navegação entre fluxos dedicados (cada um em sua própria visão ampla)
  const [fluxoAtivo, setFluxoAtivo] = useState<FluxoBancario>('conexoes');
  const [instituicaoSelecionada, setInstituicaoSelecionada] = useState<string>('341');
  // Estados dinâmicos de credenciais e consentimento
  const [credenciaisForm, setCredenciaisForm] = useState<Record<string, string>>({});
  const [consentimentoConfirmado, setConsentimentoConfirmado] = useState<boolean>(false);
  const [escoposSelecionados, setEscoposSelecionados] = useState<string[]>([
    'accounts.read',
    'transactions.read',
    'credit-cards.read',
  ]);
  const [errosValidacaoCampos, setErrosValidacaoCampos] = useState<Record<string, string>>({});

  // Formulário de importação de extrato manual
  const [importContaId, setImportContaId] = useState<string>(contas[0]?.id || '');
  const [importConteudo, setImportConteudo] = useState<string>('');
  const [importNomeArquivo, setImportNomeArquivo] = useState<string>('extrato_itau.ofx');
  const [importando, setImportando] = useState(false);

  // Feedback do usuário
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    if (contas.length > 0 && !importContaId) {
      setImportContaId(contas[0].id);
    }
  }, [contas, importContaId]);

  const carregarDados = async () => {
    try {
      setCarregando(true);
      const [resInst, resConn, resRaw] = await Promise.all([
        apiService.getInstituicoesBancarias(),
        apiService.getConexoesBancarias(),
        apiService.listarDadosBrutos().catch(() => ({ dadosBrutos: [] })),
      ]);
      setInstituicoes(resInst.instituicoes);
      if (resInst.modoOpenFinance) {
        setModoOpenFinance(resInst.modoOpenFinance);
      }
      setConexoes(resConn.conexoes);
      setDadosBrutos(resRaw.dadosBrutos || []);
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao carregar conexões.');
    } finally {
      setCarregando(false);
    }
  };

  const handleExecutarSweepWorker = async () => {
    try {
      setExecutandoWorker(true);
      setMensagemErro(null);
      const res = await apiService.executarWorkerSweep();
      setMensagemSucesso(`Sweep executado: ${res.resultado.processadosSucesso} processados com sucesso.`);
      await carregarDados();
      if (onExtratoImportado) onExtratoImportado();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao executar sweep do worker.');
    } finally {
      setExecutandoWorker(false);
    }
  };

  const handleReprocessarDLQ = async () => {
    try {
      setExecutandoWorker(true);
      setMensagemErro(null);
      const res = await apiService.reprocessarDLQ();
      setMensagemSucesso(`DLQ reprocessada: ${res.total} registros reprocessados.`);
      await carregarDados();
      if (onExtratoImportado) onExtratoImportado();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao reprocessar DLQ.');
    } finally {
      setExecutandoWorker(false);
    }
  };

  const handleProcessarIndividual = async (id: string) => {
    try {
      setExecutandoWorker(true);
      setMensagemErro(null);
      await apiService.processarDadoBruto(id);
      setMensagemSucesso('Dado bruto processado com sucesso!');
      await carregarDados();
      if (onExtratoImportado) onExtratoImportado();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao processar registro.');
    } finally {
      setExecutandoWorker(false);
    }
  };


  // Obter instituição ativa selecionada
  const instAtiva = instituicoes.find((i) => i.codigo === instituicaoSelecionada);

  const handleConectarInstituicao = async () => {

    try {
      setCarregando(true);
      setMensagemErro(null);
      setMensagemSucesso(null);
      setErrosValidacaoCampos({});

      // 1. Validar consentimento do Open Finance
      if (!consentimentoConfirmado) {
        setMensagemErro('Você precisa autorizar os termos regulados de consentimento do Open Finance.');
        setCarregando(false);
        return;
      }

      // 2. Validar escopos
      if (escoposSelecionados.length === 0) {
        setMensagemErro('Selecione pelo menos um escopo de permissão para leitura de dados bancários.');
        setCarregando(false);
        return;
      }

      // 3. Validar campos obrigatórios dinâmicos da instituição selecionada
      const camposRequeridos = instAtiva?.camposRequeridos || [];
      const novosErros: Record<string, string> = {};

      for (const campo of camposRequeridos) {
        if (campo.obrigatorio) {
          const val = (credenciaisForm[campo.id] || '').trim();
          if (!val) {
            novosErros[campo.id] = `O campo "${campo.label}" é obrigatório.`;
          } else if (campo.regexValidacao) {
            const regex = new RegExp(campo.regexValidacao);
            if (!regex.test(val)) {
              novosErros[campo.id] = `Formato inválido para "${campo.label}".`;
            }
          }
        }
      }

      if (Object.keys(novosErros).length > 0) {
        setErrosValidacaoCampos(novosErros);
        setMensagemErro('Preencha os campos bancários obrigatórios destacados antes de prosseguir.');
        setCarregando(false);
        return;
      }

      const res = await apiService.conectarBanco({
        instituicaoCodigo: instituicaoSelecionada,
        consentimentoConfirmado: true,
        escopo: escoposSelecionados,
        credentials: Object.keys(credenciaisForm).length > 0 ? credenciaisForm : undefined,
      });

      setMensagemSucesso(`Instituição conectada com sucesso! Código: ${res.conexao.instituicaoNome}`);
      setFluxoAtivo('conexoes');
      setCredenciaisForm({});
      setConsentimentoConfirmado(false);
      setErrosValidacaoCampos({});
      await carregarDados();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao conectar instituição bancária.');
    } finally {
      setCarregando(false);
    }
  };

  const handleCampoChange = (campoId: string, valor: string) => {
    setCredenciaisForm((prev) => ({ ...prev, [campoId]: valor }));
    if (errosValidacaoCampos[campoId]) {
      setErrosValidacaoCampos((prev) => {
        const novo = { ...prev };
        delete novo[campoId];
        return novo;
      });
    }
  };

  const handleToggleEscopo = (escopoId: string) => {
    setEscoposSelecionados((prev) =>
      prev.includes(escopoId) ? prev.filter((e) => e !== escopoId) : [...prev, escopoId]
    );
  };

  const handleSincronizar = async (conexaoId: string) => {
    try {
      setSincronizandoId(conexaoId);
      setMensagemErro(null);
      setMensagemSucesso(null);

      const res = await apiService.sincronizarBanco(conexaoId);
      setMensagemSucesso(
        `Sincronização concluída com sucesso! Inseridos: ${res.resumo.novosMovimentosInseridos} movimentos | Ignorados por deduplicação: ${res.resumo.movimentosIgnoradosDedupe}.`
      );
      await carregarDados();
      if (onExtratoImportado) onExtratoImportado();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao sincronizar extrato bancário.');
    } finally {
      setSincronizandoId(null);
    }
  };

  const handleDesconectar = async (conexaoId: string) => {
    const conexao = conexoes.find((c) => c.id === conexaoId);
    const isRevogado = conexao?.status === 'REVOGADO';
    const msgConfirm = isRevogado
      ? 'Deseja excluir definitivamente esta conexão do seu histórico?'
      : 'Deseja revogar o consentimento desta conexão bancária?';

    if (!confirm(msgConfirm)) {
      return;
    }

    try {
      setCarregando(true);
      setMensagemErro(null);
      await apiService.desconectarBanco(conexaoId, { purge: isRevogado });
      setMensagemSucesso(isRevogado ? 'Conexão excluída com sucesso.' : 'Conexão revogada com sucesso.');
      await carregarDados();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao revogar ou excluir conexão.');
    } finally {
      setCarregando(false);
    }
  };

  const handleImportarExtrato = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importConteudo.trim()) {
      setMensagemErro('Cole o conteúdo do arquivo OFX, CSV ou JSON.');
      return;
    }

    try {
      setImportando(true);
      setMensagemErro(null);
      setMensagemSucesso(null);

      const res = await apiService.importarExtratoManual({
        contaId: importContaId,
        content: importConteudo,
        filename: importNomeArquivo,
      });

      setMensagemSucesso(
        `Extrato ${res.resultado.formato} importado com sucesso! Inseridos: ${res.resultado.novosInseridos} novos lançamentos | Ignorados por dedupe: ${res.resultado.duplicadasIgnoradas} | Faturas convertidas (anti-dupla contagem): ${res.resultado.pagamentosFaturaConvertidos}.`
      );
      setFluxoAtivo('conexoes');
      setImportConteudo('');
      if (onExtratoImportado) onExtratoImportado();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha na importação de extrato.');
    } finally {
      setImportando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header com Sub-Navegação de Fluxos */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(56, 189, 248, 0.04) 100%)',
          border: '1px solid rgba(2, 132, 199, 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '12px',
                background: 'rgba(2, 132, 199, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.25)',
              }}
            >
              <Landmark size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                Hub Open Finance & Extratos Multi-Bancos
              </h2>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Gestão de conexões bancárias, importador universal e conciliação atômica
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '0.74rem',
                fontWeight: 700,
                letterSpacing: '0.03em',
                background: modoOpenFinance === 'real' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                color: modoOpenFinance === 'real' ? '#10b981' : '#eab308',
                border: `1px solid ${modoOpenFinance === 'real' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
              }}
            >
              <Clock size={12} />
              <span>STATUS: RECURSO EM ESPERA (FUTURAMENTE - {modoOpenFinance.toUpperCase()})</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <ShieldCheck size={16} color="var(--brand-primary)" />
              <span>Anti-dupla contagem em faturas & deduplicação ativadas</span>
            </div>
          </div>
        </div>

        {/* Banner Informativo: Recurso Futuro (Adiado para Fase Pós-Arrecadação) */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.08) 0%, rgba(245, 158, 11, 0.04) 100%)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '14px',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              background: 'rgba(234, 179, 8, 0.15)',
              color: '#eab308',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: '2px',
            }}
          >
            <Clock size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Integrações Diretas & Open Finance (Disponível Futuramente)
              </h4>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: 'rgba(234, 179, 8, 0.2)',
                  color: '#eab308',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  textTransform: 'uppercase',
                }}
              >
                Pausado Temporariamente
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              A conexão contínua direta com instituições financeiras e diretório Open Finance envolve taxas e custos regulatórios de parceiros de infraestrutura. Por este motivo, este módulo ficará desabilitado por enquanto e será disponibilizado futuramente após a fase inicial de monetização do aplicativo.
            </p>
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.80rem', color: 'var(--brand-primary)' }}>
              <Info size={14} />
              <span>
                Para incluir movimentações agora, você pode utilizar o <strong>Importador de Extratos (OFX / CSV)</strong> ou lançar manualmente na tela de Lançamentos.
              </span>
            </div>
          </div>
        </div>

        {/* Abas dos Fluxos do Hub Bancário */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-primary)',
            padding: '4px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            gap: '6px',
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            className={`auth-tab-btn ${fluxoAtivo === 'conexoes' ? 'active' : ''}`}
            onClick={() => {
              setMensagemErro(null);
              setFluxoAtivo('conexoes');
            }}
            style={{ minHeight: '38px', whiteSpace: 'nowrap' }}
          >
            <Landmark size={15} />
            <span>Bancos Conectados ({conexoes.length})</span>
          </button>

          <button
            type="button"
            className={`auth-tab-btn ${fluxoAtivo === 'conectar' ? 'active' : ''}`}
            onClick={() => {
              setMensagemErro(null);
              setFluxoAtivo('conectar');
            }}
            style={{ minHeight: '38px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <PlusCircle size={15} />
            <span>Nova Conexão Open Finance</span>
            <span
              style={{
                fontSize: '0.64rem',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '999px',
                background: 'rgba(234, 179, 8, 0.18)',
                color: '#eab308',
                border: '1px solid rgba(234, 179, 8, 0.35)',
              }}
            >
              Em breve
            </span>
          </button>

          <button
            type="button"
            className={`auth-tab-btn ${fluxoAtivo === 'importar' ? 'active' : ''}`}
            onClick={() => {
              setMensagemErro(null);
              setFluxoAtivo('importar');
            }}
            style={{ minHeight: '38px', whiteSpace: 'nowrap' }}
          >
            <FileUp size={15} />
            <span>Importador OFX / CSV</span>
          </button>

          <button
            type="button"
            className={`auth-tab-btn ${fluxoAtivo === 'worker' ? 'active' : ''}`}
            onClick={() => {
              setMensagemErro(null);
              setFluxoAtivo('worker');
            }}
            style={{ minHeight: '38px', whiteSpace: 'nowrap' }}
          >
            <Server size={15} />
            <span>Fila & Worker Raw ({dadosBrutos.length})</span>
          </button>
        </div>
      </div>

      {/* Alertas */}
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

      {/* FLUXO 1: Lista de Conexões Ativas */}
      {fluxoAtivo === 'conexoes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                Instituições Vinculadas ({conexoes.length})
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Monitore e sincronize extratos das contas autorizadas via Open Finance
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-primary"
                style={{
                  padding: '8px 16px',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: 0.65,
                  cursor: 'not-allowed',
                }}
                disabled
                title="Integração direta com bancos desabilitada temporariamente. Disponível futuramente."
              >
                <PlusCircle size={15} /> Conectar Banco (Em Breve)
              </button>
              <button
                type="button"
                style={{
                  background: 'var(--brand-primary)',
                  border: '1px solid var(--brand-primary)',
                  color: '#fff',
                  padding: '8px 14px',
                  fontSize: '0.82rem',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                }}
                onClick={() => setFluxoAtivo('importar')}
              >
                <FileUp size={15} /> Importar Arquivo (Recomendado)
              </button>
            </div>
          </div>

          {carregando && conexoes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              <Loader2 size={28} className="spinner" style={{ margin: '0 auto 12px' }} />
              <div>Carregando conexões bancárias reguladas...</div>
            </div>
          ) : conexoes.length === 0 ? (
            <div
              style={{
                padding: '40px 24px',
                background: 'var(--bg-surface)',
                border: '1px dashed var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'rgba(234, 179, 8, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#eab308',
                }}
              >
                <Clock size={24} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Integrações Automáticas em Espera</h4>
                <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--text-muted)', maxWidth: '460px', lineHeight: 1.45 }}>
                  A conexão direta com APIs bancárias requer infraestrutura paga e será disponibilizada futuramente. Enquanto isso, importe seus extratos livremente via arquivo OFX/CSV.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setFluxoAtivo('importar')}
                  style={{ padding: '8px 18px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <FileUp size={15} />
                  <span>Usar Importador OFX / CSV</span>
                </button>
                <button
                  type="button"
                  disabled
                  title="Conexão direta desabilitada temporariamente"
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    cursor: 'not-allowed',
                    opacity: 0.6,
                  }}
                >
                  Conexão Automática (Em Breve)
                </button>
                <button
                  type="button"
                  onClick={() => setFluxoAtivo('importar')}
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  Importar OFX/CSV
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
              {conexoes.map((conn) => (
                <div
                  key={conn.id}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '18px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '14px',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: '8px',
                            background: 'rgba(56, 189, 248, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--brand-primary)',
                          }}
                        >
                          <Landmark size={18} />
                        </div>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                            {conn.instituicaoNome}
                          </span>
                          {conn.compe && (
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block' }}>
                              COMPE: {conn.compe}
                            </span>
                          )}
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background:
                            conn.status === 'CONECTADO'
                              ? 'rgba(34, 197, 94, 0.15)'
                              : conn.status === 'REVOGADO'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : 'rgba(234, 179, 8, 0.15)',
                          color:
                            conn.status === 'CONECTADO'
                              ? 'var(--status-green)'
                              : conn.status === 'REVOGADO'
                              ? 'var(--status-red)'
                              : 'var(--status-yellow)',
                        }}
                      >
                        {conn.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.80rem', color: 'var(--text-muted)', marginTop: '12px', lineHeight: 1.4 }}>
                      Última sincronização:{' '}
                      <strong style={{ color: 'var(--text-secondary)' }}>
                        {conn.ultimaSincronizacaoEm
                          ? new Date(conn.ultimaSincronizacaoEm).toLocaleString('pt-BR')
                          : 'Nunca sincronizado'}
                      </strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                    {conn.status === 'CONECTADO' && (
                      <button
                        type="button"
                        disabled={sincronizandoId === conn.id}
                        onClick={() => handleSincronizar(conn.id)}
                        className="btn-primary"
                        style={{
                          flex: 1,
                          padding: '7px 12px',
                          fontSize: '0.80rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                        }}
                      >
                        <RefreshCw size={14} className={sincronizandoId === conn.id ? 'spinner' : ''} />
                        {sincronizandoId === conn.id ? 'Sincronizando...' : 'Sincronizar Lançamentos'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDesconectar(conn.id)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--status-red)',
                        padding: '7px 10px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        fontSize: '0.80rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Revogar ou excluir conexão"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          FLUXO 2: Página Completa - Conectar Banco (Open Finance)
          ========================================================================= */}
      {fluxoAtivo === 'conectar' && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '22px',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {/* Cabeçalho da Página de Conexão */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setFluxoAtivo('conexoes')}
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  width: 36,
                  height: 36,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Voltar para a lista"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                  Conectar Instituição Financeira
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                  Fluxo regulado Open Finance Brasil para sincronização contínua de contas e cartões
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFluxoAtivo('conexoes')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Cancelar
            </button>
          </div>

          {/* Grid de 2 Colunas para Amplo Espaço e Legibilidade */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '22px' }}>
            {/* Coluna 1: Seleção de Banco & Credenciais Específicas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.88rem', fontWeight: 700 }}>
                  1. Selecione o Banco ou Cooperativa
                </label>
                <select
                  className="form-select"
                  value={instituicaoSelecionada}
                  onChange={(e) => setInstituicaoSelecionada(e.target.value)}
                  style={{ fontSize: '0.9rem', padding: '10px 12px' }}
                >
                  {instituicoes.map((inst) => (
                    <option key={inst.codigo} value={inst.codigo}>
                      {inst.nome} {inst.compe ? `(COMPE ${inst.compe})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Orientação Regulada do Banco */}
              {instAtiva?.orientacaoOpenFinance && (
                <div
                  style={{
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    lineHeight: 1.45,
                  }}
                >
                  <ShieldCheck size={18} color="var(--brand-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '2px' }}>
                      Diretriz Regulatória:
                    </strong>
                    {instAtiva.orientacaoOpenFinance}
                  </div>
                </div>
              )}

              {/* Credenciais Bancárias Obrigatórias */}
              <div
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <Lock size={15} color="var(--brand-primary)" />
                    <span>2. Credenciais & Dados de Identificação</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--status-red)', fontWeight: 600 }}>* Obrigatórios</span>
                </div>

                {(!instAtiva?.camposRequeridos || instAtiva.camposRequeridos.length === 0) ? (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '8px 0' }}>
                    Esta instituição utilizará autenticação OAuth/Redirecionamento nativo do Open Finance.
                  </div>
                ) : (
                  instAtiva.camposRequeridos.map((campo) => {
                    const erro = errosValidacaoCampos[campo.id];
                    return (
                      <div key={campo.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.80rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {campo.label} {campo.obrigatorio && <span style={{ color: 'var(--status-red)' }}>*</span>}
                        </label>
                        <input
                          type={campo.tipo === 'password' ? 'password' : 'text'}
                          className="form-input"
                          placeholder={campo.placeholder}
                          maxLength={campo.maxLength}
                          value={credenciaisForm[campo.id] || ''}
                          onChange={(e) => handleCampoChange(campo.id, e.target.value)}
                          style={{
                            borderColor: erro ? 'var(--status-red)' : undefined,
                            background: erro ? 'rgba(239, 68, 68, 0.05)' : undefined,
                            fontSize: '0.88rem',
                          }}
                        />
                        {campo.mensagemAjuda && !erro && (
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            {campo.mensagemAjuda}
                          </span>
                        )}
                        {erro && (
                          <span style={{ fontSize: '0.74rem', color: 'var(--status-red)', fontWeight: 600 }}>
                            {erro}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Coluna 2: Escopos Regulados & Consentimento Formal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* Escopos de Permissão Regulados */}
              <div
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
                  <Layers size={15} color="var(--brand-primary)" />
                  <span>3. Escopos de Permissão Regulados</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ marginTop: '3px' }}
                      checked={escoposSelecionados.includes('accounts.read')}
                      onChange={() => handleToggleEscopo('accounts.read')}
                    />
                    <div style={{ fontSize: '0.80rem' }}>
                      <strong style={{ color: 'var(--text-primary)', display: 'block' }}>Identificação e Contas</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>Leitura de número da agência, conta corrente e saldos consolidados</span>
                    </div>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ marginTop: '3px' }}
                      checked={escoposSelecionados.includes('transactions.read')}
                      onChange={() => handleToggleEscopo('transactions.read')}
                    />
                    <div style={{ fontSize: '0.80rem' }}>
                      <strong style={{ color: 'var(--text-primary)', display: 'block' }}>Extratos Bancários</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>Leitura contínua de movimentações, lançamentos e transações PIX/TED</span>
                    </div>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ marginTop: '3px' }}
                      checked={escoposSelecionados.includes('credit-cards.read')}
                      onChange={() => handleToggleEscopo('credit-cards.read')}
                    />
                    <div style={{ fontSize: '0.80rem' }}>
                      <strong style={{ color: 'var(--text-primary)', display: 'block' }}>Cartões de Crédito</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>Leitura de faturas, limites e compras parceladas</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Termo Formal de Consentimento Obrigatório */}
              <div
                style={{
                  background: consentimentoConfirmado ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.08)',
                  border: `1px solid ${consentimentoConfirmado ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer', lineHeight: 1.45 }}>
                  <input
                    type="checkbox"
                    style={{ marginTop: '3px', width: 18, height: 18 }}
                    checked={consentimentoConfirmado}
                    onChange={(e) => setConsentimentoConfirmado(e.target.checked)}
                  />
                  <span>
                    <strong>Autorização Formal de Consentimento Open Finance:</strong> Autorizo expressamente o compartilhamento regulado dos dados bancários acima pelo prazo de validade de 90 dias, em total conformidade com as resoluções conjuntas do Banco Central do Brasil.
                  </span>
                </label>
              </div>

              {/* Aviso de Recurso Futuro no Formulário */}
              <div
                style={{
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <Clock size={18} color="#eab308" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Disponível futuramente:</strong> As chamadas diretas às APIs de parceiros bancários estão desativadas nesta versão inicial. O botão de autorização permanecerá bloqueado.
                </span>
              </div>

              {/* Ações Finais de Conexão */}
              <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', paddingTop: '10px' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleConectarInstituicao}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    fontSize: '0.92rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    opacity: 0.65,
                    cursor: 'not-allowed',
                  }}
                  disabled
                  title="Conexão direta desabilitada temporariamente. Disponível futuramente."
                >
                  <Lock size={18} />
                  <span>Conexão Indisponível no Momento (Em Breve)</span>
                </button>
                <button
                  type="button"
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    padding: '12px 20px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: '0.88rem',
                  }}
                  onClick={() => setFluxoAtivo('conexoes')}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          FLUXO 3: Página Completa - Importador Manual de Extratos (OFX / CSV)
          ========================================================================= */}
      {fluxoAtivo === 'importar' && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {/* Cabeçalho do Importador */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setFluxoAtivo('conexoes')}
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  width: 36,
                  height: 36,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Voltar para a lista"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                  Importador Universal de Extratos (OFX / CSV / JSON)
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                  Faça o parse automático com deduplicação determinística e anti-dupla contagem
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFluxoAtivo('conexoes')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Cancelar
            </button>
          </div>

          <form onSubmit={handleImportarExtrato} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.86rem', fontWeight: 700 }}>
                  Conta Destino no Evolvi
                </label>
                <select
                  className="form-select"
                  value={importContaId}
                  onChange={(e) => setImportContaId(e.target.value)}
                  required
                  style={{ fontSize: '0.9rem', padding: '10px 12px' }}
                >
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.tipo})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.86rem', fontWeight: 700 }}>
                  Nome de Referência do Arquivo
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: extrato_itau_outubro.ofx, extrato_nubank.csv"
                  value={importNomeArquivo}
                  onChange={(e) => setImportNomeArquivo(e.target.value)}
                  style={{ fontSize: '0.9rem', padding: '10px 12px' }}
                />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ fontSize: '0.86rem', fontWeight: 700, margin: 0 }}>
                  Conteúdo do Arquivo
                </label>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Cole o texto copiado do arquivo .OFX ou .CSV baixado do seu banco
                </span>
              </div>
              <textarea
                className="form-input"
                style={{
                  minHeight: '220px',
                  fontFamily: 'monospace',
                  fontSize: '0.82rem',
                  lineHeight: 1.45,
                  padding: '12px',
                  resize: 'vertical',
                }}
                placeholder="Exemplo OFX:
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20261012</DTPOSTED>
            <TRNAMT>-150.00</TRNAMT>
            <MEMO>SUPERMERCADO CENTRAL</MEMO>
          </STMTTRN>
        ...
Cole o conteúdo completo aqui..."
                value={importConteudo}
                onChange={(e) => setImportConteudo(e.target.value)}
                required
              />
            </div>

            <div
              style={{
                background: 'rgba(56, 189, 248, 0.06)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                fontSize: '0.80rem',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Sparkles size={16} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
              <span>
                O motor do Evolvi detecta automaticamente se o formato é <strong>OFX</strong>, <strong>CSV</strong> ou <strong>JSON</strong>, desconsiderando duplicidades e tratando o pagamento de fatura como transferência interna.
              </span>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
              <button
                type="submit"
                className="btn-primary"
                style={{ flex: 1, padding: '12px 20px', fontSize: '0.92rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                disabled={importando}
              >
                {importando ? (
                  <>
                    <Loader2 size={18} className="spinner" />
                    <span>Processando e Conciliando...</span>
                  </>
                ) : (
                  <>
                    <FileUp size={18} />
                    <span>Processar e Gravar Lançamentos</span>
                  </>
                )}
              </button>
              <button
                type="button"
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: '0.88rem',
                }}
                onClick={() => setFluxoAtivo('conexoes')}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          FLUXO 4: Página Completa - Fila & Worker Raw de Conciliação (TASK-29)
          ========================================================================= */}
      {fluxoAtivo === 'worker' && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {/* Header do Worker */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setFluxoAtivo('conexoes')}
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  width: 36,
                  height: 36,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Voltar para a lista"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                  Fila do Worker & Dados Raw
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                  Processamento assíncrono orientado a eventos, reprocessamento de DLQ e staging de dados brutos
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handleExecutarSweepWorker}
                disabled={executandoWorker}
                className="btn-primary"
                style={{
                  padding: '8px 14px',
                  fontSize: '0.80rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCw size={14} className={executandoWorker ? 'spinner' : ''} />
                <span>Executar Sweep</span>
              </button>
              <button
                type="button"
                onClick={handleReprocessarDLQ}
                disabled={executandoWorker}
                style={{
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  color: 'var(--status-yellow)',
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.80rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>Reprocessar DLQ</span>
              </button>
            </div>
          </div>

          {/* Tabela de Itens em Staging */}
          {dadosBrutos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
              Nenhum registro bruto na fila de processamento no momento.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {dadosBrutos.map((db) => (
                <div
                  key={db.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.82rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{db.tipoDado}</strong>
                      <span style={{ color: 'var(--text-muted)' }}>• Banco {db.instituicaoCodigo}</span>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                      Coletado em: {new Date(db.coletadoEm).toLocaleString('pt-BR')}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '4px',
                        background:
                          db.status === 'PROCESSADO'
                            ? 'rgba(34, 197, 94, 0.15)'
                            : db.status === 'ERRO_PROCESSAMENTO'
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(234, 179, 8, 0.15)',
                        color:
                          db.status === 'PROCESSADO'
                            ? 'var(--status-green)'
                            : db.status === 'ERRO_PROCESSAMENTO'
                            ? 'var(--status-red)'
                            : 'var(--status-yellow)',
                      }}
                    >
                      {db.status}
                    </span>
                    {db.status !== 'PROCESSADO' && (
                      <button
                        type="button"
                        onClick={() => handleProcessarIndividual(db.id)}
                        disabled={executandoWorker}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-primary)',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                        }}
                      >
                        Processar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
