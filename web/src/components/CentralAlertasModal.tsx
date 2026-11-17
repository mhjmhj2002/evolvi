import React, { useState, useEffect } from 'react';
import { AlertaSistemaItem, RegraAlertaItem, apiService } from '../api.ts';
import {
  Bell,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Settings,
  Plus,
  Trash2,
  Power,
} from 'lucide-react';

interface CentralAlertasModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAlertaModificado?: () => void;
  onNavigateTab?: (tab: any) => void;
}

export const CentralAlertasModal: React.FC<CentralAlertasModalProps> = ({
  isOpen,
  onClose,
  onAlertaModificado,
  onNavigateTab,
}) => {
  const [alertas, setAlertas] = useState<AlertaSistemaItem[]>([]);
  const [regras, setRegras] = useState<RegraAlertaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [aba, setAba] = useState<'ativos' | 'todos' | 'regras'>('ativos');
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);

  // Modal para criar nova regra de alerta dinamicamente
  const [modalNovaRegraAberto, setModalNovaRegraAberto] = useState(false);
  const [formCodigo, setFormCodigo] = useState('');
  const [formNome, setFormNome] = useState('');
  const [formDescricao, setFormDescricao] = useState('');
  const [formSeveridade, setFormSeveridade] = useState<'INFO' | 'ATENCAO' | 'URGENTE'>('INFO');
  const [formParametrosJson, setFormParametrosJson] = useState('{}');
  const [formTemplateTitulo, setFormTemplateTitulo] = useState('');
  const [formTemplateMensagem, setFormTemplateMensagem] = useState('');
  const [salvandoRegra, setSalvandoRegra] = useState(false);
  const [erroRegra, setErroRegra] = useState<string | null>(null);

  const carregarDados = async () => {
    try {
      setLoading(true);
      const [resAlertas, resRegras] = await Promise.all([
        apiService.getAlertas({ apenasAtivos: aba === 'ativos' }),
        apiService.getRegrasAlerta(),
      ]);
      setAlertas(resAlertas.alertas || []);
      setRegras(resRegras.regras || []);
    } catch (e) {
      console.error('Erro ao carregar alertas e regras:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      carregarDados();
    }
  }, [isOpen, aba]);

  if (!isOpen) return null;

  const handleCancelarAlerta = async (id: string, motivo: string = 'Dispensado pelo usuário') => {
    try {
      setProcessandoId(id);
      await apiService.atualizarStatusAlerta(id, 'CANCELADO', motivo);
      await carregarDados();
      onAlertaModificado?.();
    } catch (e) {
      console.error('Erro ao cancelar alerta:', e);
    } finally {
      setProcessandoId(null);
    }
  };

  const handleMarcarComoPago = async (alerta: AlertaSistemaItem) => {
    try {
      setProcessandoId(alerta.id);
      if (alerta.entidadeId && alerta.entidadeTipo === 'CONTA_PAGAR') {
        await apiService.atualizarContaPagar(alerta.entidadeId, { status: 'PAGO' });
      } else {
        await apiService.atualizarStatusAlerta(alerta.id, 'RESOLVIDO');
      }
      await carregarDados();
      onAlertaModificado?.();
    } catch (e) {
      console.error('Erro ao resolver alerta:', e);
    } finally {
      setProcessandoId(null);
    }
  };

  const handleMarcarTodosVisualizados = async () => {
    try {
      setLoading(true);
      await apiService.marcarTodosAlertasVisualizados();
      await carregarDados();
      onAlertaModificado?.();
    } catch (e) {
      console.error('Erro ao marcar todos como visualizados:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRegraAtiva = async (regra: RegraAlertaItem) => {
    try {
      setProcessandoId(regra.id);
      await apiService.atualizarRegraAlerta(regra.id, {
        ativo: !regra.ativo,
      });
      await carregarDados();
      onAlertaModificado?.();
    } catch (e) {
      console.error('Erro ao alterar status da regra:', e);
    } finally {
      setProcessandoId(null);
    }
  };

  const handleAlterarParametroRegra = async (regra: RegraAlertaItem, chave: string, valor: any) => {
    try {
      setProcessandoId(regra.id);
      const novosParametros = {
        ...(regra.parametros || {}),
        [chave]: valor,
      };
      await apiService.atualizarRegraAlerta(regra.id, {
        parametros: novosParametros,
      });
      await carregarDados();
      onAlertaModificado?.();
      setSucessoMsg(`Regra "${regra.nome}" atualizada!`);
      setTimeout(() => setSucessoMsg(null), 3000);
    } catch (e) {
      console.error('Erro ao atualizar parâmetros da regra:', e);
    } finally {
      setProcessandoId(null);
    }
  };

  const handleCriarNovaRegra = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroRegra(null);

    let parsedParams = {};
    try {
      parsedParams = JSON.parse(formParametrosJson || '{}');
    } catch (err) {
      setErroRegra('Parâmetros em JSON inválido.');
      return;
    }

    try {
      setSalvandoRegra(true);
      await apiService.criarRegraAlerta({
        codigo: formCodigo.trim().toUpperCase(),
        nome: formNome.trim(),
        descricao: formDescricao.trim() || null,
        severidadePadrao: formSeveridade,
        parametros: parsedParams,
        templateTitulo: formTemplateTitulo.trim() || null,
        templateMensagem: formTemplateMensagem.trim() || null,
      });

      setModalNovaRegraAberto(false);
      setFormCodigo('');
      setFormNome('');
      setFormDescricao('');
      setFormParametrosJson('{}');
      setFormTemplateTitulo('');
      setFormTemplateMensagem('');
      await carregarDados();
      setSucessoMsg('Nova regra de alerta cadastrada com sucesso!');
      setTimeout(() => setSucessoMsg(null), 3000);
    } catch (err: any) {
      setErroRegra(err.message || 'Erro ao criar regra de alerta');
    } finally {
      setSalvandoRegra(false);
    }
  };

  const handleExcluirRegra = async (id: string) => {
    if (!window.confirm('Deseja excluir esta regra de alerta?')) return;
    try {
      setProcessandoId(id);
      await apiService.excluirRegraAlerta(id);
      await carregarDados();
      onAlertaModificado?.();
    } catch (e) {
      console.error('Erro ao excluir regra:', e);
    } finally {
      setProcessandoId(null);
    }
  };

  const getSeveridadeBadge = (sev: string) => {
    switch (sev) {
      case 'URGENTE':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '0.72rem',
              fontWeight: 700,
              background: 'rgba(239, 68, 68, 0.15)',
              color: 'var(--status-red)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            <AlertCircle size={12} /> Urgente
          </span>
        );
      case 'ATENCAO':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '0.72rem',
              fontWeight: 700,
              background: 'rgba(234, 179, 8, 0.15)',
              color: 'var(--status-yellow)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
            }}
          >
            <AlertTriangle size={12} /> Atenção
          </span>
        );
      default:
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '0.72rem',
              fontWeight: 700,
              background: 'rgba(56, 189, 248, 0.15)',
              color: 'var(--brand-primary)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}
          >
            <Info size={12} /> Informativo
          </span>
        );
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '620px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: '#0f172a',
        }}
      >
        {/* Cabeçalho */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(30, 41, 59, 0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(234, 179, 8, 0.15)',
                color: 'var(--status-yellow)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bell size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>Central de Alertas</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Notificações ativas e regras configuráveis
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Abas */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(15, 23, 42, 0.8)',
            padding: '4px 16px',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setAba('ativos')}
            style={{
              padding: '8px 14px',
              border: 'none',
              background: aba === 'ativos' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color: aba === 'ativos' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.8rem',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Bell size={14} /> Ativos ({alertas.filter((a) => a.status === 'PENDENTE' || a.status === 'VISUALIZADO').length})
          </button>
          <button
            type="button"
            onClick={() => setAba('todos')}
            style={{
              padding: '8px 14px',
              border: 'none',
              background: aba === 'todos' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color: aba === 'todos' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.8rem',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Histórico
          </button>
          <button
            type="button"
            onClick={() => setAba('regras')}
            style={{
              padding: '8px 14px',
              border: 'none',
              background: aba === 'regras' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color: aba === 'regras' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.8rem',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginLeft: 'auto',
            }}
          >
            <Settings size={14} /> Regras de Alerta ({regras.length})
          </button>
        </div>

        {sucessoMsg && (
          <div
            style={{
              padding: '8px 16px',
              background: 'rgba(34, 197, 94, 0.15)',
              borderBottom: '1px solid rgba(34, 197, 94, 0.3)',
              color: 'var(--status-green)',
              fontSize: '0.78rem',
              fontWeight: 600,
            }}
          >
            {sucessoMsg}
          </div>
        )}

        {/* Conteúdo com rolagem */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {aba === 'regras' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>
                    Regras Configuradas no Banco (Data-Driven)
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Ative, desative ou ajuste parâmetros de cada regra sem mexer em código.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalNovaRegraAberto(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'var(--brand-primary)',
                    color: '#090d16',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} /> Nova Regra
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {regras.map((regra) => {
                  const isProcessando = processandoId === regra.id;
                  const isPadraoVencimento = regra.codigo === 'CONTA_A_VENCER';
                  const diasAntecedencia =
                    typeof regra.parametros?.diasAntecedencia === 'number'
                      ? regra.parametros.diasAntecedencia
                      : 3;

                  return (
                    <div
                      key={regra.id}
                      className="card"
                      style={{
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        borderLeft: `4px solid ${regra.ativo ? 'var(--brand-primary)' : 'var(--text-muted)'}`,
                        opacity: regra.ativo ? 1 : 0.6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{regra.nome}</span>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              {regra.codigo}
                            </span>
                          </div>
                          {regra.descricao && (
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                              {regra.descricao}
                            </p>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleRegraAtiva(regra)}
                            disabled={isProcessando}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 10px',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${regra.ativo ? 'rgba(34, 197, 94, 0.4)' : 'var(--border-subtle)'}`,
                              background: regra.ativo ? 'rgba(34, 197, 94, 0.12)' : 'rgba(30, 41, 59, 0.4)',
                              color: regra.ativo ? 'var(--status-green)' : 'var(--text-muted)',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            <Power size={12} />
                            <span>{regra.ativo ? 'Ativo' : 'Pausado'}</span>
                          </button>

                          {/* Se for regra personalizada, permite excluir */}
                          {regra.usuarioId && (
                            <button
                              type="button"
                              onClick={() => handleExcluirRegra(regra.id)}
                              style={{
                                background: 'transparent',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '4px 8px',
                                color: 'var(--status-red)',
                                cursor: 'pointer',
                              }}
                              title="Excluir regra personalizada"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Parâmetro customizado inline: Dias de antecedência */}
                      {isPadraoVencimento && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            background: 'rgba(255, 255, 255, 0.02)',
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                          }}
                        >
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            Dias de antecedência:
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            defaultValue={diasAntecedencia}
                            onBlur={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (val && val !== diasAntecedencia) {
                                handleAlterarParametroRegra(regra, 'diasAntecedencia', val);
                              }
                            }}
                            style={{
                              width: '60px',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-subtle)',
                              background: '#090d16',
                              color: '#fff',
                              fontSize: '0.8rem',
                              textAlign: 'center',
                            }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            dias antes do vencimento
                          </span>
                        </div>
                      )}

                      {/* Outros parâmetros em JSON se houver */}
                      {regra.codigo !== 'CONTA_A_VENCER' && Object.keys(regra.parametros || {}).length > 0 && (
                        <div
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--text-muted)',
                            background: 'rgba(255, 255, 255, 0.02)',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          Parâmetros: {JSON.stringify(regra.parametros)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              Carregando alertas...
            </div>
          ) : alertas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <Bell size={36} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Nenhum alerta no momento</div>
              <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                Você está em dia com todas as suas contas e conciliações!
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {alertas.length} notificação(ões)
                </span>
                {aba === 'ativos' && alertas.some((a) => a.status === 'PENDENTE') && (
                  <button
                    type="button"
                    onClick={handleMarcarTodosVisualizados}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--brand-primary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Marcar todos como lidos
                  </button>
                )}
              </div>

              {alertas.map((item) => {
                const isProcessando = processandoId === item.id;
                const isCancelado = item.status === 'CANCELADO';
                const isResolvido = item.status === 'RESOLVIDO';

                return (
                  <div
                    key={item.id}
                    className="card"
                    style={{
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      opacity: isCancelado || isResolvido ? 0.6 : 1,
                      borderLeft: `4px solid ${
                        item.severidade === 'URGENTE'
                          ? 'var(--status-red)'
                          : item.severidade === 'ATENCAO'
                          ? 'var(--status-yellow)'
                          : 'var(--brand-primary)'
                      }`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {getSeveridadeBadge(item.severidade)}
                        <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>{item.titulo}</span>
                      </div>
                      {isCancelado && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Dispensado</span>
                      )}
                      {isResolvido && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--status-green)' }}>Resolvido</span>
                      )}
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                      {item.mensagem}
                    </p>

                    {/* Ações do alerta */}
                    {!isCancelado && !isResolvido && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginTop: '6px',
                          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                          paddingTop: '8px',
                        }}
                      >
                        {item.entidadeTipo === 'CONTA_PAGAR' && (
                          <button
                            type="button"
                            onClick={() => handleMarcarComoPago(item)}
                            disabled={isProcessando}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '5px 10px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid rgba(34, 197, 94, 0.4)',
                              background: 'rgba(34, 197, 94, 0.12)',
                              color: 'var(--status-green)',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            <CheckCircle2 size={13} />
                            <span>Marcar como Pago</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleCancelarAlerta(item.id, 'Dispensado pelo usuário')}
                          disabled={isProcessando}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-subtle)',
                            background: 'rgba(30, 41, 59, 0.4)',
                            color: 'var(--text-muted)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Dispensar Alerta
                        </button>

                        {onNavigateTab && item.entidadeTipo === 'CONTA_PAGAR' && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onNavigateTab('compromissos');
                            }}
                            style={{
                              marginLeft: 'auto',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--brand-primary)',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              fontWeight: 600,
                              textDecoration: 'underline',
                            }}
                          >
                            Ver em Compromissos →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal para Adicionar Nova Regra Data-Driven */}
      {modalNovaRegraAberto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '480px',
              backgroundColor: '#0f172a',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>
                Cadastrar Nova Regra de Alerta
              </h3>
              <button
                type="button"
                onClick={() => setModalNovaRegraAberto(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {erroRegra && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--status-red)',
                  fontSize: '0.8rem',
                }}
              >
                {erroRegra}
              </div>
            )}

            <form onSubmit={handleCriarNovaRegra} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Código da Regra (MAIÚSCULAS_SEM_ESPAÇO) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="EX: SALDO_MINIMO_CONTA"
                  value={formCodigo}
                  onChange={(e) => setFormCodigo(e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(30, 41, 59, 0.6)',
                    color: '#fff',
                    fontSize: '0.85rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Nome da Regra *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Saldo Mínimo de Segurança"
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(30, 41, 59, 0.6)',
                    color: '#fff',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Descrição
                </label>
                <input
                  type="text"
                  placeholder="Ex: Alerta quando o saldo da conta corrente for inferior a R$ 500"
                  value={formDescricao}
                  onChange={(e) => setFormDescricao(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(30, 41, 59, 0.6)',
                    color: '#fff',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Severidade Padrão
                </label>
                <select
                  value={formSeveridade}
                  onChange={(e) => setFormSeveridade(e.target.value as any)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(30, 41, 59, 0.6)',
                    color: '#fff',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="INFO">Informativo</option>
                  <option value="ATENCAO">Atenção</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Parâmetros Dinâmicos (JSON)
                </label>
                <textarea
                  rows={2}
                  value={formParametrosJson}
                  onChange={(e) => setFormParametrosJson(e.target.value)}
                  placeholder='{"valorMinimo": 500, "dia": 1}'
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(30, 41, 59, 0.6)',
                    color: '#fff',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setModalNovaRegraAberto(false)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoRegra}
                  style={{
                    padding: '6px 16px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'var(--brand-primary)',
                    color: '#090d16',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  {salvandoRegra ? 'Salvando...' : 'Cadastrar Regra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
