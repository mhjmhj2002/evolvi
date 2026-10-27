import React, { useState, useEffect } from 'react';
import {
  AportesResponse,
  ContaItem,
  apiService,
} from '../api.ts';
import {
  TrendingUp,
  Plus,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  PiggyBank,
  CheckCircle2,
  AlertCircle,
  Clock,
  Landmark,
  Trash2,
  X,
} from 'lucide-react';

interface TelaInvestimentosProps {
  usuarioId?: string;
  contas: ContaItem[];
  onAporteCriado?: () => void;
  onNavigateTab?: (tab: any) => void;
}

export const TelaInvestimentos: React.FC<TelaInvestimentosProps> = ({
  usuarioId,
  contas,
  onAporteCriado,
  onNavigateTab: _onNavigateTab,
}) => {
  // Competência padrão (Ano-Mês atual ou 2026-10 de referência)
  const [competencia, setCompetencia] = useState<string>('2026-10');
  const [busca, setBusca] = useState<string>('');
  const [filtroContaId, setFiltroContaId] = useState<string>('');
  const [carregando, setCarregando] = useState<boolean>(true);
  const [dadosAportes, setDadosAportes] = useState<AportesResponse>({
    resumo: {
      totalAportado: 0,
      quantidadeAportes: 0,
      ultimaAplicacao: null,
    },
    paginacao: {
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 1,
    },
    aportes: [],
  });

  // Modal de Novo Aporte Manual
  const [modalNovoAberto, setModalNovoAberto] = useState<boolean>(false);
  const [salvandoAporte, setSalvandoAporte] = useState<boolean>(false);
  const [formAporteData, setFormAporteData] = useState<string>('2026-10-15');
  const [formAporteContaId, setFormAporteContaId] = useState<string>('');
  const [formAporteDescricao, setFormAporteDescricao] = useState<string>('');
  const [formAporteValor, setFormAporteValor] = useState<string>('');
  const [formAporteProdutoTipo, setFormAporteProdutoTipo] = useState<string>('CDB');
  const [formAporteObservacao, setFormAporteObservacao] = useState<string>('');
  const [feedbackModal, setFeedbackModal] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Exclusão de aporte
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [feedbackTela, setFeedbackTela] = useState<string | null>(null);

  // Inicializa conta padrão no formulário
  useEffect(() => {
    if (contas.length > 0 && !formAporteContaId) {
      // Prioriza conta do tipo INVESTIMENTO_RESERVA se houver
      const contaInv = contas.find((c) => c.tipo === 'INVESTIMENTO_RESERVA');
      setFormAporteContaId(contaInv ? contaInv.id : contas[0].id);
    }
  }, [contas, formAporteContaId]);

  const carregarAportes = async () => {
    setCarregando(true);
    try {
      const res = await apiService.getAportes({
        competencia,
        contaId: filtroContaId || undefined,
        busca: busca.trim() || undefined,
      });
      setDadosAportes(res);
    } catch (err) {
      console.warn('Erro ao carregar aportes:', err);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarAportes();
  }, [competencia, filtroContaId, usuarioId]);

  // Navegação de mês
  const mudarMes = (delta: number) => {
    const [anoStr, mesStr] = competencia.split('-');
    let ano = parseInt(anoStr, 10);
    let mes = parseInt(mesStr, 10) + delta;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    } else if (mes < 1) {
      mes = 12;
      ano -= 1;
    }
    setCompetencia(`${ano}-${String(mes).padStart(2, '0')}`);
  };

  const formatarMesAno = (comp: string) => {
    const [ano, mes] = comp.split('-');
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const nomeMes = meses[parseInt(mes, 10) - 1] || mes;
    return `${nomeMes} de ${ano}`;
  };

  const handleSalvarAporteManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackModal(null);

    const valorNum = parseFloat(formAporteValor.replace(',', '.'));
    if (!valorNum || valorNum <= 0) {
      setFeedbackModal({ tipo: 'erro', texto: 'Informe um valor válido e positivo.' });
      return;
    }

    if (!formAporteContaId) {
      setFeedbackModal({ tipo: 'erro', texto: 'Selecione a conta de origem do investimento.' });
      return;
    }

    if (!formAporteDescricao.trim()) {
      setFeedbackModal({ tipo: 'erro', texto: 'Informe a descrição do produto ou aplicação.' });
      return;
    }

    setSalvandoAporte(true);
    try {
      const res = await apiService.criarAporteManual({
        dataAporte: formAporteData,
        contaId: formAporteContaId,
        descricao: formAporteDescricao.trim(),
        valor: valorNum,
        produtoTipo: formAporteProdutoTipo,
        observacao: formAporteObservacao.trim() || null,
      });

      setFeedbackModal({ tipo: 'sucesso', texto: res.message || 'Aporte registrado com sucesso!' });
      await carregarAportes();
      onAporteCriado?.();

      setTimeout(() => {
        setModalNovoAberto(false);
        setFormAporteDescricao('');
        setFormAporteValor('');
        setFormAporteObservacao('');
        setFeedbackModal(null);
      }, 900);
    } catch (err: any) {
      setFeedbackModal({ tipo: 'erro', texto: err.message || 'Erro ao registrar aporte.' });
    } finally {
      setSalvandoAporte(false);
    }
  };

  const handleExcluirAporte = async (id: string) => {
    if (!confirm('Deseja realmente excluir este registro de aporte?')) return;
    setExcluindoId(id);
    try {
      await apiService.excluirMovimento(id);
      setFeedbackTela('Aporte removido com sucesso.');
      await carregarAportes();
      onAporteCriado?.();
      setTimeout(() => setFeedbackTela(null), 3000);
    } catch (err: any) {
      setFeedbackTela(err.message || 'Erro ao excluir aporte.');
      setTimeout(() => setFeedbackTela(null), 3000);
    } finally {
      setExcluindoId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '30px' }}>
      {/* 1. Header com Título e Ação Rápida */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Construção Patrimonial • Fase 1 Light
            </span>
            <span style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '4px',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: 'var(--brand-primary)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}>
              Fase 2 Ready
            </span>
          </div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '2px' }}>
            Investimentos & Aportes
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setModalNovoAberto(true)}
          className="btn-primary"
          style={{
            padding: '8px 14px',
            fontSize: '0.85rem',
            minHeight: '38px',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 2px 10px rgba(56, 189, 248, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Plus size={16} /> Novo Aporte
        </button>
      </div>

      {feedbackTela && (
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
          <CheckCircle2 size={16} /> {feedbackTela}
        </div>
      )}

      {/* 2. Banner Educativo / Conector com a Fase 2 */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.15) 0%, rgba(99, 102, 241, 0.12) 100%)',
          borderColor: 'rgba(56, 189, 248, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 16px',
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(56, 189, 248, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--brand-primary)',
            flexShrink: 0,
          }}
        >
          <PiggyBank size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Seus Aportes Não Afetam o Zero a Zero
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Aplicações em CDB, Tesouro e Fundos são classificadas como <strong>Aporte Patrimonial</strong>. Elas ficam isoladas dos gastos de consumo da Fase 1 e formarão a sua <strong>Reserva de Emergência da Fase 2</strong>.
          </div>
        </div>
      </div>

      {/* 3. Barra de Seleção de Mês/Competência */}
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
              {formatarMesAno(competencia)}
            </span>
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            Competência {competencia}
          </span>
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

      {/* 4. Três Cards Rápidos de KPIs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px',
        }}
      >
        {/* KPI 1: Total Aportado */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            boxShadow: '0 4px 16px rgba(56, 189, 248, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Aportado no Mês
            </span>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={14} color="var(--brand-primary)" />
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.15rem',
              color: 'var(--brand-primary)',
            }}
          >
            {dadosAportes.resumo.totalAportado.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
        </div>

        {/* KPI 2: Quantidade de Aportes */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Aplicações
            </span>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(129, 140, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={14} color="var(--brand-secondary)" />
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: '1.15rem',
              color: 'var(--text-primary)',
            }}
          >
            {dadosAportes.resumo.quantidadeAportes} aporte(s)
          </div>
        </div>

        {/* KPI 3: Última Aplicação */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Último Aporte
            </span>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(34, 197, 94, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={14} color="var(--status-green)" />
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: '0.98rem',
              color: dadosAportes.resumo.ultimaAplicacao ? 'var(--status-green)' : 'var(--text-muted)',
            }}
          >
            {dadosAportes.resumo.ultimaAplicacao
              ? dadosAportes.resumo.ultimaAplicacao.split('-').reverse().join('/')
              : 'Nenhum'}
          </div>
        </div>
      </div>

      {/* 5. Filtros Rápidos (Busca e Conta) */}
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
            style={{
              position: 'absolute',
              left: '12px',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            className="form-input"
            placeholder="Buscar por descrição, produto ou observação..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') carregarAportes();
            }}
            style={{
              paddingLeft: '36px',
              fontSize: '0.85rem',
              height: '38px',
            }}
          />
          {busca && (
            <button
              type="button"
              onClick={() => {
                setBusca('');
                setTimeout(() => carregarAportes(), 50);
              }}
              style={{
                position: 'absolute',
                right: '10px',
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

        <select
          className="form-select"
          value={filtroContaId}
          onChange={(e) => setFiltroContaId(e.target.value)}
          style={{ width: '160px', height: '38px', fontSize: '0.82rem' }}
        >
          <option value="">Todas as Contas</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>

      {/* 6. Listagem de Aportes Realizados */}
      <div className="card" style={{ padding: '0px', overflow: 'hidden' }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Landmark size={16} color="var(--brand-primary)" />
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
              Histórico de Aplicações do Mês
            </span>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {dadosAportes.aportes.length} registro(s)
          </span>
        </div>

        {carregando ? (
          <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
            Carregando aplicações financeiras...
          </div>
        ) : dadosAportes.aportes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <PiggyBank size={36} color="var(--text-muted)" style={{ margin: '0 auto 10px', opacity: 0.6 }} />
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              Nenhum aporte registrado em {formatarMesAno(competencia)}
            </div>
            <p style={{ fontSize: '0.8rem', marginTop: '4px', maxWidth: '340px', margin: '4px auto 14px' }}>
              Extratos bancários com investimentos são catalogados automaticamente aqui, ou você pode registrar manualmente.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setModalNovoAberto(true)}
              style={{ fontSize: '0.85rem', padding: '6px 16px' }}
            >
              <Plus size={16} /> Inserir Primeiro Aporte
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {dadosAportes.aportes.map((item, idx) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom:
                    idx < dadosAportes.aportes.length - 1
                      ? '1px solid var(--border-subtle)'
                      : 'none',
                  backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                  transition: 'background 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'rgba(56, 189, 248, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--brand-primary)',
                      flexShrink: 0,
                    }}
                  >
                    <TrendingUp size={18} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.descricao}
                      </span>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          backgroundColor: 'rgba(129, 140, 248, 0.15)',
                          color: 'var(--brand-secondary)',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {item.produtoTipo}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.74rem',
                        color: 'var(--text-muted)',
                        marginTop: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{item.dataMovimento.split('-').reverse().join('/')}</span>
                      <span>•</span>
                      <span>{item.conta?.nome || 'Conta'}</span>
                      {item.observacao && (
                        <>
                          <span>•</span>
                          <span style={{ fontStyle: 'italic' }}>{item.observacao}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 800,
                        fontSize: '0.96rem',
                        color: 'var(--brand-primary)',
                      }}
                    >
                      {item.valor.toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </div>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        color: 'var(--status-green)',
                        fontWeight: 600,
                      }}
                    >
                      Patrimonial
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleExcluirAporte(item.id)}
                    disabled={excluindoId === item.id}
                    title="Excluir este aporte"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.2s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--status-red)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 7. Modal de Registro de Novo Aporte Manual */}
      {modalNovoAberto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
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
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PiggyBank size={20} color="var(--brand-primary)" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Novo Aporte Manual</h2>
              </div>
              <button
                type="button"
                onClick={() => setModalNovoAberto(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {feedbackModal && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor:
                    feedbackModal.tipo === 'sucesso'
                      ? 'rgba(34, 197, 94, 0.15)'
                      : 'rgba(239, 68, 68, 0.15)',
                  border:
                    feedbackModal.tipo === 'sucesso'
                      ? '1px solid rgba(34, 197, 94, 0.4)'
                      : '1px solid rgba(239, 68, 68, 0.4)',
                  color:
                    feedbackModal.tipo === 'sucesso' ? 'var(--status-green)' : 'var(--status-red)',
                }}
              >
                {feedbackModal.tipo === 'sucesso' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {feedbackModal.texto}
              </div>
            )}

            <form
              onSubmit={handleSalvarAporteManual}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Data do Aporte</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formAporteData}
                    onChange={(e) => setFormAporteData(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Valor Aplicado (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="form-input"
                    placeholder="0,00"
                    value={formAporteValor}
                    onChange={(e) => setFormAporteValor(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Conta de Origem</label>
                <select
                  className="form-select"
                  value={formAporteContaId}
                  onChange={(e) => setFormAporteContaId(e.target.value)}
                  required
                >
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.tipo})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Descrição / Ativo</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: CDB Pós 100% CDI, Tesouro Selic 2029"
                    value={formAporteDescricao}
                    onChange={(e) => setFormAporteDescricao(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Tipo de Produto</label>
                  <select
                    className="form-select"
                    value={formAporteProdutoTipo}
                    onChange={(e) => setFormAporteProdutoTipo(e.target.value)}
                  >
                    <option value="CDB">CDB</option>
                    <option value="RDB">RDB</option>
                    <option value="Tesouro Direto">Tesouro Direto</option>
                    <option value="LCI/LCA">LCI / LCA</option>
                    <option value="Fundo de Investimento">Fundo</option>
                    <option value="Poupança">Poupança</option>
                    <option value="Ações">Ações</option>
                    <option value="FII">FII</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Observações Adicionais (Opcional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: Liquidez diária, banco Inter, prazo 2 anos"
                  value={formAporteObservacao}
                  onChange={(e) => setFormAporteObservacao(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setModalNovoAberto(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoAporte}
                  className="btn-primary"
                  style={{ padding: '8px 20px', fontSize: '0.85rem' }}
                >
                  {salvandoAporte ? 'Salvando...' : 'Confirmar Aporte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
