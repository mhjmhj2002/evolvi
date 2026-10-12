import React, { useState, useEffect } from 'react';
import {
  TopBar,
  BottomNav,
  BottomSheet,
  ProtectedRoute,
  FaseAtiva,
  NavTab,
  ModalRegistroIa,
} from './components/index.ts';
import { useAuth } from './context/AuthContext.tsx';
import {
  TelaDashboard,
  TelaDiagnostico,
  TelaCompromissos,
  TelaCadastros,
  TelaFasesEducativas,
} from './screens/index.ts';
import {
  apiService,
  mockPerfil,
  mockBaseline,
  mockSemaforo,
  mockPlanoMetas,
  mockCronogramaVencimentos,
  mockParcelamentos,
  mockContas,
  mockHistoricoResumo,
  mockHistoricoCategorias,
  mockPrevisaoSeisMeses,
  mockDecomposicaoCategorias,
  UsuarioPerfil,
  BaselineResponse,
  SemaforoResponse,
  PlanoMetasResponse,
  CronogramaVencimentosResponse,
  ParcelamentosResponse,
  ContaItem,
  CategoriaTreeItem,
  ItemCronogramaVencimento,
  HistoricoResumoResponse,
  HistoricoCategoriasResponse,
  PrevisaoSeisMesesResponse,
  DecomposicaoCategoriasResponse,
} from './api.ts';
import { CheckCircle2, Sparkles, Bot } from 'lucide-react';

export const App: React.FC = () => {
  const { usuario: authUser, isAuthenticated } = useAuth();
  const [faseAtiva, setFaseAtiva] = useState<FaseAtiva>('FASE_1');
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Estados carregados da API
  const [perfil, setPerfil] = useState<UsuarioPerfil>(authUser || mockPerfil);
  const [baseline, setBaseline] = useState<BaselineResponse>(mockBaseline);
  const [semaforo, setSemaforo] = useState<SemaforoResponse>(mockSemaforo);
  const [planoMetas, setPlanoMetas] = useState<PlanoMetasResponse>(mockPlanoMetas);
  const [cronograma, setCronograma] = useState<CronogramaVencimentosResponse>(mockCronogramaVencimentos);
  const [parcelamentos, setParcelamentos] = useState<ParcelamentosResponse>(mockParcelamentos);
  const [contas, setContas] = useState<ContaItem[]>(mockContas);
  const [categorias, setCategorias] = useState<CategoriaTreeItem[]>([]);
  const [historicoResumo, setHistoricoResumo] = useState<HistoricoResumoResponse>(mockHistoricoResumo);
  const [historicoCategorias, setHistoricoCategorias] = useState<HistoricoCategoriasResponse>(mockHistoricoCategorias);
  const [previsao6M, setPrevisao6M] = useState<PrevisaoSeisMesesResponse>(mockPrevisaoSeisMeses);
  const [decomposicao6M, setDecomposicao6M] = useState<DecomposicaoCategoriasResponse>(mockDecomposicaoCategorias);
  const [totalGastoMes, setTotalGastoMes] = useState<number>(4820.0);

  // Sincroniza perfil se authUser for atualizado
  useEffect(() => {
    if (authUser) {
      setPerfil(authUser);
    }
  }, [authUser]);

  // Estado do formulário de novo lançamento
  const [formDescricao, setFormDescricao] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formNatureza, setFormNatureza] = useState<'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA'>('DESPESA');
  const [formContaId, setFormContaId] = useState('');
  const [formCategoriaId, setFormCategoriaId] = useState('');
  const [formIsPagamentoFatura, setFormIsPagamentoFatura] = useState(false);
  const [formMensagemSucesso, setFormMensagemSucesso] = useState<string | null>(null);

  // Carregar dados ao montar o componente ou quando autenticar
  useEffect(() => {
    if (!isAuthenticated) return;

    async function loadData() {
      try {
        const [
          resPerfil,
          resBaseline,
          resSemaforo,
          resMetas,
          resCronograma,
          resParcelamentos,
          resContas,
          resCategorias,
          resMovimentos,
          resHistResumo,
          resHistCategorias,
          resPrevisao,
          resDecomposicao,
        ] = await Promise.all([
          apiService.getPerfil(),
          apiService.getBaseline(),
          apiService.getSemaforo(),
          apiService.getPlanoMetas(),
          apiService.getVencimentos('2026-10'),
          apiService.getParcelamentos(),
          apiService.getContas(),
          apiService.getCategorias(),
          apiService.getMovimentos('2026-10'),
          apiService.getHistoricoResumo(),
          apiService.getHistoricoCategorias(),
          apiService.getPrevisaoSeisMeses(),
          apiService.getDecomposicaoCategorias('2026-10'),
        ]);

        if (resPerfil) setPerfil(resPerfil);
        if (resBaseline) setBaseline(resBaseline);
        if (resSemaforo) setSemaforo(resSemaforo);
        if (resMetas) setPlanoMetas(resMetas);
        if (resCronograma) setCronograma(resCronograma);
        if (resParcelamentos) setParcelamentos(resParcelamentos);
        if (resHistResumo) setHistoricoResumo(resHistResumo);
        if (resHistCategorias) setHistoricoCategorias(resHistCategorias);
        if (resPrevisao) setPrevisao6M(resPrevisao);
        if (resDecomposicao) setDecomposicao6M(resDecomposicao);
        if (resContas && resContas.length > 0) {
          setContas(resContas);
          setFormContaId(resContas[0].id);
        }
        if (resCategorias && resCategorias.length > 0) {
          setCategorias(resCategorias);
          setFormCategoriaId(resCategorias[0].id);
        }
        if (resMovimentos && resMovimentos.resumo) {
          setTotalGastoMes(resMovimentos.resumo.totalDespesasConsumo);
        }
      } catch (err) {
        console.warn('Erro ao sincronizar dados com o backend, utilizando estado local.', err);
      }
    }

    loadData();
  }, [isAuthenticated]);

  const [isIaModalOpen, setIsIaModalOpen] = useState(false);
  const [formAvisoIa, setFormAvisoIa] = useState<string | null>(null);

  // Handlers
  const handleNovoLancamento = async (e: React.FormEvent) => {
    e.preventDefault();
    const valorNum = parseFloat(formValor.replace(',', '.'));
    if (isNaN(valorNum) || valorNum <= 0) return;

    try {
      const hoje = new Date().toISOString().split('T')[0];
      await apiService.criarMovimento({
        contaId: formContaId || (contas[0]?.id ?? 'cta-cc'),
        categoriaId: formCategoriaId || undefined,
        dataMovimento: hoje,
        descricao: formDescricao,
        valor: valorNum,
        natureza: formNatureza,
        status: 'CONCILIADO',
        isPagamentoFatura: formIsPagamentoFatura,
      });

      // Atualizar o consumo imediatamente no termômetro se for despesa de consumo
      if (formNatureza === 'DESPESA' && !formIsPagamentoFatura) {
        setTotalGastoMes((prev) => Number((prev + valorNum).toFixed(2)));
      }

      setFormMensagemSucesso('Lançamento registrado com sucesso!');
      setTimeout(() => {
        setFormMensagemSucesso(null);
        setIsSheetOpen(false);
        setFormDescricao('');
        setFormValor('');
      }, 1000);
    } catch {
      // Atualização otimista no frontend
      if (formNatureza === 'DESPESA' && !formIsPagamentoFatura) {
        setTotalGastoMes((prev) => Number((prev + valorNum).toFixed(2)));
      }
      setIsSheetOpen(false);
      setFormDescricao('');
      setFormValor('');
    }
  };

  const handleRegistrarPagamentoCronograma = (item: ItemCronogramaVencimento) => {
    // Quando uma conta/boleto é marcado como pago, reflete no total gasto do mês
    setTotalGastoMes((prev) => Number((prev + item.valor).toFixed(2)));
  };

  return (
    <ProtectedRoute>
      <div className="app-container">
        {/* 1. Barra Superior com Seletor de Fases */}
        <TopBar
          faseAtiva={faseAtiva}
          onSelectFase={(fase) => {
            setFaseAtiva(fase);
            if (fase !== 'FASE_1') {
              setActiveTab('fases');
            }
          }}
        />

      {/* 2. Conteúdo Central Dinâmico de acordo com a aba */}
      <main className="main-content">
        {activeTab === 'dashboard' && (
          <TelaDashboard
            perfil={perfil}
            baseline={baseline}
            semaforo={semaforo}
            cronograma={cronograma}
            totalGastoMes={totalGastoMes}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onOpenNovaTransacao={() => setIsSheetOpen(true)}
          />
        )}

        {activeTab === 'semaforo' && (
          <TelaDiagnostico
            baseline={baseline}
            semaforo={semaforo}
            planoMetas={planoMetas}
            historicoResumo={historicoResumo}
            historicoCategorias={historicoCategorias}
            onMetasAtualizadas={(novoPlano) => setPlanoMetas(novoPlano)}
          />
        )}

        {activeTab === 'compromissos' && (
          <TelaCompromissos
            cronograma={cronograma}
            parcelamentos={parcelamentos}
            previsao={previsao6M}
            decomposicao={decomposicao6M}
            onRegistrarPagamento={handleRegistrarPagamentoCronograma}
            onNovoCompromisso={() => setIsSheetOpen(true)}
            onAtualizarPrevisao={async () => {
              const [resPrev, resDec] = await Promise.all([
                apiService.getPrevisaoSeisMeses(),
                apiService.getDecomposicaoCategorias('2026-10'),
              ]);
              if (resPrev) setPrevisao6M(resPrev);
              if (resDec) setDecomposicao6M(resDec);
            }}
          />
        )}

        {activeTab === 'cadastros' && (
          <TelaCadastros
            perfil={perfil}
            contas={contas}
            categorias={categorias}
            onRendaAtualizada={async (novaRenda) => {
              setPerfil((prev) => ({ ...prev, rendaBaseMensal: novaRenda }));
              try {
                const [resBaseline, resSemaforo, resMetas] = await Promise.all([
                  apiService.getBaseline(),
                  apiService.getSemaforo(),
                  apiService.getPlanoMetas(),
                ]);
                if (resBaseline) setBaseline(resBaseline);
                if (resSemaforo) setSemaforo(resSemaforo);
                if (resMetas) setPlanoMetas(resMetas);
              } catch {
                // Modo offline: atualiza baseline e semáforo localmente
                setBaseline((prev) => ({
                  ...prev,
                  renda_base: novaRenda,
                  gap_zero_a_zero: Number((prev.media_mensal - novaRenda).toFixed(2)),
                  pct_excesso_renda: novaRenda > 0 ? Number((((prev.media_mensal - novaRenda) / novaRenda) * 100).toFixed(2)) : 0,
                }));
                setSemaforo((prev) => ({
                  ...prev,
                  renda_base: novaRenda,
                }));
              }
            }}
            onExtratoImportado={async () => {
              try {
                const [resMovimentos, resContas, resBaseline, resSemaforo] = await Promise.all([
                  apiService.getMovimentos('2026-10'),
                  apiService.getContas(),
                  apiService.getBaseline(),
                  apiService.getSemaforo(),
                ]);
                if (resContas) setContas(resContas);
                if (resBaseline) setBaseline(resBaseline);
                if (resSemaforo) setSemaforo(resSemaforo);
                if (resMovimentos?.movimentos) {
                  const totalGasto = resMovimentos.movimentos
                    .filter((m) => m.natureza === 'DESPESA' && m.status === 'CONCILIADO')
                    .reduce((acc, m) => acc + m.valor, 0);
                  setTotalGastoMes(totalGasto);
                }
              } catch {
                // Modo offline
              }
            }}
          />
        )}

        {activeTab === 'fases' && <TelaFasesEducativas />}
      </main>

      {/* 3. Barra de Navegação Inferior Mobile Ergonômica */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'fases') {
            setFaseAtiva('FASE_1');
          }
        }}
        onOpenNewTransaction={() => setIsSheetOpen(true)}
      />

      {/* 4. Bottom Sheet para Registro Rápido de Movimento com Suporte a IA */}
      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
          setIsIaModalOpen(false);
          setFormAvisoIa(null);
        }}
        title={isIaModalOpen ? "Registro com Inteligência Artificial" : "Novo Lançamento Rápido"}
      >
        {isIaModalOpen ? (
          <ModalRegistroIa
            contas={contas}
            categorias={categorias}
            onParsedSucesso={(parsed) => {
              // Preenche os campos do formulário para o usuário conferir (Human-in-the-loop)
              setFormDescricao(parsed.descricao);
              setFormValor(parsed.valor.toFixed(2));
              setFormNatureza(
                parsed.natureza === 'APORTE_PATRIMONIAL'
                  ? 'TRANSFERENCIA_PROPRIA'
                  : parsed.natureza
              );
              if (parsed.contaId) setFormContaId(parsed.contaId);
              if (parsed.categoriaId) setFormCategoriaId(parsed.categoriaId);
              setFormIsPagamentoFatura(parsed.isPagamentoFatura || false);
              setFormAvisoIa('Dados preenchidos pela IA! Por favor, confira os campos antes de confirmar.');
              setIsIaModalOpen(false);
            }}
            onCancelar={() => setIsIaModalOpen(false)}
          />
        ) : formMensagemSucesso ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
              color: 'var(--status-green)',
            }}
          >
            <CheckCircle2 size={36} />
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{formMensagemSucesso}</div>
          </div>
        ) : (
          <form
            onSubmit={handleNovoLancamento}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            {/* Banner de atalho para IA */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(129, 140, 248, 0.15) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} color="var(--brand-primary)" />
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Quer ditar ou colar texto?</span>
              </div>
              <button
                type="button"
                onClick={() => setIsIaModalOpen(true)}
                style={{
                  background: 'var(--brand-primary)',
                  color: 'var(--text-inverse)',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Bot size={13} /> Usar IA (3 Modos)
              </button>
            </div>

            {formAvisoIa && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                fontSize: '0.8rem',
                color: 'var(--brand-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <Sparkles size={14} />
                {formAvisoIa}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Descrição</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Supermercado, Almoço, Gasolina"
                value={formDescricao}
                onChange={(e) => setFormDescricao(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="form-input"
                  placeholder="0,00"
                  value={formValor}
                  onChange={(e) => setFormValor(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Natureza</label>
                <select
                  className="form-select"
                  value={formNatureza}
                  onChange={(e) =>
                    setFormNatureza(
                      e.target.value as 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA'
                    )
                  }
                >
                  <option value="DESPESA">Despesa (Consumo)</option>
                  <option value="RECEITA">Receita</option>
                  <option value="TRANSFERENCIA_PROPRIA">Transferência / Fatura</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Conta</label>
                <select
                  className="form-select"
                  value={formContaId}
                  onChange={(e) => setFormContaId(e.target.value)}
                >
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Categoria POF</label>
                <select
                  className="form-select"
                  value={formCategoriaId}
                  onChange={(e) => setFormCategoriaId(e.target.value)}
                >
                  {categorias.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {formNatureza === 'TRANSFERENCIA_PROPRIA' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={formIsPagamentoFatura}
                  onChange={(e) => setFormIsPagamentoFatura(e.target.checked)}
                />
                Pagamento de fatura de cartão (Anti-dupla contagem)
              </label>
            )}

            <button type="submit" className="btn-primary" style={{ marginTop: '6px' }}>
              Confirmar Lançamento
            </button>
          </form>
        )}
      </BottomSheet>
    </div>
    </ProtectedRoute>
  );
};
