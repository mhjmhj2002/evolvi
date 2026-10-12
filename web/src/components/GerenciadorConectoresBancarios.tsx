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
} from 'lucide-react';

interface GerenciadorConectoresBancariosProps {
  contas: ContaItem[];
  onExtratoImportado?: () => void;
}

export const GerenciadorConectoresBancarios: React.FC<GerenciadorConectoresBancariosProps> = ({
  contas,
  onExtratoImportado,
}) => {
  const [instituicoes, setInstituicoes] = useState<InstituicaoBancariaItem[]>([]);
  const [conexoes, setConexoes] = useState<ConexaoBancariaItem[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [sincronizandoId, setSincronizandoId] = useState<string | null>(null);

  // Estados de modais e ações
  const [isConectarModalOpen, setIsConectarModalOpen] = useState(false);
  const [isImportarModalOpen, setIsImportarModalOpen] = useState(false);
  const [instituicaoSelecionada, setInstituicaoSelecionada] = useState<string>('341');
  const [itauAgencia, setItauAgencia] = useState<string>('');
  const [itauConta, setItauConta] = useState<string>('');
  const [santanderAgencia, setSantanderAgencia] = useState<string>('');
  const [santanderConta, setSantanderConta] = useState<string>('');
  const [interConta, setInterConta] = useState<string>('');
  const [interChavePix, setInterChavePix] = useState<string>('');

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
      const [resInst, resConn] = await Promise.all([
        apiService.getInstituicoesBancarias(),
        apiService.getConexoesBancarias(),
      ]);
      setInstituicoes(resInst.instituicoes);
      setConexoes(resConn.conexoes);
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao carregar conexões.');
    } finally {
      setCarregando(false);
    }
  };

  const handleConectarInstituicao = async () => {
    try {
      setCarregando(true);
      setMensagemErro(null);
      setMensagemSucesso(null);

      const credentials: Record<string, unknown> = {};
      if (instituicaoSelecionada === '341' || instituicaoSelecionada === 'CON-ITAU') {
        if (itauAgencia) credentials.agencia = itauAgencia;
        if (itauConta) credentials.conta = itauConta;
      } else if (instituicaoSelecionada === '033' || instituicaoSelecionada === 'CON-SANTANDER') {
        if (santanderAgencia) credentials.agencia = santanderAgencia;
        if (santanderConta) credentials.conta = santanderConta;
      } else if (instituicaoSelecionada === '077' || instituicaoSelecionada === 'CON-INTER') {
        if (interConta) credentials.contaCorrente = interConta;
        if (interChavePix) credentials.chavePix = interChavePix;
      }

      const res = await apiService.conectarBanco({
        instituicaoCodigo: instituicaoSelecionada,
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      });

      setMensagemSucesso(`Instituição conectada com sucesso! Código: ${res.conexao.instituicaoNome}`);
      setIsConectarModalOpen(false);
      setItauAgencia('');
      setItauConta('');
      setSantanderAgencia('');
      setSantanderConta('');
      setInterConta('');
      setInterChavePix('');
      await carregarDados();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao conectar instituição bancária.');
    } finally {
      setCarregando(false);
    }
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
    if (!confirm('Deseja realmente revogar o consentimento desta conexão bancária?')) {
      return;
    }

    try {
      setCarregando(true);
      setMensagemErro(null);
      await apiService.desconectarBanco(conexaoId);
      setMensagemSucesso('Conexão revogada com sucesso.');
      await carregarDados();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha ao revogar conexão.');
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
      setIsImportarModalOpen(false);
      setImportConteudo('');
      if (onExtratoImportado) onExtratoImportado();
    } catch (err: unknown) {
      setMensagemErro(err instanceof Error ? err.message : 'Falha na importação de extrato.');
    } finally {
      setImportando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Header do Hub */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(56, 189, 248, 0.05) 100%)',
          border: '1px solid rgba(2, 132, 199, 0.25)',
          borderRadius: 'var(--radius-sm)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: '8px',
                background: 'rgba(2, 132, 199, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}
            >
              <Landmark size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                Hub Open Finance & Extratos Multi-Bancos
              </h2>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Conexão automatizada regulada e importador universal (OFX/CSV)
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => setIsConectarModalOpen(true)}
            >
              <PlusCircle size={14} /> Conectar Banco
            </button>
            <button
              type="button"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                padding: '6px 12px',
                fontSize: '0.78rem',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onClick={() => setIsImportarModalOpen(true)}
            >
              <FileUp size={14} /> Importar OFX/CSV
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          <ShieldCheck size={14} color="var(--brand-primary)" />
          <span>Deduplicação determinística e anti-dupla contagem em pagamento de faturas de cartão ativadas por padrão.</span>
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

      {/* 2. Lista de Conexões Ativas */}
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Instituições e Conexões Vinculadas ({conexoes.length})
        </div>

        {carregando && conexoes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
            <Loader2 size={24} className="spinner" style={{ margin: '0 auto 8px' }} />
            <div>Carregando conexões bancárias...</div>
          </div>
        ) : conexoes.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              background: 'var(--bg-surface)',
              border: '1px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.84rem',
            }}
          >
            Nenhum banco ou agregador conectado ainda. Clique em <strong>Conectar Banco</strong> para sincronização automática ou em <strong>Importar OFX/CSV</strong> para leitura de arquivos.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {conexoes.map((conn) => (
              <div
                key={conn.id}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{conn.instituicaoNome}</span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
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
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                    {conn.compe ? `COMPE: ${conn.compe} • ` : ''}
                    Última sincronização:{' '}
                    {conn.ultimaSincronizacaoEm
                      ? new Date(conn.ultimaSincronizacaoEm).toLocaleString('pt-BR')
                      : 'Nunca sincronizado'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {conn.status === 'CONECTADO' && (
                    <button
                      type="button"
                      disabled={sincronizandoId === conn.id}
                      onClick={() => handleSincronizar(conn.id)}
                      style={{
                        background: 'rgba(56, 189, 248, 0.12)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        color: 'var(--brand-primary)',
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                      title="Sincronizar lançamentos recentes"
                    >
                      <RefreshCw size={14} className={sincronizandoId === conn.id ? 'spinner' : ''} />
                      {sincronizandoId === conn.id ? 'Sincronizando...' : 'Sincronizar'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDesconectar(conn.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      padding: '6px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                    title="Revogar conexão"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Modal de Conectar Banco (Open Finance) */}
      {isConectarModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              maxWidth: '460px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                Conectar Instituição Bancária
              </h3>
              <button
                type="button"
                onClick={() => setIsConectarModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
              Selecione o banco ou cooperativa para autorizar o compartilhamento seguro de extratos e faturas:
            </p>

            <div className="form-group">
              <label className="form-label">Instituição Financeira</label>
              <select
                className="form-select"
                value={instituicaoSelecionada}
                onChange={(e) => setInstituicaoSelecionada(e.target.value)}
              >
                {instituicoes.map((inst) => (
                  <option key={inst.codigo} value={inst.codigo}>
                    {inst.nome} {inst.compe ? `(COMPE ${inst.compe})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {(instituicaoSelecionada === '341' || instituicaoSelecionada === 'CON-ITAU') && (
              <div
                style={{
                  background: 'rgba(236, 112, 0, 0.08)',
                  border: '1px solid rgba(236, 112, 0, 0.25)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ec7000' }}>
                  Parâmetros de Acesso Itaú Unibanco (Opcional / Sandbox)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      Agência (4 dígitos)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: 0910"
                      maxLength={4}
                      value={itauAgencia}
                      onChange={(e) => setItauAgencia(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      Conta Corrente
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: 54321-0"
                      value={itauConta}
                      onChange={(e) => setItauConta(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Suporta contas correntes Itaú e cartões Itaucard com classificação automática POF e anti-dupla contagem no pagamento de fatura.
                </div>
              </div>
            )}

            {(instituicaoSelecionada === '033' || instituicaoSelecionada === 'CON-SANTANDER') && (
              <div
                style={{
                  background: 'rgba(204, 0, 0, 0.08)',
                  border: '1px solid rgba(204, 0, 0, 0.25)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#cc0000' }}>
                  Parâmetros de Acesso Santander Brasil (Opcional / Sandbox)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      Agência (4 dígitos)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: 2041"
                      maxLength={4}
                      value={santanderAgencia}
                      onChange={(e) => setSantanderAgencia(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      Conta Corrente
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: 88765-4"
                      value={santanderConta}
                      onChange={(e) => setSantanderConta(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Suporta contas correntes Santander e cartões Santander Way / SX com classificação automática POF e anti-dupla contagem no pagamento de fatura.
                </div>
              </div>
            )}

            {(instituicaoSelecionada === '077' || instituicaoSelecionada === 'CON-INTER') && (
              <div
                style={{
                  background: 'rgba(255, 122, 0, 0.08)',
                  border: '1px solid rgba(255, 122, 0, 0.25)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ff7a00' }}>
                  Parâmetros de Acesso Banco Inter (Opcional / Sandbox / API Correntista)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      Conta Digital Inter
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: 1234567-8"
                      value={interConta}
                      onChange={(e) => setInterConta(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      Chave PIX / CPF
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: 123.456.789-00"
                      value={interChavePix}
                      onChange={(e) => setInterChavePix(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Suporta contas digitais Inter e cartões Mastercard (Gold, Platinum, Black) com cashback, Inter Shop e regra anti-dupla contagem no pagamento de faturas.
                </div>
              </div>
            )}

            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
                background: 'rgba(56, 189, 248, 0.05)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid rgba(56, 189, 248, 0.15)',
              }}
            >
              Ao conectar, o Hub Open Finance gerará um consentimento seguro de 90 dias com escopo de leitura de contas e transações, sincronizando com suas contas locais no Evolvi.
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={handleConectarInstituicao}
                disabled={carregando}
              >
                {carregando ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    <span>Conectando...</span>
                  </>
                ) : (
                  <span>Autorizar Conexão</span>
                )}
              </button>
              <button
                type="button"
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
                onClick={() => setIsConectarModalOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Modal de Importação Manual (OFX / CSV / JSON) */}
      {isImportarModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              maxWidth: '520px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                Importador Universal de Extratos (OFX / CSV / JSON)
              </h3>
              <button
                type="button"
                onClick={() => setIsImportarModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleImportarExtrato} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Conta Destino</label>
                <select
                  className="form-select"
                  value={importContaId}
                  onChange={(e) => setImportContaId(e.target.value)}
                  required
                >
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.tipo})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Nome do Arquivo / Tipo</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: extrato_itau.ofx, extrato.csv"
                  value={importNomeArquivo}
                  onChange={(e) => setImportNomeArquivo(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Conteúdo do Arquivo (Cole o texto aqui)</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '0.78rem' }}
                  placeholder="Cole aqui o texto do arquivo .OFX ou conteúdo das linhas do .CSV..."
                  value={importConteudo}
                  onChange={(e) => setImportConteudo(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1 }}
                  disabled={importando}
                >
                  {importando ? (
                    <>
                      <Loader2 size={16} className="spinner" />
                      <span>Processando Importação...</span>
                    </>
                  ) : (
                    <span>Processar e Gravar Lançamentos</span>
                  )}
                </button>
                <button
                  type="button"
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setIsImportarModalOpen(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
