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
  Trash2,
  Bell,
} from 'lucide-react';
import {
  apiService,
  LoteImportacaoItem,
  StagingLancamentoItem,
  StatusLoteImportacao,
  StatusIaResponse,
  AlertaConciliacaoItem,
  HistoricoImportacaoArquivoItem,
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
  const [visualizacaoAba, setVisualizacaoAba] = useState<'pipeline' | 'feed' | 'historico' | 'arquivos'>('pipeline');
  const [workerDetalheAba, setWorkerDetalheAba] = useState<'resumo' | 'ia' | 'staging' | 'consolidacao'>('resumo');

  // TASK-41: Estados de Alertas de Conciliação e Histórico Estruturado
  const [alertasConciliacao, setAlertasConciliacao] = useState<AlertaConciliacaoItem[]>([]);
  const [historicoArquivos, setHistoricoArquivos] = useState<HistoricoImportacaoArquivoItem[]>([]);
  const [alertaParaDispensar, setAlertaParaDispensar] = useState<AlertaConciliacaoItem | null>(null);
  const [motivoDispensaSelecionado, setMotivoDispensaSelecionado] = useState<string>('SEM_GASTOS');

  // Validação prévia de configuração da IA e seleção no lote / reprocessamento
  const [statusIa, setStatusIa] = useState<StatusIaResponse | null>(null);
  const [modalConfigIaAberto, setModalConfigIaAberto] = useState(false);
  const [modalEscolhaIaAberto, setModalEscolhaIaAberto] = useState(false);
  const [provedorIaSelecionado, setProvedorIaSelecionado] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const salvo = localStorage.getItem('evolvi_provedor_ia_ativo');
      if (salvo) return salvo;
    }
    return 'DEEPSEEK';
  });
  const [modeloIaSelecionado, setModeloIaSelecionado] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const salvo = localStorage.getItem('evolvi_modelo_ia_ativo');
      if (salvo) return salvo;
    }
    return 'deepseek-chat';
  });

  const salvarPreferenciaIa = (provedor: string, modelo?: string) => {
    const mod = modelo || (provedor === 'DEEPSEEK' ? 'deepseek-chat' : 'gemini-3.8-flash');
    setProvedorIaSelecionado(provedor);
    setModeloIaSelecionado(mod);
    if (typeof window !== 'undefined') {
      localStorage.setItem('evolvi_provedor_ia_ativo', provedor);
      localStorage.setItem('evolvi_modelo_ia_ativo', mod);
    }
  };

  // Reprocessamento granular por arquivo com falha
  const [arquivoParaReprocessar, setArquivoParaReprocessar] = useState<{
    id: string;
    nomeArquivo: string;
    mensagemErro?: string | null;
  } | null>(null);
  const [reprocessandoArquivoId, setReprocessandoArquivoId] = useState<string | null>(null);
  const [excluindoArquivoId, setExcluindoArquivoId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Consulta o status da IA no servidor e localmente
  const verificarStatusIa = useCallback(async () => {
    try {
      const res = await apiService.getStatusIa();
      setStatusIa(res);
      if (res.configuracoes && res.configuracoes.length > 0) {
        const salvoProv = typeof window !== 'undefined' ? localStorage.getItem('evolvi_provedor_ia_ativo') : null;
        const confSalva = salvoProv ? res.configuracoes.find((c) => c.provedor === salvoProv) : null;
        const configAtiva = confSalva || res.configuracoes[0];

        setProvedorIaSelecionado(configAtiva.provedor);
        setModeloIaSelecionado(
          configAtiva.modelo ||
            (configAtiva.provedor === 'DEEPSEEK' ? 'deepseek-chat' : 'gemini-3.8-flash')
        );
      } else if (res.hasEnvKey) {
        setProvedorIaSelecionado('GEMINI');
        setModeloIaSelecionado('gemini-3.8-flash');
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

  // TASK-41: Carrega alertas de conciliação e histórico de arquivos
  const carregarAlertasEHistorico = useCallback(async () => {
    try {
      const [resAlertas, resHist] = await Promise.all([
        apiService.getAlertasConciliacao({ status: 'PENDENTE' }),
        apiService.getHistoricoArquivosImportados(),
      ]);
      setAlertasConciliacao(resAlertas?.alertas || []);
      setHistoricoArquivos(resHist?.historico || []);
    } catch (err: any) {
      console.warn('Erro ao carregar alertas ou histórico de arquivos:', err);
    }
  }, []);

  // Polling reativo e sincronização periódica a cada 3.5s enquanto o lote estiver em processamento
  useEffect(() => {
    carregarLotes();
    carregarAlertasEHistorico();
  }, [carregarLotes, carregarAlertasEHistorico, usuarioId]);

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
      }, 1500);
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

    // Pre-flight Check de Mídia no Frontend (Upload):
    // Se selecionado provedor puramente textual (DeepSeek) e há arquivos de imagem, avisa e sugere Gemini
    const temImagens = files.some((f) => {
      const ext = f.name.toLowerCase();
      return (
        ext.endsWith('.png') ||
        ext.endsWith('.jpg') ||
        ext.endsWith('.jpeg') ||
        ext.endsWith('.webp') ||
        f.type.startsWith('image/')
      );
    });

    if (temImagens && provedorIaSelecionado === 'DEEPSEEK') {
      const confirma = window.confirm(
        'Aviso de Mídia: Você incluiu arquivos de imagem (.png/.jpg), mas a IA selecionada (DeepSeek) é puramente textual e não processa mídias visuais.\n\nRecomendamos utilizar o Google Gemini para imagens.\n\nDeseja continuar mesmo assim? Os arquivos de imagem serão identificados como incompatíveis.'
      );
      if (!confirma) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (folderInputRef.current) folderInputRef.current.value = '';
        return;
      }
    }

    setUploading(true);
    setUploadProgress(15);
    setMensagemErro(null);
    setMensagemSucesso(null);

    try {
      setUploadProgress(45);
      const resultado = await apiService.uploadLoteImportacao(files, {
        provedorIa: provedorIaSelecionado,
        modeloIa: modeloIaSelecionado,
      });
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
  const executarExtracaoComProvedor = async (loteId: string, provedorEscolhido?: string, modeloEscolhido?: string) => {
    setProcessandoAcao(true);
    setMensagemErro(null);
    try {
      await apiService.processarLoteIa(
        loteId,
        provedorEscolhido ? { provedorIa: provedorEscolhido, modeloIa: modeloEscolhido } : undefined
      );
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

  const executarReprocessamentoArquivoIndividualComIa = async (
    arquivoId: string,
    provedorEscolhido?: string,
    modeloEscolhido?: string
  ) => {
    setReprocessandoArquivoId(arquivoId);
    setMensagemErro(null);
    setMensagemSucesso(null);
    // Limpa imediatamente o motivo da falha do card do arquivo sendo reprocessado
    setArquivoParaReprocessar((prev) => (prev ? { ...prev, mensagemErro: null } : null));

    try {
      const res = await apiService.reprocessarArquivoIa(arquivoId, {
        provedorIa: provedorEscolhido,
        modeloIa: modeloEscolhido,
      });

      if (loteAtivo?.id) {
        await carregarDetalhesLoteAtivo(loteAtivo.id);
      }
      await carregarLotes();
      onNovasContasOuMovimentos?.();

      setMensagemSucesso(
        `Arquivo reprocessado com sucesso com ${provedorEscolhido || 'a nova IA'}! (${res.resultado.totalTransacoes} transações extraídas)`
      );
      setArquivoParaReprocessar(null);
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao reprocessar arquivo com a IA selecionada.');
    } finally {
      setReprocessandoArquivoId(null);
    }
  };

  const handleExcluirArquivo = async (arquivoId: string, nomeArquivo: string) => {
    const confirmou = window.confirm(
      `Deseja realmente excluir o arquivo "${nomeArquivo}" do lote? Esta ação removerá os dados pendentes deste arquivo.`
    );
    if (!confirmou) return;

    setExcluindoArquivoId(arquivoId);
    setMensagemErro(null);
    setMensagemSucesso(null);

    try {
      await apiService.excluirArquivoImportacao(arquivoId);
      if (arquivoParaReprocessar?.id === arquivoId) {
        setArquivoParaReprocessar(null);
      }
      if (loteAtivo?.id) {
        await carregarDetalhesLoteAtivo(loteAtivo.id);
      }
      await carregarLotes();
      setMensagemSucesso(`Arquivo "${nomeArquivo}" foi excluído com sucesso do lote.`);
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao excluir o arquivo da importação.');
    } finally {
      setExcluindoArquivoId(null);
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

    // Dispara a extração usando explicitamente a IA selecionada pelo usuário
    await executarExtracaoComProvedor(loteAtivo.id, provedorIaSelecionado, modeloIaSelecionado);
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
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={18} style={{ color: 'var(--status-green, #22c55e)', flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                  IA Ativa para Importação de Lote:
                </span>
                <span style={{ fontSize: '0.82rem', color: 'var(--brand-primary)', marginLeft: '6px', fontWeight: 600 }}>
                  {provedorIaSelecionado === 'GEMINI'
                    ? 'Google Gemini'
                    : provedorIaSelecionado === 'DEEPSEEK'
                    ? 'DeepSeek'
                    : provedorIaSelecionado === 'OPENAI'
                    ? 'OpenAI (ChatGPT)'
                    : provedorIaSelecionado === 'OPENROUTER'
                    ? 'OpenRouter'
                    : 'Anthropic (Claude)'}{' '}
                  <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>({modeloIaSelecionado})</code>
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModalConfigIaAberto(true)}
              className="btn btn-secondary"
              style={{ fontSize: '0.76rem', padding: '4px 10px', height: 'auto' }}
            >
              Gerenciar Chaves de IA
            </button>
          </div>

          {/* Seletor rápido de IA quando há provedores disponíveis */}
          {statusIa?.configuracoes && statusIa.configuracoes.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Escolher IA do lote:</span>
              {statusIa.configuracoes.map((cfg) => {
                const isSelected = provedorIaSelecionado === cfg.provedor;
                const nomeCurto =
                  cfg.provedor === 'GEMINI'
                    ? 'Gemini'
                    : cfg.provedor === 'DEEPSEEK'
                    ? 'DeepSeek'
                    : cfg.provedor === 'OPENAI'
                    ? 'OpenAI'
                    : cfg.provedor === 'OPENROUTER'
                    ? 'OpenRouter'
                    : 'Claude';

                return (
                  <button
                    key={cfg.provedor}
                    type="button"
                    onClick={() => {
                      salvarPreferenciaIa(
                        cfg.provedor,
                        cfg.modelo || (cfg.provedor === 'DEEPSEEK' ? 'deepseek-chat' : 'gemini-3.8-flash')
                      );
                    }}
                    style={{
                      background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(15, 23, 42, 0.5)',
                      border: isSelected ? '1px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                      color: isSelected ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: isSelected ? 700 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    {isSelected && <CheckCircle2 size={12} />}
                    <span>{nomeCurto} ({cfg.modelo})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Aviso sobre capacidade de mídia caso o provedor selecionado seja puramente textual (DeepSeek) */}
          {provedorIaSelecionado === 'DEEPSEEK' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                fontSize: '0.78rem',
                color: '#fef08a',
              }}
            >
              <AlertTriangle size={15} style={{ color: 'var(--status-yellow, #eab308)', flexShrink: 0 }} />
              <div>
                <strong>Atenção com arquivos visuais:</strong> O modelo DeepSeek é estritamente textual e não processa imagens (.jpg, .png) ou PDFs escaneados. Para faturas em imagem, utilize o <strong>Google Gemini</strong>.
              </div>
            </div>
          )}
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
                    : cfg.provedor === 'DEEPSEEK'
                    ? 'DeepSeek'
                    : cfg.provedor === 'OPENAI'
                    ? 'OpenAI (ChatGPT)'
                    : cfg.provedor === 'OPENROUTER'
                    ? 'OpenRouter'
                    : 'Anthropic (Claude)';

                return (
                  <button
                    key={cfg.provedor}
                    type="button"
                    onClick={() => {
                      salvarPreferenciaIa(
                        cfg.provedor,
                        cfg.modelo || (cfg.provedor === 'DEEPSEEK' ? 'deepseek-chat' : 'gemini-3.8-flash')
                      );
                    }}
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
                    executarExtracaoComProvedor(loteAtivo.id, provedorIaSelecionado, modeloIaSelecionado);
                  }
                }}
              >
                {processandoAcao ? 'Processando...' : `Iniciar Extração com ${provedorIaSelecionado}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Reprocessamento Granular de Arquivo com Falha */}
      {arquivoParaReprocessar && (
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
            if (e.target === e.currentTarget && !reprocessandoArquivoId) {
              setArquivoParaReprocessar(null);
            }
          }}
        >
          <div
            className="login-card"
            style={{ width: '100%', maxWidth: '520px', margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <RefreshCw size={24} style={{ color: 'var(--brand-primary, #38bdf8)' }} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  Reprocessar Arquivo com outra IA
                </h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Recupere apenas este arquivo sem perder os dados já consolidados do lote.
                </p>
              </div>
            </div>

            {/* Detalhes do arquivo e da falha */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Arquivo: <code>{arquivoParaReprocessar.nomeArquivo}</code>
              </div>
              {arquivoParaReprocessar.mensagemErro && (
                <div style={{ fontSize: '0.78rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 8px', borderRadius: '4px' }}>
                  <strong>Motivo da falha:</strong> {arquivoParaReprocessar.mensagemErro}
                </div>
              )}
            </div>

            {/* Lista das IAs disponíveis para escolher para este arquivo */}
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Selecione a IA para reprocessar este arquivo:
              </label>

              {statusIa?.configuracoes && statusIa.configuracoes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {statusIa.configuracoes.map((cfg) => {
                    const isSelected = provedorIaSelecionado === cfg.provedor;
                    const nomeAmigavel =
                      cfg.provedor === 'GEMINI'
                        ? 'Google Gemini'
                        : cfg.provedor === 'DEEPSEEK'
                        ? 'DeepSeek'
                        : cfg.provedor === 'OPENAI'
                        ? 'OpenAI (ChatGPT)'
                        : cfg.provedor === 'OPENROUTER'
                        ? 'OpenRouter'
                        : 'Anthropic (Claude)';

                    return (
                      <button
                        key={cfg.provedor}
                        type="button"
                        onClick={() => {
                          salvarPreferenciaIa(
                            cfg.provedor,
                            cfg.modelo || (cfg.provedor === 'DEEPSEEK' ? 'deepseek-chat' : 'gemini-3.8-flash')
                          );
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: isSelected ? '2px solid var(--brand-primary)' : '1px solid var(--border-color)',
                          background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-secondary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                            {nomeAmigavel}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            Modelo: <code>{cfg.modelo}</code> • Chave: <code>{cfg.chaveMascarada}</code>
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 size={16} style={{ color: 'var(--brand-primary)' }} />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Usando a IA padrão configurada no servidor ({provedorIaSelecionado} - {modeloIaSelecionado}).
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <button
                type="button"
                disabled={Boolean(reprocessandoArquivoId) || Boolean(excluindoArquivoId)}
                onClick={() => handleExcluirArquivo(arquivoParaReprocessar.id, arquivoParaReprocessar.nomeArquivo)}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                title="Excluir este arquivo do lote de importação"
              >
                <Trash2 size={14} className={excluindoArquivoId === arquivoParaReprocessar.id ? 'spin' : ''} />
                {excluindoArquivoId === arquivoParaReprocessar.id ? 'Excluindo...' : 'Excluir Arquivo'}
              </button>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(reprocessandoArquivoId) || Boolean(excluindoArquivoId)}
                  onClick={() => setArquivoParaReprocessar(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(reprocessandoArquivoId) || Boolean(excluindoArquivoId)}
                  onClick={() => {
                    executarReprocessamentoArquivoIndividualComIa(
                      arquivoParaReprocessar.id,
                      provedorIaSelecionado,
                      modeloIaSelecionado
                    );
                  }}
                >
                  {reprocessandoArquivoId ? (
                    <>
                      <RefreshCw size={14} className="spin" /> Reprocessando com {provedorIaSelecionado}...
                    </>
                  ) : (
                    `Reprocessar com ${provedorIaSelecionado}`
                  )}
                </button>
              </div>
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

      {/* 2.5 TASK-41: Alertas Inteligentes de Conciliação e Lacunas de Faturas/Extratos */}
      {alertasConciliacao.length > 0 && (
        <div
          className="card"
          style={{
            border: '1px solid rgba(245, 158, 11, 0.4)',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', fontWeight: 700, fontSize: '0.92rem' }}>
              <Bell size={18} />
              Alertas de Conciliação: Lacunas e Faturas Pendentes ({alertasConciliacao.length})
            </div>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Identificado automaticamente pela auditoria de continuidade temporal
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {alertasConciliacao.map((alerta) => (
              <div
                key={alerta.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: '240px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#fef3c7' }}>
                    {alerta.titulo}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {alerta.descricao}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Competência: <strong>{alerta.competencia}</strong> • Criado em: {new Date(alerta.criadoEm).toLocaleDateString()}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ fontSize: '0.76rem', padding: '6px 12px', minHeight: '32px' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadCloud size={14} /> Importar Arquivo
                  </button>

                  <button
                    type="button"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.76rem',
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      minHeight: '32px',
                    }}
                    onClick={() => {
                      setAlertaParaDispensar(alerta);
                      setMotivoDispensaSelecionado('SEM_GASTOS');
                    }}
                  >
                    Dispensar
                  </button>
                </div>
              </div>
            ))}
          </div>
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

        <button
          type="button"
          onClick={() => setVisualizacaoAba('arquivos')}
          style={{
            background: visualizacaoAba === 'arquivos' ? 'var(--bg-surface)' : 'transparent',
            border: visualizacaoAba === 'arquivos' ? '1px solid var(--border-card)' : 'none',
            color: visualizacaoAba === 'arquivos' ? 'var(--brand-primary)' : 'var(--text-secondary)',
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
          <Database size={15} /> Arquivos Catalogados ({historicoArquivos.length})
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
              {/* Card Consolidado: Progresso Multi-Worker com 4 Barras de Status Reais do Banco de Dados */}
              {(() => {
                const totalArqs = loteAtivo.totalArquivos || loteAtivo.arquivos?.length || 0;
                const m = loteAtivo.metricasProgresso;

                const progUpload = {
                  concluido: m?.upload?.concluido ?? totalArqs,
                  total: m?.upload?.total ?? totalArqs,
                  porcentagem: 100,
                };

                const arqsIa = loteAtivo.arquivos?.filter((a) =>
                  ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(a.status)
                ).length ?? 0;
                const progIa = {
                  concluido: m?.ia?.concluido ?? arqsIa,
                  total: m?.ia?.total ?? totalArqs,
                  porcentagem: m?.ia?.porcentagem ?? (totalArqs > 0 ? Math.round((arqsIa / totalArqs) * 100) : 0),
                };

                const arqsStaging = loteAtivo.arquivos?.filter((a) =>
                  ['STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(a.status)
                ).length ?? 0;
                const progStaging = {
                  concluido: m?.staging?.concluido ?? arqsStaging,
                  total: m?.staging?.total ?? totalArqs,
                  porcentagem: m?.staging?.porcentagem ?? (totalArqs > 0 ? Math.round((arqsStaging / totalArqs) * 100) : 0),
                  totalLinhas: m?.staging?.totalLinhas ?? itensStaging.length,
                };

                const arqsConsolidados = loteAtivo.arquivos?.filter(
                  (a) => a.status === 'PROCESSADO_FINAL'
                ).length ?? 0;
                const progConsolidacao = {
                  concluido: m?.consolidacao?.concluido ?? arqsConsolidados,
                  total: m?.consolidacao?.total ?? totalArqs,
                  porcentagem: m?.consolidacao?.porcentagem ?? (totalArqs > 0 ? Math.round((arqsConsolidados / totalArqs) * 100) : 0),
                  linhasConsolidadas: m?.consolidacao?.linhasConsolidadas ?? itensStaging.filter((i) => i.statusProcessamento === 'PROCESSADO' || i.statusProcessamento === 'IGNORADO').length,
                  totalLinhas: m?.consolidacao?.totalLinhas ?? itensStaging.length,
                };

                return (
                  <div className="card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          Lote Ativo em Execução Contínua:
                        </span>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92rem', fontWeight: 800, color: 'var(--brand-primary)' }}>
                          {loteAtivo.id}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Status Geral:</span>
                        <span className={`badge ${loteAtivo.status === 'CONCLUIDO' ? 'badge-verde' : loteAtivo.status === 'ERRO_TOTAL' ? 'badge-vermelho' : 'badge-blue'}`}>
                          {loteAtivo.status}
                        </span>
                      </div>
                    </div>

                    {/* 4 Barras de Progresso Independentes dos Workers */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                      {/* 1. Upload */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--status-green)' }}>
                            1. Upload & Storage
                          </span>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {progUpload.concluido} de {progUpload.total} ({progUpload.porcentagem}%)
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '7px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${progUpload.porcentagem}%`, height: '100%', background: 'var(--status-green)', transition: 'width 0.3s ease' }} />
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Recepcionado no servidor
                        </span>
                      </div>

                      {/* 2. Extração IA */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brand-primary)' }}>
                            2. Extração IA
                          </span>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {progIa.concluido} de {progIa.total} ({progIa.porcentagem}%)
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '7px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${progIa.porcentagem}%`, height: '100%', background: 'var(--brand-primary)', transition: 'width 0.3s ease' }} />
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {progIa.concluido === progIa.total && progIa.total > 0 ? 'Todos os arquivos extraídos' : 'Processamento sequencial por arquivo'}
                        </span>
                      </div>

                      {/* 3. Carga Staging */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brand-secondary)' }}>
                            3. Carga Staging
                          </span>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {progStaging.concluido} de {progStaging.total} ({progStaging.porcentagem}%)
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '7px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${progStaging.porcentagem}%`, height: '100%', background: 'var(--brand-secondary)', transition: 'width 0.3s ease' }} />
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {progStaging.totalLinhas} linhas em staging
                        </span>
                      </div>

                      {/* 4. Consolidação */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--status-green)' }}>
                            4. Consolidação
                          </span>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {progConsolidacao.concluido} de {progConsolidacao.total} ({progConsolidacao.porcentagem}%)
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '7px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${progConsolidacao.porcentagem}%`, height: '100%', background: 'var(--status-green)', transition: 'width 0.3s ease' }} />
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {progConsolidacao.linhasConsolidadas} lançamentos no extrato
                        </span>
                      </div>
                    </div>

                    {/* Botões de Ação de Contingência (Retentativa Manual) */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px',
                      alignItems: 'center',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px dashed var(--border-subtle)',
                    }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertTriangle size={13} /> Contingência / Disparo Manual (se necessário):
                      </span>
                      <button
                        type="button"
                        disabled={processandoAcao}
                        onClick={handleProcessarEtapaIa}
                        style={{
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--brand-primary)',
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {processandoAcao ? 'Processando...' : `Re-executar IA (${provedorIaSelecionado})`}
                      </button>
                      <button
                        type="button"
                        disabled={processandoAcao}
                        onClick={handleCarregarStaging}
                        style={{
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--brand-secondary)',
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Re-executar Staging
                      </button>
                      <button
                        type="button"
                        disabled={processandoAcao}
                        onClick={handleConsolidarNegocio}
                        style={{
                          background: 'rgba(34, 197, 94, 0.1)',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          color: 'var(--status-green)',
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Re-executar Consolidação
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Seletor de Telas de Detalhes dos Workers */}
              <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
                <button
                  type="button"
                  onClick={() => setWorkerDetalheAba('resumo')}
                  style={{
                    background: workerDetalheAba === 'resumo' ? 'var(--bg-surface)' : 'transparent',
                    border: workerDetalheAba === 'resumo' ? '1px solid var(--border-card)' : 'none',
                    color: workerDetalheAba === 'resumo' ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  Visão Consolidada ({loteAtivo.arquivos?.length || 0} arquivos)
                </button>
                <button
                  type="button"
                  onClick={() => setWorkerDetalheAba('ia')}
                  style={{
                    background: workerDetalheAba === 'ia' ? 'var(--bg-surface)' : 'transparent',
                    border: workerDetalheAba === 'ia' ? '1px solid var(--border-card)' : 'none',
                    color: workerDetalheAba === 'ia' ? 'var(--brand-primary)' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  Worker 1: Extração IA
                </button>
                <button
                  type="button"
                  onClick={() => setWorkerDetalheAba('staging')}
                  style={{
                    background: workerDetalheAba === 'staging' ? 'var(--bg-surface)' : 'transparent',
                    border: workerDetalheAba === 'staging' ? '1px solid var(--border-card)' : 'none',
                    color: workerDetalheAba === 'staging' ? 'var(--brand-secondary)' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  Worker 2: Tabela Staging ({itensStaging.length} linhas)
                </button>
                <button
                  type="button"
                  onClick={() => setWorkerDetalheAba('consolidacao')}
                  style={{
                    background: workerDetalheAba === 'consolidacao' ? 'var(--bg-surface)' : 'transparent',
                    border: workerDetalheAba === 'consolidacao' ? '1px solid var(--border-card)' : 'none',
                    color: workerDetalheAba === 'consolidacao' ? 'var(--status-green)' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  Worker 3: Consolidação
                </button>
              </div>

              {/* Sub-Aba 1: Visão Consolidada de Todos os Arquivos com progresso granular */}
              {workerDetalheAba === 'resumo' && (
                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                      Arquivos do Lote ({loteAtivo.arquivos?.length || 0})
                    </h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Total Finalizados: {loteAtivo.arquivosProcessados} / {loteAtivo.totalArquivos}
                    </span>
                  </div>

                  {!loteAtivo.arquivos || loteAtivo.arquivos.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                      Nenhum arquivo cadastrado neste lote.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {loteAtivo.arquivos.map((arq) => {
                        const stats = arq.stagingStats;
                        return (
                          <div
                            key={arq.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 14px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'rgba(30, 41, 59, 0.45)',
                              border: '1px solid var(--border-subtle)',
                              gap: '12px',
                              flexWrap: 'wrap',
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

                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                              {stats && stats.totalLinhas > 0 && (
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
                                  <span>{stats.totalLinhas} linhas</span>
                                  {stats.processado > 0 && (
                                    <span style={{ color: 'var(--status-green)', marginLeft: '6px' }}>
                                      • {stats.processado} consolidadas
                                    </span>
                                  )}
                                  {stats.ignorado > 0 && (
                                    <span style={{ color: 'var(--status-yellow)', marginLeft: '6px' }}>
                                      • {stats.ignorado} dup
                                    </span>
                                  )}
                                </div>
                              )}
                              <div>
                                {arq.status === 'ERRO' ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {arq.mensagemErro?.includes('não oferece suporte a imagens') ? (
                                      <span
                                        className="badge"
                                        style={{
                                          background: 'rgba(234, 179, 8, 0.2)',
                                          color: '#fef08a',
                                          border: '1px solid rgba(234, 179, 8, 0.4)',
                                        }}
                                      >
                                        Mídia Incompatível
                                      </span>
                                    ) : (
                                      <span className="badge badge-vermelho">Erro</span>
                                    )}
                                    <button
                                      type="button"
                                      disabled={reprocessandoArquivoId === arq.id || excluindoArquivoId === arq.id}
                                      onClick={() => {
                                        setArquivoParaReprocessar({
                                          id: arq.id,
                                          nomeArquivo: arq.nomeArquivo,
                                          mensagemErro: arq.mensagemErro,
                                        });
                                      }}
                                      style={{
                                        background: 'rgba(239, 68, 68, 0.15)',
                                        border: '1px solid rgba(239, 68, 68, 0.4)',
                                        color: '#f87171',
                                        borderRadius: 'var(--radius-sm)',
                                        padding: '3px 7px',
                                        fontSize: '0.72rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <RefreshCw size={11} className={reprocessandoArquivoId === arq.id ? 'spin' : ''} />
                                      Reprocessar IA
                                    </button>
                                    <button
                                      type="button"
                                      disabled={reprocessandoArquivoId === arq.id || excluindoArquivoId === arq.id}
                                      onClick={() => handleExcluirArquivo(arq.id, arq.nomeArquivo)}
                                      style={{
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        border: '1px solid rgba(239, 68, 68, 0.25)',
                                        color: '#fca5a5',
                                        borderRadius: 'var(--radius-sm)',
                                        padding: '3px 7px',
                                        fontSize: '0.72rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                      title="Excluir arquivo com erro do lote"
                                    >
                                      <Trash2 size={11} className={excluindoArquivoId === arq.id ? 'spin' : ''} />
                                      {excluindoArquivoId === arq.id ? 'Excluindo...' : 'Excluir'}
                                    </button>
                                  </div>
                                ) : (
                                  getBadgeStatusArquivo(arq.status)
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Sub-Aba 2: Detalhes do Worker 1 (Extração IA) */}
              {workerDetalheAba === 'ia' && (
                <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Sparkles size={16} color="var(--brand-primary)" /> Detalhes da Extração por IA (Worker 1)
                    </h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Processa 1 arquivo por vez de forma sequencial
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {loteAtivo.arquivos?.map((arq, idx) => (
                      <div
                        key={arq.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                          background: 'rgba(15, 23, 42, 0.4)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                            #{idx + 1} - {arq.nomeArquivo}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {arq.mimeType || 'Documento'} • Status da IA: {arq.status}
                          </div>
                          {arq.mensagemErro && (
                            <div style={{ fontSize: '0.74rem', color: 'var(--status-red)', marginTop: '2px' }}>
                              Erro: {arq.mensagemErro}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(arq.status) ? (
                            <span className="badge badge-verde">Extraído com Sucesso</span>
                          ) : arq.status === 'ENVIADO_IA' ? (
                            <span className="badge badge-blue">Processando Agora...</span>
                          ) : arq.status === 'ERRO' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {arq.mensagemErro?.includes('não oferece suporte a imagens') ? (
                                <span
                                  className="badge"
                                  style={{
                                    background: 'rgba(234, 179, 8, 0.2)',
                                    color: '#fef08a',
                                    border: '1px solid rgba(234, 179, 8, 0.4)',
                                  }}
                                >
                                  Mídia Incompatível
                                </span>
                              ) : (
                                <span className="badge badge-vermelho">Falha</span>
                              )}
                              <button
                                type="button"
                                disabled={reprocessandoArquivoId === arq.id || excluindoArquivoId === arq.id}
                                onClick={() => {
                                  setArquivoParaReprocessar({
                                    id: arq.id,
                                    nomeArquivo: arq.nomeArquivo,
                                    mensagemErro: arq.mensagemErro,
                                  });
                                }}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  border: '1px solid rgba(239, 68, 68, 0.4)',
                                  color: '#f87171',
                                  borderRadius: 'var(--radius-sm)',
                                  padding: '4px 8px',
                                  fontSize: '0.74rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                                title="Reprocessar este arquivo escolhendo outra IA"
                              >
                                <RefreshCw size={12} className={reprocessandoArquivoId === arq.id ? 'spin' : ''} />
                                {reprocessandoArquivoId === arq.id ? 'Reprocessando...' : 'Reprocessar com outra IA'}
                              </button>
                              <button
                                type="button"
                                disabled={reprocessandoArquivoId === arq.id || excluindoArquivoId === arq.id}
                                onClick={() => handleExcluirArquivo(arq.id, arq.nomeArquivo)}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  border: '1px solid rgba(239, 68, 68, 0.25)',
                                  color: '#fca5a5',
                                  borderRadius: 'var(--radius-sm)',
                                  padding: '4px 8px',
                                  fontSize: '0.74rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                                title="Excluir este arquivo com erro do lote"
                              >
                                <Trash2 size={12} className={excluindoArquivoId === arq.id ? 'spin' : ''} />
                                {excluindoArquivoId === arq.id ? 'Excluindo...' : 'Excluir'}
                              </button>
                            </div>
                          ) : (
                            <span className="badge badge-amarelo">Aguardando Fila</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-Aba 3: Detalhes do Worker 2 (Tabela Staging) */}
              {workerDetalheAba === 'staging' && (
                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Database size={16} color="var(--brand-secondary)" />
                      Registros Extraídos em Staging ({itensStaging.length})
                    </h3>
                  </div>

                  {itensStaging.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                      Nenhum registro carregado na tabela de staging ainda. O Worker 2 carrega cada arquivo automaticamente assim que a IA conclui a leitura.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                            <th style={{ padding: '8px 6px' }}>Arquivo</th>
                            <th style={{ padding: '8px 6px' }}>Data</th>
                            <th style={{ padding: '8px 6px' }}>Descrição</th>
                            <th style={{ padding: '8px 6px' }}>Valor</th>
                            <th style={{ padding: '8px 6px' }}>Conta Sugerida</th>
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
                              <td style={{ padding: '8px 6px' }}>{item.contaSugerida || 'Auto-Cadastrar'}</td>
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
                  )}
                </div>
              )}

              {/* Sub-Aba 4: Detalhes do Worker 3 (Consolidação) */}
              {workerDetalheAba === 'consolidacao' && (
                <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ShieldCheck size={16} color="var(--status-green)" />
                      Worker 3: Consolidação e Regras de Negócio
                    </h3>
                  </div>

                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    O Worker 3 consolida cada arquivo à medida que entra na tabela de Staging, executando deduplicação por hash determinística (Dedupe), auto-cadastro de contas bancárias/cartões sem interrupção e conversão de pagamentos de fatura em transferências internas.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginTop: '6px' }}>
                    <div style={{ background: 'rgba(15, 23, 42, 0.5)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Linhas Processadas</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--status-green)' }}>
                        {itensStaging.filter((i) => i.statusProcessamento === 'PROCESSADO').length}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(15, 23, 42, 0.5)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Duplicatas Ignoradas</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--status-yellow)' }}>
                        {itensStaging.filter((i) => i.statusProcessamento === 'IGNORADO').length}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(15, 23, 42, 0.5)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pendentes de Consolidação</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--brand-primary)' }}>
                        {itensStaging.filter((i) => i.statusProcessamento === 'PENDENTE').length}
                      </div>
                    </div>
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

      {/* 9. Aba 4: Histórico Estruturado de Arquivos Catalogados (TASK-41) */}
      {visualizacaoAba === 'arquivos' && (
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <h3 style={{ fontSize: '0.98rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={18} color="var(--brand-primary)" />
              Histórico Estruturado de Arquivos Importados
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Metadados analíticos e conciliação temporal ({historicoArquivos.length} arquivos)
            </span>
          </div>

          {historicoArquivos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
              Nenhum arquivo catalogado analiticamente até o momento. Processe um lote de faturas ou extratos para gerar o catálogo.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-card)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Instituição</th>
                    <th style={{ padding: '8px 10px' }}>Tipo Documento</th>
                    <th style={{ padding: '8px 10px' }}>Competência</th>
                    <th style={{ padding: '8px 10px' }}>Período Coberto</th>
                    <th style={{ padding: '8px 10px' }}>Conta Vinculada</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Qtd Itens</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Valor Total</th>
                    <th style={{ padding: '8px 10px' }}>Arquivo de Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {historicoArquivos.map((hist) => (
                    <tr
                      key={hist.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        backgroundColor: 'rgba(30, 41, 59, 0.25)',
                      }}
                    >
                      <td style={{ padding: '10px', fontWeight: 700, color: '#f8fafc' }}>
                        {hist.instituicao}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span
                          className={`badge ${
                            hist.tipoDocumento === 'FATURA_CARTAO'
                              ? 'badge-purple'
                              : hist.tipoDocumento === 'EXTRATO_INVESTIMENTO'
                              ? 'badge-green'
                              : 'badge-blue'
                          }`}
                        >
                          {hist.tipoDocumento.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                        {hist.competencia}
                      </td>
                      <td style={{ padding: '10px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        {hist.periodoInicio ? new Date(hist.periodoInicio).toLocaleDateString() : 'N/A'} até{' '}
                        {hist.periodoFim ? new Date(hist.periodoFim).toLocaleDateString() : 'N/A'}
                      </td>
                      <td style={{ padding: '10px', color: hist.conta?.nome ? 'var(--brand-primary)' : 'var(--text-muted)' }}>
                        {hist.conta?.nome || 'Não vinculada'}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>
                        {hist.totalTransacoes}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        R$ {Number(hist.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '10px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                        {hist.arquivo?.nomeArquivo || 'Arquivo consolidado'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal de Dispensa de Alerta de Conciliação */}
      {alertaParaDispensar && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '460px',
              padding: '24px',
              border: '1px solid var(--border-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={18} color="#fbbf24" /> Dispensar Alerta de Conciliação
              </h3>
              <button
                type="button"
                onClick={() => setAlertaParaDispensar(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                &times;
              </button>
            </div>

            <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              <strong>{alertaParaDispensar.titulo}</strong>
              <div style={{ marginTop: '4px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {alertaParaDispensar.descricao}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Selecione o motivo da dispensa:
              </label>
              <select
                className="input"
                value={motivoDispensaSelecionado}
                onChange={(e) => setMotivoDispensaSelecionado(e.target.value)}
                style={{ fontSize: '0.85rem', width: '100%' }}
              >
                <option value="SEM_GASTOS">Não houve gastos/movimentações nesta competência</option>
                <option value="CONTA_ENCERRADA">Conta ou cartão cancelado/encerrado (não alertar mais)</option>
                <option value="DOCUMENTO_INDISPONIVEL">Extrato ou fatura indisponível no banco</option>
                <option value="OUTRO">Outro motivo</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setAlertaParaDispensar(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: '0.84rem',
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="btn-primary"
                style={{ fontSize: '0.84rem', padding: '8px 18px' }}
                onClick={async () => {
                  try {
                    await apiService.dispensarAlertaConciliacao(
                      alertaParaDispensar.id,
                      motivoDispensaSelecionado
                    );
                    setAlertaParaDispensar(null);
                    setMensagemSucesso('Alerta dispensado com sucesso.');
                    carregarAlertasEHistorico();
                  } catch (err: any) {
                    setMensagemErro(err.message || 'Falha ao dispensar alerta.');
                  }
                }}
              >
                Confirmar Dispensa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

