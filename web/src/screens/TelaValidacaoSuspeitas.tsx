import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Check,
  TrendingDown,
  Sparkles,
  ArrowRight,
  Tag,
  ShieldCheck,
  Info,
  ArrowLeftRight,
  CreditCard,
  BookmarkCheck,
  ArrowUpDown,
  Wallet,
} from 'lucide-react';
import {
  apiService,
  SuspeitasResponse,
  SuspeitaDuplicataItem,
  SuspeitaAporteItem,
  SuspeitaCategorizacaoItem,
  CategoriaTreeItem,
  VereditoPayload,
} from '../api.ts';

type CriterioOrdenacao =
  | 'VALOR_DESC'
  | 'VALOR_ASC'
  | 'DATA_DESC'
  | 'DATA_ASC'
  | 'ALFABETICA_ASC'
  | 'ALFABETICA_DESC';

interface TelaValidacaoSuspeitasProps {
  usuarioId?: string;
  categorias: CategoriaTreeItem[];
  onVereditoAplicado?: () => void;
  onNavigateTab?: (tab: any) => void;
}

export const TelaValidacaoSuspeitas: React.FC<TelaValidacaoSuspeitasProps> = ({
  categorias,
  onVereditoAplicado,
  onNavigateTab,
}) => {
  const [carregando, setCarregando] = useState<boolean>(true);
  const [suspeitas, setSuspeitas] = useState<SuspeitasResponse>({
    totalPendentes: 0,
    suspeitasDuplicatas: [],
    suspeitasAportes: [],
    suspeitasCategorizacao: [],
  });

  const [abaAtiva, setAbaAtiva] = useState<'TODOS' | 'DUPLICATAS' | 'APORTES' | 'CATEGORIAS'>('TODOS');
  const [ordenacao, setOrdenacao] = useState<CriterioOrdenacao>('VALOR_DESC');
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [toastFeedback, setToastFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Mapeamento de categorias selecionadas para ações de categorização
  const [categoriaEscolhidaMap, setCategoriaEscolhidaMap] = useState<Record<string, string>>({});
  // Mapeamento de checkboxes de propagação e memorização por movimento
  const [propagarVendedorMap, setPropagarVendedorMap] = useState<Record<string, boolean>>({});
  const [memorizarVendedorMap, setMemorizarVendedorMap] = useState<Record<string, boolean>>({});

  const carregarSuspeitas = async () => {
    setCarregando(true);
    try {
      const data = await apiService.getSuspeitas();
      setSuspeitas(data);
    } catch (err: any) {
      console.error('Erro ao carregar suspeitas:', err);
      setToastFeedback({
        tipo: 'erro',
        texto: err?.message || 'Falha ao carregar fila de validação.',
      });
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarSuspeitas();
  }, []);

  const aplicarVeredito = async (movimentoId: string, payload: VereditoPayload) => {
    setProcessandoId(movimentoId);
    try {
      const res = await apiService.aplicarVereditoSuspeita(movimentoId, payload);
      setToastFeedback({
        tipo: 'sucesso',
        texto: res.message || 'Veredito soberano aplicado com sucesso!',
      });
      await carregarSuspeitas();
      onVereditoAplicado?.();
    } catch (err: any) {
      console.error('Erro ao aplicar veredito:', err);
      setToastFeedback({
        tipo: 'erro',
        texto: err?.message || 'Erro ao processar veredito.',
      });
    } finally {
      setProcessandoId(null);
      setTimeout(() => {
        setToastFeedback(null);
      }, 4500);
    }
  };

  const [reprocessando, setReprocessando] = useState<boolean>(false);

  const reprocessarMalhaFina = async () => {
    setReprocessando(true);
    try {
      const res = await apiService.reprocessarSuspeitas();
      setToastFeedback({
        tipo: 'sucesso',
        texto: res.message || 'Malha fina e recálculo reprocessados com sucesso!',
      });
      await carregarSuspeitas();
      onVereditoAplicado?.();
    } catch (err: any) {
      console.error('Erro ao reprocessar suspeitas:', err);
      setToastFeedback({
        tipo: 'erro',
        texto: err?.message || 'Falha ao reprocessar malha fina.',
      });
    } finally {
      setReprocessando(false);
      setTimeout(() => {
        setToastFeedback(null);
      }, 4500);
    }
  };

  // Funções utilitárias para extração de propriedades de ordenação
  const getDuplicataValor = (item: SuspeitaDuplicataItem): number => {
    return Math.max(item.movimentoA.valor, item.movimentoB.valor);
  };

  const getDuplicataData = (item: SuspeitaDuplicataItem): string => {
    return item.movimentoA.dataMovimento >= item.movimentoB.dataMovimento
      ? item.movimentoA.dataMovimento
      : item.movimentoB.dataMovimento;
  };

  const getDuplicataDescricao = (item: SuspeitaDuplicataItem): string => {
    return item.movimentoA.descricao;
  };

  const duplicatasOrdenadas = React.useMemo(() => {
    const list = [...suspeitas.suspeitasDuplicatas];
    return list.sort((a, b) => {
      switch (ordenacao) {
        case 'VALOR_DESC':
          return getDuplicataValor(b) - getDuplicataValor(a);
        case 'VALOR_ASC':
          return getDuplicataValor(a) - getDuplicataValor(b);
        case 'DATA_DESC':
          return getDuplicataData(b).localeCompare(getDuplicataData(a));
        case 'DATA_ASC':
          return getDuplicataData(a).localeCompare(getDuplicataData(b));
        case 'ALFABETICA_ASC':
          return getDuplicataDescricao(a).localeCompare(getDuplicataDescricao(b));
        case 'ALFABETICA_DESC':
          return getDuplicataDescricao(b).localeCompare(getDuplicataDescricao(a));
        default:
          return 0;
      }
    });
  }, [suspeitas.suspeitasDuplicatas, ordenacao]);

  const aportesOrdenados = React.useMemo(() => {
    const list = [...suspeitas.suspeitasAportes];
    return list.sort((a, b) => {
      switch (ordenacao) {
        case 'VALOR_DESC':
          return b.movimento.valor - a.movimento.valor;
        case 'VALOR_ASC':
          return a.movimento.valor - b.movimento.valor;
        case 'DATA_DESC':
          return b.movimento.dataMovimento.localeCompare(a.movimento.dataMovimento);
        case 'DATA_ASC':
          return a.movimento.dataMovimento.localeCompare(b.movimento.dataMovimento);
        case 'ALFABETICA_ASC':
          return a.movimento.descricao.localeCompare(b.movimento.descricao);
        case 'ALFABETICA_DESC':
          return b.movimento.descricao.localeCompare(a.movimento.descricao);
        default:
          return 0;
      }
    });
  }, [suspeitas.suspeitasAportes, ordenacao]);

  const categorizacoesOrdenadas = React.useMemo(() => {
    const list = [...suspeitas.suspeitasCategorizacao];
    return list.sort((a, b) => {
      switch (ordenacao) {
        case 'VALOR_DESC':
          return b.movimento.valor - a.movimento.valor;
        case 'VALOR_ASC':
          return a.movimento.valor - b.movimento.valor;
        case 'DATA_DESC':
          return b.movimento.dataMovimento.localeCompare(a.movimento.dataMovimento);
        case 'DATA_ASC':
          return a.movimento.dataMovimento.localeCompare(b.movimento.dataMovimento);
        case 'ALFABETICA_ASC':
          return a.movimento.descricao.localeCompare(b.movimento.descricao);
        case 'ALFABETICA_DESC':
          return b.movimento.descricao.localeCompare(a.movimento.descricao);
        default:
          return 0;
      }
    });
  }, [suspeitas.suspeitasCategorizacao, ordenacao]);

  // Cálculo dos valores totais das pendências
  const totaisValores = React.useMemo(() => {
    // Para duplicatas, considera o valor em disputa de cada par (item.movimentoA.valor ou o maior entre eles)
    const totalDuplicatas = suspeitas.suspeitasDuplicatas.reduce(
      (acc, item) => acc + (item.movimentoA?.valor || item.movimentoB?.valor || 0),
      0
    );
    const totalAportes = suspeitas.suspeitasAportes.reduce(
      (acc, item) => acc + (item.movimento?.valor || 0),
      0
    );
    const totalCategorizacao = suspeitas.suspeitasCategorizacao.reduce(
      (acc, item) => acc + (item.movimento?.valor || 0),
      0
    );

    const totalGeral = totalDuplicatas + totalAportes + totalCategorizacao;

    return {
      totalGeral,
      totalDuplicatas,
      totalAportes,
      totalCategorizacao,
    };
  }, [suspeitas]);

  const renderDuplicataCard = (item: SuspeitaDuplicataItem) => {
    const { movimentoA: mA, movimentoB: mB } = item;
    const isBusy = processandoId === mA.id || processandoId === mB.id;

    return (
      <div
        key={item.id}
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.05) 0%, rgba(30, 41, 59, 0.4) 100%)',
          padding: '16px',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} color="var(--status-red)" />
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--status-red)' }}>
              Suspeita de Duplicata ({Math.round(item.confianca * 100)}% de similaridade)
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Data: {mA.dataMovimento}
          </span>
        </div>

        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          {item.motivo}
        </p>

        {/* Comparativo lado a lado dos lançamentos */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '12px',
          }}
        >
          {/* Lançamento A */}
          <div
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Registro #1
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)' }}>
                R$ {mA.valor.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{mA.descricao}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Data da Compra: <strong style={{ color: 'var(--text-primary)' }}>{mA.dataMovimento}</strong> • Conta: {mA.conta?.nome || 'N/D'} • Cat: {mA.categoria?.nome || 'Sem categoria'}
            </div>
            {mA.idOrigem && (
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Doc / ID: <span style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>{mA.idOrigem}</span>
              </div>
            )}
            {mA.observacao && (
              <div style={{ fontSize: '0.75rem', color: 'var(--brand-primary)' }}>
                Obs: {mA.observacao}
              </div>
            )}
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                aplicarVeredito(mA.id, {
                  acao: 'CONFIRMAR_DUPLICATA_DESCARTAR',
                  duplicataId: mB.id,
                })
              }
              style={{
                marginTop: '6px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--status-red)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Trash2 size={13} /> Descartar #2 e Manter Este (#1)
            </button>
          </div>

          {/* Lançamento B */}
          <div
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Registro #2
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)' }}>
                R$ {mB.valor.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{mB.descricao}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Data da Compra: <strong style={{ color: 'var(--text-primary)' }}>{mB.dataMovimento}</strong> • Conta: {mB.conta?.nome || 'N/D'} • Cat: {mB.categoria?.nome || 'Sem categoria'}
            </div>
            {mB.idOrigem && (
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Doc / ID: <span style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>{mB.idOrigem}</span>
              </div>
            )}
            {mB.observacao && (
              <div style={{ fontSize: '0.75rem', color: 'var(--brand-primary)' }}>
                Obs: {mB.observacao}
              </div>
            )}
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                aplicarVeredito(mB.id, {
                  acao: 'CONFIRMAR_DUPLICATA_DESCARTAR',
                  duplicataId: mA.id,
                })
              }
              style={{
                marginTop: '6px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--status-red)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Trash2 size={13} /> Descartar #1 e Manter Este (#2)
            </button>
          </div>
        </div>

        {/* Botão de arbitrar como compras distintas e válidas */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
          {!(mA.natureza === 'TRANSFERENCIA_PROPRIA' && mB.natureza === 'TRANSFERENCIA_PROPRIA') && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                aplicarVeredito(mA.id, {
                  acao: 'CONVERTER_TRANSFERENCIA_PROPRIA',
                  duplicataId: mB.id,
                })
              }
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ArrowLeftRight size={16} /> É Transferência entre Contas Próprias (Não é Gasto nem Receita)
            </button>
          )}

          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              aplicarVeredito(mA.id, {
                acao: 'CONFIRMAR_DISTINTOS_PRESERVAR',
                duplicataId: mB.id,
              })
            }
            style={{
              background: 'rgba(34, 197, 94, 0.15)',
              color: 'var(--status-green)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Check size={16} /> São Lançamentos Distintos (Manter Ambos com Segurança)
          </button>
        </div>
      </div>
    );
  };

  const renderAporteCard = (item: SuspeitaAporteItem) => {
    const m = item.movimento;
    const isBusy = processandoId === m.id;

    return (
      <div
        key={item.id}
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.06) 0%, rgba(30, 41, 59, 0.4) 100%)',
          padding: '16px',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="var(--brand-primary)" />
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--brand-primary)' }}>
              Suspeita de Aporte / Aplicação Financeira
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.98rem' }}>
            R$ {m.valor.toFixed(2)}
          </span>
        </div>

        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{m.descricao}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Data: {m.dataMovimento} • Conta: {m.conta?.nome || 'N/D'} • Atual: Despesa de Consumo
          </div>
        </div>

        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          {item.motivo}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              aplicarVeredito(m.id, {
                acao: 'CONVERTER_APORTE_PATRIMONIAL',
              })
            }
            style={{
              flex: '1 1 180px',
              background: 'var(--brand-primary)',
              color: '#fff',
              border: 'none',
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <ShieldCheck size={16} /> Confirmar como Investimento / Aporte
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              aplicarVeredito(m.id, {
                acao: 'CONFIRMAR_DESPESA_REGULAR',
              })
            }
            style={{
              flex: '1 1 160px',
              background: 'rgba(51, 65, 85, 0.6)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <TrendingDown size={15} /> Manter como Despesa Regular
          </button>
        </div>
      </div>
    );
  };

  const renderCategorizacaoCard = (item: SuspeitaCategorizacaoItem) => {
    const m = item.movimento;
    const isBusy = processandoId === m.id;
    const categoriaSelecionada = categoriaEscolhidaMap[m.id] || '';

    // Encontra ID de sugestão se houver
    const sugeridaNome = item.categoriaSugerida?.toLowerCase();
    const catEncontrada = categorias.find(
      (c) => c.nome.toLowerCase() === sugeridaNome
    );

    return (
      <div
        key={item.id}
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, rgba(30, 41, 59, 0.4) 100%)',
          padding: '16px',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Tag size={18} color="var(--status-yellow)" />
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--status-yellow)' }}>
              Alta Materialidade em "Outros" / Sem Categoria
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.98rem' }}>
            R$ {m.valor.toFixed(2)}
          </span>
        </div>

        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{m.descricao}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Data: {m.dataMovimento} • Conta: {m.conta?.nome || 'N/D'} • Cat Atual:{' '}
            {m.categoria?.nome || 'Não definida'}
          </div>
          {m.observacao && (
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '3px', fontStyle: 'italic' }}>
              ℹ️ {m.observacao}
            </div>
          )}
        </div>

        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          {item.motivo}
        </p>

        {/* Indicação visual amigável quando for compra parcelada */}
        {(() => {
          const matchParcela = m.descricao.match(/(?:[\-_–—]|\()\s*(?:parcela\s+)?(\d+)\s*(?:\/|\s+de\s+)\s*(\d+)\s*\)?/i);
          if (matchParcela) {
            return (
              <div
                style={{
                  fontSize: '0.74rem',
                  color: 'var(--brand-primary)',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px dashed rgba(56, 189, 248, 0.3)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexWrap: 'wrap',
                }}
              >
                <span>📦</span>
                <span>
                  Compra parcelada ({matchParcela[1]} de {matchParcela[2]}) • <strong>Data da Compra: {m.dataMovimento}</strong>. A categoria definida será aplicada a todas as parcelas desta compra.
                </span>
              </div>
            );
          }
          return null;
        })()}

        {/* Sugestão de Regra Cadastrada do Usuário (se houver no catálogo) */}
        {item.regraVendedorSalva && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12) 0%, rgba(30, 41, 59, 0.5) 100%)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BookmarkCheck size={18} color="var(--status-green)" />
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--status-green)', fontWeight: 700 }}>
                  Catálogo de Lojas: <strong>{item.regraVendedorSalva.categoriaNome}</strong>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Regra salva para compras em "{item.termoVendedor}"
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                aplicarVeredito(m.id, {
                  acao: 'DEFINIR_CATEGORIA',
                  categoriaId: item.regraVendedorSalva!.categoriaId,
                  propagarMesmoVendedor: propagarVendedorMap[m.id] ?? false,
                  memorizarRegraVendedor: memorizarVendedorMap[m.id] ?? true,
                })
              }
              style={{
                background: 'var(--status-green)',
                color: '#fff',
                border: 'none',
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Aplicar Regra do Catálogo
            </button>
          </div>
        )}

        {item.categoriaSugerida && catEncontrada && !item.regraVendedorSalva && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--brand-primary)', fontWeight: 600 }}>
              Sugestão IA/Combinatória: <strong>{catEncontrada.nome}</strong>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                aplicarVeredito(m.id, {
                  acao: 'DEFINIR_CATEGORIA',
                  categoriaId: catEncontrada.id,
                  propagarMesmoVendedor: propagarVendedorMap[m.id] ?? false,
                  memorizarRegraVendedor: memorizarVendedorMap[m.id] ?? true,
                })
              }
              style={{
                background: 'var(--brand-primary)',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Aceitar Sugestão
            </button>
          </div>
        )}

        {/* Ação rápida para converter em Pagamento de Fatura de Cartão / Transferência Própria */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              aplicarVeredito(m.id, {
                acao: 'CONVERTER_TRANSFERENCIA_PROPRIA',
                observacao: 'Pagamento de fatura de cartão de crédito',
              })
            }
            style={{
              flex: 1,
              background: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <CreditCard size={15} /> É Pagamento de Fatura de Cartão (Anti-Dupla Contagem)
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={categoriaSelecionada}
            onChange={(e) =>
              setCategoriaEscolhidaMap({
                ...categoriaEscolhidaMap,
                [m.id]: e.target.value,
              })
            }
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.82rem',
            }}
          >
            <option value="">Selecionar categoria ou subcategoria...</option>
            {categorias.map((c) => {
              if (c.subcategorias && c.subcategorias.length > 0) {
                return (
                  <optgroup key={c.id} label={c.nome}>
                    <option value={c.id}>{c.nome} (Principal)</option>
                    {c.subcategorias.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        ↳ {sub.nome}
                      </option>
                    ))}
                  </optgroup>
                );
              }
              return (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              );
            })}
          </select>

          <button
            type="button"
            disabled={isBusy || !categoriaSelecionada}
            onClick={() =>
              aplicarVeredito(m.id, {
                acao: 'DEFINIR_CATEGORIA',
                categoriaId: categoriaSelecionada,
                propagarMesmoVendedor: propagarVendedorMap[m.id] ?? false,
                memorizarRegraVendedor: memorizarVendedorMap[m.id] ?? true,
              })
            }
            style={{
              background: categoriaSelecionada ? 'var(--status-green)' : 'rgba(51, 65, 85, 0.4)',
              color: '#fff',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: isBusy || !categoriaSelecionada ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Check size={14} /> Aplicar
          </button>
        </div>

        {/* Opções de Escopo de Aplicação (Somente esta compra / parcelas vs Loja inteira) e Catálogo */}
        {(() => {
          const vendedorOuDesc = item.termoVendedor || m.descricao;
          return (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '4px',
                padding: '10px 12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {/* Opção 1: Escopo - Propagação para outros lançamentos do vendedor */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={propagarVendedorMap[m.id] === true}
                  onChange={(e) =>
                    setPropagarVendedorMap({
                      ...propagarVendedorMap,
                      [m.id]: e.target.checked,
                    })
                  }
                  style={{ cursor: 'pointer', accentColor: 'var(--brand-primary)', marginTop: '2px' }}
                />
                <span style={{ lineHeight: 1.4 }}>
                  Aplicar também para os demais lançamentos de{' '}
                  <strong style={{ color: 'var(--brand-primary)' }}>"{vendedorOuDesc}"</strong>
                  {item.totalSimilaresVendedor !== undefined && item.totalSimilaresVendedor > 0 ? (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' '}({item.totalSimilaresVendedor} outro{item.totalSimilaresVendedor > 1 ? 's' : ''} pendente{item.totalSimilaresVendedor > 1 ? 's' : ''})
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}> (se houverem)</span>
                  )}
                  {!propagarVendedorMap[m.id] && (
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--status-green)', marginTop: '2px' }}>
                      ✓ Modo seguro ativo: a categoria será aplicada <strong>apenas a esta compra</strong> (realizada em {m.dataMovimento})
                      {m.descricao.match(/(?:[\-_–—]|\()\s*(?:parcela\s+)?(\d+)\s*(?:\/|\s+de\s+)\s*(\d+)\s*\)?/i) ? ' (e às suas demais parcelas)' : ''}.
                    </span>
                  )}
                </span>
              </label>

              {/* Opção 2: Memorizar no Catálogo de Regras de Lojas */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    memorizarVendedorMap[m.id] !== undefined
                      ? memorizarVendedorMap[m.id]
                      : true
                  }
                  onChange={(e) =>
                    setMemorizarVendedorMap({
                      ...memorizarVendedorMap,
                      [m.id]: e.target.checked,
                    })
                  }
                  style={{ cursor: 'pointer', accentColor: 'var(--status-green)', marginTop: '2px' }}
                />
                <span style={{ lineHeight: 1.4 }}>
                  Cadastrar regra no catálogo para classificar automaticamente compras futuras de{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>"{vendedorOuDesc}"</strong>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Desmarque caso este lançamento/estabelecimento represente transações de naturezas variadas.
                  </span>
                </span>
              </label>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Toast de Feedback */}
      {toastFeedback && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 18px',
            borderRadius: 'var(--radius-md)',
            background:
              toastFeedback.tipo === 'sucesso'
                ? 'rgba(34, 197, 94, 0.95)'
                : 'rgba(239, 68, 68, 0.95)',
            color: '#fff',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            fontSize: '0.88rem',
            fontWeight: 700,
          }}
        >
          {toastFeedback.tipo === 'sucesso' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{toastFeedback.texto}</span>
        </div>
      )}

      {/* Header com Status e Contador Soberano */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={22} color="var(--status-yellow)" />
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Central de Validação de Suspeitas
            </h1>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Decisões humanas soberanas para resolução de duplicatas, naturezas e categorização com imunização definitiva.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={reprocessarMalhaFina}
            disabled={reprocessando || carregando}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.25) 0%, rgba(59, 130, 246, 0.15) 100%)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: 'var(--accent-blue)',
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: reprocessando || carregando ? 'not-allowed' : 'pointer',
            }}
          >
            <Sparkles size={14} className={reprocessando ? 'spin' : ''} />
            <span>{reprocessando ? 'Reprocessando...' : 'Reprocessar Malha Fina'}</span>
          </button>

          <button
            type="button"
            onClick={carregarSuspeitas}
            disabled={carregando}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(30, 41, 59, 0.6)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: carregando ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={14} className={carregando ? 'spin' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Card de Resumo de Valores das Pendências */}
      {!carregando && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          {/* Card Principal: Total Geral das Pendências */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(30, 41, 59, 0.6) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(56, 189, 248, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: 'var(--brand-primary)',
              }}
            >
              <Wallet size={22} />
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Valor Total das Pendências
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand-primary)', marginTop: '2px' }}>
                {totaisValores.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                {suspeitas.totalPendentes} {suspeitas.totalPendentes === 1 ? 'item pendente' : 'itens pendentes'} de validação
              </div>
            </div>
          </div>

          {/* Subcard: Duplicatas */}
          {suspeitas.suspeitasDuplicatas.length > 0 && (
            <div
              onClick={() => setAbaAtiva('DUPLICATAS')}
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, border-color 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--status-red)', fontWeight: 600 }}>
                  Duplicatas em Disputa
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {suspeitas.suspeitasDuplicatas.length}
                </span>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                {totaisValores.totalDuplicatas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </div>
            </div>
          )}

          {/* Subcard: Aportes */}
          {suspeitas.suspeitasAportes.length > 0 && (
            <div
              onClick={() => setAbaAtiva('APORTES')}
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(168, 85, 247, 0.06)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, border-color 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--brand-secondary)', fontWeight: 600 }}>
                  Aportes / Investimentos
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {suspeitas.suspeitasAportes.length}
                </span>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                {totaisValores.totalAportes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </div>
            </div>
          )}

          {/* Subcard: Categorização */}
          {suspeitas.suspeitasCategorizacao.length > 0 && (
            <div
              onClick={() => setAbaAtiva('CATEGORIAS')}
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(234, 179, 8, 0.06)',
                border: '1px solid rgba(234, 179, 8, 0.25)',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, border-color 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--status-yellow)', fontWeight: 600 }}>
                  Categorização Pendente
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {suspeitas.suspeitasCategorizacao.length}
                </span>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                {totaisValores.totalCategorizacao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alerta de Imunização Soberana */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
        }}
      >
        <Info size={18} color="var(--brand-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          <strong>Blindagem de Decisão:</strong> Todo veredito emitido nesta central grava um selo imutável de validação humana. Workers automáticos, scripts de importação e rotinas de login nunca reprocessam nem alteram registros validados por você.
        </div>
      </div>

      {/* Filtros em Abas */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}
      >
        <button
          type="button"
          onClick={() => setAbaAtiva('TODOS')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
            background: abaAtiva === 'TODOS' ? 'var(--brand-primary)' : 'rgba(30, 41, 59, 0.5)',
            color: abaAtiva === 'TODOS' ? '#fff' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>Todos ({suspeitas.totalPendentes})</span>
          {totaisValores.totalGeral > 0 && (
            <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
              • {totaisValores.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setAbaAtiva('DUPLICATAS')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
            background: abaAtiva === 'DUPLICATAS' ? 'var(--status-red)' : 'rgba(30, 41, 59, 0.5)',
            color: abaAtiva === 'DUPLICATAS' ? '#fff' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>Duplicatas ({suspeitas.suspeitasDuplicatas.length})</span>
          {totaisValores.totalDuplicatas > 0 && (
            <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
              • {totaisValores.totalDuplicatas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setAbaAtiva('APORTES')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
            background: abaAtiva === 'APORTES' ? 'var(--brand-secondary)' : 'rgba(30, 41, 59, 0.5)',
            color: abaAtiva === 'APORTES' ? '#fff' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>Aportes / Investimentos ({suspeitas.suspeitasAportes.length})</span>
          {totaisValores.totalAportes > 0 && (
            <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
              • {totaisValores.totalAportes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setAbaAtiva('CATEGORIAS')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
            background: abaAtiva === 'CATEGORIAS' ? 'var(--status-yellow)' : 'rgba(30, 41, 59, 0.5)',
            color: abaAtiva === 'CATEGORIAS' ? '#000' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>Categorização ({suspeitas.suspeitasCategorizacao.length})</span>
          {totaisValores.totalCategorizacao > 0 && (
            <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
              • {totaisValores.totalCategorizacao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          )}
        </button>
      </div>

      {/* Barra de Ordenação */}
      {suspeitas.totalPendentes > 0 && !carregando && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            padding: '10px 14px',
            background: 'rgba(30, 41, 59, 0.4)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <ArrowUpDown size={16} color="var(--brand-primary)" />
            <span>Ordenar itens por:</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <select
              aria-label="Critério de ordenação das suspeitas"
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as CriterioOrdenacao)}
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="VALOR_DESC">💰 Maior Valor (Padrão)</option>
              <option value="VALOR_ASC">💰 Menor Valor</option>
              <option value="DATA_DESC">📅 Mais Recentes Primeiro</option>
              <option value="DATA_ASC">📅 Mais Antigos Primeiro</option>
              <option value="ALFABETICA_ASC">🔤 Ordem Alfabética (A-Z)</option>
              <option value="ALFABETICA_DESC">🔤 Ordem Alfabética (Z-A)</option>
            </select>
          </div>
        </div>
      )}

      {/* Lista de Cards ou Mensagem Vazia */}
      {carregando ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px auto' }} />
          <div>Auditando lançamentos e carregando divergências...</div>
        </div>
      ) : suspeitas.totalPendentes === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '999px',
              background: 'rgba(34, 197, 94, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--status-green)',
            }}
          >
            <CheckCircle2 size={32} />
          </div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>
            Tudo em ordem! Nenhuma suspeita pendente
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '420px', margin: 0 }}>
            Todos os seus lançamentos importados foram validados pela malha fina e não há duplicatas ou inconsistências de natureza a arbitrar.
          </p>
          {onNavigateTab && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => onNavigateTab('lancamentos')}
              style={{ marginTop: '8px', fontSize: '0.85rem' }}
            >
              Ver Extrato Completo <ArrowRight size={14} />
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {(abaAtiva === 'TODOS' || abaAtiva === 'DUPLICATAS') &&
            duplicatasOrdenadas.map(renderDuplicataCard)}

          {(abaAtiva === 'TODOS' || abaAtiva === 'APORTES') &&
            aportesOrdenados.map(renderAporteCard)}

          {(abaAtiva === 'TODOS' || abaAtiva === 'CATEGORIAS') &&
            categorizacoesOrdenadas.map(renderCategorizacaoCard)}
        </div>
      )}
    </div>
  );
};
