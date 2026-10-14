import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  UploadCloud,
  FolderUp,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Database,
  History,
  RefreshCw,
  ChevronRight,
  FileCheck,
  ShieldCheck,
  Zap,
  Key,
} from 'lucide-react';
import {
  apiService,
  LoteImportacaoItem,
  StagingLancamentoItem,
  StatusLoteImportacao,
  StatusIaResponse,
} from '../api.ts';
import { ConfiguracaoIaCard } from '../components/ConfiguracaoIaCard.tsx';

interface TelaImportacaoIaProps {
  usuarioId?: string;
  onNovasContasOuMovimentos?: () => void;
  onNavigateTab?: (tab: any) => void;
}

interface TransacaoAoVivo {
  id: string;
  arquivoOrigem: string;
  dataMovimento: string;
  descricao: string;
  valor: number;
  natureza: string;
  contaNome: string;
  categoriaNome?: string;
  duplicadaIgnorada?: boolean;
  pagamentoFaturaConvertido?: boolean;
  timestamp: string;
}

export const TelaImportacaoIa: React.FC<TelaImportacaoIaProps> = ({
  usuarioId,
  onNovasContasOuMovimentos,
  onNavigateTab,
}) => {
  // Estados principais
  const [lotes, setLotes] = useState<LoteImportacaoItem[]>([]);
  const [loteAtivo, setLoteAtivo] = useState<LoteImportacaoItem | null>(null);
  const [itensStaging, setItensStaging] = useState<StagingLancamentoItem[]>([]);
  const [feedAoVivo, setFeedAoVivo] = useState<TransacaoAoVivo[]>([]);
  const [contasCriadasDetectadas, setContasCriadasDetectadas] = useState<string[]>([]);

  // Estados de upload
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Estados de controle e polling
  const [processandoAcao, setProcessandoAcao] = useState(false);
  const [visualizacaoAba, setVisualizacaoAba] = useState<'pipeline' | 'feed' | 'historico'>('pipeline');

  // Validação prévia de configuração da IA
  const [statusIa, setStatusIa] = useState<StatusIaResponse | null>(null);
  const [modalConfigIaAberto, setModalConfigIaAberto] = useState(false);
  const [modalEscolhaIaAberto, setModalEscolhaIaAberto] = useState(false);
  const [provedorIaSelecionado, setProvedorIaSelecionado] = useState<string>('GEMINI');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Consulta o status da IA no servidor e localmente
  const verificarStatusIa = useCallback(async () => {
    try {
      const res = await apiService.getStatusIa();
      setStatusIa(res);
      if (res.configuracoes && res.configuracoes.length > 0) {
        setProvedorIaSelecionado(res.configuracoes[0].provedor);
      }
    } catch {
      setStatusIa(null);
    }
  }, []);

  useEffect(() => {
    verificarStatusIa();
  }, [verificarStatusIa]);

  const temIaConfigurada = Boolean(
    statusIa?.hasUserKey ||
    statusIa?.hasEnvKey ||
    (typeof window !== 'undefined' && localStorage.getItem('evolvi_ia_byok_key')?.trim())
  );

  // Carrega lista de lotes recentes
  const carregarLotes = useCallback(async () => {
    try {
      const res = await apiService.getLotesImportacao({ limite: 15 });
      setLotes(res.lotes || []);

      // Se não há lote ativo selecionado e houver lotes, seleciona o mais recente
      if (res.lotes && res.lotes.length > 0) {
        setLoteAtivo((prev) => {
          if (!prev) return res.lotes[0];
          const atualizado = res.lotes.find((l) => l.id === prev.id);
          return atualizado || res.lotes[0];
        });
      }
    } catch (err: any) {
      console.warn('Erro ao carregar lotes de importação:', err);
    }
  }, []);

  // Carrega detalhes e staging do lote ativo
  const carregarDetalhesLoteAtivo = useCallback(async (loteId: string) => {
    try {
      const [resLote, resStaging] = await Promise.all([
        apiService.getLoteImportacao(loteId),
        apiService.getStagingLote(loteId),
      ]);
      if (resLote?.lote) {
        setLoteAtivo(resLote.lote);
      }
      if (resStaging?.itens) {
        setItensStaging(resStaging.itens);
      }
    } catch (err: any) {
      console.warn('Erro ao sincronizar detalhes do lote:', err);
    }
  }, []);

  // Polling reativo e sincronização periódica a cada 3.5s enquanto o lote estiver em processamento
  useEffect(() => {
    carregarLotes();
  }, [carregarLotes, usuarioId]);

  useEffect(() => {
    if (!loteAtivo) return;

    // Se o lote está ativo em alguma fase de processamento, atualiza em loop
    const statusAtivos: StatusLoteImportacao[] = [
      'RECEPCIONADO',
      'PROCESSANDO_IA',
      'CARGA_STAGING',
      'CONSOLIDANDO',
    ];

    const deveAtualizarPeriodicamente = statusAtivos.includes(loteAtivo.status);

    let intervalId: any = null;
    if (deveAtualizarPeriodicamente) {
      intervalId = setInterval(() => {
        carregarDetalhesLoteAtivo(loteAtivo.id);
        carregarLotes();
      }, 3500);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [loteAtivo?.id, loteAtivo?.status, carregarDetalhesLoteAtivo, carregarLotes]);

  // Conexão SSE (Server-Sent Events) para feed ao vivo de eventos do pipeline
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('evolvi_auth_token') : null;
    if (!token || token.startsWith('mock-token-')) return;

    let eventSource: EventSource | null = null;
    try {
      // Navegadores nativos EventSource suportam SSE
      eventSource = new EventSource(`/api/importacao/stream-eventos?token=${encodeURIComponent(token)}`);

      eventSource.addEventListener('transacao_consolidada', (e: MessageEvent) => {
        try {
          const dados = JSON.parse(e.data);
          setFeedAoVivo((prev) => [
            {
              id: dados.stagingId || `tx-${Date.now()}-${Math.random()}`,
              arquivoOrigem: dados.arquivoOrigem,
              dataMovimento: dados.dataMovimento,
              descricao: dados.descricao,
              valor: dados.valor,
              natureza: dados.natureza,
              contaNome: dados.contaNome,
              categoriaNome: dados.categoriaNome,
              duplicadaIgnorada: dados.duplicadaIgnorada,
              pagamentoFaturaConvertido: dados.pagamentoFaturaConvertido,
              timestamp: new Date().toLocaleTimeString(),
            },
            ...prev.slice(0, 49), // mantém até 50 transações mais recentes
          ]);

          if (dados.contaNome) {
            setContasCriadasDetectadas((prev) => {
              if (!prev.includes(dados.contaNome)) {
                return [...prev, dados.contaNome];
              }
              return prev;
            });
          }

          onNovasContasOuMovimentos?.();
        } catch (err) {
          console.warn('Erro ao processar evento transacao_consolidada SSE:', err);
        }
      });

      eventSource.addEventListener('arquivo_progresso', (_e: MessageEvent) => {
        if (loteAtivo?.id) {
          carregarDetalhesLoteAtivo(loteAtivo.id);
        }
      });

      eventSource.addEventListener('lote_concluido', (e: MessageEvent) => {
        try {
          const dados = JSON.parse(e.data);
          setMensagemSucesso(
            `Lote processado com sucesso! ${dados.totalTransacoesImportadas} transações integradas.`
          );
          if (loteAtivo?.id) {
            carregarDetalhesLoteAtivo(loteAtivo.id);
          }
          carregarLotes();
          onNovasContasOuMovimentos?.();
        } catch (err) {
          console.warn('Erro ao processar evento lote_concluido SSE:', err);
        }
      });

      eventSource.onerror = () => {
        // SSE fecha ou tenta reconectar sem quebrar a tela
      };
    } catch {
      // Fallback gracioso para navegadores ou ambientes sem SSE
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [loteAtivo?.id, carregarDetalhesLoteAtivo, carregarLotes, onNovasContasOuMovimentos]);

  // Handler de envio de arquivos via Upload em Lote
  const handleUploadFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;

    // Validação prévia de IA:
    // Se algum dos arquivos for não estruturado (PDF, imagem, texto livre) e não há IA configurada,
    // interrompe e oferece configurar a IA antes.
    const temArquivosNaoEstruturados = files.some((f) => {
      const ext = f.name.toLowerCase();
      return (
        ext.endsWith('.pdf') ||
        ext.endsWith('.png') ||
        ext.endsWith('.jpg') ||
        ext.endsWith('.jpeg') ||
        f.type.includes('pdf') ||
        f.type.includes('image')
      );
    });

    if (temArquivosNaoEstruturados && !temIaConfigurada) {
      setMensagemErro(
        'A Inteligência Artificial ainda não está configurada para extrair dados de faturas em PDF ou imagens. Configure a IA primeiro para continuar.'
      );
      setModalConfigIaAberto(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadProgress(15);
    setMensagemErro(null);
    setMensagemSucesso(null);

    try {
      setUploadProgress(45);
      const resultado = await apiService.uploadLoteImportacao(files);
      setUploadProgress(100);

      setMensagemSucesso(
        `Lote criado com sucesso! ${resultado.totalArquivos} arquivo(s) recepcionado(s) na pasta temporária do servidor.`
      );

      // Transição automática para o monitor do lote criado
      await carregarLotes();
      if (resultado.loteId) {
        await carregarDetalhesLoteAtivo(resultado.loteId);
        setVisualizacaoAba('pipeline');
      }
    } catch (err: any) {
      setMensagemErro(err.message || 'Falha ao realizar upload dos arquivos.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const fileList = Array.from(e.dataTransfer.files);
      handleUploadFiles(fileList);
    }
  };

  // Disparo manual das etapas do pipeline se necessário
  const executarExtracaoComProvedor = async (loteId: string, provedorEscolhido?: string) => {
    setProcessandoAcao(true);
    setMensagemErro(null);
    try {
      await apiService.processarLoteIa(loteId, provedorEscolhido ? { provedorIa: provedorEscolhido } : undefined);
      await carregarDetalhesLoteAtivo(loteId);
      await carregarLotes();
      setMensagemSucesso(`Extração executada com sucesso usando ${provedorEscolhido || 'a IA configurada'}!`);
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao processar extração por IA.');
    } finally {
      setProcessandoAcao(false);
      setModalEscolhaIaAberto(false);
    }
  };

  const handleProcessarEtapaIa = async () => {
    if (!loteAtivo) return;

    const totalConfiguradas = statusIa?.configuracoes?.length || (statusIa?.hasEnvKey ? 1 : 0);

    // Se não tiver nenhuma configurada, não permite e avisa que precisa configurar
    if (totalConfiguradas === 0) {
      setMensagemErro('Nenhuma Inteligência Artificial configurada. Você precisa configurar sua IA antes de processar.');
      setModalConfigIaAberto(true);
      return;
    }

    // Se tiver mais de uma IA configurada, abre modal perguntando qual IA usar
    if (statusIa?.configuracoes && statusIa.configuracoes.length > 1) {
      setModalEscolhaIaAberto(true);
      return;
    }

    // Se tiver apenas uma IA configurada, escolhe a única e não pergunta
    const unicoProvedor = statusIa?.configuracoes?.[0]?.provedor || (statusIa?.hasEnvKey ? 'GEMINI' : undefined);
    await executarExtracaoComProvedor(loteAtivo.id, unicoProvedor);
  };

  const handleCarregarStaging = async () => {
    if (!loteAtivo) return;
    setProcessandoAcao(true);
    setMensagemErro(null);
    try {
      await apiService.carregarLoteStaging(loteAtivo.id);
      await carregarDetalhesLoteAtivo(loteAtivo.id);
      await carregarLotes();
      setMensagemSucesso('Carga em Staging concluída com sucesso!');
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao carregar dados em staging.');
    } finally {
      setProcessandoAcao(false);
    }
  };

  const handleConsolidarNegocio = async () => {
    if (!loteAtivo) return;
    setProcessandoAcao(true);
    setMensagemErro(null);
    try {
      const res = await apiService.consolidarLote(loteAtivo.id);
      await carregarDetalhesLoteAtivo(loteAtivo.id);
      await carregarLotes();
      onNovasContasOuMovimentos?.();
      setMensagemSucesso(
        `Consolidação concluída! ${res.resultado.novosMovimentosInseridos} movimentos adicionados, ${res.resultado.contasCriadas} contas novas provisionadas.`
      );
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao consolidar movimentos.');
    } finally {
      setProcessandoAcao(false);
    }
  };

  // Status Helpers
  const getBadgeStatusArquivo = (status: string) => {
    switch (status) {
      case 'RECEPCIONADO':
        return <span className="badge badge-amarelo">Em Fila</span>;
      case 'ENVIADO_IA':
        return <span className="badge badge-blue">Processando IA...</span>;
      case 'IA_CONCLUIDO':
        return <span className="badge badge-verde">IA Concluída</span>;
      case 'STAGING_CARREGADO':
        return <span className="badge badge-blue">Staging Pronto</span>;
      case 'PROCESSADO_FINAL':
        return <span className="badge badge-verde">Consolidado</span>;
      case 'ERRO':
        return <span className="badge badge-vermelho">Erro</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const getEtapaProgressoNumero = (status: StatusLoteImportacao): number => {
    switch (status) {
      case 'RECEPCIONADO':
        return 1;
      case 'PROCESSANDO_IA':
        return 2;
      case 'CARGA_STAGING':
        return 3;
      case 'CONSOLIDANDO':
      case 'CONCLUIDO':
        return 4;
      default:
        return 1;
    }
  };

  const etapaAtual = loteAtivo ? getEtapaProgressoNumero(loteAtivo.status) : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header da Tela Dedicada */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <span style={{ fontSize: '0.8rem', color: 'var(--brand-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sparkles size={14} /> Pipeline Inteligente • Plano A
          </span>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
            Importação em Lote por IA
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Envie faturas e extratos em múltiplos arquivos ou pastas completas para extração sequencial e consolidação automática.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setModalConfigIaAberto(true)}
            style={{
              background: temIaConfigurada ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.14)',
              border: temIaConfigurada ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(234, 179, 8, 0.35)',
              color: temIaConfigurada ? 'var(--status-green, #22c55e)' : 'var(--status-yellow, #eab308)',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 12px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Ver e configurar chaves de IA (Gemini, ChatGPT, Claude)"
          >
            <Sparkles size={14} />
            <span>{temIaConfigurada ? 'IA Configurada' : 'Configurar IA'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              carregarLotes();
              if (loteAtivo?.id) carregarDetalhesLoteAtivo(loteAtivo.id);
            }}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 12px',
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Recarregar dados"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* 2. Banner de Status da IA (Informativo ou de Alerta de Configuração) */}
      {!temIaConfigurada ? (
        <div
          style={{
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={20} style={{ color: 'var(--status-yellow, #eab308)', flexShrink: 0 }} />
            <div>
              <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                IA ainda não configurada para leitura de PDFs e imagens
              </strong>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Para importar faturas não estruturadas com IA, configure sua chave do Google Gemini, OpenAI ou Claude. Extratos OFX e planilhas CSV continuam funcionando diretamente.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalConfigIaAberto(true)}
            className="btn-primary"
            style={{ fontSize: '0.8rem', padding: '6px 14px', whiteSpace: 'nowrap' }}
          >
            <Key size={14} /> Configurar IA Agora
          </button>
        </div>
      ) : (
        <div
          style={{
            background: 'rgba(34, 197, 94, 0.08)',
            border: '1px solid rgba(34, 197, 94, 0.25)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sparkles size={18} style={{ color: 'var(--status-green, #22c55e)', flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: '0.84rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                IA configurada:{' '}
              </span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {statusIa?.configuracoes && statusIa.configuracoes.length > 0
                  ? statusIa.configuracoes.map(c => `${c.provedor} (${c.modelo})`).join(', ')
                  : 'Pronta para uso'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalConfigIaAberto(true)}
            className="btn btn-secondary"
            style={{ fontSize: '0.76rem', padding: '4px 10px', height: 'auto' }}
          >
            Gerenciar IAs
          </button>
        </div>
      )}

      {/* Modal de Configuração de Chaves de IA */}
      {modalConfigIaAberto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalConfigIaAberto(false);
          }}
        >
          <div style={{ width: '100%', maxWidth: '720px', maxHeight: '90vh', overflowY: 'auto' }}>
            <ConfiguracaoIaCard
              modoModal={true}
              onChaveAtualizada={() => {
                verificarStatusIa();
              }}
              onFecharModal={() => setModalConfigIaAberto(false)}
            />
          </div>
        </div>
      )}

      {/* Modal de Escolha de IA quando há mais de uma configurada */}
      {modalEscolhaIaAberto && statusIa?.configuracoes && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalEscolhaIaAberto(false);
          }}
        >
          <div
            className="login-card"
            style={{ width: '100%', maxWidth: '480px', margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={24} style={{ color: 'var(--brand-primary, #38bdf8)' }} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  Qual IA você deseja usar neste lote?
                </h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Você possui mais de uma Inteligência Artificial configurada. Selecione a desejada:
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {statusIa.configuracoes.map((cfg) => {
                const isSelected = provedorIaSelecionado === cfg.provedor;
                const nomeAmigavel =
                  cfg.provedor === 'GEMINI'
                    ? 'Google Gemini'
                    : cfg.provedor === 'OPENAI'
                    ? 'OpenAI (ChatGPT)'
                    : 'Anthropic (Claude)';

                return (
                  <button
                    key={cfg.provedor}
                    type="button"
                    onClick={() => setProvedorIaSelecionado(cfg.provedor)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '2px solid var(--brand-primary)' : '1px solid var(--border-color)',
                      background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-secondary)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {nomeAmigavel}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Modelo: <code>{cfg.modelo}</code> • Chave: <code>{cfg.chaveMascarada}</code>
                      </div>
                    </div>
                    {isSelected && <CheckCircle2 size={18} style={{ color: 'var(--brand-primary)' }} />}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setModalEscolhaIaAberto(false)}
                disabled={processandoAcao}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={processandoAcao || !loteAtivo}
                onClick={() => {
                  if (loteAtivo) {
                    executarExtracaoComProvedor(loteAtivo.id, provedorIaSelecionado);
                  }
                }}
              >
                {processandoAcao ? 'Processando...' : `Iniciar Extração com ${provedorIaSelecionado}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Feedback de Notificações */}
      {mensagemSucesso && (
        <div style={{
          backgroundColor: 'var(--status-green-bg)',
          border: '1px solid var(--status-green-border)',
          color: '#34d399',
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <CheckCircle2 size={18} />
          <span style={{ flex: 1 }}>{mensagemSucesso}</span>
          <button
            type="button"
            onClick={() => setMensagemSucesso(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            &times;
          </button>
        </div>
      )}

      {mensagemErro && (
        <div style={{
          backgroundColor: 'var(--status-red-bg)',
          border: '1px solid var(--status-red-border)',
          color: '#f87171',
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <AlertTriangle size={18} />
          <span style={{ flex: 1 }}>{mensagemErro}</span>
          <button
            type="button"
            onClick={() => setMensagemErro(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            &times;
          </button>
        </div>
      )}

      {/* 3. Área Ergonômica de Drag & Drop e Seleção de Arquivos / Pasta Completa */}
      <div
        className="card"
        style={{
          border: dragOver ? '2px dashed var(--brand-primary)' : '2px dashed var(--border-card)',
          backgroundColor: dragOver ? 'rgba(56, 189, 248, 0.08)' : 'var(--bg-card)',
          padding: '24px 20px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '14px',
          transition: 'all 0.2s ease',
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'rgba(56, 189, 248, 0.14)',
            color: 'var(--brand-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <UploadCloud size={30} />
        </div>

        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Arraste e solte seus arquivos ou pastas aqui
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Suporta faturas em PDF, extratos OFX, planilhas CSV, notas fiscais e comprovantes em TXT ou imagens.
          </div>
        </div>

        {uploading && (
          <div style={{ width: '100%', maxWidth: '340px', marginTop: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              <span>Enviando arquivos para o servidor...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'linear-gradient(90deg, #38bdf8, #818cf8)', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}

        {/* Inputs escondidos para arquivos e pastas */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.ofx,.csv,.txt,.png,.jpg,.jpeg"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleUploadFiles(Array.from(e.target.files));
            }
          }}
        />

        <input
          ref={folderInputRef}
          type="file"
          // @ts-ignore - Atributos suportados por Chromium/WebKit para upload de pastas inteiras
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleUploadFiles(Array.from(e.target.files));
            }
          }}
        />

        {/* Botões de Ação para Seleção */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' }}>
          <button
            type="button"
            className="btn-primary"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            style={{ fontSize: '0.85rem', minHeight: '40px', padding: '0 16px' }}
          >
            <FileText size={16} /> Selecionar Arquivos
          </button>

          <button
            type="button"
            disabled={uploading}
            onClick={() => folderInputRef.current?.click()}
            style={{
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(129, 140, 248, 0.4)',
              color: '#c7d2fe',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: '0.85rem',
              minHeight: '40px',
              padding: '0 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FolderUp size={16} /> Selecionar Pasta Inteira
          </button>
        </div>
      </div>

      {/* 4. Notificação de Novas Contas Provisionadas */}
      {contasCriadasDetectadas.length > 0 && (
        <div style={{
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--brand-primary)',
          fontSize: '0.84rem',
        }}>
          <ShieldCheck size={20} />
          <div style={{ flex: 1 }}>
            <strong>Auto-cadastro de contas ativado:</strong>{' '}
            As seguintes contas foram provisionadas automaticamente no seu cadastro sem interrupções:{' '}
            <em>{contasCriadasDetectadas.join(', ')}</em>.
          </div>
        </div>
      )}

      {/* 5. Seletor de Abas de Visualização Interna */}
      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
        <button
          type="button"
          onClick={() => setVisualizacaoAba('pipeline')}
          style={{
            background: visualizacaoAba === 'pipeline' ? 'var(--bg-surface)' : 'transparent',
            border: visualizacaoAba === 'pipeline' ? '1px solid var(--border-card)' : 'none',
            color: visualizacaoAba === 'pipeline' ? 'var(--brand-primary)' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.85rem',
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Zap size={15} /> Monitor do Lote Ativo
        </button>

        <button
          type="button"
          onClick={() => setVisualizacaoAba('feed')}
          style={{
            background: visualizacaoAba === 'feed' ? 'var(--bg-surface)' : 'transparent',
            border: visualizacaoAba === 'feed' ? '1px solid var(--border-card)' : 'none',
            color: visualizacaoAba === 'feed' ? 'var(--status-green)' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.85rem',
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <FileCheck size={15} /> Feed de Registros ao Vivo ({feedAoVivo.length})
        </button>

        <button
          type="button"
          onClick={() => setVisualizacaoAba('historico')}
          style={{
            background: visualizacaoAba === 'historico' ? 'var(--bg-surface)' : 'transparent',
            border: visualizacaoAba === 'historico' ? '1px solid var(--border-card)' : 'none',
            color: visualizacaoAba === 'historico' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.85rem',
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <History size={15} /> Histórico de Lotes ({lotes.length})
        </button>
      </div>

      {/* 6. Aba 1: Monitor do Lote Ativo e Etapas do Pipeline */}
      {visualizacaoAba === 'pipeline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {!loteAtivo ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
              Nenhum lote selecionado. Envie novos arquivos acima para iniciar o processamento.
            </div>
          ) : (
            <>
              {/* Card Resumo do Lote */}
              <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Código do Lote:
                    </span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>
                      {loteAtivo.id}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Status:</span>
                    <span className="badge badge-blue">{loteAtivo.status}</span>
                  </div>
                </div>

                {/* Esteira Visual das 4 Etapas do Pipeline */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  padding: '12px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  {[
                    { passo: 1, titulo: '1. Recepcionado', desc: 'Storage no servidor' },
                    { passo: 2, titulo: '2. Extração IA', desc: 'Arquivo a arquivo' },
                    { passo: 3, titulo: '3. Carga Staging', desc: 'Preparo dos dados' },
                    { passo: 4, titulo: '4. Consolidação', desc: 'Anti-dupla contagem' },
                  ].map((step) => {
                    const isConcluido = etapaAtual > step.passo || loteAtivo.status === 'CONCLUIDO';
                    const isAtivo = etapaAtual === step.passo && loteAtivo.status !== 'CONCLUIDO';
                    return (
                      <div
                        key={step.passo}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                          borderLeft: `3px solid ${
                            isConcluido
                              ? 'var(--status-green)'
                              : isAtivo
                              ? 'var(--brand-primary)'
                              : 'var(--border-subtle)'
                          }`,
                          paddingLeft: '8px',
                        }}
                      >
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: isConcluido ? 'var(--status-green)' : isAtivo ? 'var(--brand-primary)' : 'var(--text-muted)',
                        }}>
                          {step.titulo}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {step.desc}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Controles de Disparo dos Workers (Para aceleração/auditoria) */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Ações do Pipeline:</span>
                  <button
                    type="button"
                    disabled={processandoAcao}
                    onClick={handleProcessarEtapaIa}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--brand-primary)',
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    1. Re-executar IA
                  </button>
                  <button
                    type="button"
                    disabled={processandoAcao}
                    onClick={handleCarregarStaging}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--brand-secondary)',
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    2. Carregar Staging
                  </button>
                  <button
                    type="button"
                    disabled={processandoAcao}
                    onClick={handleConsolidarNegocio}
                    style={{
                      background: 'var(--status-green-bg)',
                      border: '1px solid var(--status-green-border)',
                      color: 'var(--status-green)',
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    3. Consolidar no Extrato
                  </button>
                </div>
              </div>

              {/* Lista Individual dos Arquivos do Lote */}
              <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                    Arquivos do Lote ({loteAtivo.arquivos?.length || 0})
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Processados: {loteAtivo.arquivosProcessados} / {loteAtivo.totalArquivos}
                  </span>
                </div>

                {!loteAtivo.arquivos || loteAtivo.arquivos.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                    Nenhum arquivo cadastrado neste lote.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {loteAtivo.arquivos.map((arq) => (
                      <div
                        key={arq.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'rgba(30, 41, 59, 0.45)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <FileText size={18} color="var(--brand-primary)" />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{arq.nomeArquivo}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {(arq.tamanhoBytes / 1024).toFixed(1)} KB • {arq.caminhoRelativo}
                            </div>
                          </div>
                        </div>

                        <div>{getBadgeStatusArquivo(arq.status)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tabela de Dados em Staging Preparados */}
              {itensStaging.length > 0 && (
                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Database size={16} color="var(--brand-secondary)" />
                      Registros Extraídos em Staging ({itensStaging.length})
                    </h3>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 6px' }}>Arquivo</th>
                          <th style={{ padding: '8px 6px' }}>Data</th>
                          <th style={{ padding: '8px 6px' }}>Descrição</th>
                          <th style={{ padding: '8px 6px' }}>Valor</th>
                          <th style={{ padding: '8px 6px' }}>Conta</th>
                          <th style={{ padding: '8px 6px' }}>Categoria</th>
                          <th style={{ padding: '8px 6px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itensStaging.map((item) => (
                          <tr key={item.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '8px 6px', color: 'var(--brand-primary)' }}>{item.arquivoOrigem}</td>
                            <td style={{ padding: '8px 6px' }}>{item.dataMovimento.substring(0, 10)}</td>
                            <td style={{ padding: '8px 6px', fontWeight: 600 }}>{item.descricao}</td>
                            <td style={{
                              padding: '8px 6px',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              color: item.natureza === 'RECEITA' ? 'var(--status-green)' : 'var(--status-red)',
                            }}>
                              {item.natureza === 'RECEITA' ? '+' : '-'} {Number(item.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </td>
                            <td style={{ padding: '8px 6px' }}>{item.contaSugerida || 'Padrão'}</td>
                            <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{item.categoriaSugerida || '-'}</td>
                            <td style={{ padding: '8px 6px' }}>
                              <span className={`badge ${item.statusProcessamento === 'PROCESSADO' ? 'badge-verde' : item.statusProcessamento === 'IGNORADO' ? 'badge-amarelo' : 'badge-blue'}`}>
                                {item.statusProcessamento}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 7. Aba 2: Feed de Registros ao Vivo */}
      {visualizacaoAba === 'feed' && (
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={18} color="var(--brand-primary)" />
                Linha do Tempo de Ingestão em Tempo Real
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Exibe as transações entrando na base oficial identificadas com o nome do arquivo de origem.
              </p>
            </div>

            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('lancamentos')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--brand-primary)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                Abrir Extrato Completo <ArrowRight size={14} />
              </button>
            )}
          </div>

          {feedAoVivo.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
              Nenhuma transação recebida ao vivo nesta sessão ainda. As transações consolidadas pelos workers aparecerão aqui automaticamente.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {feedAoVivo.map((tx) => (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(30, 41, 59, 0.45)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.72rem', background: 'rgba(56, 189, 248, 0.15)', color: 'var(--brand-primary)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        {tx.arquivoOrigem}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {tx.dataMovimento}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>
                      {tx.descricao}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                      Conta: <strong>{tx.contaNome}</strong> {tx.categoriaNome && `• ${tx.categoriaNome}`}
                      {tx.pagamentoFaturaConvertido && ' • (Anti-dupla contagem fatura)'}
                      {tx.duplicadaIgnorada && ' • (Duplicata identificada)'}
                    </div>
                  </div>

                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    color: tx.natureza === 'RECEITA' ? 'var(--status-green)' : 'var(--status-red)',
                  }}>
                    {tx.natureza === 'RECEITA' ? '+' : '-'} {tx.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 8. Aba 3: Histórico de Lotes Anteriores */}
      {visualizacaoAba === 'historico' && (
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '0.98rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={18} color="var(--brand-primary)" />
              Lotes de Importação Registrados
            </h3>
          </div>

          {lotes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
              Nenhum lote histórico registrado no seu perfil.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {lotes.map((lote) => {
                const isSelected = loteAtivo?.id === lote.id;
                return (
                  <div
                    key={lote.id}
                    onClick={() => {
                      setLoteAtivo(lote);
                      carregarDetalhesLoteAtivo(lote.id);
                      setVisualizacaoAba('pipeline');
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(30, 41, 59, 0.45)',
                      border: isSelected ? '1px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {lote.id}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Criado em: {new Date(lote.criadoEm).toLocaleString()} • {lote.totalArquivos} arquivo(s)
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="badge badge-blue">{lote.status}</span>
                      <ChevronRight size={18} color="var(--text-muted)" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
