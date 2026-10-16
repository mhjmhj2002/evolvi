import React, { useState, useEffect, useMemo } from 'react';
import {
  MovimentoItem,
  ContaItem,
  CategoriaTreeItem,
  FiltroMovimentosParams,
  apiService,
} from '../api.ts';
import {
  Calendar,
  Search,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  X,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Receipt,
  CheckCircle2,
  Clock,
  RotateCcw,
  Trash2,
  CalendarDays,
  Split,
  Lock,
} from 'lucide-react';

interface TelaLancamentosProps {
  usuarioId?: string;
  contas: ContaItem[];
  categorias: CategoriaTreeItem[];
  onOpenNovoLancamento: () => void;
  onMovimentoModificado?: () => void;
}

export const TelaLancamentos: React.FC<TelaLancamentosProps> = ({
  usuarioId,
  contas,
  categorias,
  onOpenNovoLancamento,
  onMovimentoModificado,
}) => {
  // Competência padrão (Ano-Mês atual ou 2026-10 de referência)
  const [competencia, setCompetencia] = useState<string>('2026-10');
  const [dataInicio, setDataInicio] = useState<string>('');
  const [dataFim, setDataFim] = useState<string>('');
  const [busca, setBusca] = useState<string>('');
  const [filtroContaId, setFiltroContaId] = useState<string>('');
  const [filtroCategoriaId, setFiltroCategoriaId] = useState<string>('');
  const [filtroNatureza, setFiltroNatureza] = useState<string>('TODOS');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');

  // Controle de Painel de Filtros Avançados
  const [showFiltrosAvancados, setShowFiltrosAvancados] = useState<boolean>(false);

  // Estados de dados da API
  const [carregando, setCarregando] = useState<boolean>(true);
  const [movimentos, setMovimentos] = useState<MovimentoItem[]>([]);
  const [resumo, setResumo] = useState({
    totalReceitas: 0,
    totalDespesasConsumo: 0,
    totalTransferenciasProprias: 0,
    totalAportesPatrimoniais: 0,
    saldoOperacionalConsumo: 0,
  });

  // Modal de edição rápida ou visualização detalhada de lançamento
  const [itemSelecionado, setItemSelecionado] = useState<MovimentoItem | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [mensagemAviso, setMensagemAviso] = useState<string | null>(null);

  // Estados de Ajuste e Propagação de Categoria por Vendedor (TASK-42)
  const [categoriaEdicao, setCategoriaEdicao] = useState<string>('');
  const [propagarVendedor, setPropagarVendedor] = useState<boolean>(false);
  const [similaresInfo, setSimilaresInfo] = useState<{ termoVendedor: string | null; totalSimilares: number } | null>(null);
  const [salvandoCategoria, setSalvandoCategoria] = useState<boolean>(false);
  const [feedbackCategoria, setFeedbackCategoria] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Ao abrir o bottom sheet do item selecionado, inicializa a categoria e consulta outros lançamentos similares
  useEffect(() => {
    if (itemSelecionado) {
      setCategoriaEdicao(itemSelecionado.categoriaId || '');
      setPropagarVendedor(false);
      setFeedbackCategoria(null);
      setSimilaresInfo(null);
      apiService.obterSimilaresVendedor(itemSelecionado.id)
        .then((info) => {
          setSimilaresInfo(info);
          if (info.totalSimilares > 0) {
            setPropagarVendedor(true); // Sugere pré-marcado por conveniência quando houver compras similares
          }
        })
        .catch((err) => {
          console.warn('Erro ao buscar lançamentos similares:', err);
        });
    }
  }, [itemSelecionado?.id]);

  const handleSalvarCategoria = async () => {
    if (!itemSelecionado) return;
    setSalvandoCategoria(true);
    setFeedbackCategoria(null);
    try {
      const res = await apiService.atualizarMovimento(itemSelecionado.id, {
        categoriaId: categoriaEdicao || null,
        propagarMesmoVendedor: propagarVendedor,
      });

      setFeedbackCategoria({ tipo: 'sucesso', texto: res.message || 'Categoria salva com sucesso!' });
      await carregarMovimentos();
      onMovimentoModificado?.();

      // Atualiza o próprio item selecionado na tela
      const catObj = categorias.find((c) => c.id === categoriaEdicao);
      setItemSelecionado({
        ...itemSelecionado,
        categoriaId: categoriaEdicao || null,
        categoriaFixadaPeloUsuario: true,
        categoria: catObj ? { id: catObj.id, nome: catObj.nome, categoriaPaiId: null } : null,
      });

      setTimeout(() => {
        setFeedbackCategoria(null);
      }, 3500);
    } catch (err: any) {
      setFeedbackCategoria({ tipo: 'erro', texto: err.message || 'Erro ao atualizar categoria.' });
    } finally {
      setSalvandoCategoria(false);
    }
  };

  // Estados de Desdobramento / Transaction Splitting (TASK-39)
  const [modalSplitAberto, setModalSplitAberto] = useState(false);
  const [movimentoEmSplit, setMovimentoEmSplit] = useState<MovimentoItem | null>(null);
  const [splitsEmEdicao, setSplitsEmEdicao] = useState<Array<{ categoriaId: string; valor: string; descricao: string }>>([]);
  const [salvandoSplit, setSalvandoSplit] = useState(false);
  const [feedbackSplit, setFeedbackSplit] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const abrirModalSplit = (mov: MovimentoItem) => {
    setMovimentoEmSplit(mov);
    setFeedbackSplit(null);
    if (mov.rateios && mov.rateios.length > 0) {
      setSplitsEmEdicao(
        mov.rateios.map((r) => ({
          categoriaId: r.categoriaId,
          valor: r.valor.toFixed(2),
          descricao: r.descricao || '',
        }))
      );
    } else {
      // Sugere 2 fatias iniciais: metade no valor da categoria original (ou primeira) e a outra metade vazia
      const metade = (mov.valor / 2).toFixed(2);
      const resto = (mov.valor - parseFloat(metade)).toFixed(2);
      const catPadrao = mov.categoriaId || (categorias.length > 0 ? categorias[0].id : '');
      const outraCat = categorias.length > 1 ? (categorias.find((c) => c.id !== catPadrao)?.id || catPadrao) : catPadrao;

      setSplitsEmEdicao([
        { categoriaId: catPadrao, valor: metade, descricao: 'Fatia 1/2' },
        { categoriaId: outraCat, valor: resto, descricao: 'Fatia 2/2' },
      ]);
    }
    setModalSplitAberto(true);
  };

  const fecharModalSplit = () => {
    setModalSplitAberto(false);
    setMovimentoEmSplit(null);
    setSplitsEmEdicao([]);
    setFeedbackSplit(null);
  };

  const adicionarLinhaSplit = () => {
    const catPadrao = categorias.length > 0 ? categorias[0].id : '';
    setSplitsEmEdicao([...splitsEmEdicao, { categoriaId: catPadrao, valor: '0.00', descricao: '' }]);
  };

  const removerLinhaSplit = (index: number) => {
    if (splitsEmEdicao.length <= 2) {
      setFeedbackSplit({ tipo: 'erro', texto: 'Um desdobramento requer no mínimo 2 categorias.' });
      return;
    }
    setSplitsEmEdicao(splitsEmEdicao.filter((_, i) => i !== index));
  };

  const atualizarLinhaSplit = (index: number, campo: 'categoriaId' | 'valor' | 'descricao', valor: string) => {
    const novas = [...splitsEmEdicao];
    novas[index] = { ...novas[index], [campo]: valor };
    setSplitsEmEdicao(novas);
  };

  const handleSalvarSplit = async () => {
    if (!movimentoEmSplit) return;
    setFeedbackSplit(null);

    const valorOriginal = Number(movimentoEmSplit.valor);
    const parsedSplits = splitsEmEdicao.map((s) => ({
      categoriaId: s.categoriaId,
      valor: parseFloat(s.valor.replace(',', '.')) || 0,
      descricao: s.descricao.trim() || undefined,
    }));

    if (parsedSplits.some((s) => !s.categoriaId)) {
      setFeedbackSplit({ tipo: 'erro', texto: 'Selecione uma categoria para todas as fatias.' });
      return;
    }

    if (parsedSplits.some((s) => s.valor <= 0)) {
      setFeedbackSplit({ tipo: 'erro', texto: 'O valor de cada fatia deve ser maior que zero.' });
      return;
    }

    const soma = Number(parsedSplits.reduce((acc, s) => acc + s.valor, 0).toFixed(2));
    if (Math.abs(soma - valorOriginal) > 0.001) {
      setFeedbackSplit({
        tipo: 'erro',
        texto: `A soma das fatias (R$ ${soma.toFixed(2)}) deve ser exatamente igual ao total (R$ ${valorOriginal.toFixed(2)}). Diferença: R$ ${(valorOriginal - soma).toFixed(2)}`,
      });
      return;
    }

    setSalvandoSplit(true);
    try {
      const res = await apiService.splitMovimento(movimentoEmSplit.id, parsedSplits);
      setFeedbackSplit({ tipo: 'sucesso', texto: res.message || 'Desdobramento salvo com sucesso!' });
      await carregarMovimentos();
      onMovimentoModificado?.();
      setTimeout(() => {
        fecharModalSplit();
        setItemSelecionado(null);
      }, 700);
    } catch (err: any) {
      setFeedbackSplit({ tipo: 'erro', texto: err.message || 'Erro ao salvar desdobramento.' });
    } finally {
      setSalvandoSplit(false);
    }
  };

  const handleRemoverSplit = async (movId: string) => {
    setSalvandoSplit(true);
    try {
      await apiService.removerSplitMovimento(movId);
      setFeedbackSplit({ tipo: 'sucesso', texto: 'Desdobramento revertido com sucesso!' });
      await carregarMovimentos();
      onMovimentoModificado?.();
      setTimeout(() => {
        fecharModalSplit();
        setItemSelecionado(null);
      }, 700);
    } catch (err: any) {
      setFeedbackSplit({ tipo: 'erro', texto: err.message || 'Erro ao reverter desdobramento.' });
    } finally {
      setSalvandoSplit(false);
    }
  };

  // Função para buscar dados
  const carregarMovimentos = async () => {
    setCarregando(true);
    try {
      const params: FiltroMovimentosParams = {};
      if (competencia && !dataInicio && !dataFim) {
        params.competencia = competencia;
      }
      if (dataInicio) params.dataInicio = dataInicio;
      if (dataFim) params.dataFim = dataFim;
      if (busca.trim()) params.busca = busca.trim();
      if (filtroContaId) params.contaId = filtroContaId;
      if (filtroCategoriaId) params.categoriaId = filtroCategoriaId;
      if (filtroNatureza !== 'TODOS') params.natureza = filtroNatureza as any;
      if (filtroStatus !== 'TODOS') params.status = filtroStatus as any;

      const res = await apiService.getMovimentos(params);
      if (res) {
        setMovimentos(res.movimentos || []);
        if (res.resumo) {
          setResumo(res.resumo);
        }
      } else {
        setMovimentos([]);
        setResumo({
          totalReceitas: 0,
          totalDespesasConsumo: 0,
          totalTransferenciasProprias: 0,
          totalAportesPatrimoniais: 0,
          saldoOperacionalConsumo: 0,
        });
      }
    } catch (err) {
      console.warn('Erro ao carregar lista de movimentos:', err);
      setMovimentos([]);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarMovimentos();
  }, [usuarioId, competencia, dataInicio, dataFim, filtroContaId, filtroCategoriaId, filtroNatureza, filtroStatus]);

  // Manipulação de busca com debounce rápido
  useEffect(() => {
    const handler = setTimeout(() => {
      carregarMovimentos();
    }, 300);
    return () => clearTimeout(handler);
  }, [busca]);

  // Navegar entre meses
  const mudarMes = (direcao: number) => {
    // Se estiver usando data customizada, limpa ao mudar de mês
    setDataInicio('');
    setDataFim('');
    const [anoStr, mesStr] = competencia.split('-');
    let ano = parseInt(anoStr, 10);
    let mes = parseInt(mesStr, 10) + direcao;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    } else if (mes < 1) {
      mes = 12;
      ano -= 1;
    }
    const novoMesStr = mes < 10 ? `0${mes}` : `${mes}`;
    setCompetencia(`${ano}-${novoMesStr}`);
  };

  // Nome do mês formatado em português
  const mesFormatadoExtenso = useMemo(() => {
    if (!competencia) return 'Todos os períodos';
    const [anoStr, mesStr] = competencia.split('-');
    const dataRef = new Date(parseInt(anoStr, 10), parseInt(mesStr, 10) - 1, 1);
    const nomeMes = dataRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
  }, [competencia]);

  // Excluir movimento
  const handleExcluirMovimento = async (id: string) => {
    if (!confirm('Deseja realmente excluir este lançamento financeiro?')) return;
    setExcluindoId(id);
    try {
      await apiService.excluirMovimento(id);
      setMensagemAviso('Lançamento removido com sucesso!');
      setTimeout(() => setMensagemAviso(null), 3000);
      setItemSelecionado(null);
      await carregarMovimentos();
      if (onMovimentoModificado) onMovimentoModificado();
    } catch (err) {
      console.error('Falha ao excluir lançamento:', err);
      alert('Não foi possível excluir o lançamento.');
    } finally {
      setExcluindoId(null);
    }
  };

  // Agrupamento por data (Timeline / Mercado Financeiro)
  const movimentosAgrupados = useMemo(() => {
    const grupos: { [data: string]: MovimentoItem[] } = {};
    for (const mov of movimentos) {
      const dataChave = mov.dataMovimento;
      if (!grupos[dataChave]) {
        grupos[dataChave] = [];
      }
      grupos[dataChave].push(mov);
    }
    return grupos;
  }, [movimentos]);

  const datasOrdenadas = Object.keys(movimentosAgrupados).sort((a, b) => b.localeCompare(a));

  // Formatar moeda BRL com sinal explícito
  const formatarValor = (valor: number) => {
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Formatar data para exibição elegante no grupo
  const formatarDataCabecalho = (dataStr: string) => {
    const [ano, mes, dia] = dataStr.split('-');
    const dataObj = new Date(parseInt(ano, 10), parseInt(mes, 10) - 1, parseInt(dia, 10));
    const diaSemana = dataObj.toLocaleDateString('pt-BR', { weekday: 'short' });
    const diaMes = `${dia}/${mes}`;
    return { diaSemana: diaSemana.toUpperCase().replace('.', ''), diaMes, ano };
  };

  // Contagem de filtros ativos
  const filtrosAtivosCount = useMemo(() => {
    let count = 0;
    if (dataInicio || dataFim) count += 1;
    if (filtroContaId) count += 1;
    if (filtroCategoriaId) count += 1;
    if (filtroNatureza !== 'TODOS') count += 1;
    if (filtroStatus !== 'TODOS') count += 1;
    if (busca.trim()) count += 1;
    return count;
  }, [dataInicio, dataFim, filtroContaId, filtroCategoriaId, filtroNatureza, filtroStatus, busca]);

  const limparFiltros = () => {
    setDataInicio('');
    setDataFim('');
    setBusca('');
    setFiltroContaId('');
    setFiltroCategoriaId('');
    setFiltroNatureza('TODOS');
    setFiltroStatus('TODOS');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '30px' }}>
      {/* 1. Header com Título e Ação Rápida de Adicionar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Fluxo de Caixa & Extrato Completo
          </span>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
            Todos os Lançamentos
          </h1>
        </div>
        <button
          type="button"
          onClick={onOpenNovoLancamento}
          className="btn-primary"
          style={{
            padding: '8px 14px',
            fontSize: '0.85rem',
            minHeight: '38px',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 2px 10px rgba(56, 189, 248, 0.25)',
          }}
        >
          <Plus size={16} /> Novo
        </button>
      </div>

      {mensagemAviso && (
        <div
          style={{
            background: 'var(--status-green-bg)',
            border: '1px solid var(--status-green-border)',
            color: '#34d399',
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={16} /> {mensagemAviso}
        </div>
      )}

      {/* 2. Barra de Navegação Temporal (Mês Anterior / Mês Atual / Próximo Mês) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-card)',
          backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 14px',
        }}
      >
        <button
          type="button"
          onClick={() => mudarMes(-1)}
          style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label="Mês anterior"
        >
          <ChevronLeft size={20} />
        </button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Calendar size={16} color="var(--brand-primary)" />
            <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
              {mesFormatadoExtenso}
            </span>
          </div>
          {(dataInicio || dataFim) && (
            <span style={{ fontSize: '0.72rem', color: 'var(--brand-primary)', fontWeight: 600 }}>
              Período específico ativo ({dataInicio || 'início'} até {dataFim || 'fim'})
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => mudarMes(1)}
          style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label="Próximo mês"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* 3. Cards de Totalizadores de Mercado (Receitas +, Despesas -, Saldo Líquido) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px',
        }}
      >
        {/* Card Receitas */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--status-green-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            boxShadow: '0 4px 16px rgba(16, 185, 129, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Total Receitas
            </span>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--status-green-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={14} color="var(--status-green)" />
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.05rem',
              color: 'var(--status-green)',
            }}
          >
            + R$ {formatarValor(resumo.totalReceitas)}
          </div>
        </div>

        {/* Card Despesas de Consumo */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--status-red-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            boxShadow: '0 4px 16px rgba(239, 68, 68, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Total Despesas
            </span>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--status-red-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingDown size={14} color="var(--status-red)" />
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.05rem',
              color: 'var(--status-red)',
            }}
          >
            - R$ {formatarValor(resumo.totalDespesasConsumo)}
          </div>
        </div>
      </div>

      {/* Card Horizontal Saldo Operacional Líquido do Período */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Saldo Operacional Líquido (Receitas - Despesas)
          </span>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.15rem',
              color:
                resumo.saldoOperacionalConsumo >= 0
                  ? 'var(--status-green)'
                  : 'var(--status-red)',
            }}
          >
            {resumo.saldoOperacionalConsumo >= 0 ? '+' : '-'} R${' '}
            {formatarValor(Math.abs(resumo.saldoOperacionalConsumo))}
          </div>
        </div>
        {resumo.totalTransferenciasProprias > 0 && (
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Transferências/Faturas
            </span>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                color: 'var(--brand-secondary)',
                fontWeight: 600,
              }}
            >
              R$ {formatarValor(resumo.totalTransferenciasProprias)}
            </div>
          </div>
        )}
      </div>

      {/* 4. Barra de Pesquisa Rápida e Botão de Filtros Avançados */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Search
            size={16}
            color="var(--text-muted)"
            style={{ position: 'absolute', left: '12px', pointerEvents: 'none' }}
          />
          <input
            type="text"
            placeholder="Buscar por descrição ou observação..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              padding: '10px 12px 10px 36px',
              fontSize: '0.88rem',
              outline: 'none',
            }}
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              style={{
                position: 'absolute',
                right: '10px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFiltrosAvancados(!showFiltrosAvancados)}
          style={{
            background: showFiltrosAvancados || filtrosAtivosCount > 0 ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-surface)',
            border: `1px solid ${showFiltrosAvancados || filtrosAtivosCount > 0 ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
            color: showFiltrosAvancados || filtrosAtivosCount > 0 ? 'var(--brand-primary)' : 'var(--text-secondary)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: '40px',
          }}
        >
          <SlidersHorizontal size={16} />
          <span>Filtros</span>
          {filtrosAtivosCount > 0 && (
            <span
              style={{
                background: 'var(--brand-primary)',
                color: 'var(--bg-primary)',
                borderRadius: 'var(--radius-full)',
                padding: '1px 6px',
                fontSize: '0.72rem',
                fontWeight: 800,
              }}
            >
              {filtrosAtivosCount}
            </span>
          )}
        </button>
      </div>

      {/* 5. Painel Expansível de Filtros Avançados (Data Específica, Calendário, Conta, Categoria, Natureza, Status) */}
      {showFiltrosAvancados && (
        <div
          style={{
            background: 'var(--bg-card-solid)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Filtros Avançados & Período
            </span>
            {filtrosAtivosCount > 0 && (
              <button
                type="button"
                onClick={limparFiltros}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--brand-primary)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <RotateCcw size={12} /> Limpar Filtros
              </button>
            )}
          </div>

          {/* Filtro por Datas Específicas / Calendário */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Data Inicial</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="form-input"
                style={{ padding: '8px 10px', fontSize: '0.85rem', minHeight: '38px' }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Data Final</label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="form-input"
                style={{ padding: '8px 10px', fontSize: '0.85rem', minHeight: '38px' }}
              />
            </div>
          </div>

          {/* Filtro por Conta e Categoria */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Conta / Cartão</label>
              <select
                value={filtroContaId}
                onChange={(e) => setFiltroContaId(e.target.value)}
                className="form-select"
                style={{ padding: '8px 10px', fontSize: '0.85rem', minHeight: '38px' }}
              >
                <option value="">Todas as Contas</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.tipo === 'CARTAO_CREDITO' ? 'Cartão' : 'Conta'})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Categoria</label>
              <select
                value={filtroCategoriaId}
                onChange={(e) => setFiltroCategoriaId(e.target.value)}
                className="form-select"
                style={{ padding: '8px 10px', fontSize: '0.85rem', minHeight: '38px' }}
              >
                <option value="">Todas as Categorias</option>
                {categorias.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filtro por Natureza e Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Tipo de Movimento</label>
              <select
                value={filtroNatureza}
                onChange={(e) => setFiltroNatureza(e.target.value)}
                className="form-select"
                style={{ padding: '8px 10px', fontSize: '0.85rem', minHeight: '38px' }}
              >
                <option value="TODOS">Todos os Tipos</option>
                <option value="RECEITA">Apenas Receitas (+)</option>
                <option value="DESPESA">Apenas Despesas (-)</option>
                <option value="TRANSFERENCIA_PROPRIA">Transferências</option>
                <option value="APORTE_PATRIMONIAL">Aportes / Investimentos</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Status</label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="form-select"
                style={{ padding: '8px 10px', fontSize: '0.85rem', minHeight: '38px' }}
              >
                <option value="TODOS">Todos os Status</option>
                <option value="CONCILIADO">Conciliado (Efetivado)</option>
                <option value="PREVISTO">Previsto / Pendente</option>
                <option value="CANCELADO">Cancelado</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 6. Filtros Rápidos em Chips / Tabs (Todos, Receitas +, Despesas -, Transferências) */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
          scrollbarWidth: 'none',
        }}
      >
        {[
          { key: 'TODOS', label: 'Todos' },
          { key: 'RECEITA', label: 'Receitas (+)', color: 'var(--status-green)' },
          { key: 'DESPESA', label: 'Despesas (-)', color: 'var(--status-red)' },
          { key: 'TRANSFERENCIA_PROPRIA', label: 'Transferências', color: 'var(--brand-secondary)' },
        ].map((tab) => {
          const ativo = filtroNatureza === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFiltroNatureza(tab.key)}
              style={{
                background: ativo ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.6)',
                border: `1px solid ${ativo ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
                color: ativo ? (tab.color || 'var(--brand-primary)') : 'var(--text-muted)',
                borderRadius: 'var(--radius-full)',
                padding: '6px 14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 7. Lista de Movimentos Agrupados por Dia */}
      {carregando ? (
        <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
          <Clock className="animate-spin" size={24} style={{ margin: '0 auto 8px auto' }} />
          Carregando lançamentos...
        </div>
      ) : movimentos.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <Receipt size={36} color="var(--text-muted)" />
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
              Nenhum lançamento encontrado
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Não há transações para os filtros ou período selecionado.
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={onOpenNovoLancamento}
            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
          >
            <Plus size={16} /> Criar Primeiro Lançamento
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {datasOrdenadas.map((dataChave) => {
            const itensDoDia = movimentosAgrupados[dataChave];
            const infoData = formatarDataCabecalho(dataChave);

            // Subtotal do dia para conveniência do usuário
            const subtotalDia = itensDoDia.reduce((acc, it) => {
              if (it.natureza === 'RECEITA') return acc + it.valor;
              if (it.natureza === 'DESPESA') return acc - it.valor;
              return acc;
            }, 0);

            return (
              <div key={dataChave} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Separador de Data com Dia da Semana e Subtotal */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 6px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CalendarDays size={14} color="var(--brand-primary)" />
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {infoData.diaMes}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      • {infoData.diaSemana}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: subtotalDia >= 0 ? 'var(--status-green)' : 'var(--status-red)',
                    }}
                  >
                    {subtotalDia >= 0 ? '+' : '-'} R$ {formatarValor(Math.abs(subtotalDia))}
                  </span>
                </div>

                {/* Itens do Dia */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {itensDoDia.map((item) => {
                    const isReceita = item.natureza === 'RECEITA';
                    const isDespesa = item.natureza === 'DESPESA';
                    const isTransf = item.natureza === 'TRANSFERENCIA_PROPRIA';

                    const corValor = isReceita
                      ? 'var(--status-green)'
                      : isDespesa
                      ? 'var(--status-red)'
                      : 'var(--brand-secondary)';

                    const sinal = isReceita ? '+ ' : isDespesa ? '- ' : '';

                    return (
                      <div
                        key={item.id}
                        onClick={() => setItemSelecionado(item)}
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-card)',
                          borderRadius: 'var(--radius-md)',
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          transition: 'transform 0.15s ease, background-color 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {/* Ícone de Natureza */}
                          <div
                            style={{
                              width: '38px',
                              height: '38px',
                              borderRadius: 'var(--radius-full)',
                              background: isReceita
                                ? 'var(--status-green-bg)'
                                : isDespesa
                                ? 'var(--status-red-bg)'
                                : 'rgba(129, 140, 248, 0.12)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {isReceita && <ArrowDownLeft size={20} color="var(--status-green)" />}
                            {isDespesa && <ArrowUpRight size={20} color="var(--status-red)" />}
                            {isTransf && <ArrowLeftRight size={20} color="var(--brand-secondary)" />}
                          </div>

                          {/* Textos: Descrição, Conta e Categoria */}
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                              {item.descricao}
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.74rem',
                                color: 'var(--text-muted)',
                                marginTop: '2px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span>{item.conta?.nome || 'Conta Padrão'}</span>
                              {item.categoria?.nome && (
                                <>
                                  <span>•</span>
                                  <span style={{ color: 'var(--brand-primary)' }}>{item.categoria.nome}</span>
                                </>
                              )}
                              {item.rateios && item.rateios.length > 0 && (
                                <span
                                  style={{
                                    background: 'rgba(56, 189, 248, 0.15)',
                                    color: 'var(--brand-primary)',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title={`Desdobrado em ${item.rateios.length} categorias`}
                                >
                                  <Split size={10} /> {item.rateios.length} fatias
                                </span>
                              )}
                              {item.status === 'PREVISTO' && (
                                <span
                                  style={{
                                    background: 'var(--status-yellow-bg)',
                                    color: 'var(--status-yellow)',
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                  }}
                                >
                                  Previsto
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Valor Formatado com Padrão de Mercado */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 800,
                              fontSize: '1rem',
                              color: corValor,
                            }}
                          >
                            {sinal}R$ {formatarValor(item.valor)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {item.status === 'CONCILIADO' ? 'Efetivado' : 'Pendente'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 8. Modal de Detalhes do Lançamento Selecionado */}
      {itemSelecionado && (
        <div
          className="bottom-sheet-backdrop"
          onClick={() => setItemSelecionado(null)}
          style={{ zIndex: 100 }}
        >
          <div
            className="bottom-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '520px', gap: '14px' }}
          >
            <div className="bottom-sheet-header">
              <span className="bottom-sheet-title">Detalhes do Lançamento</span>
              <button
                type="button"
                className="bottom-sheet-close"
                onClick={() => setItemSelecionado(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                border: '1px solid var(--border-card)',
                textAlign: 'center',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                {itemSelecionado.natureza === 'RECEITA'
                  ? 'RECEITA'
                  : itemSelecionado.natureza === 'DESPESA'
                  ? 'DESPESA DE CONSUMO'
                  : 'TRANSFERÊNCIA PRÓPRIA'}
              </span>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 800,
                  fontSize: '1.6rem',
                  color:
                    itemSelecionado.natureza === 'RECEITA'
                      ? 'var(--status-green)'
                      : itemSelecionado.natureza === 'DESPESA'
                      ? 'var(--status-red)'
                      : 'var(--brand-secondary)',
                }}
              >
                {itemSelecionado.natureza === 'RECEITA' ? '+ ' : itemSelecionado.natureza === 'DESPESA' ? '- ' : ''}
                R$ {formatarValor(itemSelecionado.valor)}
              </div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                {itemSelecionado.descricao}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Data:</span>
                <span style={{ fontWeight: 600 }}>{itemSelecionado.dataMovimento}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Conta:</span>
                <span style={{ fontWeight: 600 }}>{itemSelecionado.conta?.nome || 'Conta Padrão'}</span>
              </div>
              {/* Campo Categoria com Ajuste Direto e Propagação por Vendedor (TASK-42) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(56, 189, 248, 0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem' }}>Categoria do Lançamento:</span>
                    {itemSelecionado.categoriaFixadaPeloUsuario && (
                      <span
                        title="Categoria ajustada manualmente. Protegida contra alterações automáticas ou reclassificações por IA/rotinas."
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: 'var(--brand-primary)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: 'var(--radius-full)',
                          padding: '1px 7px',
                          fontSize: '0.70rem',
                          fontWeight: 700,
                        }}
                      >
                        <Lock size={10} />
                        Fixada pelo usuário
                      </span>
                    )}
                  </div>
                  {itemSelecionado.rateios && itemSelecionado.rateios.length > 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--brand-primary)', fontWeight: 600 }}>
                      Possui Rateio Analítico
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    className="form-control"
                    value={categoriaEdicao}
                    onChange={(e) => setCategoriaEdicao(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px',
                      fontSize: '0.84rem',
                    }}
                  >
                    <option value="">Sem categoria definida</option>
                    {categorias.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nome}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleSalvarCategoria}
                    disabled={salvandoCategoria || (categoriaEdicao === (itemSelecionado.categoriaId || '') && !propagarVendedor)}
                    style={{
                      background: 'var(--brand-primary)',
                      color: '#0f172a',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0 14px',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: salvandoCategoria || (categoriaEdicao === (itemSelecionado.categoriaId || '') && !propagarVendedor) ? 'not-allowed' : 'pointer',
                      opacity: salvandoCategoria || (categoriaEdicao === (itemSelecionado.categoriaId || '') && !propagarVendedor) ? 0.6 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {salvandoCategoria ? 'Salvando...' : 'Salvar Categoria'}
                  </button>
                </div>

                {/* Opção de Propagação para Lançamentos Similares do mesmo Vendedor */}
                {similaresInfo && similaresInfo.totalSimilares > 0 && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                      marginTop: '4px',
                      padding: '4px 6px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 'var(--radius-xs)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={propagarVendedor}
                      onChange={(e) => setPropagarVendedor(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: 'var(--brand-primary)' }}
                    />
                    <span>
                      Aplicar também a todas as compras de{' '}
                      <strong style={{ color: 'var(--brand-primary)' }}>"{similaresInfo.termoVendedor}"</strong>{' '}
                      ({similaresInfo.totalSimilares} outro{similaresInfo.totalSimilares > 1 ? 's' : ''} lançamento{similaresInfo.totalSimilares > 1 ? 's' : ''})
                    </span>
                  </label>
                )}

                {feedbackCategoria && (
                  <div
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-xs)',
                      background: feedbackCategoria.tipo === 'sucesso' ? 'var(--status-green-bg)' : 'var(--status-red-bg)',
                      color: feedbackCategoria.tipo === 'sucesso' ? 'var(--status-green)' : 'var(--status-red)',
                      border: `1px solid ${feedbackCategoria.tipo === 'sucesso' ? 'var(--status-green-border)' : 'var(--status-red-border)'}`,
                    }}
                  >
                    {feedbackCategoria.texto}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                <span style={{ fontWeight: 700, color: itemSelecionado.status === 'CONCILIADO' ? 'var(--status-green)' : 'var(--status-yellow)' }}>
                  {itemSelecionado.status}
                </span>
              </div>
              {itemSelecionado.observacao && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Observação:</span>
                  <span style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                    {itemSelecionado.observacao}
                  </span>
                </div>
              )}

              {itemSelecionado.rateios && itemSelecionado.rateios.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--brand-primary)', fontWeight: 700, fontSize: '0.8rem' }}>
                    <Split size={14} /> Fatias do Rateio Analítico ({itemSelecionado.rateios.length}):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: 'var(--radius-sm)' }}>
                    {itemSelecionado.rateios.map((r, i) => (
                      <div key={r.id || i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                        <span>
                          <strong style={{ color: 'var(--text-primary)' }}>{r.categoria?.nome || 'Categoria'}:</strong>{' '}
                          <span style={{ color: 'var(--text-muted)' }}>{r.descricao || '-'}</span>
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--brand-primary)' }}>
                          R$ {formatarValor(r.valor)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ações: Desdobrar e Excluir Lançamento */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => abrirModalSplit(itemSelecionado)}
                style={{
                  width: '100%',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: 'var(--brand-primary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <Split size={16} />
                {itemSelecionado.rateios && itemSelecionado.rateios.length > 0
                  ? 'Editar Rateio / Desdobramento'
                  : 'Desdobrar / Ratear Categorias'}
              </button>

              <button
                type="button"
                onClick={() => handleExcluirMovimento(itemSelecionado.id)}
                disabled={excluindoId === itemSelecionado.id}
                style={{
                  width: '100%',
                  background: 'var(--status-red-bg)',
                  border: '1px solid var(--status-red-border)',
                  color: 'var(--status-red)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={16} /> Excluir Lançamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Modal de Edição de Desdobramento / Transaction Splitting (TASK-39) */}
      {modalSplitAberto && movimentoEmSplit && (
        <div
          className="bottom-sheet-backdrop"
          onClick={fecharModalSplit}
          style={{ zIndex: 110 }}
        >
          <div
            className="bottom-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '580px', gap: '14px', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div className="bottom-sheet-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Split size={18} color="var(--brand-primary)" />
                <span className="bottom-sheet-title">Rateio Analítico de Categorias</span>
              </div>
              <button
                type="button"
                className="bottom-sheet-close"
                onClick={fecharModalSplit}
              >
                <X size={18} />
              </button>
            </div>

            {/* Cabeçalho do Lançamento em Edição de Split */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Lançamento Selecionado</div>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                  {movimentoEmSplit.descricao}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Valor Total</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 800,
                    fontSize: '1.15rem',
                    color: 'var(--brand-primary)',
                  }}
                >
                  R$ {formatarValor(movimentoEmSplit.valor)}
                </div>
              </div>
            </div>

            {/* Mensagem de Feedback */}
            {feedbackSplit && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  background:
                    feedbackSplit.tipo === 'sucesso'
                      ? 'var(--status-green-bg)'
                      : 'var(--status-red-bg)',
                  border: `1px solid ${
                    feedbackSplit.tipo === 'sucesso'
                      ? 'var(--status-green-border)'
                      : 'var(--status-red-border)'
                  }`,
                  color:
                    feedbackSplit.tipo === 'sucesso'
                      ? 'var(--status-green)'
                      : 'var(--status-red)',
                }}
              >
                {feedbackSplit.texto}
              </div>
            )}

            {/* Lista Dinâmica de Fatias */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Distribuição por Categoria
                </span>
                <button
                  type="button"
                  onClick={adicionarLinhaSplit}
                  style={{
                    background: 'transparent',
                    border: '1px dashed var(--brand-primary)',
                    color: 'var(--brand-primary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Plus size={14} /> Adicionar Fatia
                </button>
              </div>

              {splitsEmEdicao.map((linha, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {/* Categoria Select */}
                    <div style={{ flex: 1 }}>
                      <select
                        value={linha.categoriaId}
                        onChange={(e) => atualizarLinhaSplit(idx, 'categoriaId', e.target.value)}
                        style={{
                          width: '100%',
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-primary)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '8px',
                          fontSize: '0.82rem',
                        }}
                      >
                        <option value="">Selecione a categoria...</option>
                        {categorias.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.nome}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Valor da Fatia */}
                    <div style={{ width: '130px' }}>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={linha.valor}
                        onChange={(e) => atualizarLinhaSplit(idx, 'valor', e.target.value)}
                        style={{
                          width: '100%',
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-primary)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '8px',
                          fontSize: '0.85rem',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          textAlign: 'right',
                        }}
                      />
                    </div>

                    {/* Botão Remover Linha */}
                    <button
                      type="button"
                      onClick={() => removerLinhaSplit(idx)}
                      disabled={splitsEmEdicao.length <= 2}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: splitsEmEdicao.length <= 2 ? 'var(--text-muted)' : 'var(--status-red)',
                        cursor: splitsEmEdicao.length <= 2 ? 'not-allowed' : 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={splitsEmEdicao.length <= 2 ? 'Mínimo de 2 fatias' : 'Remover fatia'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Subdescrição Opcional da Fatia */}
                  <div>
                    <input
                      type="text"
                      placeholder="Subdescrição da fatia (ex: Alimentos, Farmácia, Bebidas...)"
                      value={linha.descricao}
                      onChange={(e) => atualizarLinhaSplit(idx, 'descricao', e.target.value)}
                      style={{
                        width: '100%',
                        background: 'var(--bg-main)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 8px',
                        fontSize: '0.78rem',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Resumo da Soma e Validação Visual */}
            {(() => {
              const somaAtual = splitsEmEdicao.reduce(
                (acc, s) => acc + (parseFloat(s.valor.replace(',', '.')) || 0),
                0
              );
              const totalEsperado = Number(movimentoEmSplit.valor);
              const diferenca = totalEsperado - somaAtual;
              const estaBalanceado = Math.abs(diferenca) < 0.009;

              return (
                <div
                  style={{
                    background: estaBalanceado
                      ? 'rgba(34, 197, 94, 0.08)'
                      : 'rgba(239, 68, 68, 0.08)',
                    border: `1px solid ${
                      estaBalanceado
                        ? 'var(--status-green-border)'
                        : 'var(--status-red-border)'
                    }`,
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Total Distribuído
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        color: estaBalanceado ? 'var(--status-green)' : 'var(--status-red)',
                      }}
                    >
                      R$ {formatarValor(somaAtual)} / R$ {formatarValor(totalEsperado)}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {estaBalanceado ? 'Status' : 'Diferença Restante'}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 800,
                        fontSize: '0.9rem',
                        color: estaBalanceado ? 'var(--status-green)' : 'var(--status-yellow)',
                      }}
                    >
                      {estaBalanceado ? '✓ Balanceado' : `R$ ${formatarValor(diferenca)}`}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Ações do Modal de Rateio */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              {movimentoEmSplit.rateios && movimentoEmSplit.rateios.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleRemoverSplit(movimentoEmSplit.id)}
                  disabled={salvandoSplit}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: salvandoSplit ? 'not-allowed' : 'pointer',
                  }}
                >
                  Remover Rateio
                </button>
              )}

              <button
                type="button"
                onClick={handleSalvarSplit}
                disabled={salvandoSplit}
                style={{
                  flex: 1,
                  background: 'var(--brand-primary)',
                  border: 'none',
                  color: '#0f172a',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: salvandoSplit ? 'not-allowed' : 'pointer',
                  opacity: salvandoSplit ? 0.7 : 1,
                }}
              >
                {salvandoSplit ? 'Salvando Rateio...' : 'Salvar Desdobramento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
