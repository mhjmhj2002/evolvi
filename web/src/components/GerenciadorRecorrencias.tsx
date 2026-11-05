import React, { useState, useEffect } from 'react';
import { RecorrenciaItem, CategoriaTreeItem, apiService } from '../api.ts';
import {
  Repeat,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Check,
  Power,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

interface GerenciadorRecorrenciasProps {
  categorias?: CategoriaTreeItem[];
  onRecorrenciasAtualizadas?: () => void;
}

export const GerenciadorRecorrencias: React.FC<GerenciadorRecorrenciasProps> = ({
  categorias = [],
  onRecorrenciasAtualizadas,
}) => {
  const [recorrencias, setRecorrencias] = useState<RecorrenciaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Modal de Criação / Edição
  const [modalAberto, setModalAberto] = useState<boolean>(false);
  const [itemEmEdicao, setItemEmEdicao] = useState<RecorrenciaItem | null>(null);
  const [salvando, setSalvando] = useState<boolean>(false);

  // Campos do formulário
  const [formDescricao, setFormDescricao] = useState<string>('');
  const [formValor, setFormValor] = useState<string>('');
  const [formDiaPrevisto, setFormDiaPrevisto] = useState<string>('');
  const [formCategoriaId, setFormCategoriaId] = useState<string>('');
  const [formFormaPagamento, setFormFormaPagamento] = useState<string>('Boleto');
  const [formEssencial, setFormEssencial] = useState<boolean>(true);
  const [formStatus, setFormStatus] = useState<'ATIVA' | 'PAUSADA' | 'CANCELADA'>('ATIVA');

  // Carrega a lista de recorrências do usuário
  const carregarRecorrencias = async () => {
    try {
      setLoading(true);
      setErro(null);
      const res = await apiService.getRecorrencias();
      setRecorrencias(res.recorrencias || []);
    } catch (err: any) {
      setErro(err.message || 'Falha ao carregar compromissos recorrentes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarRecorrencias();
  }, []);

  const abrirModalNovo = () => {
    setItemEmEdicao(null);
    setFormDescricao('');
    setFormValor('');
    setFormDiaPrevisto('');
    setFormCategoriaId('');
    setFormFormaPagamento('Boleto');
    setFormEssencial(true);
    setFormStatus('ATIVA');
    setErro(null);
    setSucesso(null);
    setModalAberto(true);
  };

  const abrirModalEditar = (item: RecorrenciaItem) => {
    setItemEmEdicao(item);
    setFormDescricao(item.descricao);
    setFormValor(item.valorReferencia.toString());
    setFormDiaPrevisto(item.diaPrevisto ? item.diaPrevisto.toString() : '');
    setFormCategoriaId(item.categoriaId || '');
    setFormFormaPagamento(item.formaPagamento || 'Boleto');
    setFormEssencial(item.essencial);
    setFormStatus(item.status);
    setErro(null);
    setSucesso(null);
    setModalAberto(true);
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDescricao.trim()) {
      setErro('Informe uma descrição para o gasto recorrente.');
      return;
    }

    const valorNum = parseFloat(formValor.replace(',', '.'));
    if (isNaN(valorNum) || valorNum <= 0) {
      setErro('Informe um valor de referência mensal positivo.');
      return;
    }

    const diaNum = formDiaPrevisto ? parseInt(formDiaPrevisto, 10) : null;
    if (diaNum !== null && (isNaN(diaNum) || diaNum < 1 || diaNum > 31)) {
      setErro('Dia previsto deve ser entre 1 e 31.');
      return;
    }

    try {
      setSalvando(true);
      setErro(null);

      const payload = {
        descricao: formDescricao.trim(),
        valorReferencia: valorNum,
        diaPrevisto: diaNum,
        categoriaId: formCategoriaId ? formCategoriaId : null,
        formaPagamento: formFormaPagamento || null,
        essencial: formEssencial,
        status: formStatus,
      };

      if (itemEmEdicao) {
        await apiService.atualizarRecorrencia(itemEmEdicao.id, payload);
        setSucesso('Compromisso recorrente atualizado com sucesso!');
      } else {
        await apiService.criarRecorrencia(payload);
        setSucesso('Compromisso recorrente criado com sucesso!');
      }

      setModalAberto(false);
      await carregarRecorrencias();
      if (onRecorrenciasAtualizadas) {
        onRecorrenciasAtualizadas();
      }
    } catch (err: any) {
      setErro(err.message || 'Erro ao salvar compromisso recorrente.');
    } finally {
      setSalvando(false);
    }
  };

  const handleAlternarStatus = async (item: RecorrenciaItem) => {
    const novoStatus = item.status === 'ATIVA' ? 'PAUSADA' : 'ATIVA';
    try {
      await apiService.atualizarRecorrencia(item.id, { status: novoStatus });
      await carregarRecorrencias();
      if (onRecorrenciasAtualizadas) {
        onRecorrenciasAtualizadas();
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar status da recorrência.');
    }
  };

  const handleExcluir = async (item: RecorrenciaItem) => {
    const confirmou = window.confirm(
      `Deseja realmente excluir o gasto recorrente "${item.descricao}"?`
    );
    if (!confirmou) return;

    try {
      await apiService.excluirRecorrencia(item.id);
      setSucesso(`Recorrência "${item.descricao}" removida com sucesso.`);
      await carregarRecorrencias();
      if (onRecorrenciasAtualizadas) {
        onRecorrenciasAtualizadas();
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir gasto recorrente.');
    }
  };

  const totalAtivoMensal = recorrencias
    .filter((r) => r.status === 'ATIVA')
    .reduce((sum, r) => sum + r.valorReferencia, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Alertas */}
      {sucesso && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--status-green)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.85rem',
          }}
        >
          <CheckCircle2 size={16} />
          <span>{sucesso}</span>
        </div>
      )}

      {erro && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--status-red)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.85rem',
          }}
        >
          <AlertCircle size={16} />
          <span>{erro}</span>
        </div>
      )}

      {/* Cabeçalho do Card */}
      <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                padding: '8px',
                borderRadius: 'var(--radius-sm)',
                color: '#3b82f6',
              }}
            >
              <Repeat size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                Compromissos e Gastos Recorrentes
              </h3>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Despesas regulares e contratos fixos mensais (condomínio, aluguel, luz, internet, assinaturas).
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Mensal Ativo</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.1rem', color: '#60a5fa' }}>
                {totalAtivoMensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={abrirModalNovo}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}
            >
              <Plus size={16} />
              <span>Novo Gasto Recorrente</span>
            </button>
          </div>
        </div>

        {/* Tabela / Lista de Itens */}
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Loader2 size={24} className="spin" style={{ margin: '0 auto 8px auto' }} />
            <span>Carregando compromissos recorrentes...</span>
          </div>
        ) : recorrencias.length === 0 ? (
          <div
            style={{
              padding: '28px',
              textAlign: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 'var(--radius-sm)',
              border: '1px dashed var(--border-subtle)',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
            }}
          >
            Nenhum gasto recorrente cadastrado ou detectado. Clique em "Novo Gasto Recorrente" para adicionar.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recorrencias.map((rec) => {
              const isAtiva = rec.status === 'ATIVA';
              return (
                <div
                  key={rec.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: isAtiva ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.2)',
                    border: isAtiva ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid var(--border-subtle)',
                    opacity: isAtiva ? 1 : 0.65,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={() => handleAlternarStatus(rec)}
                      title={isAtiva ? 'Pausar este compromisso' : 'Ativar compromisso'}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: isAtiva ? 'var(--status-green)' : 'var(--text-muted)',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Power size={18} />
                    </button>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: isAtiva ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {rec.descricao}
                        </span>

                        {rec.essencial ? (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              color: 'var(--status-green)',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <ShieldCheck size={11} /> Essencial
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              backgroundColor: 'rgba(245, 158, 11, 0.15)',
                              color: 'var(--status-yellow, #f59e0b)',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <ShieldAlert size={11} /> Ajustável
                          </span>
                        )}

                        <span
                          style={{
                            fontSize: '0.65rem',
                            backgroundColor: isAtiva ? 'rgba(59, 130, 246, 0.15)' : 'rgba(100, 116, 139, 0.2)',
                            color: isAtiva ? '#93c5fd' : 'var(--text-muted)',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontWeight: 700,
                          }}
                        >
                          {rec.status}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span>Categoria: {rec.categoria?.nome || 'Geral'}</span>
                        {rec.diaPrevisto && <span>• Vencimento dia {rec.diaPrevisto}</span>}
                        {rec.formaPagamento && <span>• Pagamento: {rec.formaPagamento}</span>}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.96rem', color: isAtiva ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {rec.valorReferencia.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>ao mês</div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => abrirModalEditar(rec)}
                        title="Editar compromisso"
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '6px',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        <Edit2 size={14} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExcluir(rec)}
                        title="Excluir compromisso"
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '6px',
                          color: 'var(--status-red)',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Criação / Edição */}
      {modalAberto && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                {itemEmEdicao ? 'Editar Gasto Recorrente' : 'Novo Gasto Recorrente'}
              </h3>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSalvar} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="form-label" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', display: 'block' }}>
                  Descrição / Nome do Compromisso *
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Condomínio Edifício Altair, Plano de Saúde, Claro Fibra..."
                  value={formDescricao}
                  onChange={(e) => setFormDescricao(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', display: 'block' }}>
                    Valor Mensal (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input-field"
                    placeholder="0.00"
                    value={formValor}
                    onChange={(e) => setFormValor(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', display: 'block' }}>
                    Dia Previsto / Vencimento
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    className="input-field"
                    placeholder="Ex: 10"
                    value={formDiaPrevisto}
                    onChange={(e) => setFormDiaPrevisto(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', display: 'block' }}>
                    Forma de Pagamento
                  </label>
                  <select
                    className="input-field"
                    value={formFormaPagamento}
                    onChange={(e) => setFormFormaPagamento(e.target.value)}
                  >
                    <option value="Boleto">Boleto</option>
                    <option value="Débito Automático">Débito Automático</option>
                    <option value="Cartão">Cartão de Crédito</option>
                    <option value="PIX">PIX</option>
                    <option value="Transferência">Transferência</option>
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', display: 'block' }}>
                    Status
                  </label>
                  <select
                    className="input-field"
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                  >
                    <option value="ATIVA">Ativa</option>
                    <option value="PAUSADA">Pausada</option>
                    <option value="CANCELADA">Cancelada</option>
                  </select>
                </div>
              </div>

              {categorias.length > 0 && (
                <div>
                  <label className="form-label" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', display: 'block' }}>
                    Categoria
                  </label>
                  <select
                    className="input-field"
                    value={formCategoriaId}
                    onChange={(e) => setFormCategoriaId(e.target.value)}
                  >
                    <option value="">Selecione uma categoria...</option>
                    {categorias.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="chkEssencial"
                  checked={formEssencial}
                  onChange={(e) => setFormEssencial(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="chkEssencial" style={{ fontSize: '0.82rem', cursor: 'pointer' }}>
                  Gasto essencial (custo de vida básico/moradia/saúde/educação)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setModalAberto(false)}
                  disabled={salvando}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={salvando}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  {salvando ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                  <span>{itemEmEdicao ? 'Salvar Alterações' : 'Criar Recorrência'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
