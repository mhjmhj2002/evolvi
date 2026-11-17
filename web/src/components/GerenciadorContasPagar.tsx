import React, { useState, useEffect } from 'react';
import { ContaPagarItem, CategoriaTreeItem, ContaItem, apiService } from '../api.ts';
import {
  Calendar,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Circle,
  Loader2,
  X,
  Sparkles,
  CreditCard,
  Clock,
  Ban,
} from 'lucide-react';
import { formatarDataIso } from '../utils/data.ts';

interface GerenciadorContasPagarProps {
  categorias?: CategoriaTreeItem[];
  contas?: ContaItem[];
  onContasAtualizadas?: () => void;
}

export const GerenciadorContasPagar: React.FC<GerenciadorContasPagarProps> = ({
  categorias = [],
  contas = [],
  onContasAtualizadas,
}) => {
  const [contasPagar, setContasPagar] = useState<ContaPagarItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sincronizando, setSincronizando] = useState<boolean>(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Modal de Criação / Edição
  const [modalAberto, setModalAberto] = useState<boolean>(false);
  const [itemEmEdicao, setItemEmEdicao] = useState<ContaPagarItem | null>(null);
  const [salvando, setSalvando] = useState<boolean>(false);

  // Campos do formulário
  const [formDescricao, setFormDescricao] = useState<string>('');
  const [formValor, setFormValor] = useState<string>('');
  const [formValorVariavel, setFormValorVariavel] = useState<boolean>(false);
  const [formTipoContaPagar, setFormTipoContaPagar] = useState<'FATURA_CARTAO' | 'CONTA_CONSUMO' | 'BOLETO' | 'OUTRO'>('OUTRO');
  const [formStatus, setFormStatus] = useState<'PENDENTE' | 'AGENDADO' | 'PAGO' | 'CANCELADO'>('PENDENTE');
  const [formDiaVencimento, setFormDiaVencimento] = useState<string>('10');
  const [formCategoriaId, setFormCategoriaId] = useState<string>('');
  const [formContaId, setFormContaId] = useState<string>('');
  const [formEssencial, setFormEssencial] = useState<boolean>(true);
  const [formCodigoBarras, setFormCodigoBarras] = useState<string>('');
  const [formObservacoes, setFormObservacoes] = useState<string>('');

  const carregarContasPagar = async () => {
    try {
      setLoading(true);
      setErro(null);
      // Valida automaticamente virada de mês a partir do dia 1º e retorna a lista atualizada
      const res = await apiService.getContasPagar();
      setContasPagar(res.contas || []);
    } catch (err: any) {
      setErro(err.message || 'Falha ao carregar contas a pagar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarContasPagar();
  }, []);

  const abrirModalCriacao = (tipoInicial: 'FATURA_CARTAO' | 'OUTRO' = 'OUTRO') => {
    setItemEmEdicao(null);
    setFormDescricao(tipoInicial === 'FATURA_CARTAO' ? 'Fatura Cartão de Crédito' : '');
    setFormValor('');
    setFormValorVariavel(tipoInicial === 'FATURA_CARTAO');
    setFormTipoContaPagar(tipoInicial);
    setFormStatus('PENDENTE');
    setFormDiaVencimento('10');
    setFormCategoriaId('');
    setFormContaId('');
    setFormEssencial(true);
    setFormCodigoBarras('');
    setFormObservacoes('');
    setModalAberto(true);
  };

  const abrirModalEdicao = (item: ContaPagarItem) => {
    setItemEmEdicao(item);
    setFormDescricao(item.descricao);
    setFormValor(item.valor !== null && item.valor !== undefined ? String(item.valor) : '');
    setFormValorVariavel(Boolean(item.valorVariavel || item.valor === null));
    setFormTipoContaPagar(item.tipoContaPagar || 'OUTRO');
    setFormStatus(item.status || 'PENDENTE');
    setFormDiaVencimento(String(item.diaVencimento || 10));
    setFormCategoriaId(item.categoriaId || '');
    setFormContaId(item.contaId || '');
    setFormEssencial(item.essencial);
    setFormCodigoBarras(item.codigoBarras || '');
    setFormObservacoes(item.observacoes || '');
    setModalAberto(true);
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDescricao.trim()) {
      setErro('A descrição é obrigatória.');
      return;
    }

    let valorNumerico: number | null = null;
    if (formValor.trim() !== '') {
      valorNumerico = parseFloat(formValor.replace(',', '.'));
      if (isNaN(valorNumerico) || valorNumerico < 0) {
        setErro('Informe um valor numérico válido.');
        return;
      }
    } else if (!formValorVariavel && formTipoContaPagar !== 'FATURA_CARTAO') {
      setErro('Informe o valor ou marque a opção de valor variável / fatura.');
      return;
    }

    const diaNum = parseInt(formDiaVencimento, 10);
    if (isNaN(diaNum) || diaNum < 1 || diaNum > 31) {
      setErro('Informe um dia de vencimento válido (entre 1 e 31).');
      return;
    }

    try {
      setSalvando(true);
      setErro(null);

      const payload = {
        descricao: formDescricao.trim(),
        valor: valorNumerico,
        valorVariavel: formValorVariavel || (valorNumerico === null && formTipoContaPagar === 'FATURA_CARTAO'),
        tipoContaPagar: formTipoContaPagar,
        status: formStatus,
        diaVencimento: diaNum,
        categoriaId: formCategoriaId || null,
        contaId: formContaId || null,
        essencial: formEssencial,
        codigoBarras: formCodigoBarras.trim() || null,
        observacoes: formObservacoes.trim() || null,
      };

      if (itemEmEdicao) {
        await apiService.atualizarContaPagar(itemEmEdicao.id, payload);
        setSucesso('Conta a pagar atualizada com sucesso!');
      } else {
        await apiService.criarContaPagar(payload);
        setSucesso('Conta a pagar cadastrada com sucesso!');
      }

      setModalAberto(false);
      await carregarContasPagar();
      onContasAtualizadas?.();
      setTimeout(() => setSucesso(null), 3500);
    } catch (err: any) {
      setErro(err.message || 'Erro ao salvar conta a pagar.');
    } finally {
      setSalvando(false);
    }
  };

  const handleSincronizarRecorrentes = async () => {
    try {
      setSincronizando(true);
      setErro(null);
      const res = await apiService.sincronizarRecorrenciasContasPagar();
      await carregarContasPagar();
      onContasAtualizadas?.();

      if (res.totalImportadas > 0) {
        setSucesso(
          `Sincronização concluída: ${res.totalImportadas} nova(s) conta(s) importada(s) das despesas recorrentes! (${res.totalExistentes} já cadastradas mantidas sem duplicar).`
        );
      } else {
        setSucesso(
          `Todas as ${res.totalExistentes} despesa(s) recorrente(s) já estavam cadastradas. Nenhuma conta foi duplicada.`
        );
      }
      setTimeout(() => setSucesso(null), 5000);
    } catch (err: any) {
      setErro(err.message || 'Erro ao importar despesas recorrentes.');
    } finally {
      setSincronizando(false);
    }
  };

  const handleExcluir = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta conta a pagar?')) return;
    try {
      setLoading(true);
      await apiService.excluirContaPagar(id);
      await carregarContasPagar();
      onContasAtualizadas?.();
      setSucesso('Conta removida com sucesso!');
      setTimeout(() => setSucesso(null), 3000);
    } catch (err: any) {
      setErro(err.message || 'Erro ao excluir conta.');
    } finally {
      setLoading(false);
    }
  };

  // Alterna cíclico entre PENDENTE -> AGENDADO -> PAGO
  const alternarProximoStatus = async (item: ContaPagarItem) => {
    let proximoStatus: 'PENDENTE' | 'AGENDADO' | 'PAGO' = 'PENDENTE';
    if (item.status === 'PENDENTE') {
      proximoStatus = 'AGENDADO';
    } else if (item.status === 'AGENDADO') {
      proximoStatus = 'PAGO';
    } else {
      proximoStatus = 'PENDENTE';
    }

    try {
      await apiService.atualizarContaPagar(item.id, {
        status: proximoStatus,
        dataPagamento: proximoStatus === 'PAGO' ? new Date().toISOString().split('T')[0] : null,
      });
      await carregarContasPagar();
      onContasAtualizadas?.();
    } catch (err: any) {
      setErro(err.message || 'Erro ao atualizar status.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'AGENDADO':
        return {
          label: 'AGENDADO',
          color: '#38bdf8', // Azul celeste destacado, totalmente diferente de verde
          bgColor: 'rgba(56, 189, 248, 0.15)',
          borderColor: 'rgba(56, 189, 248, 0.35)',
          icon: <Clock size={13} />,
        };
      case 'PAGO':
        return {
          label: 'PAGO',
          color: 'var(--status-green)',
          bgColor: 'rgba(34, 197, 94, 0.15)',
          borderColor: 'rgba(34, 197, 94, 0.35)',
          icon: <CheckCircle2 size={13} />,
        };
      case 'CANCELADO':
        return {
          label: 'CANCELADO',
          color: 'var(--text-muted)',
          bgColor: 'rgba(148, 163, 184, 0.1)',
          borderColor: 'rgba(148, 163, 184, 0.25)',
          icon: <Ban size={13} />,
        };
      default:
        return {
          label: 'PENDENTE',
          color: 'var(--status-yellow)',
          bgColor: 'rgba(234, 179, 8, 0.15)',
          borderColor: 'rgba(234, 179, 8, 0.35)',
          icon: <Circle size={13} />,
        };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Barra superior de ações */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Contas a Pagar (CRUD Recorrente)</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
            Vencimentos cadastrados por dia fixo do mês. Suporta valores variáveis (faturas de cartão) e status agendado.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleSincronizarRecorrentes}
            disabled={sincronizando || loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--brand-primary)',
              background: 'rgba(56, 189, 248, 0.1)',
              color: 'var(--brand-primary)',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: sincronizando ? 'not-allowed' : 'pointer',
            }}
            title="Importa compromissos recorrentes ativos automaticamente sem duplicar contas existentes"
          >
            {sincronizando ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            Cadastrar Recorrentes Automático
          </button>

          <button
            type="button"
            onClick={() => abrirModalCriacao('FATURA_CARTAO')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              background: 'rgba(168, 85, 247, 0.12)',
              color: '#c084fc',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
            title="Cadastrar fatura de cartão com valor variável e dia de vencimento fixo"
          >
            <CreditCard size={16} /> + Fatura de Cartão
          </button>

          <button
            type="button"
            onClick={() => abrirModalCriacao('OUTRO')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--brand-primary)',
              color: '#090d16',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            <Plus size={16} /> Nova Conta a Pagar
          </button>
        </div>
      </div>

      {erro && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--status-red)',
            fontSize: '0.82rem',
          }}
        >
          {erro}
        </div>
      )}

      {sucesso && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            color: 'var(--status-green)',
            fontSize: '0.82rem',
          }}
        >
          {sucesso}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Loader2 className="animate-spin" size={24} style={{ margin: '0 auto 8px auto' }} />
          Carregando contas a pagar...
        </div>
      ) : contasPagar.length === 0 ? (
        <div
          style={{
            padding: '36px 20px',
            textAlign: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-subtle)',
          }}
        >
          <Calendar size={32} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Nenhuma conta a pagar cadastrada ainda.
          </p>
          <p style={{ margin: '4px 0 16px 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Cadastre vencimentos fixos, faturas variáveis ou puxe suas despesas recorrentes com 1 clique.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSincronizarRecorrentes}
              disabled={sincronizando}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--brand-primary)',
                background: 'rgba(56, 189, 248, 0.12)',
                color: 'var(--brand-primary)',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              <Sparkles size={16} /> Puxar Recorrentes Automático
            </button>
            <button
              type="button"
              onClick={() => abrirModalCriacao('FATURA_CARTAO')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                background: 'rgba(168, 85, 247, 0.12)',
                color: '#c084fc',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              <CreditCard size={16} /> + Fatura de Cartão
            </button>
            <button
              type="button"
              onClick={() => abrirModalCriacao('OUTRO')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--brand-primary)',
                color: '#090d16',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              <Plus size={16} /> Cadastrar Nova Conta
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {contasPagar.map((item) => {
            const isPago = item.status === 'PAGO';
            const isAgendado = item.status === 'AGENDADO';
            const badge = getStatusBadge(item.status);

            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: isAgendado ? 'rgba(56, 189, 248, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 'var(--radius-md)',
                  border: isAgendado ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid var(--border-subtle)',
                  opacity: isPago ? 0.75 : 1,
                  transition: 'background-color 0.2s, border-color 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {/* Botão de alternar status rápido */}
                  <button
                    type="button"
                    onClick={() => alternarProximoStatus(item)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      color: badge.color,
                    }}
                    title={`Status atual: ${badge.label}. Clique para alternar (Pendente -> Agendado -> Pago).`}
                  >
                    {isPago ? (
                      <CheckCircle2 size={20} />
                    ) : isAgendado ? (
                      <Clock size={20} />
                    ) : (
                      <Circle size={20} />
                    )}
                  </button>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: '0.9rem',
                          color: isPago ? 'var(--text-muted)' : 'var(--text-primary)',
                          textDecoration: isPago ? 'line-through' : 'none',
                        }}
                      >
                        {item.descricao}
                      </span>

                      {item.tipoContaPagar === 'FATURA_CARTAO' && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.68rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(168, 85, 247, 0.15)',
                            color: '#c084fc',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            fontWeight: 600,
                          }}
                        >
                          <CreditCard size={11} /> Fatura de Cartão
                        </span>
                      )}

                      {item.valorVariavel && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(245, 158, 11, 0.15)',
                            color: '#fbbf24',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            fontWeight: 600,
                          }}
                        >
                          Variável
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: '0.76rem',
                        color: 'var(--text-muted)',
                        marginTop: '2px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Dia {item.diaVencimento || 10} do mês
                      </span>
                      {item.dataVencimento && (
                        <span>({formatarDataIso(item.dataVencimento)})</span>
                      )}
                      <span>• {item.categoria?.nome || 'Sem categoria'}</span>
                      {item.conta && <span>• {item.conta.nome}</span>}
                      {item.recorrenciaId && (
                        <span style={{ color: 'var(--brand-primary)', fontSize: '0.72rem' }}>
                          • Vinculada a Recorrência
                        </span>
                      )}
                      {item.essencial && (
                        <span style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>• Essencial</span>
                      )}
                      {item.codigoBarras && <span>• Boleto</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      color: isPago ? 'var(--status-green)' : isAgendado ? '#38bdf8' : 'var(--text-primary)',
                      textAlign: 'right',
                    }}
                  >
                    {item.valor !== null && item.valor !== undefined
                      ? Number(item.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                      : item.valorVariavel
                      ? 'Valor Variável'
                      : 'A definir'}

                    <div style={{ marginTop: '2px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: badge.bgColor,
                          color: badge.color,
                          border: `1px solid ${badge.borderColor}`,
                        }}
                      >
                        {badge.icon}
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => abrirModalEdicao(item)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                      title="Editar conta"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExcluir(item.id)}
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px',
                        color: 'var(--status-red)',
                        cursor: 'pointer',
                      }}
                      title="Excluir conta"
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

      {/* Modal de Criação / Edição */}
      {modalAberto && (
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
              maxWidth: '520px',
              backgroundColor: '#0f172a',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>
                  {itemEmEdicao ? 'Editar Conta a Pagar' : 'Nova Conta a Pagar'}
                </h3>
                {formTipoContaPagar === 'FATURA_CARTAO' && (
                  <span
                    style={{
                      fontSize: '0.72rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: 'rgba(168, 85, 247, 0.2)',
                      color: '#c084fc',
                      border: '1px solid rgba(168, 85, 247, 0.4)',
                      fontWeight: 700,
                    }}
                  >
                    Cartão
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSalvar} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Tipo de Conta
                  </label>
                  <select
                    value={formTipoContaPagar}
                    onChange={(e) => {
                      const t = e.target.value as any;
                      setFormTipoContaPagar(t);
                      if (t === 'FATURA_CARTAO') {
                        setFormValorVariavel(true);
                      }
                    }}
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
                    <option value="OUTRO">Despesa Geral / Outro</option>
                    <option value="FATURA_CARTAO">💳 Fatura de Cartão de Crédito</option>
                    <option value="CONTA_CONSUMO">💡 Conta de Consumo (Luz/Água/Gás)</option>
                    <option value="BOLETO">📄 Boleto Avulso</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
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
                    <option value="PENDENTE">🟡 Pendente</option>
                    <option value="AGENDADO">🔵 Agendado (Programado)</option>
                    <option value="PAGO">🟢 Pago</option>
                    <option value="CANCELADO">⚪ Cancelado</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Descrição *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Fatura Nubank Mastercard, Aluguel, Sabesp"
                  value={formDescricao}
                  onChange={(e) => setFormDescricao(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(30, 41, 59, 0.6)',
                    color: '#fff',
                    fontSize: '0.88rem',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                      Valor (R$) {formValorVariavel ? '(Opcional/Variável)' : '*'}
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    disabled={formValorVariavel}
                    placeholder={formValorVariavel ? 'Varia todo mês' : '0,00'}
                    value={formValorVariavel ? '' : formValor}
                    onChange={(e) => setFormValor(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      background: formValorVariavel ? 'rgba(15, 23, 42, 0.6)' : 'rgba(30, 41, 59, 0.6)',
                      color: formValorVariavel ? 'var(--text-muted)' : '#fff',
                      fontSize: '0.88rem',
                    }}
                  />
                  <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      id="chk-variavel"
                      checked={formValorVariavel}
                      onChange={(e) => {
                        setFormValorVariavel(e.target.checked);
                        if (e.target.checked) setFormValor('');
                      }}
                    />
                    <label htmlFor="chk-variavel" style={{ fontSize: '0.74rem', color: '#fbbf24', cursor: 'pointer' }}>
                      Valor Variável todo mês
                    </label>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Dia do Vencimento (1 a 31) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    placeholder="Ex: 10"
                    value={formDiaVencimento}
                    onChange={(e) => setFormDiaVencimento(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      background: 'rgba(30, 41, 59, 0.6)',
                      color: '#fff',
                      fontSize: '0.88rem',
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Dia do mês fixo para emissão dos alertas
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Categoria
                  </label>
                  <select
                    value={formCategoriaId}
                    onChange={(e) => setFormCategoriaId(e.target.value)}
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
                    <option value="">Selecione...</option>
                    {categorias.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Conta Vinculada (Opcional)
                  </label>
                  <select
                    value={formContaId}
                    onChange={(e) => setFormContaId(e.target.value)}
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
                    <option value="">Nenhuma / Débito Geral</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} ({c.tipo})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Código de Barras / Linha Digitável
                </label>
                <input
                  type="text"
                  placeholder="Linha digitável do boleto ou código de pagamento"
                  value={formCodigoBarras}
                  onChange={(e) => setFormCodigoBarras(e.target.value)}
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

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
                <input
                  type="checkbox"
                  id="chk-essencial"
                  checked={formEssencial}
                  onChange={(e) => setFormEssencial(e.target.checked)}
                />
                <label htmlFor="chk-essencial" style={{ fontSize: '0.82rem', cursor: 'pointer' }}>
                  Despesa Essencial (Fase 1: Moradia, Alimentação Básica, Saúde, etc.)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'var(--brand-primary)',
                    color: '#090d16',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  {salvando ? 'Salvando...' : 'Salvar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
