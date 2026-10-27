import { prisma } from '../../infrastructure/database/prisma.js';
import { authEventBus, AuthEventBus, UsuarioAutenticadoEvent } from '../../infrastructure/events/auth-event-bus.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteConcluidoEvent,
} from '../../infrastructure/events/importacao-event-bus.js';

export interface FaturaConciliacaoResultado {
  usuarioId: string;
  totalFaturasAvaliadas: number;
  totalFaturasConciliadas: number;
  totalSuspeitasCriadas: number;
  detalhes: Array<{
    arquivoId: string;
    movimentoPagamentoId?: string;
    status: 'CONCILIADO' | 'SUSPEITO';
    motivo: string;
  }>;
}

/**
 * BUG-21: Serviço de Detecção e Conciliação de Pagamentos de Fatura de Cartão.
 *
 * Avalia faturas pendentes de validação contra movimentos da conta corrente do usuário:
 * Critério a: Débito com mesmo valor da fatura (tolerância R$ 0,05) e data entre 10 dias antes do vencimento até o vencimento.
 * Critério b: Descrição contém termos como `pag`, `pagamento`, `boleto`, `pgto`, `fatura`.
 * Critério c: Débito com data após o vencimento (até 30 dias) com valor igual ou até 5% maior que a fatura (juros/multa).
 *
 * Decisão:
 * - (a E b) OU c: CONCILIADO automaticamente -> converte o movimento em TRANSFERENCIA_PROPRIA (isPagamentoFatura = true),
 *   vincula faturaPagamentoMovimentoId no arquivo e atualiza status para CONCILIADO.
 * - Caso contrário (ex: a isolado, b isolado): encaminha para a Central de Suspeitas do Usuário.
 */
export class FaturaConciliacaoService {
  public static async executarParaUsuario(usuarioId: string): Promise<FaturaConciliacaoResultado> {
    const resultado: FaturaConciliacaoResultado = {
      usuarioId,
      totalFaturasAvaliadas: 0,
      totalFaturasConciliadas: 0,
      totalSuspeitasCriadas: 0,
      detalhes: [],
    };

    // 1. Busca arquivos que são faturas de cartão pendentes de conciliação
    const faturasPendentes = await prisma.arquivoImportacao.findMany({
      where: {
        usuarioId,
        eFaturaCartao: true,
        faturaStatusValidacao: 'PENDENTE',
        faturaValorTotal: { not: null },
      },
      include: {
        lote: { select: { id: true, usuarioId: true } },
      },
    });

    resultado.totalFaturasAvaliadas = faturasPendentes.length;
    if (faturasPendentes.length === 0) {
      return resultado;
    }

    // 2. Busca movimentos de conta corrente (ou sem conta de cartão) deste usuário
    // que estejam como DESPESA (possíveis pagamentos não identificados) ou já como TRANSFERENCIA_PROPRIA
    const movimentosCandidatos = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: { in: ['DESPESA', 'TRANSFERENCIA_PROPRIA'] },
        conta: { tipo: { not: 'CARTAO_CREDITO' } },
      },
      include: {
        conta: { select: { id: true, nome: true, tipo: true } },
      },
      orderBy: { dataMovimento: 'asc' },
    });

    for (const fatura of faturasPendentes) {
      const valorFatura = Number(fatura.faturaValorTotal);
      if (!valorFatura || isNaN(valorFatura) || valorFatura <= 0) {
        continue;
      }

      const dataVencimento = fatura.faturaDataVencimento ? new Date(fatura.faturaDataVencimento) : null;

      let melhorCandidato: (typeof movimentosCandidatos)[0] | null = null;
      let atendeRegraAutomatica = false;
      let motivoDecisao = '';
      let candidatoSuspeito: (typeof movimentosCandidatos)[0] | null = null;

      for (const mov of movimentosCandidatos) {
        const valorMov = Number(mov.valor);
        const descUpper = mov.descricao.toUpperCase();

        const descTemTermoPagamento =
          /pag(amento|to)?\s*(de)?\s*(fat(ura)?|cart[aã]o|boleto)|pgto\s*fat|pag\s*boleto|debito\s*automatico\s*fatura|pagamento\s*fatura|pagamento\s*efetuado/i.test(
            descUpper
          ) || /bradescard|c6\s*bank|nubank|itaucard|santander/i.test(descUpper);

        // Se temos data de vencimento da fatura
        if (dataVencimento) {
          const dataMovTime = new Date(mov.dataMovimento).getTime();
          const dataVencTime = dataVencimento.getTime();
          const diffDias = (dataMovTime - dataVencTime) / (1000 * 60 * 60 * 24);

          // Critério a: Mesmo valor (tolerância R$ 0.05) e data entre 10 dias antes do vencimento e o vencimento (diffDias entre -10 e 0)
          const diffValor = Math.abs(valorMov - valorFatura);
          const atendeA = diffValor <= 0.05 && diffDias >= -10 && diffDias <= 1; // +1 dia de tolerância de compensação bancária

          // Critério b: Descrição com termos de pagamento de fatura/boleto
          const atendeB = descTemTermoPagamento;

          // Critério c: Débito após o vencimento (até 30 dias após) com valor igual ou até 5% maior (multa/juros)
          const atendeC =
            diffDias > 1 &&
            diffDias <= 30 &&
            valorMov >= valorFatura - 0.05 &&
            valorMov <= valorFatura * 1.05 + 0.05;

          if ((atendeA && atendeB) || atendeC) {
            melhorCandidato = mov;
            atendeRegraAutomatica = true;
            motivoDecisao = atendeC
              ? `Pagamento após vencimento com valor coerente (+juros/multa até 5%): R$ ${valorMov.toFixed(2)}`
              : `Pagamento tempestivo com mesmo valor (R$ ${valorMov.toFixed(2)}) e termos de fatura.`;
            break;
          }

          // Se atende critério isolado (ex: a isolado sem termo de pagamento claro, ou b isolado)
          if (atendeA || (atendeB && diffValor <= 0.05)) {
            candidatoSuspeito = mov;
          }
        } else {
          // Sem data de vencimento explícita: se tem valor exato e descrição clara de pagamento de fatura
          const diffValor = Math.abs(valorMov - valorFatura);
          if (diffValor <= 0.05 && descTemTermoPagamento) {
            melhorCandidato = mov;
            atendeRegraAutomatica = true;
            motivoDecisao = `Pagamento de fatura detectado por valor idêntico (R$ ${valorMov.toFixed(2)}) e descrição expressa.`;
            break;
          }
        }
      }

      if (atendeRegraAutomatica && melhorCandidato) {
        // Converte o movimento em TRANSFERENCIA_PROPRIA para não inflar despesas/compras
        await prisma.movimento.update({
          where: { id: melhorCandidato.id },
          data: {
            natureza: 'TRANSFERENCIA_PROPRIA',
            categoriaId: null, // Quitação de fatura não pertence a categoria de compra
            observacao: melhorCandidato.observacao
              ? `${melhorCandidato.observacao} [Pagamento de Fatura Conciliado - BUG-21]`
              : 'Pagamento de Fatura Conciliado (não computado como despesa)',
          },
        });

        // Vincula a fatura ao movimento
        await prisma.arquivoImportacao.update({
          where: { id: fatura.id },
          data: {
            faturaPagamentoMovimentoId: melhorCandidato.id,
            faturaStatusValidacao: 'CONCILIADO',
          },
        });

        resultado.totalFaturasConciliadas++;
        resultado.detalhes.push({
          arquivoId: fatura.id,
          movimentoPagamentoId: melhorCandidato.id,
          status: 'CONCILIADO',
          motivo: motivoDecisao,
        });
      } else if (candidatoSuspeito) {
        // Encaminha para a Central de Validação de Suspeitas
        await prisma.suspeitaMovimento.create({
          data: {
            usuarioId,
            tipo: 'SUSPEITA_APORTE',
            status: 'PENDENTE',
            confianca: 0.75,
            motivo: `Possível quitação de fatura de cartão (${fatura.nomeArquivo}): débito de R$ ${Number(candidatoSuspeito.valor).toFixed(2)} em ${candidatoSuspeito.dataMovimento.toISOString().slice(0, 10)}.`,
            movimentoId: candidatoSuspeito.id,
            sugestaoNatureza: 'TRANSFERENCIA_PROPRIA',
          },
        });

        await prisma.arquivoImportacao.update({
          where: { id: fatura.id },
          data: { faturaStatusValidacao: 'SUSPEITO' },
        });

        resultado.totalSuspeitasCriadas++;
        resultado.detalhes.push({
          arquivoId: fatura.id,
          movimentoPagamentoId: candidatoSuspeito.id,
          status: 'SUSPEITO',
          motivo: 'Critério parcial atingido — enviado para validação do usuário.',
        });
      }
    }

    return resultado;
  }
}

export class FaturaConciliacaoWorkerService {
  private isListeningEvents: boolean = false;
  private boundAuthListener?: (event: UsuarioAutenticadoEvent) => void;
  private boundLoteListener?: (event: ImportacaoLoteConcluidoEvent) => void;
  private boundArquivoListener?: (event: any) => void;
  private processamentosAtivos: Set<string> = new Set();

  constructor(autoListen: boolean = false) {
    if (autoListen) {
      this.setupEventListener();
    }
  }

  public setupEventListener(): void {
    if (this.isListeningEvents) return;

    console.log('[evolvi-worker:faturas] Inicializando ouvinte de conciliação de faturas...');

    this.boundAuthListener = (event: UsuarioAutenticadoEvent) => {
      console.log(`[evolvi-worker:faturas] Usuário [${event.usuarioId}] autenticado. Disparando conciliação de faturas...`);
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(`[evolvi-worker:faturas] Erro no login para usuário [${event.usuarioId}]:`, err);
      });
    };

    this.boundArquivoListener = (event: any) => {
      console.log(`[evolvi-worker:faturas] Arquivo [${event.nomeArquivo}] consolidado. Disparando conciliação de faturas para usuário [${event.usuarioId}]...`);
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(`[evolvi-worker:faturas] Erro pós-arquivo [${event.nomeArquivo}] para usuário [${event.usuarioId}]:`, err);
      });
    };

    this.boundLoteListener = (event: ImportacaoLoteConcluidoEvent) => {
      console.log(`[evolvi-worker:faturas] Lote [${event.loteId}] concluído. Disparando conciliação de faturas para usuário [${event.usuarioId}]...`);
      this.processarParaUsuario(event.usuarioId).catch((err) => {
        console.error(`[evolvi-worker:faturas] Erro pós-lote [${event.loteId}] para usuário [${event.usuarioId}]:`, err);
      });
    };

    authEventBus.onUsuarioAutenticado(this.boundAuthListener);
    importacaoEventBus.onArquivoConsolidadoFinal(this.boundArquivoListener);
    importacaoEventBus.onLoteConcluido(this.boundLoteListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundAuthListener) {
      authEventBus.removeListener(AuthEventBus.EVENT_USUARIO_AUTENTICADO, this.boundAuthListener);
      this.boundAuthListener = undefined;
    }
    if (this.boundArquivoListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_ARQUIVO_CONSOLIDADO_FINAL,
        this.boundArquivoListener
      );
      this.boundArquivoListener = undefined;
    }
    if (this.boundLoteListener) {
      importacaoEventBus.removeListener(ImportacaoEventBus.EVENT_LOTE_CONCLUIDO, this.boundLoteListener);
      this.boundLoteListener = undefined;
    }
    this.isListeningEvents = false;
  }

  public async processarParaUsuario(usuarioId: string): Promise<FaturaConciliacaoResultado | null> {
    if (this.processamentosAtivos.has(usuarioId)) {
      console.log(`[evolvi-worker:faturas] Processamento já ativo para o usuário [${usuarioId}]. Ignorando duplicação.`);
      return null;
    }

    this.processamentosAtivos.add(usuarioId);
    try {
      const inicio = Date.now();
      const resultado = await FaturaConciliacaoService.executarParaUsuario(usuarioId);
      const duracao = Date.now() - inicio;
      console.log(
        `[evolvi-worker:faturas] Concluído para [${usuarioId}] em ${duracao}ms (faturas: ${resultado.totalFaturasAvaliadas}, conciliados: ${resultado.totalFaturasConciliadas})`
      );
      return resultado;
    } finally {
      this.processamentosAtivos.delete(usuarioId);
    }
  }
}

export const faturaConciliacaoWorkerService = new FaturaConciliacaoWorkerService(true);
