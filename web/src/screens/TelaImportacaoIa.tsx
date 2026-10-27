import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Search,
  Eye,
  X,
  Filter,
} from 'lucide-react';
import {
  apiService,
  LoteImportacaoItem,
  ArquivoImportacaoItem,
  StagingLancamentoItem,
  StatusLoteImportacao,
  StatusIaResponse,
  AlertaConciliacaoItem,
  HistoricoImportacaoArquivoItem,
  TentativaArquivoImportacaoItem,
  UploadImportacaoResponse,
  DetalhesLancamentosArquivoResponse,
  ProvedorIa,
  ProvedorIaInfo,
  PROVEDORES_IA_CATALOGO_OFFLINE,
  modeloPadraoDoProvedor,
  nomeAmigavelDoProvedor,
  IaMediaConsolidadaItem,
} from '../api.ts';
import { ConfiguracaoIaCard } from '../components/ConfiguracaoIaCard.tsx';

interface TelaImportacaoIaProps {
  usuarioId?: string;
  onNovasContasOuMovimentos?: () => void;
  onNavigateTab?: (tab: any) => void;
}

/** Opção de provedor de IA já enriquecida com o estado de configuração do usuário. */
interface ProvedorIaOpcao extends ProvedorIaInfo {
  modeloConfigurado?: string;
  chaveMascarada?: string;
}

/** Aviso curto exibido para provedores ainda não implementados no fluxo de importação. */
const AVISO_PROVEDOR_NAO_SUPORTADO =
  'Ainda não suportado neste fluxo — use Gemini, DeepSeek ou OpenRouter';

/**
 * `false` somente quando o provedor está explicitamente fora do fluxo de importação
 * por IA (`suportadoNoFluxo === false`). Campo ausente/undefined é tratado como
 * suportado, para não bloquear provedores quando o backend é antigo.
 */
const ehProvedorSuportadoNoFluxo = (prov?: { suportadoNoFluxo?: boolean } | null): boolean =>
  prov?.suportadoNoFluxo !== false;

/** Mesma regra, resolvendo o provedor pelo `id` no catálogo offline. */
const idProvedorSuportadoNoFluxo = (id?: string | null): boolean => {
  if (!id) return true;
  const item = PROVEDORES_IA_CATALOGO_OFFLINE.find(p => p.id === id);
  return ehProvedorSuportadoNoFluxo(item);
};

/**
 * Seletor de modelo reutilizável: lista os modelos do catálogo do provedor (API)
 * + campo livre para slugs abertos (ex.: `vendor/model` do OpenRouter).
 */
const SeletorModeloIa: React.FC<{
  provedor: ProvedorIa | string;
  modelo: string;
  modelos: string[];
  onChange: (modelo: string) => void;
  compacto?: boolean;
}> = ({ provedor, modelo, modelos, onChange, compacto = false }) => {
  const catalogo = modelos.length > 0 ? modelos : [modeloPadraoDoProvedor(provedor)];
  const noCatalogo = catalogo.includes(modelo);
  const inputId = `modelo-ia-${provedor}-${compacto ? 'c' : 'n'}`;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
      onClick={e => e.stopPropagation()}
    >
      <select
        className="form-select"
        value={noCatalogo ? modelo : ''}
        onChange={e => {
          if (e.target.value) onChange(e.target.value);
        }}
        style={{
          fontSize: compacto ? '0.72rem' : '0.78rem',
          padding: compacto ? '3px 6px' : '5px 8px',
          minWidth: '150px',
        }}
        title="Modelos conhecidos do provedor"
      >
        <option value="">{noCatalogo ? 'Catálogo...' : 'Personalizado'}</option>
        {catalogo.map(m => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        id={inputId}
        className="input"
        type="text"
        value={modelo}
        onChange={e => onChange(e.target.value)}
        placeholder={
          provedor === 'OPENROUTER' ? 'vendor/model (ex: deepseek/deepseek-chat)' : 'slug do modelo'
        }
        style={{
          fontSize: compacto ? '0.72rem' : '0.78rem',
          padding: compacto ? '3px 6px' : '5px 8px',
          minWidth: '190px',
          fontFamily: 'var(--font-mono)',
        }}
        title={
          provedor === 'OPENROUTER'
            ? 'OpenRouter exige o slug completo vendor/model'
            : 'Modelo efetivo'
        }
      />
    </div>
  );
};

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

  // Estados de visualização analítica e consulta de lançamentos do arquivo importado
  const [arquivoLancamentosModal, setArquivoLancamentosModal] = useState<DetalhesLancamentosArquivoResponse | null>(null);
  const [carregandoLancamentosArquivoId, setCarregandoLancamentosArquivoId] = useState<string | null>(null);
  const [filtroHistoricoBusca, setFiltroHistoricoBusca] = useState<string>('');
  const [filtroHistoricoTipo, setFiltroHistoricoTipo] = useState<string>('TODOS');
  const [abaModalLancamentos, setAbaModalLancamentos] = useState<'movimentos' | 'staging' | 'tentativas'>('movimentos');

  // Validação prévia de configuração da IA e seleção no lote / reprocessamento
  const [statusIa, setStatusIa] = useState<StatusIaResponse | null>(null);
  const [mediasConsolidadasIa, setMediasConsolidadasIa] = useState<IaMediaConsolidadaItem[]>([]);
  const [modalConfigIaAberto, setModalConfigIaAberto] = useState(false);
  const [modalEscolhaIaAberto, setModalEscolhaIaAberto] = useState(false);
  const [provedorIaSelecionado, setProvedorIaSelecionado] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const salvo = localStorage.getItem('evolvi_provedor_ia_ativo');
      // Provedor salvo que não opera neste fluxo (ex.: OPENAI/ANTHROPIC) → padrão GEMINI.
      if (salvo && idProvedorSuportadoNoFluxo(salvo)) return salvo;
    }
    return 'GEMINI';
  });
  const [modeloIaSelecionado, setModeloIaSelecionado] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const salvo = localStorage.getItem('evolvi_modelo_ia_ativo');
      if (salvo) return salvo;
    }
    return modeloPadraoDoProvedor('GEMINI');
  });
  // Marca se o usuário já escolheu explicitamente a IA/provedor para este processamento
  const [escolhaIaExplicita, setEscolhaIaExplicita] = useState(false);

  const salvarPreferenciaIa = (provedor: string, modelo?: string) => {
    const mod = modelo || modeloPadraoDoProvedor(provedor);
    setProvedorIaSelecionado(provedor);
    setModeloIaSelecionado(mod);
    setEscolhaIaExplicita(true);
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

  // TASK-50: Alerta de duplicidade no upload e histórico de tentativas por arquivo
  const [alertaDuplicidade, setAlertaDuplicidade] = useState<UploadImportacaoResponse | null>(null);
  const [confirmandoReprocessamento, setConfirmandoReprocessamento] = useState(false);
  const [arquivoTentativasAberto, setArquivoTentativasAberto] = useState<string | null>(null);
  const [tentativasPorArquivo, setTentativasPorArquivo] = useState<
    Record<string, TentativaArquivoImportacaoItem[]>
  >({});
  const [carregandoTentativasId, setCarregandoTentativasId] = useState<string | null>(null);

  // TASK-51: Filtros de status e nome para os arquivos do lote
  const [filtroStatusArquivo, setFiltroStatusArquivo] = useState<string>('TODOS');
  const [filtroNomeArquivo, setFiltroNomeArquivo] = useState<string>('');

  // TASK-51: Derivação determinística estável e memoizada dos arquivos do lote
  const arquivosDoLoteFiltrados = useMemo(() => {
    if (!loteAtivo?.arquivos || loteAtivo.arquivos.length === 0) {
      return [];
    }

    // 1. Ordenação estável e determinística por criadoEm (asc) com desempate por id (asc)
    const ordenados = [...loteAtivo.arquivos].sort((a, b) => {
      const dataA = a.criadoEm ? new Date(a.criadoEm).getTime() : 0;
      const dataB = b.criadoEm ? new Date(b.criadoEm).getTime() : 0;
      if (dataA !== dataB) return dataA - dataB;
      return (a.id || '').localeCompare(b.id || '');
    });

    // 2. Aplicação de filtros combinados (AND)
    return ordenados.filter((arq) => {
      // Filtro de status
      if (filtroStatusArquivo !== 'TODOS' && arq.status !== filtroStatusArquivo) {
        return false;
      }

      // Filtro de nome (case-insensitive e sem diacríticos/acentos)
      if (filtroNomeArquivo.trim()) {
        const termoBusca = filtroNomeArquivo
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
        const nomeNorm = (arq.nomeArquivo || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        if (!nomeNorm.includes(termoBusca)) {
          return false;
        }
      }

      return true;
    });
  }, [loteAtivo?.arquivos, filtroStatusArquivo, filtroNomeArquivo]);

  // Derivação e filtragem da tabela consolidada de arquivos importados
  const historicoArquivosFiltrados = useMemo(() => {
    return historicoArquivos.filter((hist) => {
      if (filtroHistoricoTipo !== 'TODOS' && hist.tipoDocumento !== filtroHistoricoTipo) {
        return false;
      }
      if (filtroHistoricoBusca.trim()) {
        const termo = filtroHistoricoBusca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const instituicaoNorm = (hist.instituicao || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const nomeArquivoNorm = (hist.arquivo?.nomeArquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const contaNorm = (hist.conta?.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const competenciaNorm = (hist.competencia || '').toLowerCase();

        if (
          !instituicaoNorm.includes(termo) &&
          !nomeArquivoNorm.includes(termo) &&
          !contaNorm.includes(termo) &&
          !competenciaNorm.includes(termo)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [historicoArquivos, filtroHistoricoTipo, filtroHistoricoBusca]);

  // Carrega e abre o modal de lançamentos de um arquivo importado
  const abrirModalLancamentosArquivo = async (arquivoId: string) => {
    try {
      setCarregandoLancamentosArquivoId(arquivoId);
      setAbaModalLancamentos('movimentos');
      const dados = await apiService.getLancamentosArquivoImportado(arquivoId);
      setArquivoLancamentosModal(dados);
    } catch (err: any) {
      setMensagemErro(err.message || 'Falha ao buscar os lançamentos deste arquivo.');
    } finally {
      setCarregandoLancamentosArquivoId(null);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const onNovasContasRef = useRef(onNovasContasOuMovimentos);
  onNovasContasRef.current = onNovasContasOuMovimentos;

  // Consulta o status da IA no servidor e localmente, além das médias consolidadas (TASK-52)
  const verificarStatusIa = useCallback(async () => {
    try {
      const [res, resMedias] = await Promise.all([
        apiService.getStatusIa(),
        apiService.getIaMediasConsolidadas(),
      ]);
      setStatusIa(res);
      if (resMedias && resMedias.itens) {
        setMediasConsolidadasIa(resMedias.itens);
      }
      if (res.configuracoes && res.configuracoes.length > 0) {
        const salvoProv = typeof window !== 'undefined' ? localStorage.getItem('evolvi_provedor_ia_ativo') : null;
        const confSalva = salvoProv ? res.configuracoes.find((c) => c.provedor === salvoProv) : null;
        const configAtiva = confSalva || res.configuracoes[0];

        // Provedor salvo/ativo fora do fluxo (OPENAI/ANTHROPIC) não pode ser usado aqui:
        // cai na primeira configuração suportada e, na ausência dela, no padrão GEMINI.
        if (!idProvedorSuportadoNoFluxo(configAtiva.provedor)) {
          const confSuportada = res.configuracoes.find((c) => idProvedorSuportadoNoFluxo(c.provedor));
          setProvedorIaSelecionado(confSuportada?.provedor || 'GEMINI');
          setModeloIaSelecionado(
            confSuportada?.modelo || modeloPadraoDoProvedor(confSuportada?.provedor || 'GEMINI')
          );
          return;
        }

        setProvedorIaSelecionado(configAtiva.provedor);
        setModeloIaSelecionado(configAtiva.modelo || modeloPadraoDoProvedor(configAtiva.provedor));
      } else if (res.hasEnvKey) {
        setProvedorIaSelecionado('GEMINI');
        setModeloIaSelecionado(modeloPadraoDoProvedor('GEMINI'));
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

  /**
   * Catálogo de provedores para a UI: vem de statusIa.provedoresSuportados (API)
   * e é enriquecido com as configurações salvas. Nunca fica vazio — no pior caso
   * usa o catálogo offline, garantindo que OpenRouter apareça desde o 1º load.
   */
  const provedoresDisponiveis: ProvedorIaOpcao[] = (() => {
    const base =
      statusIa?.provedoresSuportados && statusIa.provedoresSuportados.length > 0
        ? statusIa.provedoresSuportados
        : PROVEDORES_IA_CATALOGO_OFFLINE;

    return base.map(prov => {
      const cfg = statusIa?.configuracoes?.find(c => c.provedor === prov.id);
      return {
        ...prov,
        modeloPadrao: prov.modeloPadrao || modeloPadraoDoProvedor(prov.id),
        nome: prov.nome || nomeAmigavelDoProvedor(prov.id),
        modeloConfigurado: cfg?.modelo,
        chaveMascarada: cfg?.chaveMascarada,
        configurado: Boolean(cfg) || Boolean(prov.configurado) || false,
        // Campo ausente = provedor suportado (compatibilidade com backend antigo).
        suportadoNoFluxo: ehProvedorSuportadoNoFluxo(prov),
      };
    });
  })();

  const provedorAtualOpcao =
    provedoresDisponiveis.find(p => p.id === provedorIaSelecionado) || null;

  /** Quantos provedores realmente podem operar neste fluxo (ignora os não suportados). */
  const totalProvedoresSuportadosNoFluxo = provedoresDisponiveis.filter(p =>
    ehProvedorSuportadoNoFluxo(p)
  ).length;

  /** O provedor atual está selecionável/processável neste fluxo de importação. */
  const provedorAtualSuportadoNoFluxo = ehProvedorSuportadoNoFluxo(provedorAtualOpcao);

  /** Provedor selecionado possui chave disponível (salva no banco) para uso imediato. */
  const provedorAtualConfigurado = Boolean(
    provedorAtualOpcao?.configurado ||
    provedorAtualOpcao?.temChaveServidor ||
    (provedorIaSelecionado === 'GEMINI' && statusIa?.hasEnvKey)
  );

  const nomeProvedorAtual = nomeAmigavelDoProvedor(provedorIaSelecionado);

  /** Abre o modal de configuração já focado no provedor escolhido. */
  const abrirConfiguracaoDoProvedor = (provedor: string) => {
    if (provedor !== provedorIaSelecionado) {
      salvarPreferenciaIa(provedor, modeloPadraoDoProvedor(provedor));
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('evolvi_ia_byok_provedor', provedor);
    }
    setModalConfigIaAberto(true);
  };

  /**
   * Capacidades de mídia do provedor selecionado.
   * Usa suportaImagens/suportaPdfsNaoEstruturados vindos da API; se ausentes,
   * cai no catálogo offline e, por último, assume suporte (evita bloquear sem prova).
   */
  const capacidadeProvedorAtual = (() => {
    const offline = PROVEDORES_IA_CATALOGO_OFFLINE.find(p => p.id === provedorIaSelecionado);
    const fonte = provedorAtualOpcao || offline;
    return {
      suportaImagens: fonte?.suportaImagens ?? true,
      suportaPdfsNaoEstruturados: fonte?.suportaPdfsNaoEstruturados ?? true,
    };
  })();

  /** Duração dos arquivos: imagem vs PDF não estruturado (para o pré-flight de mídia). */
  const classificarArquivosMidia = (files: File[]) => {
    const ehImagem = (f: File) => {
      const nome = f.name.toLowerCase();
      return (
        nome.endsWith('.png') ||
        nome.endsWith('.jpg') ||
        nome.endsWith('.jpeg') ||
        nome.endsWith('.webp') ||
        f.type.startsWith('image/')
      );
    };
    const ehPdf = (f: File) => f.name.toLowerCase().endsWith('.pdf') || f.type.includes('pdf');
    return {
      temImagens: files.some(ehImagem),
      temPdfs: files.some(ehPdf),
    };
  };

  const loteAtivoRef = useRef<LoteImportacaoItem | null>(null);
  loteAtivoRef.current = loteAtivo;

  // Carrega lista de lotes recentes
  const carregarLotes = useCallback(async (preferencialLoteId?: string) => {
    try {
      const res = await apiService.getLotesImportacao({ limite: 15 });
      setLotes(res.lotes || []);

      if (res.lotes && res.lotes.length > 0) {
        setLoteAtivo((prev) => {
          const targetId = preferencialLoteId || prev?.id;
          if (!targetId) return res.lotes[0];
          const atualizado = res.lotes.find((l) => l.id === targetId);
          if (!atualizado) return res.lotes[0];
          // TASK-51 Anti-Flicker: Se já temos os arquivos detalhados carregados, preserva-os
          // em vez de sobrescrever com o array simplificado do lote resumido se for o mesmo lote
          const mesmoLote = prev && prev.id === atualizado.id;
          return {
            ...atualizado,
            arquivos: mesmoLote && prev.arquivos && prev.arquivos.length > 0 ? prev.arquivos : atualizado.arquivos,
            metricasProgresso: mesmoLote && prev.metricasProgresso ? prev.metricasProgresso : atualizado.metricasProgresso,
          };
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
        carregarAlertasEHistorico();
      }, 1500);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [loteAtivo?.id, loteAtivo?.status, carregarDetalhesLoteAtivo, carregarLotes, carregarAlertasEHistorico]);

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

          onNovasContasRef.current?.();
        } catch (err) {
          console.warn('Erro ao processar evento transacao_consolidada SSE:', err);
        }
      });

      eventSource.addEventListener('arquivo_progresso', (e: MessageEvent) => {
        try {
          const dados = e.data ? JSON.parse(e.data) : null;
          const targetId = dados?.loteId || loteAtivoRef.current?.id;
          if (targetId) {
            carregarDetalhesLoteAtivo(targetId);
          }
          if (dados?.status === 'PROCESSADO_FINAL' || dados?.status === 'CONCLUIDO') {
            carregarAlertasEHistorico();
          }
        } catch {
          if (loteAtivoRef.current?.id) {
            carregarDetalhesLoteAtivo(loteAtivoRef.current.id);
          }
        }
      });

      eventSource.addEventListener('arquivo_consolidado', () => {
        try {
          carregarAlertasEHistorico();
        } catch (err) {
          console.warn('Erro ao processar evento arquivo_consolidado SSE:', err);
        }
      });

      eventSource.addEventListener('lote_concluido', (e: MessageEvent) => {
        try {
          const dados = JSON.parse(e.data);
          setMensagemSucesso(
            `Lote processado com sucesso! ${dados.totalTransacoesImportadas} transações integradas.`
          );
          const targetId = dados?.loteId || loteAtivoRef.current?.id;
          if (targetId) {
            carregarDetalhesLoteAtivo(targetId);
          }
          carregarLotes(targetId);
          carregarAlertasEHistorico();
          onNovasContasRef.current?.();
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
  }, [
    carregarDetalhesLoteAtivo,
    carregarLotes,
    carregarAlertasEHistorico,
  ]);

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
        `A Inteligência Artificial ainda não está configurada para extrair dados de faturas em PDF ou imagens. Configure a IA (Gemini, DeepSeek, OpenAI, Claude ou OpenRouter) primeiro para continuar.`
      );
      setModalConfigIaAberto(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    // Provedor selecionado sem chave + arquivos que dependem de IA:
    // bloqueia com orientação clara em vez de seguir silenciosamente sem chave.
    if (temArquivosNaoEstruturados && !provedorAtualConfigurado) {
      setMensagemErro(
        `A IA selecionada (${nomeProvedorAtual} — ${modeloIaSelecionado}) ainda não possui chave salva. Configure-a na seção de configuração de IA para importar PDFs e imagens.`
      );
      setModalConfigIaAberto(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    // Provedor fora do fluxo de importação por IA (ex.: OPENAI/ANTHROPIC): bloqueia
    // o upload em vez de deixar a extração falhar depois no backend.
    if (temArquivosNaoEstruturados && !provedorAtualSuportadoNoFluxo) {
      setMensagemErro(
        `A IA selecionada (${nomeProvedorAtual}) ainda não é suportada no fluxo de importação por IA. ${AVISO_PROVEDOR_NAO_SUPORTADO}.`
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    // Pre-flight Check de Mídia no Frontend (Upload):
    // Genérico por capacidade: usa suportaImagens/suportaPdfsNaoEstruturados do provedor
    // selecionado (vindos do catálogo da API), não mais um `=== 'DEEPSEEK'` hardcoded.
    const { temImagens, temPdfs } = classificarArquivosMidia(files);

    if (temImagens && !capacidadeProvedorAtual.suportaImagens) {
      setMensagemErro(
        `A IA selecionada (${nomeProvedorAtual} — ${modeloIaSelecionado}) não processa imagens (.png/.jpg). Escolha o Google Gemini, OpenAI, Claude ou OpenRouter para faturas em imagem, ou remova os arquivos de imagem do envio.`
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    if (temPdfs && !capacidadeProvedorAtual.suportaPdfsNaoEstruturados) {
      const confirma = window.confirm(
        `Aviso de Mídia: A IA selecionada (${nomeProvedorAtual}) não processa PDFs não estruturados/escaneados.\n\nRecomendamos Gemini, OpenAI, Claude ou OpenRouter para esse tipo de arquivo.\n\nDeseja continuar mesmo assim? PDFs sem texto extraível serão marcados como incompatíveis.`
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
    setAlertaDuplicidade(null);
    // Limpa a tela da importação anterior para não ficar travada com dados antigos
    setLoteAtivo(null);
    setItensStaging([]);
    setFeedAoVivo([]);
    setContasCriadasDetectadas([]);

    try {
      setUploadProgress(45);
      const origem: 'UPLOAD' | 'PASTA' = files.some(f => Boolean((f as any).webkitRelativePath))
        ? 'PASTA'
        : 'UPLOAD';

      const resultado = await apiService.uploadLoteImportacao(files, {
        provedorIa: provedorIaSelecionado,
        modeloIa: modeloIaSelecionado,
        origem,
      });
      setUploadProgress(100);

      // Transição automática para o monitor do lote recém-criado
      if (resultado.loteId) {
        await carregarDetalhesLoteAtivo(resultado.loteId);
        await carregarLotes(resultado.loteId);
        setVisualizacaoAba('pipeline');
      } else {
        await carregarLotes();
      }

      // TASK-50: duplicidade detectada → exige confirmação explícita do usuário
      if (resultado.requerConfirmacaoReprocessamento && (resultado.duplicados?.length ?? 0) > 0) {
        setAlertaDuplicidade(resultado);
        setMensagemSucesso(null);
      } else {
        setMensagemSucesso(
          `Lote criado com sucesso! ${resultado.totalArquivos} arquivo(s) recepcionado(s) na pasta temporária do servidor.`
        );
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

  // TASK-50: carrega o histórico de tentativas de um arquivo (timeline no monitor)
  const carregarTentativasArquivo = useCallback(async (arquivoId: string) => {
    setCarregandoTentativasId(arquivoId);
    try {
      const res = await apiService.getTentativasArquivo(arquivoId, { pagina: 1, limite: 50 });
      setTentativasPorArquivo(prev => ({ ...prev, [arquivoId]: res.tentativas || [] }));
    } catch (err: any) {
      console.warn('Erro ao carregar tentativas do arquivo:', err);
    } finally {
      setCarregandoTentativasId(null);
    }
  }, []);

  const alternarTentativasArquivo = async (arquivoId: string) => {
    if (arquivoTentativasAberto === arquivoId) {
      setArquivoTentativasAberto(null);
      return;
    }
    setArquivoTentativasAberto(arquivoId);
    await carregarTentativasArquivo(arquivoId);
  };

  // TASK-50: confirma o reprocessamento dos arquivos apontados como já importados
  const handleConfirmarReprocessamento = async () => {
    if (!alertaDuplicidade) return;
    setConfirmandoReprocessamento(true);
    setMensagemErro(null);
    try {
      const arquivosDuplicados = alertaDuplicidade.duplicados || [];
      for (const dup of arquivosDuplicados) {
        await apiService.confirmarReprocessamentoArquivo(dup.arquivoId);
      }
      await carregarLotes();
      if (alertaDuplicidade.loteId) {
        await carregarDetalhesLoteAtivo(alertaDuplicidade.loteId);
      }
      setMensagemSucesso(
        `Reprocessamento confirmado para ${arquivosDuplicados.length} arquivo(s). Eles já podem ser processados novamente pela IA.`
      );
      setAlertaDuplicidade(null);
    } catch (err: any) {
      setMensagemErro(
        err.message || 'Erro ao confirmar o reprocessamento dos arquivos duplicados.'
      );
    } finally {
      setConfirmandoReprocessamento(false);
    }
  };

  const handleDescartarAlertaDuplicidade = () => {
    setAlertaDuplicidade(null);
    setMensagemSucesso(
      'Lote mantido com os arquivos marcados como já importados. Nada será reprocessado sem sua confirmação.'
    );
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
    // Provedores fora do fluxo (OPENAI/ANTHROPIC) não contam para abrir o modal de escolha.
    const totalIasDisponiveis = statusIa?.configuracoes?.length
      ? statusIa.configuracoes.filter(c => idProvedorSuportadoNoFluxo(c.provedor)).length
      : totalProvedoresSuportadosNoFluxo || (statusIa?.hasEnvKey ? 1 : 0);

    // Se não tiver nenhuma configurada, não permite e avisa que precisa configurar
    if (totalConfiguradas === 0) {
      setMensagemErro(
        `Nenhuma Inteligência Artificial com chave salva. Configure ${nomeProvedorAtual} (ou outro provedor) antes de processar.`
      );
      setModalConfigIaAberto(true);
      return;
    }

    // Provedor ainda não implementado neste fluxo: bloqueia o processamento.
    if (!provedorAtualSuportadoNoFluxo) {
      setMensagemErro(
        `A IA selecionada (${nomeProvedorAtual}) ainda não é suportada no fluxo de importação por IA. ${AVISO_PROVEDOR_NAO_SUPORTADO}.`
      );
      setModalConfigIaAberto(true);
      return;
    }

    // Se o provedor atual não tem chave, orienta a configurar em vez de seguir silenciosamente
    if (!provedorAtualConfigurado) {
      setMensagemErro(
        `A IA selecionada (${nomeProvedorAtual} — ${modeloIaSelecionado}) ainda não possui chave salva. Configure-a para processar o lote.`
      );
      setModalConfigIaAberto(true);
      return;
    }

    // Ativa o modal de escolha quando há mais de uma IA disponível e o usuário
    // ainda não escolheu explicitamente nesta sessão de processamento.
    if (totalIasDisponiveis > 1 && !escolhaIaExplicita) {
      setModalEscolhaIaAberto(true);
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

  // TASK-50: badge do status de cada tentativa (SUCESSO / FALHA / DUPLICADO)
  const getBadgeTentativa = (status: 'SUCESSO' | 'FALHA' | 'DUPLICADO') => {
    if (status === 'SUCESSO') return <span className="badge badge-verde">Sucesso</span>;
    if (status === 'DUPLICADO') return <span className="badge badge-amarelo">Duplicado</span>;
    return <span className="badge badge-vermelho">Falha</span>;
  };

  // TASK-50: linha do tempo (timeline) de tentativas de extração de um arquivo
  const renderTimelineTentativas = (arquivoId: string) => {
    const tentativas = tentativasPorArquivo[arquivoId] || [];
    const carregando = carregandoTentativasId === arquivoId;

    if (carregando && tentativas.length === 0) {
      return (
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', padding: '6px 0' }}>
          Carregando histórico de tentativas...
        </div>
      );
    }

    if (tentativas.length === 0) {
      return (
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', padding: '6px 0' }}>
          Nenhuma tentativa de extração registrada para este arquivo ainda.
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '10px 12px',
          marginTop: '2px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'rgba(2, 6, 23, 0.5)',
          border: '1px dashed var(--border-subtle)',
        }}
      >
        <div
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            letterSpacing: '0.04em',
          }}
        >
          HISTÓRICO DE TENTATIVAS ({tentativas.length})
        </div>
        {tentativas.map(t => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              paddingLeft: '10px',
              borderLeft: `2px solid ${
                t.status === 'SUCESSO'
                  ? 'var(--status-green)'
                  : t.status === 'DUPLICADO'
                    ? 'var(--status-yellow)'
                    : 'var(--status-red)'
              }`,
              fontSize: '0.74rem',
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', minWidth: '46px' }}>
              #{t.numeroTentativa}
            </span>
            <span style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>
              {t.provedor}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {t.modelo}</span>
            </span>
            {getBadgeTentativa(t.status)}
            <span style={{ color: 'var(--text-secondary)' }}>
              {t.totalTransacoesExtraidas} lançamento(s)
            </span>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {t.duracaoMs} ms
            </span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {new Date(t.criadoEm).toLocaleString('pt-BR')}
            </span>
            {t.mensagemErro && (
              <div
                style={{
                  flexBasis: '100%',
                  color: t.status === 'DUPLICADO' ? '#fcd34d' : '#f87171',
                  fontSize: '0.72rem',
                  paddingTop: '2px',
                }}
              >
                {t.mensagemErro}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // Status Helpers
  const getBadgeStatusArquivo = (
    status: string,
    statusFinal?: string | null,
    jaImportadoAnteriormente?: boolean
  ) => {
    if (statusFinal === 'VAZIO') {
      return (
        <span
          className="badge"
          style={{
            background: 'rgba(148, 163, 184, 0.15)',
            color: '#94a3b8',
            border: '1px solid rgba(148, 163, 184, 0.3)',
          }}
        >
          Sem Movimentação
        </span>
      );
    }
    if (statusFinal === 'DUPLICADO' || jaImportadoAnteriormente) {
      return <span className="badge badge-amarelo">Já Importado</span>;
    }
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
              carregarAlertasEHistorico();
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
      {!temIaConfigurada && (
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
              <div
                style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}
              >
                Para importar faturas não estruturadas com IA, configure sua chave do Google Gemini,
                DeepSeek, OpenAI, Claude ou OpenRouter. Extratos OFX e planilhas CSV continuam
                funcionando diretamente.
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
      )}

      {/*
        Seletor de IA do lote SEMPRE visível (com ou sem chave salva): alimentado por
        statusIa.provedoresSuportados, garante que OpenRouter apareça desde o 1º load.
      */}
      <div
        style={{
          background: temIaConfigurada ? 'rgba(34, 197, 94, 0.08)' : 'rgba(56, 189, 248, 0.06)',
          border: temIaConfigurada
            ? '1px solid rgba(34, 197, 94, 0.25)'
            : '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          style={{
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
              <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                IA Ativa para Importação de Lote:
              </span>
              <span
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--brand-primary)',
                  marginLeft: '6px',
                  fontWeight: 600,
                }}
              >
                {nomeProvedorAtual}{' '}
                <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  ({modeloIaSelecionado})
                </code>
                {!provedorAtualSuportadoNoFluxo ? (
                  <span
                    className="badge badge-amarelo"
                    style={{ fontSize: '0.65rem', marginLeft: '6px' }}
                    title={AVISO_PROVEDOR_NAO_SUPORTADO}
                  >
                    Não suportado
                  </span>
                ) : provedorAtualConfigurado ? (
                  <span
                    className="badge badge-verde"
                    style={{ fontSize: '0.65rem', marginLeft: '6px' }}
                  >
                    ✓ Configurada
                  </span>
                ) : (
                  <span
                    className="badge badge-amarelo"
                    style={{ fontSize: '0.65rem', marginLeft: '6px' }}
                  >
                    Sem chave
                  </span>
                )}
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

        {/*
            Seletor de provedor alimentado por statusIa.provedoresSuportados (não apenas
            pelas configurações salvas): todos os 5 provedores — incluindo OpenRouter —
            aparecem desde o primeiro carregamento, mesmo sem chave salva.
          */}
        <div
          style={{
            paddingTop: '6px',
            borderTop: '1px dashed rgba(255,255,255,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Escolher IA do lote:
            </span>
            {provedoresDisponiveis.map(prov => {
              const isSelected = provedorIaSelecionado === prov.id;
              const modeloEfetivo =
                prov.modeloConfigurado || prov.modeloPadrao || modeloPadraoDoProvedor(prov.id);
              const nomeCurto = nomeAmigavelDoProvedor(prov.id);
              const suportado = ehProvedorSuportadoNoFluxo(prov);

              return (
                <button
                  key={prov.id}
                  type="button"
                  disabled={!suportado}
                  onClick={() => {
                    if (!suportado) return;
                    salvarPreferenciaIa(prov.id, modeloEfetivo);
                  }}
                  style={{
                    background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(15, 23, 42, 0.5)',
                    border: isSelected
                      ? '1px solid var(--brand-primary)'
                      : '1px solid var(--border-subtle)',
                    color: isSelected ? 'var(--brand-primary)' : 'var(--text-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    fontWeight: isSelected ? 700 : 500,
                    cursor: suportado ? 'pointer' : 'not-allowed',
                    opacity: suportado ? 1 : 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title={
                    suportado
                      ? `${nomeCurto} • modelo efetivo: ${modeloEfetivo}`
                      : `${nomeCurto} • ${AVISO_PROVEDOR_NAO_SUPORTADO}`
                  }
                >
                  {isSelected && <CheckCircle2 size={12} />}
                  <span>
                    {nomeCurto} ({modeloEfetivo})
                  </span>
                  {!suportado ? (
                    <span
                      className="badge badge-amarelo"
                      style={{ fontSize: '0.62rem', padding: '0 4px' }}
                    >
                      Não suportado
                    </span>
                  ) : prov.configurado ? (
                    <span
                      className="badge badge-verde"
                      style={{ fontSize: '0.62rem', padding: '0 4px' }}
                    >
                      ✓ Configurada
                    </span>
                  ) : (
                    <span
                      className="badge badge-amarelo"
                      style={{ fontSize: '0.62rem', padding: '0 4px' }}
                    >
                      Configurar
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Modelo efetivo do provedor selecionado (select do catálogo + slug livre) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Modelo:</span>
            <SeletorModeloIa
              provedor={provedorIaSelecionado}
              modelo={modeloIaSelecionado}
              modelos={provedorAtualOpcao?.modelos || []}
              onChange={novo => salvarPreferenciaIa(provedorIaSelecionado, novo)}
              compacto
            />
            {provedorIaSelecionado === 'OPENROUTER' && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                OpenRouter usa catálogo aberto: informe sempre <code>vendor/model</code>.
              </span>
            )}
          </div>

          {/* TASK-52: Painel de Médias Consolidadas de Custo e Tempo por 1k tokens */}
          {(() => {
            const provNorm = (provedorIaSelecionado || '').toUpperCase();
            const modNorm = (modeloIaSelecionado || '').toLowerCase();
            const media = mediasConsolidadasIa.find(
              m => m.provedor.toUpperCase() === provNorm && m.modelo.toLowerCase() === modNorm
            );
            if (!media) return null;

            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <Sparkles size={13} style={{ color: 'var(--brand-primary, #38bdf8)' }} />
                  Médias por 1k tokens:
                </span>
                <span>
                  <strong>Custo:</strong> ${media.custoUsdPor1kTokens.toFixed(5)} (~R$ {media.custoBrlPor1kTokens.toFixed(4)})
                </span>
                <span>•</span>
                <span>
                  <strong>Tempo:</strong> {media.segundosPor1kTokens.toFixed(2)}s
                </span>
                <span>•</span>
                {media.isEstimativa ? (
                  <span
                    className="badge badge-amarelo"
                    style={{ fontSize: '0.62rem', padding: '1px 5px' }}
                    title="Média estimada via tabela de referência (sem histórico real suficiente nos últimos 90 dias)"
                  >
                    Estimativa de referência
                  </span>
                ) : (
                  <span
                    className="badge badge-verde"
                    style={{ fontSize: '0.62rem', padding: '1px 5px' }}
                    title={`Baseado em ${media.totalChamadas} chamadas reais nos últimos ${media.janelaDias} dias`}
                  >
                    Histórico real ({media.totalChamadas} {media.totalChamadas === 1 ? 'amostra' : 'amostras'})
                  </span>
                )}
              </div>
            );
          })()}

          {/* Aviso de provedor ainda não suportado neste fluxo de importação */}
          {!provedorAtualSuportadoNoFluxo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(148, 163, 184, 0.12)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
              }}
            >
              <AlertTriangle size={15} style={{ color: '#94a3b8', flexShrink: 0 }} />
              <span>
                <strong>{nomeProvedorAtual}</strong> • {AVISO_PROVEDOR_NAO_SUPORTADO}.
              </span>
            </div>
          )}

          {/* Feedback de provedor ainda não configurado */}
          {provedorAtualSuportadoNoFluxo && !provedorAtualConfigurado && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                fontSize: '0.78rem',
                color: '#fef08a',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle
                  size={15}
                  style={{ color: 'var(--status-yellow, #eab308)', flexShrink: 0 }}
                />
                <span>
                  <strong>{nomeProvedorAtual}</strong> ainda não possui chave salva. Configure para
                  poder importar faturas e extratos com esta IA.
                </span>
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => abrirConfiguracaoDoProvedor(provedorIaSelecionado)}
                style={{ fontSize: '0.76rem', padding: '4px 10px', height: 'auto' }}
              >
                <Key size={13} /> Configurar
              </button>
            </div>
          )}

          {/* Aviso de limitação de mídia — genérico por capacidade do provedor */}
          {(!capacidadeProvedorAtual.suportaImagens ||
            !capacidadeProvedorAtual.suportaPdfsNaoEstruturados) && (
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
                <strong>Atenção com arquivos visuais:</strong> {nomeProvedorAtual} não processa{' '}
                {!capacidadeProvedorAtual.suportaImagens && 'imagens (.jpg, .png)'}
                {!capacidadeProvedorAtual.suportaImagens &&
                  !capacidadeProvedorAtual.suportaPdfsNaoEstruturados &&
                  ' nem '}
                {!capacidadeProvedorAtual.suportaPdfsNaoEstruturados &&
                  'PDFs escaneados/não estruturados'}
                . Para faturas em imagem, utilize o <strong>Google Gemini</strong>, OpenAI, Claude
                ou OpenRouter.
              </div>
            </div>
          )}
        </div>
      </div>

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

      {/* Modal de Escolha de IA quando há mais de uma IA disponível (configurada ou suportada) */}
      {modalEscolhaIaAberto && (
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
              {provedoresDisponiveis.map(prov => {
                const isSelected = provedorIaSelecionado === prov.id;
                const nomeAmigavel = nomeAmigavelDoProvedor(prov.id);
                const suportado = ehProvedorSuportadoNoFluxo(prov);
                const modeloEfetivo =
                  prov.modeloConfigurado ||
                  (isSelected ? modeloIaSelecionado : undefined) ||
                  prov.modeloPadrao ||
                  modeloPadraoDoProvedor(prov.id);

                return (
                  <div
                    key={prov.id}
                    role="button"
                    tabIndex={suportado ? 0 : -1}
                    aria-disabled={!suportado}
                    onClick={() => {
                      if (!suportado) return;
                      salvarPreferenciaIa(prov.id, modeloEfetivo);
                    }}
                    onKeyDown={e => {
                      if (!suportado) return;
                      if (e.key === 'Enter' || e.key === ' ')
                        salvarPreferenciaIa(prov.id, modeloEfetivo);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '2px solid var(--brand-primary)' : '1px solid var(--border-color)',
                      background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-secondary)',
                      cursor: suportado ? 'pointer' : 'not-allowed',
                      opacity: suportado ? 1 : 0.5,
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {nomeAmigavel}
                        </span>
                        {!suportado ? (
                          <span className="badge badge-amarelo" style={{ fontSize: '0.62rem' }}>
                            Não suportado
                          </span>
                        ) : prov.configurado ? (
                          <span className="badge badge-verde" style={{ fontSize: '0.62rem' }}>
                            ✓ Configurada
                          </span>
                        ) : (
                          <span className="badge badge-amarelo" style={{ fontSize: '0.62rem' }}>
                            Sem chave
                          </span>
                        )}
                      </div>
                      {!suportado && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {AVISO_PROVEDOR_NAO_SUPORTADO}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginTop: '2px',
                        }}
                      >
                        Modelo: <code>{modeloEfetivo}</code>
                        {prov.chaveMascarada ? (
                          <>
                            {' '}
                            • Chave: <code>{prov.chaveMascarada}</code>
                          </>
                        ) : null}
                      </div>
                      {suportado && (
                        <div style={{ marginTop: '6px' }}>
                          <SeletorModeloIa
                            provedor={prov.id}
                            modelo={modeloEfetivo}
                            modelos={prov.modelos}
                            onChange={novo => salvarPreferenciaIa(prov.id, novo)}
                            compacto
                          />
                        </div>
                      )}
                      {suportado && (() => {
                        const m = mediasConsolidadasIa.find(
                          item => item.provedor.toUpperCase() === prov.id.toUpperCase() && item.modelo.toLowerCase() === modeloEfetivo.toLowerCase()
                        );
                        if (!m) return null;
                        return (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span><strong>Custo:</strong> ${m.custoUsdPor1kTokens.toFixed(5)} (~R$ {m.custoBrlPor1kTokens.toFixed(4)})/1k</span>
                            <span>•</span>
                            <span><strong>Tempo:</strong> {m.segundosPor1kTokens.toFixed(2)}s/1k</span>
                            <span>•</span>
                            <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                              {m.isEstimativa ? 'estimativa' : `${m.totalChamadas} amostras`}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                    {isSelected && suportado && (
                      <CheckCircle2 size={18} style={{ color: 'var(--brand-primary)' }} />
                    )}
                  </div>
                );
              })}
            </div>

            {!provedorAtualSuportadoNoFluxo && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(148, 163, 184, 0.12)',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                }}
              >
                <AlertTriangle size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                <span>
                  <strong>{nomeProvedorAtual}</strong> • {AVISO_PROVEDOR_NAO_SUPORTADO}.
                </span>
              </div>
            )}

            {provedorAtualSuportadoNoFluxo && !provedorAtualConfigurado && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  fontSize: '0.78rem',
                  color: '#fef08a',
                }}
              >
                <span>
                  <strong>{nomeProvedorAtual}</strong> ainda não possui chave salva. Configure para
                  processar este lote.
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => abrirConfiguracaoDoProvedor(provedorIaSelecionado)}
                  style={{ fontSize: '0.76rem', padding: '4px 10px', height: 'auto' }}
                >
                  <Key size={13} /> Configurar
                </button>
              </div>
            )}

            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}
            >
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
                disabled={
                  processandoAcao ||
                  !loteAtivo ||
                  !provedorAtualConfigurado ||
                  !provedorAtualSuportadoNoFluxo
                }
                onClick={() => {
                  if (loteAtivo && provedorAtualConfigurado && provedorAtualSuportadoNoFluxo) {
                    setEscolhaIaExplicita(true);
                    executarExtracaoComProvedor(
                      loteAtivo.id,
                      provedorIaSelecionado,
                      modeloIaSelecionado
                    );
                  }
                }}
              >
                {processandoAcao ? 'Processando...' : `Iniciar Extração com ${nomeProvedorAtual}`}
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {provedoresDisponiveis.map(prov => {
                  const isSelected = provedorIaSelecionado === prov.id;
                  const nomeAmigavel = nomeAmigavelDoProvedor(prov.id);
                  const suportado = ehProvedorSuportadoNoFluxo(prov);
                  const modeloEfetivo =
                    prov.modeloConfigurado ||
                    (isSelected ? modeloIaSelecionado : undefined) ||
                    prov.modeloPadrao ||
                    modeloPadraoDoProvedor(prov.id);

                  return (
                    <div
                      key={prov.id}
                      role="button"
                      tabIndex={suportado ? 0 : -1}
                      aria-disabled={!suportado}
                      onClick={() => {
                        if (!suportado) return;
                        salvarPreferenciaIa(prov.id, modeloEfetivo);
                      }}
                      onKeyDown={e => {
                        if (!suportado) return;
                        if (e.key === 'Enter' || e.key === ' ')
                          salvarPreferenciaIa(prov.id, modeloEfetivo);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: isSelected
                          ? '2px solid var(--brand-primary)'
                          : '1px solid var(--border-color)',
                        background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-secondary)',
                        cursor: suportado ? 'pointer' : 'not-allowed',
                        opacity: suportado ? 1 : 0.5,
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '0.88rem',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {nomeAmigavel}
                          </span>
                          {!suportado ? (
                            <span className="badge badge-amarelo" style={{ fontSize: '0.62rem' }}>
                              Não suportado
                            </span>
                          ) : prov.configurado ? (
                            <span className="badge badge-verde" style={{ fontSize: '0.62rem' }}>
                              ✓ Configurada
                            </span>
                          ) : (
                            <span className="badge badge-amarelo" style={{ fontSize: '0.62rem' }}>
                              Sem chave
                            </span>
                          )}
                        </div>
                        {!suportado && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {AVISO_PROVEDOR_NAO_SUPORTADO}
                          </div>
                        )}
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          Modelo: <code>{modeloEfetivo}</code>
                          {prov.chaveMascarada ? (
                            <>
                              {' '}
                              • Chave: <code>{prov.chaveMascarada}</code>
                            </>
                          ) : null}
                        </div>
                        {suportado && (
                          <div style={{ marginTop: '6px' }}>
                            <SeletorModeloIa
                              provedor={prov.id}
                              modelo={modeloEfetivo}
                              modelos={prov.modelos}
                              onChange={novo => salvarPreferenciaIa(prov.id, novo)}
                              compacto
                            />
                          </div>
                        )}
                      </div>
                      {isSelected && suportado && (
                        <CheckCircle2 size={16} style={{ color: 'var(--brand-primary)' }} />
                      )}
                    </div>
                  );
                })}
              </div>

              {!provedorAtualSuportadoNoFluxo && (
                <div
                  style={{
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(148, 163, 184, 0.12)',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <AlertTriangle size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                  <span>
                    <strong>{nomeProvedorAtual}</strong> • {AVISO_PROVEDOR_NAO_SUPORTADO}.
                  </span>
                </div>
              )}

              {provedorAtualSuportadoNoFluxo && !provedorAtualConfigurado && (
                <div
                  style={{
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(234, 179, 8, 0.1)',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    fontSize: '0.78rem',
                    color: '#fef08a',
                  }}
                >
                  <span>
                    <strong>{nomeProvedorAtual}</strong> ainda não possui chave salva. Configure
                    para reprocessar este arquivo.
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => abrirConfiguracaoDoProvedor(provedorIaSelecionado)}
                    style={{ fontSize: '0.76rem', padding: '4px 10px', height: 'auto' }}
                  >
                    <Key size={13} /> Configurar
                  </button>
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
                  disabled={
                    Boolean(reprocessandoArquivoId) ||
                    Boolean(excluindoArquivoId) ||
                    !provedorAtualConfigurado ||
                    !provedorAtualSuportadoNoFluxo
                  }
                  onClick={() => {
                    if (!provedorAtualSuportadoNoFluxo) return;
                    executarReprocessamentoArquivoIndividualComIa(
                      arquivoParaReprocessar.id,
                      provedorIaSelecionado,
                      modeloIaSelecionado
                    );
                  }}
                >
                  {reprocessandoArquivoId ? (
                    <>
                      <RefreshCw size={14} className="spin" /> Reprocessando com {nomeProvedorAtual}
                      ...
                    </>
                  ) : (
                    `Reprocessar com ${nomeProvedorAtual}`
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

      {/* 2.2 TASK-50: Alerta de Duplicidade no Upload (requer confirmação explícita) */}
      {alertaDuplicidade && (alertaDuplicidade.duplicados?.length ?? 0) > 0 && (
        <div
          className="card"
          style={{
            border: '1px solid rgba(245, 158, 11, 0.45)',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#fbbf24',
              fontWeight: 700,
              fontSize: '0.92rem',
            }}
          >
            <AlertTriangle size={18} />
            <span>Arquivos já importados anteriormente</span>
          </div>

          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            O lote foi criado, mas {alertaDuplicidade.duplicados?.length} arquivo(s) já existem no
            seu histórico (mesmo nome ou mesmo conteúdo SHA-256). Eles{' '}
            <strong>não serão reprocessados</strong> até que você confirme explicitamente.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(alertaDuplicidade.duplicados || []).map(dup => (
              <div
                key={dup.arquivoId}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(15, 23, 42, 0.55)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.78rem',
                }}
              >
                <FileText size={14} color="#fbbf24" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {dup.nomeArquivo}
                </span>
                {dup.motivos?.map(m => (
                  <span
                    key={m}
                    className="badge"
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.18)',
                      color: '#fcd34d',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                    }}
                  >
                    {m === 'MESMO_NOME' ? 'Mesmo nome' : 'Mesmo conteúdo'}
                  </span>
                ))}
                {dup.ocorrencias?.length > 0 && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                    {dup.ocorrencias.length} ocorrência(s) anterior(es)
                  </span>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary"
              disabled={confirmandoReprocessamento}
              onClick={handleConfirmarReprocessamento}
              style={{ fontSize: '0.82rem', minHeight: '38px', padding: '0 16px' }}
            >
              <RefreshCw size={14} className={confirmandoReprocessamento ? 'spin' : ''} />
              {confirmandoReprocessamento ? 'Confirmando...' : 'Confirmar e reprocessar'}
            </button>
            <button
              type="button"
              disabled={confirmandoReprocessamento}
              onClick={handleDescartarAlertaDuplicidade}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: '0.82rem',
                minHeight: '38px',
                padding: '0 16px',
                cursor: 'pointer',
              }}
            >
              Manter como duplicado
            </button>
          </div>
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
          onClick={() => {
            setVisualizacaoAba('arquivos');
            carregarAlertasEHistorico();
          }}
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

                    {/* TASK-50: contadores agregados do lote (arquivos, sucesso, falha, duplicados e lançamentos) */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {[
                        {
                          rotulo: 'Arquivos',
                          valor: loteAtivo.totalArquivos ?? 0,
                          cor: 'var(--text-primary)',
                        },
                        {
                          rotulo: 'Sucesso',
                          valor: loteAtivo.totalSucesso ?? 0,
                          cor: 'var(--status-green)',
                        },
                        {
                          rotulo: 'Falhas',
                          valor: loteAtivo.totalFalha ?? 0,
                          cor: 'var(--status-red)',
                        },
                        {
                          rotulo: 'Duplicados',
                          valor: loteAtivo.totalDuplicados ?? 0,
                          cor: 'var(--status-yellow)',
                        },
                        {
                          rotulo: 'Lançamentos',
                          valor: loteAtivo.totalLancamentos ?? 0,
                          cor: 'var(--brand-primary)',
                        },
                        ...(loteAtivo.origem
                          ? [
                              {
                                rotulo: 'Origem',
                                valor: loteAtivo.origem,
                                cor: 'var(--text-secondary)',
                              },
                            ]
                          : []),
                      ].map(item => (
                        <div
                          key={item.rotulo}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 10px',
                            borderRadius: '999px',
                            backgroundColor: 'rgba(15, 23, 42, 0.65)',
                            border: '1px solid var(--border-subtle)',
                            fontSize: '0.74rem',
                          }}
                        >
                          <span style={{ color: 'var(--text-muted)' }}>{item.rotulo}:</span>
                          <strong style={{ color: item.cor, fontFamily: 'var(--font-mono)' }}>
                            {item.valor}
                          </strong>
                        </div>
                      ))}
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
                  {/* Cabeçalho com contadores dinâmicos (TASK-51) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                      Arquivos do Lote ({loteAtivo.arquivos?.length || 0})
                      {loteAtivo.arquivos && (filtroStatusArquivo !== 'TODOS' || filtroNomeArquivo.trim()) && (
                        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '6px' }}>
                          — exibindo {arquivosDoLoteFiltrados.length} de {loteAtivo.arquivos.length}
                        </span>
                      )}
                    </h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Total Finalizados: {loteAtivo.arquivosProcessados} / {loteAtivo.totalArquivos}
                    </span>
                  </div>

                  {/* Barra de Filtros Client-Side (TASK-51) */}
                  {loteAtivo.arquivos && loteAtivo.arquivos.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '14px',
                        flexWrap: 'wrap',
                        background: 'rgba(15, 23, 42, 0.4)',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {/* Campo de Busca por Nome */}
                      <div style={{ position: 'relative', flex: '1 1 200px' }}>
                        <input
                          type="text"
                          placeholder="Filtrar por nome do arquivo..."
                          value={filtroNomeArquivo}
                          onChange={(e) => setFiltroNomeArquivo(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '6px 28px 6px 10px',
                            fontSize: '0.8rem',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-card)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                          }}
                        />
                        {filtroNomeArquivo && (
                          <button
                            type="button"
                            onClick={() => setFiltroNomeArquivo('')}
                            style={{
                              position: 'absolute',
                              right: '6px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              padding: '2px 4px',
                            }}
                            title="Limpar busca"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Select de Status */}
                      <div style={{ flex: '0 0 auto' }}>
                        <select
                          value={filtroStatusArquivo}
                          onChange={(e) => setFiltroStatusArquivo(e.target.value)}
                          style={{
                            padding: '6px 10px',
                            fontSize: '0.8rem',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-card)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="TODOS">Todos os status</option>
                          <option value="RECEPCIONADO">Em Fila</option>
                          <option value="ENVIADO_IA">Processando IA...</option>
                          <option value="IA_CONCLUIDO">IA Concluída</option>
                          <option value="STAGING_CARREGADO">Staging Pronto</option>
                          <option value="PROCESSADO_FINAL">Consolidado</option>
                          <option value="ERRO">Erro</option>
                        </select>
                      </div>

                      {/* Botão Limpar Filtros quando ativo */}
                      {(filtroStatusArquivo !== 'TODOS' || filtroNomeArquivo.trim()) && (
                        <button
                          type="button"
                          onClick={() => {
                            setFiltroStatusArquivo('TODOS');
                            setFiltroNomeArquivo('');
                          }}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-card)',
                            color: 'var(--brand-primary)',
                            padding: '5px 10px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Limpar filtros
                        </button>
                      )}
                    </div>
                  )}

                  {!loteAtivo.arquivos || loteAtivo.arquivos.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                      Nenhum arquivo cadastrado neste lote.
                    </div>
                  ) : arquivosDoLoteFiltrados.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                      Nenhum arquivo corresponde aos filtros aplicados.
                      <div style={{ marginTop: '8px' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setFiltroStatusArquivo('TODOS');
                            setFiltroNomeArquivo('');
                          }}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-card)',
                            color: 'var(--brand-primary)',
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Limpar filtros
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {arquivosDoLoteFiltrados.map((arq: ArquivoImportacaoItem) => {
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
                                  getBadgeStatusArquivo(
                                    arq.status,
                                    arq.statusFinal,
                                    arq.jaImportadoAnteriormente
                                  )
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
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                              #{idx + 1} - {arq.nomeArquivo}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {arq.mimeType || 'Documento'} • Status da IA: {arq.status}
                              {typeof arq.totalTentativas === 'number' &&
                                arq.totalTentativas > 0 && (
                                  <> • {arq.totalTentativas} tentativa(s)</>
                                )}
                              {arq.ultimoProvedor && <> • Último provedor: {arq.ultimoProvedor}</>}
                            </div>
                            {arq.mensagemErro && (
                              <div
                                style={{
                                  fontSize: '0.74rem',
                                  color: 'var(--status-red)',
                                  marginTop: '2px',
                                }}
                              >
                                Erro: {arq.mensagemErro}
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => alternarTentativasArquivo(arq.id)}
                              style={{
                                background: 'rgba(56, 189, 248, 0.12)',
                                border: '1px solid rgba(56, 189, 248, 0.35)',
                                color: 'var(--brand-primary)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '4px 8px',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              title="Ver histórico de tentativas deste arquivo"
                            >
                              <History
                                size={12}
                                className={carregandoTentativasId === arq.id ? 'spin' : ''}
                              />
                              {arquivoTentativasAberto === arq.id
                                ? 'Ocultar tentativas'
                                : 'Ver tentativas'}
                            </button>
                            {arq.statusFinal === 'VAZIO' ? (
                              <span
                                className="badge"
                                style={{
                                  background: 'rgba(148, 163, 184, 0.15)',
                                  color: '#94a3b8',
                                  border: '1px solid rgba(148, 163, 184, 0.3)',
                                }}
                              >
                                Sem Movimentação
                              </span>
                            ) : ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(
                              arq.status
                            ) ? (
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
                                  disabled={
                                    reprocessandoArquivoId === arq.id ||
                                    excluindoArquivoId === arq.id
                                  }
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
                                  <RefreshCw
                                    size={12}
                                    className={reprocessandoArquivoId === arq.id ? 'spin' : ''}
                                  />
                                  {reprocessandoArquivoId === arq.id
                                    ? 'Reprocessando...'
                                    : 'Reprocessar com outra IA'}
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    reprocessandoArquivoId === arq.id ||
                                    excluindoArquivoId === arq.id
                                  }
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
                                  <Trash2
                                    size={12}
                                    className={excluindoArquivoId === arq.id ? 'spin' : ''}
                                  />
                                  {excluindoArquivoId === arq.id ? 'Excluindo...' : 'Excluir'}
                                </button>
                              </div>
                            ) : arq.jaImportadoAnteriormente ? (
                              <span className="badge badge-amarelo">Já importado</span>
                            ) : (
                              <span className="badge badge-amarelo">Aguardando Fila</span>
                            )}
                          </div>
                        </div>
                        {/* TASK-50: timeline de tentativas por arquivo */}
                        {arquivoTentativasAberto === arq.id && renderTimelineTentativas(arq.id)}
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

      {/* 9. Aba 4: Histórico Estruturado e Tabela Consolidada de Arquivos (TASK-41 / Melhoria Consolidado) */}
      {visualizacaoAba === 'arquivos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Cards de Métricas Consolidadas */}
          {(() => {
            const totalDocs = historicoArquivos.length;
            const totalTrans = historicoArquivos.reduce((acc, h) => acc + (h.totalTransacoes || 0), 0);
            const somaValores = historicoArquivos.reduce((acc, h) => acc + Number(h.valorTotal || 0), 0);
            const totalFaturas = historicoArquivos.filter((h) => h.tipoDocumento === 'FATURA_CARTAO').length;
            const totalExtratos = historicoArquivos.filter((h) => h.tipoDocumento !== 'FATURA_CARTAO').length;

            return (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                }}
              >
                <div
                  className="card"
                  style={{
                    padding: '14px 16px',
                    borderLeft: '4px solid var(--brand-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Arquivos Catalogados
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                      {totalDocs}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {totalFaturas} faturas • {totalExtratos} extratos
                    </div>
                  </div>
                  <Database size={28} color="var(--brand-primary)" style={{ opacity: 0.8 }} />
                </div>

                <div
                  className="card"
                  style={{
                    padding: '14px 16px',
                    borderLeft: '4px solid #10b981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Total Lançamentos
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', marginTop: '2px' }}>
                      {totalTrans.toLocaleString('pt-BR')}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      itens extraídos e integrados
                    </div>
                  </div>
                  <FileCheck size={28} color="#10b981" style={{ opacity: 0.8 }} />
                </div>

                <div
                  className="card"
                  style={{
                    padding: '14px 16px',
                    borderLeft: '4px solid #a855f7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Volume Total Movimentado
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                      R$ {somaValores.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      soma do valor dos documentos
                    </div>
                  </div>
                  <ShieldCheck size={28} color="#a855f7" style={{ opacity: 0.8 }} />
                </div>
              </div>
            );
          })()}

          {/* Card Principal: Tabela Consolidada com Filtros */}
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ fontSize: '0.98rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                  <Database size={18} color="var(--brand-primary)" />
                  Consolidado da Importação de Arquivos por IA
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Histórico completo de arquivos importados, métricas analíticas e conferência de lançamentos criados
                </span>
              </div>

              <button
                type="button"
                onClick={carregarAlertasEHistorico}
                className="btn-secondary"
                style={{ fontSize: '0.76rem', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '5px' }}
                title="Recarregar histórico consolidado"
              >
                <RefreshCw size={13} /> Atualizar
              </button>
            </div>

            {/* Barra de Filtros e Busca */}
            <div
              style={{
                display: 'flex',
                gap: '10px',
                marginBottom: '16px',
                flexWrap: 'wrap',
                alignItems: 'center',
                backgroundColor: 'rgba(15, 23, 42, 0.4)',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
                <Search
                  size={14}
                  color="var(--text-muted)"
                  style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Filtrar por instituição, nome do arquivo ou conta..."
                  value={filtroHistoricoBusca}
                  onChange={(e) => setFiltroHistoricoBusca(e.target.value)}
                  style={{ paddingLeft: '32px', fontSize: '0.8rem', width: '100%' }}
                />
                {filtroHistoricoBusca && (
                  <button
                    type="button"
                    onClick={() => setFiltroHistoricoBusca('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Filter size={14} color="var(--text-muted)" />
                <select
                  className="form-select"
                  value={filtroHistoricoTipo}
                  onChange={(e) => setFiltroHistoricoTipo(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                >
                  <option value="TODOS">Todos os tipos</option>
                  <option value="FATURA_CARTAO">Fatura de Cartão</option>
                  <option value="EXTRATO_CONTA_CORRENTE">Extrato Bancário</option>
                  <option value="EXTRATO_INVESTIMENTO">Investimentos</option>
                  <option value="OUTRO">Outros</option>
                </select>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                Exibindo <strong>{historicoArquivosFiltrados.length}</strong> de <strong>{historicoArquivos.length}</strong>
              </div>
            </div>

            {historicoArquivos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
                <FileText size={36} color="var(--text-muted)" style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                Nenhum arquivo catalogado analiticamente até o momento. Processe um lote de faturas ou extratos para gerar o consolidado.
              </div>
            ) : historicoArquivosFiltrados.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
                Nenhum arquivo encontrado para os filtros informados.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-card)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                      <th style={{ padding: '10px 12px' }}>Arquivo de Origem</th>
                      <th style={{ padding: '10px 12px' }}>Instituição</th>
                      <th style={{ padding: '10px 12px' }}>Tipo Documento</th>
                      <th style={{ padding: '10px 12px' }}>Competência</th>
                      <th style={{ padding: '10px 12px' }}>Período Coberto</th>
                      <th style={{ padding: '10px 12px' }}>Conta Vinculada</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Qtd Lançamentos</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Valor Total</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historicoArquivosFiltrados.map((hist) => (
                      <tr
                        key={hist.id}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          backgroundColor: 'rgba(30, 41, 59, 0.25)',
                          transition: 'background-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.5)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.25)';
                        }}
                      >
                        <td style={{ padding: '12px 10px' }}>
                          <div style={{ fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FileText size={15} color="var(--brand-primary)" />
                            {hist.arquivo?.nomeArquivo || 'Arquivo consolidado'}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', gap: '8px' }}>
                            {hist.arquivo?.tamanhoBytes ? (
                              <span>{(hist.arquivo.tamanhoBytes / 1024).toFixed(1)} KB</span>
                            ) : null}
                            <span>• {new Date(hist.criadoEm).toLocaleDateString()}</span>
                            {hist.arquivo?.ultimoProvedor && (
                              <span style={{ color: 'var(--brand-primary)' }}>• IA: {hist.arquivo.ultimoProvedor}</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '12px 10px', fontWeight: 700, color: '#f8fafc' }}>
                          {hist.instituicao}
                        </td>
                        <td style={{ padding: '12px 10px' }}>
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
                        <td style={{ padding: '12px 10px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {hist.competencia}
                        </td>
                        <td style={{ padding: '12px 10px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          {hist.periodoInicio ? new Date(hist.periodoInicio).toLocaleDateString() : 'N/A'} até{' '}
                          {hist.periodoFim ? new Date(hist.periodoFim).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '12px 10px', color: hist.conta?.nome ? 'var(--brand-primary)' : 'var(--text-muted)', fontWeight: 500 }}>
                          {hist.conta?.nome || 'Não vinculada'}
                        </td>
                        <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                          {hist.totalTransacoes}
                        </td>
                        <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#f8fafc' }}>
                          R$ {Number(hist.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => abrirModalLancamentosArquivo(hist.arquivoId)}
                            disabled={carregandoLancamentosArquivoId === hist.arquivoId}
                            className="btn-primary"
                            style={{
                              fontSize: '0.75rem',
                              padding: '5px 10px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                            }}
                            title="Consultar lançamentos criados a partir deste arquivo"
                          >
                            {carregandoLancamentosArquivoId === hist.arquivoId ? (
                              <RefreshCw size={13} className="spin" />
                            ) : (
                              <Eye size={13} />
                            )}
                            Ver Lançamentos
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Detalhado de Consulta de Lançamentos Criados do Arquivo */}
      {arquivoLancamentosModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(5px)',
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
              maxWidth: '960px',
              maxHeight: '90vh',
              padding: '24px',
              border: '1px solid var(--border-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              overflow: 'hidden',
            }}
          >
            {/* Cabeçalho do Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-card)', paddingBottom: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={20} color="var(--brand-primary)" />
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {arquivoLancamentosModal.arquivo.nomeArquivo}
                  </h3>
                  <span className="badge badge-green">
                    {arquivoLancamentosModal.arquivo.statusFinal || arquivoLancamentosModal.arquivo.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                  <span>ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{arquivoLancamentosModal.arquivo.id.slice(0, 8)}</code></span>
                  <span>Tamanho: {(arquivoLancamentosModal.arquivo.tamanhoBytes / 1024).toFixed(1)} KB</span>
                  {arquivoLancamentosModal.arquivo.historico && (
                    <span>Instituição: <strong>{arquivoLancamentosModal.arquivo.historico.instituicao}</strong></span>
                  )}
                  {arquivoLancamentosModal.arquivo.historico?.competencia && (
                    <span>Competência: <strong>{arquivoLancamentosModal.arquivo.historico.competencia}</strong></span>
                  )}
                  {arquivoLancamentosModal.arquivo.ultimoProvedor && (
                    <span>IA: <strong>{arquivoLancamentosModal.arquivo.ultimoProvedor}</strong></span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setArquivoLancamentosModal(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Cards de Resumo dos Lançamentos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <div style={{ padding: '10px 14px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Movimentos Oficiais Criados</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10b981', marginTop: '2px' }}>
                  {arquivoLancamentosModal.resumo.totalMovimentosOficiais}
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Extraído Staging</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#38bdf8', marginTop: '2px' }}>
                  {arquivoLancamentosModal.resumo.totalStagingItens}
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Volume Total Consolidado</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                  R$ {arquivoLancamentosModal.resumo.valorTotalMovimentos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Seletor de visualização do modal (Movimentos Oficiais vs Staging de Auditoria vs Tentativas de IA) */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-card)', paddingBottom: '6px' }}>
              <button
                type="button"
                onClick={() => setAbaModalLancamentos('movimentos')}
                style={{
                  background: abaModalLancamentos === 'movimentos' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                  border: 'none',
                  color: abaModalLancamentos === 'movimentos' ? 'var(--brand-primary)' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckCircle2 size={14} /> Movimentos no Sistema ({arquivoLancamentosModal.movimentos.length})
              </button>

              <button
                type="button"
                onClick={() => setAbaModalLancamentos('staging')}
                style={{
                  background: abaModalLancamentos === 'staging' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                  border: 'none',
                  color: abaModalLancamentos === 'staging' ? 'var(--brand-primary)' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Database size={14} /> Auditoria Staging ({arquivoLancamentosModal.stagingItens.length})
              </button>

              {arquivoLancamentosModal.arquivo.tentativas && arquivoLancamentosModal.arquivo.tentativas.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAbaModalLancamentos('tentativas')}
                  style={{
                    background: abaModalLancamentos === 'tentativas' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                    border: 'none',
                    color: abaModalLancamentos === 'tentativas' ? 'var(--brand-primary)' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Sparkles size={14} /> Execuções de IA ({arquivoLancamentosModal.arquivo.tentativas.length})
                </button>
              )}
            </div>

            {/* Conteúdo da Aba do Modal */}
            <div style={{ overflowY: 'auto', maxHeight: '50vh', flex: 1, paddingRight: '4px' }}>
              {abaModalLancamentos === 'movimentos' && (
                <>
                  {arquivoLancamentosModal.movimentos.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
                      Nenhum movimento oficial vinculado gerado para este arquivo (possível arquivo zerado ou pendente de consolidação).
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-card)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 10px' }}>Data</th>
                          <th style={{ padding: '8px 10px' }}>Descrição</th>
                          <th style={{ padding: '8px 10px' }}>Conta</th>
                          <th style={{ padding: '8px 10px' }}>Categoria POF</th>
                          <th style={{ padding: '8px 10px' }}>Natureza</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arquivoLancamentosModal.movimentos.map((mov) => (
                          <tr key={mov.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                              {new Date(mov.dataMovimento).toLocaleDateString()}
                            </td>
                            <td style={{ padding: '8px 10px', fontWeight: 600, color: '#f8fafc' }}>
                              {mov.descricao}
                            </td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                              {mov.conta?.nome || '—'}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              {mov.categoria?.nome ? (
                                <span className="badge badge-blue">{mov.categoria.nome}</span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>Não categorizado</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span
                                className={`badge ${
                                  mov.natureza === 'RECEITA'
                                    ? 'badge-green'
                                    : mov.natureza === 'TRANSFERENCIA_PROPRIA'
                                    ? 'badge-purple'
                                    : mov.natureza === 'APORTE_PATRIMONIAL'
                                    ? 'badge-blue'
                                    : 'badge-yellow'
                                }`}
                              >
                                {mov.natureza}
                              </span>
                            </td>
                            <td
                              style={{
                                padding: '8px 10px',
                                textAlign: 'right',
                                fontWeight: 700,
                                fontFamily: 'var(--font-mono)',
                                color: mov.natureza === 'RECEITA' ? '#10b981' : '#f8fafc',
                              }}
                            >
                              R$ {Number(mov.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {abaModalLancamentos === 'staging' && (
                <>
                  {arquivoLancamentosModal.stagingItens.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
                      Nenhum registro de staging encontrado para este arquivo.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-card)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 10px' }}>Data</th>
                          <th style={{ padding: '8px 10px' }}>Descrição</th>
                          <th style={{ padding: '8px 10px' }}>Conta Sugerida</th>
                          <th style={{ padding: '8px 10px' }}>Status Processamento</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arquivoLancamentosModal.stagingItens.map((stg) => (
                          <tr key={stg.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                              {new Date(stg.dataMovimento).toLocaleDateString()}
                            </td>
                            <td style={{ padding: '8px 10px', color: '#f8fafc' }}>
                              {stg.descricao}
                              {stg.observacao && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {stg.observacao}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                              {stg.contaSugerida || '—'}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span
                                className={`badge ${
                                  stg.statusProcessamento === 'PROCESSADO'
                                    ? 'badge-green'
                                    : stg.statusProcessamento === 'IGNORADO'
                                    ? 'badge-purple'
                                    : stg.statusProcessamento === 'ERRO'
                                    ? 'badge-red'
                                    : 'badge-yellow'
                                }`}
                              >
                                {stg.statusProcessamento}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              R$ {Number(stg.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {abaModalLancamentos === 'tentativas' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {arquivoLancamentosModal.arquivo.tentativas?.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        padding: '10px 12px',
                        background: 'rgba(15, 23, 42, 0.4)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.82rem' }}>
                          Tentativa #{t.numeroTentativa} • {t.provedor} ({t.modelo})
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Executado em {new Date(t.criadoEm).toLocaleString()} • Duração: {(t.duracaoMs / 1000).toFixed(1)}s
                        </div>
                        {t.mensagemErro && (
                          <div style={{ fontSize: '0.74rem', color: '#f87171', marginTop: '4px' }}>
                            {t.mensagemErro}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`badge ${t.status === 'SUCESSO' ? 'badge-green' : 'badge-red'}`}>
                          {t.status}
                        </span>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          {t.totalTransacoesExtraidas} transações
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-card)', paddingTop: '12px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setArquivoLancamentosModal(null)}
                style={{ fontSize: '0.82rem', padding: '7px 16px' }}
              >
                Fechar
              </button>
            </div>
          </div>
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

