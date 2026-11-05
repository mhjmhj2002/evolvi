import React, { useState, useEffect } from 'react';
import {
  RegraExclusaoMediaItem,
  ExclusaoMovimentoMediaItem,
  LancamentoPesquisaMediaItem,
  MediaConsolidadaResponse,
  CategoriaTreeItem,
  apiService,
} from '../api.ts';
import { formatarDataIso } from '../utils/data.ts';
import {
  Search,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Layers,
  X,
  Ban,
} from 'lucide-react';

interface GerenciadorMediaRegrasProps {
  categorias: CategoriaTreeItem[];
}

export const GerenciadorMediaRegras: React.FC<GerenciadorMediaRegrasProps> = ({ categorias }) => {
  // Aba interna da seção
  const [subSecao, setSubSecao] = useState<'consolidado' | 'regras' | 'exclusoes' | 'pesquisa'>('consolidado');

  // Estados de dados
  const [consolidado, setConsolidado] = useState<MediaConsolidadaResponse | null>(null);
  const [regras, setRegras] = useState<RegraExclusaoMediaItem[]>([]);
  const [exclusoes, setExclusoes] = useState<ExclusaoMovimentoMediaItem[]>([]);
  const [lancamentosBusca, setLancamentosBusca] = useState<LancamentoPesquisaMediaItem[]>([]);

  // Estados de carregamento e mensagens
  const [loadingConsolidado, setLoadingConsolidado] = useState(false);
  const [loadingRegras, setLoadingRegras] = useState(false);
  const [loadingExclusoes, setLoadingExclusoes] = useState(false);
  const [loadingBusca, setLoadingBusca] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Estados para pesquisa de lançamentos
  const [termoBusca, setTermoBusca] = useState('');
  const [categoriaBusca, setCategoriaBusca] = useState('');
  const [apenasExcluidosBusca, setApenasExcluidosBusca] = useState(false);

  // Modal de inclusão manual de exclusão
  const [modalExclusaoManualAberto, setModalExclusaoManualAberto] = useState(false);
  const [movimentoParaExcluir, setMovimentoParaExcluir] = useState<LancamentoPesquisaMediaItem | null>(null);
  const [motivoManualInput, setMotivoManualInput] = useState('');
  const [salvandoManual, setSalvandoManual] = useState(false);

  // Modal / Formulário de Criação de Regra
  const [modalNovaRegraAberto, setModalNovaRegraAberto] = useState(false);
  const [formDescricaoPadrao, setFormDescricaoPadrao] = useState('');
  const [formCategoriaId, setFormCategoriaId] = useState('');
  const [formValorMinimo, setFormValorMinimo] = useState('');
  const [formApenasUmaVez, setFormApenasUmaVez] = useState(true);
  const [formMotivo, setFormMotivo] = useState('');
  const [salvandoRegra, setSalvandoRegra] = useState(false);

  // Ações de Carregamento
  const carregarConsolidado = async () => {
    try {
      setLoadingConsolidado(true);
      const res = await apiService.getMediaMensalConsolidada();
      setConsolidado(res);
    } catch (err: any) {
      console.warn('Erro ao carregar dados consolidados da média:', err);
    } finally {
      setLoadingConsolidado(false);
    }
  };

  const carregarRegras = async () => {
    try {
      setLoadingRegras(true);
      const res = await apiService.getRegrasExclusaoMedia();
      setRegras(res);
    } catch (err: any) {
      console.warn('Erro ao carregar regras de exclusão:', err);
    } finally {
      setLoadingRegras(false);
    }
  };

  const carregarExclusoes = async () => {
    try {
      setLoadingExclusoes(true);
      const res = await apiService.getExclusoesMovimentoMedia();
      setExclusoes(res);
    } catch (err: any) {
      console.warn('Erro ao carregar exclusões:', err);
    } finally {
      setLoadingExclusoes(false);
    }
  };

  const executarPesquisa = async () => {
    try {
      setLoadingBusca(true);
      const res = await apiService.pesquisarLancamentosParaExclusao({
        termo: termoBusca.trim() || undefined,
        categoriaId: categoriaBusca || undefined,
        apenasExcluidos: apenasExcluidosBusca || undefined,
      });
      setLancamentosBusca(res);
    } catch (err: any) {
      console.warn('Erro ao pesquisar lançamentos:', err);
    } finally {
      setLoadingBusca(false);
    }
  };

  useEffect(() => {
    carregarConsolidado();
    carregarRegras();
    carregarExclusoes();
    executarPesquisa();
  }, []);

  const handleRecalcular = async () => {
    try {
      setRecalculando(true);
      setMensagem(null);
      await apiService.recalcularMediaMensal();
      await Promise.all([carregarConsolidado(), carregarExclusoes(), executarPesquisa()]);
      setMensagem({ tipo: 'sucesso', texto: 'Médias e regras recalculadas com sucesso!' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao recalcular médias.' });
    } finally {
      setRecalculando(false);
    }
  };

  const handleCriarRegra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDescricaoPadrao && !formCategoriaId && !formValorMinimo) {
      setMensagem({ tipo: 'erro', texto: 'Preencha pelo menos um critério (termo, categoria ou valor mínimo).' });
      return;
    }

    try {
      setSalvandoRegra(true);
      setMensagem(null);
      await apiService.criarRegraExclusaoMedia({
        descricaoPadrao: formDescricaoPadrao.trim() || null,
        categoriaId: formCategoriaId || null,
        valorMinimo: formValorMinimo ? parseFloat(formValorMinimo) : null,
        apenasUmaVez: formApenasUmaVez,
        motivo: formMotivo.trim() || 'Regra de desconsideração da média',
      });
      setModalNovaRegraAberto(false);
      setFormDescricaoPadrao('');
      setFormCategoriaId('');
      setFormValorMinimo('');
      setFormMotivo('');
      setFormApenasUmaVez(true);
      await Promise.all([carregarRegras(), carregarConsolidado(), carregarExclusoes(), executarPesquisa()]);
      setMensagem({ tipo: 'sucesso', texto: 'Nova regra de exclusão cadastrada e médias consolidadas!' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao criar regra de exclusão.' });
    } finally {
      setSalvandoRegra(false);
    }
  };

  const handleExcluirRegra = async (id: string) => {
    if (!window.confirm('Deseja realmente remover esta regra? As médias serão recalculadas.')) return;
    try {
      setMensagem(null);
      await apiService.excluirRegraExclusaoMedia(id);
      await Promise.all([carregarRegras(), carregarConsolidado(), carregarExclusoes(), executarPesquisa()]);
      setMensagem({ tipo: 'sucesso', texto: 'Regra removida com sucesso.' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao remover regra.' });
    }
  };

  const handleAlternarRegraStatus = async (regra: RegraExclusaoMediaItem) => {
    try {
      setMensagem(null);
      await apiService.atualizarRegraExclusaoMedia(regra.id, {
        ativo: !regra.ativo,
      });
      await Promise.all([carregarRegras(), carregarConsolidado(), carregarExclusoes(), executarPesquisa()]);
      setMensagem({ tipo: 'sucesso', texto: `Regra ${!regra.ativo ? 'ativada' : 'desativada'} com sucesso.` });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao atualizar status da regra.' });
    }
  };

  const handleAbrirModalExclusaoManual = (item: LancamentoPesquisaMediaItem) => {
    setMovimentoParaExcluir(item);
    setMotivoManualInput('Gasto pontual que não irá se repetir (fora da média)');
    setModalExclusaoManualAberto(true);
  };

  const handleConfirmarExclusaoManual = async () => {
    if (!movimentoParaExcluir) return;
    try {
      setSalvandoManual(true);
      setMensagem(null);
      await apiService.incluirExclusaoManualMedia({
        movimentoId: movimentoParaExcluir.id,
        motivo: motivoManualInput.trim() || 'Gasto único desconsiderado da média',
      });
      setModalExclusaoManualAberto(false);
      setMovimentoParaExcluir(null);
      await Promise.all([carregarConsolidado(), carregarExclusoes(), executarPesquisa()]);
      setMensagem({ tipo: 'sucesso', texto: 'Lançamento excluído da média histórica com sucesso!' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao excluir lançamento da média.' });
    } finally {
      setSalvandoManual(false);
    }
  };

  const handleRestaurarParaMedia = async (exclusaoId: string) => {
    try {
      setMensagem(null);
      await apiService.removerExclusaoMedia(exclusaoId);
      await Promise.all([carregarConsolidado(), carregarExclusoes(), executarPesquisa()]);
      setMensagem({ tipo: 'sucesso', texto: 'Lançamento restaurado para o cálculo da média.' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao restaurar lançamento.' });
    }
  };

  const formatarMoeda = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header do Módulo com Explicação e Ação de Recálculo */}
      <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="login-logo-badge" style={{ width: 44, height: 44, margin: 0, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
              <Ban size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                Gestão da Média & Gastos Únicos
                <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', fontWeight: 600 }}>
                  TASK-53
                </span>
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Exclua gastos esporádicos (ex: viagens isoladas, reformas) para evitar inflar a média de consumo da Fase 1
              </p>
            </div>
          </div>

          <button
            type="button"
            className="auth-btn-primary"
            onClick={handleRecalcular}
            disabled={recalculando}
            style={{ width: 'auto', padding: '8px 16px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} className={recalculando ? 'spinner' : ''} />
            <span>{recalculando ? 'Recalculando...' : 'Recalcular Médias'}</span>
          </button>
        </div>

        {mensagem && (
          <div
            className={mensagem.tipo === 'sucesso' ? 'login-success-alert' : 'login-error-alert'}
            style={{ marginTop: '16px' }}
          >
            {mensagem.tipo === 'sucesso' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{mensagem.texto}</span>
          </div>
        )}

        {/* Alerta de Dados Insuficientes para Cálculo da Média */}
        {consolidado?.dadosInsuficientes && (
          <div
            style={{
              marginTop: '16px',
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 700, color: '#ef4444', fontSize: '0.92rem' }}>
                Dados insuficientes para realizar o cálculo da média
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.45 }}>
                {consolidado.mensagem ||
                  'Adicione pelo menos 3 meses em sequência de lançamentos para calcular a média de consumo com fidelidade estatística.'}
              </div>
            </div>
          </div>
        )}

        {/* Cards de Resumo da Consolidação (Exibidos apenas com dados suficientes) */}
        {!consolidado?.dadosInsuficientes && consolidado?.global && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '16px' }}>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Total Bruto ({consolidado.mesesJanela}M)</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                {formatarMoeda(consolidado.global.totalPeriodoBruto)}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {consolidado.global.qtdLancamentosTotais} despesas avaliadas
              </div>
            </div>

            <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.74rem', color: '#ef4444' }}>Total Excluído da Média</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ef4444', marginTop: '4px' }}>
                - {formatarMoeda(consolidado.global.totalExcluido)}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {consolidado.global.qtdLancamentosExcluidos} lançamentos desconsiderados
              </div>
            </div>

            <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.74rem', color: '#10b981' }}>Total Efetivo de Consumo</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
                {formatarMoeda(consolidado.global.totalPeriodoEfetivo)}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Base real sem distorção
              </div>
            </div>

            <div style={{ background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--brand-primary)' }}>Média Mensal Efetiva</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand-primary)', marginTop: '4px' }}>
                {formatarMoeda(consolidado.global.mediaMensalEfetiva)}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Parâmetro mestre das metas
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Menu de Navegação das Abas Internas */}
      <div className="auth-tabs-nav" style={{ margin: 0 }}>
        <button
          type="button"
          className={`auth-tab-btn ${subSecao === 'consolidado' ? 'active' : ''}`}
          onClick={() => setSubSecao('consolidado')}
        >
          <Layers size={15} />
          <span>Visão Consolidada por Categoria</span>
        </button>

        <button
          type="button"
          className={`auth-tab-btn ${subSecao === 'exclusoes' ? 'active' : ''}`}
          onClick={() => setSubSecao('exclusoes')}
        >
          <Ban size={15} />
          <span>Gastos Excluídos ({exclusoes.length})</span>
        </button>

        <button
          type="button"
          className={`auth-tab-btn ${subSecao === 'regras' ? 'active' : ''}`}
          onClick={() => setSubSecao('regras')}
        >
          <Sliders size={15} />
          <span>Regras do Motor ({regras.length})</span>
        </button>

        <button
          type="button"
          className={`auth-tab-btn ${subSecao === 'pesquisa' ? 'active' : ''}`}
          onClick={() => setSubSecao('pesquisa')}
        >
          <Search size={15} />
          <span>Pesquisar Lançamentos</span>
        </button>
      </div>

      {/* 3. Seção: Visão Consolidada por Categoria */}
      {subSecao === 'consolidado' && (
        <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
              Detalhamento da Média Efetiva por Grupo de Consumo
            </h3>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {loadingConsolidado ? 'Carregando dados...' : `Janela: ${consolidado?.mesesJanela || 6} Meses`}
            </span>
          </div>

          {consolidado?.dadosInsuficientes ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              <AlertCircle size={24} style={{ color: '#ef4444', margin: '0 auto 8px' }} />
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                Dados insuficientes para realizar o cálculo
              </div>
              <div style={{ marginTop: '4px', fontSize: '0.82rem' }}>
                Adicione pelo menos 3 meses em sequência de lançamentos para visualizar o detalhamento consolidado da média.
              </div>
            </div>
          ) : !consolidado?.categorias || consolidado.categorias.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
              Nenhum dado consolidado disponível no momento. Clique em "Recalcular Médias" acima para processar.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 10px' }}>Categoria</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total Bruto</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Excluído</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total Efetivo</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Média Mensal Efetiva</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Exclusões</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidado?.categorias.map((cat) => (
                    <tr key={cat.categoriaId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px', fontWeight: 600 }}>{cat.nome}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{formatarMoeda(cat.totalPeriodoBruto)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: cat.totalExcluido > 0 ? '#ef4444' : 'var(--text-muted)' }}>
                        {cat.totalExcluido > 0 ? `- ${formatarMoeda(cat.totalExcluido)}` : 'R$ 0,00'}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                        {formatarMoeda(cat.totalPeriodoEfetivo)}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: 'var(--brand-primary)' }}>
                        {formatarMoeda(cat.mediaMensalEfetiva)}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {cat.qtdLancamentosExcluidos > 0 ? (
                          <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontWeight: 700 }}>
                            {cat.qtdLancamentosExcluidos} excluídos
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. Seção: Lançamentos Excluídos da Média */}
      {subSecao === 'exclusoes' && (
        <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                Lançamentos Desconsiderados da Média Histórica
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Estes gastos continuam registrados no extrato, mas não distorcem a sua média de consumo
              </p>
            </div>
            <button
              type="button"
              className="auth-btn-secondary"
              onClick={() => setSubSecao('pesquisa')}
              style={{ width: 'auto', padding: '6px 12px', fontSize: '0.78rem' }}
            >
              <Plus size={14} />
              <span>Excluir Outro Lançamento</span>
            </button>
          </div>

          {loadingExclusoes ? (
            <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
              Carregando exclusões...
            </div>
          ) : exclusoes.length === 0 ? (
            <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
              Nenhum gasto excluído no momento. Todos os lançamentos estão compondo a média normal.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 10px' }}>Data / Comp</th>
                    <th style={{ padding: '8px 10px' }}>Descrição</th>
                    <th style={{ padding: '8px 10px' }}>Categoria / Conta</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Valor</th>
                    <th style={{ padding: '8px 10px' }}>Motivo da Exclusão</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Origem</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {exclusoes.map((exc) => (
                    <tr key={exc.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600 }}>{exc.movimento?.competencia}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {formatarDataIso(exc.movimento?.dataMovimento)}
                        </div>
                      </td>
                      <td style={{ padding: '10px', fontWeight: 600 }}>{exc.movimento?.descricao}</td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontSize: '0.82rem' }}>{exc.movimento?.categoria?.nome || 'Sem categoria'}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{exc.movimento?.conta?.nome}</div>
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>
                        {formatarMoeda(exc.movimento?.valor || 0)}
                      </td>
                      <td style={{ padding: '10px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {exc.motivo}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontWeight: 700,
                            background: exc.origem === 'AUTOMATICA' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: exc.origem === 'AUTOMATICA' ? 'var(--brand-primary)' : '#f59e0b',
                          }}
                        >
                          {exc.origem}
                        </span>
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleRestaurarParaMedia(exc.id)}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                          }}
                          title="Restaurar este lançamento para voltar a compor a média"
                        >
                          Restaurar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 5. Seção: Regras do Motor de Exclusão */}
      {subSecao === 'regras' && (
        <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                Regras Automatizadas de Exclusão
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                O motor aplica essas regras automaticamente após cada importação de arquivos e após cada login
              </p>
            </div>
            <button
              type="button"
              className="auth-btn-primary"
              onClick={() => setModalNovaRegraAberto(true)}
              style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={14} />
              <span>Nova Regra</span>
            </button>
          </div>

          {loadingRegras ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
              Carregando regras de exclusão...
            </div>
          ) : regras.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
              Nenhuma regra personalizada cadastrada. O sistema está utilizando apenas a detecção heurística padrão (compras únicas de viagens e passagens).
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
              {regras.map((regra) => (
                <div
                  key={regra.id}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '10px',
                    opacity: regra.ativo ? 1 : 0.6,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {regra.categoria?.nome || 'Qualquer Categoria'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAlternarRegraStatus(regra)}
                        style={{
                          background: regra.ativo ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                          color: regra.ativo ? '#10b981' : 'var(--text-muted)',
                          border: 'none',
                          borderRadius: '10px',
                          padding: '2px 8px',
                          fontSize: '0.68rem',
                          cursor: 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        {regra.ativo ? 'ATIVA' : 'INATIVA'}
                      </button>
                    </div>

                    <div style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                      {regra.descricaoPadrao ? `Contém "${regra.descricaoPadrao}"` : 'Filtro sem termo de texto'}
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                      {regra.motivo || 'Sem observação'}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                      {regra.valorMinimo && (
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.06)' }}>
                          Mínimo: {formatarMoeda(regra.valorMinimo)}
                        </span>
                      )}
                      {regra.apenasUmaVez && (
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                          Apenas compra única
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                    <button
                      type="button"
                      onClick={() => handleExcluirRegra(regra.id)}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem' }}
                    >
                      <Trash2 size={13} />
                      <span>Excluir</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 6. Seção: Pesquisa de Lançamentos para Inclusão */}
      {subSecao === 'pesquisa' && (
        <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0' }}>
            Pesquisar Lançamentos para Incluir ou Excluir da Média
          </h3>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ flex: '1 1 200px', position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Buscar por descrição (ex: Chile, Reforma, Notebook)..."
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && executarPesquisa()}
                style={{ paddingLeft: '32px' }}
              />
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '12px', color: 'var(--text-muted)' }} />
            </div>

            <div style={{ flex: '0 1 180px' }}>
              <select
                className="form-input"
                value={categoriaBusca}
                onChange={(e) => setCategoriaBusca(e.target.value)}
              >
                <option value="">Todas as categorias</option>
                {categorias.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.nome}</option>
                ))}
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={apenasExcluidosBusca}
                onChange={(e) => setApenasExcluidosBusca(e.target.checked)}
              />
              Apenas já excluídos
            </label>

            <button
              type="button"
              className="auth-btn-primary"
              onClick={executarPesquisa}
              disabled={loadingBusca}
              style={{ width: 'auto', padding: '8px 16px', fontSize: '0.82rem' }}
            >
              {loadingBusca ? 'Buscando...' : 'Filtrar'}
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 10px' }}>Competência</th>
                  <th style={{ padding: '8px 10px' }}>Descrição</th>
                  <th style={{ padding: '8px 10px' }}>Categoria / Conta</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Valor</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>Status na Média</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {lancamentosBusca.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Nenhum lançamento encontrado para os critérios pesquisados.
                    </td>
                  </tr>
                ) : (
                  lancamentosBusca.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px' }}>{item.competencia}</td>
                      <td style={{ padding: '10px', fontWeight: 600 }}>{item.descricao}</td>
                      <td style={{ padding: '10px' }}>
                        <div>{item.categoriaNome}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.contaNome}</div>
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>
                        {formatarMoeda(item.valor)}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {item.excluidoDaMedia ? (
                          <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontWeight: 700 }}>
                            EXCLUÍDO DA MÉDIA
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontWeight: 600 }}>
                            Na Média
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {item.excluidoDaMedia ? (
                          <button
                            type="button"
                            onClick={() => item.exclusaoId && handleRestaurarParaMedia(item.exclusaoId)}
                            style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
                          >
                            Restaurar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAbrirModalExclusaoManual(item)}
                            style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
                          >
                            Excluir da Média
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. Modal de Exclusão Manual */}
      {modalExclusaoManualAberto && movimentoParaExcluir && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '460px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Desconsiderar Lançamento da Média</h3>
              <button
                type="button"
                onClick={() => setModalExclusaoManualAberto(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
              Ao excluir, o lançamento permanecerá nos extratos, mas não será contabilizado na média histórica de consumo.
            </p>

            <div style={{ background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '14px', fontSize: '0.84rem' }}>
              <div style={{ fontWeight: 700 }}>{movimentoParaExcluir.descricao}</div>
              <div style={{ color: 'var(--brand-primary)', fontWeight: 800, marginTop: '2px' }}>
                {formatarMoeda(movimentoParaExcluir.valor)} ({movimentoParaExcluir.competencia})
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Motivo da Exclusão</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Compra de viagem pontual que não irá se repetir"
                value={motivoManualInput}
                onChange={(e) => setMotivoManualInput(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="auth-btn-secondary"
                onClick={() => setModalExclusaoManualAberto(false)}
                style={{ width: 'auto' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="auth-btn-primary"
                onClick={handleConfirmarExclusaoManual}
                disabled={salvandoManual}
                style={{ width: 'auto', background: '#ef4444' }}
              >
                {salvandoManual ? 'Salvando...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Modal de Criação de Nova Regra */}
      {modalNovaRegraAberto && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Nova Regra para o Motor de Exclusão</h3>
              <button
                type="button"
                onClick={() => setModalNovaRegraAberto(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCriarRegra} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label className="form-label">Termo de Texto na Descrição (opcional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: REFORMA, CHILE, PASSAGEM, CIRURGIA"
                  value={formDescricaoPadrao}
                  onChange={(e) => setFormDescricaoPadrao(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Categoria Alvo (opcional)</label>
                <select
                  className="form-input"
                  value={formCategoriaId}
                  onChange={(e) => setFormCategoriaId(e.target.value)}
                >
                  <option value="">Qualquer Categoria</option>
                  {categorias.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.nome}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Valor Mínimo em R$ (opcional)</label>
                <input
                  type="number"
                  step="0.01"
                  className="form-input"
                  placeholder="Ex: 1000.00"
                  value={formValorMinimo}
                  onChange={(e) => setFormValorMinimo(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.84rem' }}>
                  <input
                    type="checkbox"
                    checked={formApenasUmaVez}
                    onChange={(e) => setFormApenasUmaVez(e.target.checked)}
                  />
                  <span>Aplicar apenas se ocorreu uma única vez no período analisado</span>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Motivo / Justificativa</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: Despesa extraordinária não recorrente"
                  value={formMotivo}
                  onChange={(e) => setFormMotivo(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="auth-btn-secondary"
                  onClick={() => setModalNovaRegraAberto(false)}
                  style={{ width: 'auto' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="auth-btn-primary"
                  disabled={salvandoRegra}
                  style={{ width: 'auto' }}
                >
                  {salvandoRegra ? 'Cadastrando...' : 'Salvar Regra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
