import crypto from 'crypto';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { openFinanceEventBus } from '../../../infrastructure/events/open-finance-event-bus.js';
import { configuracaoService } from '../../usuario/configuracao.service.js';
import { BankConnectorFactory } from '../factory/bank-connector.factory.js';
import { BankAccountRaw, BankTransactionRaw, BankInvoiceRaw } from '../types/bank-connector.interface.js';

export interface IngestaoRawResultado {
  conexaoId: string;
  instituicaoCodigo: string;
  usuarioId: string;
  dadosBrutosGerados: number;
  dadosBrutosIds: string[];
  detalhes: {
    contas: number;
    transacoes: number;
    faturas: number;
  };
}

export interface SchedulerExecutionResult {
  jobId: string;
  inicio: Date;
  fim: Date;
  duracaoMs: number;
  conexoesElegiveisTotal: number;
  conexoesProcessadasSucesso: number;
  conexoesComErro: number;
  dadosBrutosCriadosTotal: number;
  erros: Array<{ conexaoId: string; instituicaoCodigo: string; motivo: string }>;
}

export class OpenFinanceSchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isRunningCycle: boolean = false;
  private intervalCheckMs: number = 60 * 1000; // Polling padrão de 1 minuto para verificação de elegibilidade

  /**
   * Calcula hash SHA-256 determinístico de um payload bruto para garantia de idempotência
   */
  public static calcularHashCarga(payload: unknown): string {
    const jsonString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');
  }

  /**
   * Inicia o scheduler em background
   */
  public start(intervalCheckMs: number = 60 * 1000): void {
    if (this.timer) {
      return;
    }
    this.intervalCheckMs = intervalCheckMs;
    // Executa uma checagem inicial assíncrona
    this.runJobCycle().catch((err) => {
      console.error('[OpenFinanceScheduler] Erro no ciclo inicial:', err);
    });

    this.timer = setInterval(() => {
      this.runJobCycle().catch((err) => {
        console.error('[OpenFinanceScheduler] Erro no ciclo periódico:', err);
      });
    }, this.intervalCheckMs);

    if (this.timer.unref) {
      this.timer.unref(); // Não impede finalização limpa do Node
    }
  }

  /**
   * Para o scheduler em background
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Localiza conexões bancárias elegíveis para busca automática com base na parametrização de cada usuário.
   * Regras:
   * 1. Status = 'CONECTADO'
   * 2. consentimentoExpiraEm > NOW() ou nulo
   * 3. ultimaSincronizacaoEm IS NULL OU ultimaSincronizacaoEm <= NOW() - intervaloSincronizacaoHoras
   */
  public async obterConexoesElegiveis() {
    const agora = new Date();

    // Busca conexões conectadas com consentimento válido (ou sem expiração definida)
    const conexoes = await prisma.conexaoBancaria.findMany({
      where: {
        status: 'CONECTADO',
        OR: [
          { consentimentoExpiraEm: null },
          { consentimentoExpiraEm: { gt: agora } },
        ],
      },
      include: {
        usuario: {
          select: {
            id: true,
            configuracao: {
              select: {
                intervaloSincronizacaoHoras: true,
                mesesJanelaTemporal: true,
              },
            },
          },
        },
      },
    });

    const elegiveis = [];

    for (const conexao of conexoes) {
      const horasConfiguradas = conexao.usuario.configuracao?.intervaloSincronizacaoHoras ?? 6;

      if (!conexao.ultimaSincronizacaoEm) {
        // Nunca sincronizou: elegível imediatamente
        elegiveis.push({
          conexao,
          intervaloHoras: horasConfiguradas,
        });
        continue;
      }

      const diffMs = agora.getTime() - new Date(conexao.ultimaSincronizacaoEm).getTime();
      const diffHoras = diffMs / (1000 * 60 * 60);

      if (diffHoras >= horasConfiguradas) {
        elegiveis.push({
          conexao,
          intervaloHoras: horasConfiguradas,
        });
      }
    }

    return elegiveis;
  }

  /**
   * Executa a coleta raw de uma conexão específica e salva na tabela de dados brutos
   */
  public async coletarDadosBrutosConexao(conexaoId: string): Promise<IngestaoRawResultado> {
    const conexao = await prisma.conexaoBancaria.findUnique({
      where: { id: conexaoId },
    });

    if (!conexao) {
      throw new Error(`Conexão bancária [${conexaoId}] não encontrada.`);
    }

    if (conexao.status !== 'CONECTADO') {
      throw new Error(`Conexão bancária [${conexaoId}] não está ativa (status: ${conexao.status}).`);
    }

    if (conexao.consentimentoExpiraEm && conexao.consentimentoExpiraEm <= new Date()) {
      await prisma.conexaoBancaria.update({
        where: { id: conexaoId },
        data: { status: 'EXPIRADO', mensagemErro: 'Consentimento Open Finance expirado.' },
      });
      throw new Error(`Consentimento Open Finance da conexão [${conexaoId}] expirado.`);
    }

    if (!conexao.consentimentoId) {
      throw new Error(`Conexão bancária [${conexaoId}] sem consentimentoId registrado.`);
    }

    const provider = BankConnectorFactory.getProvider(conexao.instituicaoCodigo);
    const usuarioId = conexao.usuarioId;
    const mesesJanela = await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    // Calcular janela retroativa de coleta
    const hoje = new Date().toISOString().split('T')[0];
    const dataRetro = new Date();
    dataRetro.setMonth(dataRetro.getMonth() - (mesesJanela - 1));
    const anoRetro = dataRetro.getFullYear();
    const mesRetro = String(dataRetro.getMonth() + 1).padStart(2, '0');
    const dataInicio = `${anoRetro}-${mesRetro}-01`;
    const dataFim = hoje;

    // 1. Coleta raw de contas
    const rawAccounts: BankAccountRaw[] = await provider.listAccounts(conexao.consentimentoId);

    const dadosBrutosCriadosIds: string[] = [];
    let totalTransacoesColetadas = 0;
    let totalFaturasColetadas = 0;

    const loteId = crypto.randomUUID();
    const coletadoEm = new Date();

    // Salvar CONTAS brutas se houver
    if (rawAccounts && rawAccounts.length > 0) {
      const hashContas = OpenFinanceSchedulerService.calcularHashCarga({
        tipo: 'CONTAS',
        conexaoId,
        contas: rawAccounts,
      });

      try {
        const dadoConta = await prisma.dadoBrutoOpenFinance.upsert({
          where: {
            conexaoId_hashCarga: {
              conexaoId,
              hashCarga: hashContas,
            },
          },
          create: {
            usuarioId,
            conexaoId,
            instituicaoCodigo: conexao.instituicaoCodigo,
            tipoDado: 'CONTAS',
            payloadRaw: rawAccounts as any,
            hashCarga: hashContas,
            status: 'PENDENTE_PROCESSAMENTO',
            coletadoEm,
          },
          update: {
            // Se já existia e estava processado, não regride, apenas atualiza timestamp de coleta
            coletadoEm,
          },
        });
        dadosBrutosCriadosIds.push(dadoConta.id);
      } catch (err) {
        console.warn(`[OpenFinanceScheduler] Registro de contas idêntico já persistido:`, err);
      }
    }

    // 2. Coleta raw de transações e faturas por conta
    for (const rawAcc of rawAccounts) {
      let transacoes: BankTransactionRaw[] = [];
      try {
        transacoes = await provider.fetchTransactions({
          consentimentoId: conexao.consentimentoId,
          contaIdExterno: rawAcc.idExterno,
          dataInicio,
          dataFim,
        });
      } catch (errTrans) {
        console.warn(`[OpenFinanceScheduler] Falha ao coletar transações da conta ${rawAcc.idExterno}:`, errTrans);
      }

      if (transacoes && transacoes.length > 0) {
        totalTransacoesColetadas += transacoes.length;
        const hashTrans = OpenFinanceSchedulerService.calcularHashCarga({
          tipo: 'TRANSACOES',
          contaIdExterno: rawAcc.idExterno,
          transacoes,
        });

        try {
          const dadoTrans = await prisma.dadoBrutoOpenFinance.upsert({
            where: {
              conexaoId_hashCarga: {
                conexaoId,
                hashCarga: hashTrans,
              },
            },
            create: {
              usuarioId,
              conexaoId,
              instituicaoCodigo: conexao.instituicaoCodigo,
              tipoDado: 'TRANSACOES',
              payloadRaw: {
                contaIdExterno: rawAcc.idExterno,
                contaNome: rawAcc.nome,
                tipoConta: rawAcc.tipo,
                transacoes,
              } as any,
              hashCarga: hashTrans,
              status: 'PENDENTE_PROCESSAMENTO',
              coletadoEm,
            },
            update: {
              coletadoEm,
            },
          });
          dadosBrutosCriadosIds.push(dadoTrans.id);
        } catch (err) {
          console.warn(`[OpenFinanceScheduler] Transações idênticas já persistidas:`, err);
        }
      }

      // Se for cartão de crédito, coletar faturas brutas
      if (rawAcc.tipo === 'CARTAO_CREDITO') {
        const competenciaAtual = dataFim.substring(0, 7);
        let faturas: BankInvoiceRaw[] = [];
        try {
          faturas = await provider.fetchCreditCardInvoices({
            consentimentoId: conexao.consentimentoId,
            cartaoIdExterno: rawAcc.idExterno,
            competencia: competenciaAtual,
          });
        } catch (errFat) {
          console.warn(`[OpenFinanceScheduler] Falha ao coletar faturas de cartão ${rawAcc.idExterno}:`, errFat);
        }

        if (faturas && faturas.length > 0) {
          totalFaturasColetadas += faturas.length;
          const hashFat = OpenFinanceSchedulerService.calcularHashCarga({
            tipo: 'FATURAS',
            cartaoIdExterno: rawAcc.idExterno,
            faturas,
          });

          try {
            const dadoFat = await prisma.dadoBrutoOpenFinance.upsert({
              where: {
                conexaoId_hashCarga: {
                  conexaoId,
                  hashCarga: hashFat,
                },
              },
              create: {
                usuarioId,
                conexaoId,
                instituicaoCodigo: conexao.instituicaoCodigo,
                tipoDado: 'FATURAS',
                payloadRaw: {
                  cartaoIdExterno: rawAcc.idExterno,
                  faturas,
                } as any,
                hashCarga: hashFat,
                status: 'PENDENTE_PROCESSAMENTO',
                coletadoEm,
              },
              update: {
                coletadoEm,
              },
            });
            dadosBrutosCriadosIds.push(dadoFat.id);
          } catch (err) {
            console.warn(`[OpenFinanceScheduler] Faturas idênticas já persistidas:`, err);
          }
        }
      }
    }

    // 3. Atualizar timestamp de última sincronização da conexão
    await prisma.conexaoBancaria.update({
      where: { id: conexaoId },
      data: {
        ultimaSincronizacaoEm: coletadoEm,
        mensagemErro: null,
      },
    });

    // 4. Emitir ping reativo / evento orientado a eventos notificando o worker
    if (dadosBrutosCriadosIds.length > 0) {
      openFinanceEventBus.emitRawIngested({
        usuarioId,
        conexaoId,
        instituicaoCodigo: conexao.instituicaoCodigo,
        loteId,
        dadosBrutosIds: dadosBrutosCriadosIds,
        coletadoEm,
        quantidadeRegistros: dadosBrutosCriadosIds.length,
      });
    }

    return {
      conexaoId,
      instituicaoCodigo: conexao.instituicaoCodigo,
      usuarioId,
      dadosBrutosGerados: dadosBrutosCriadosIds.length,
      dadosBrutosIds: dadosBrutosCriadosIds,
      detalhes: {
        contas: rawAccounts.length,
        transacoes: totalTransacoesColetadas,
        faturas: totalFaturasColetadas,
      },
    };
  }

  /**
   * Ciclo completo de execução periódica (Job / Polling)
   */
  public async runJobCycle(): Promise<SchedulerExecutionResult> {
    if (this.isRunningCycle) {
      return {
        jobId: 'skipped_busy',
        inicio: new Date(),
        fim: new Date(),
        duracaoMs: 0,
        conexoesElegiveisTotal: 0,
        conexoesProcessadasSucesso: 0,
        conexoesComErro: 0,
        dadosBrutosCriadosTotal: 0,
        erros: [],
      };
    }

    this.isRunningCycle = true;
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const inicio = new Date();

    let elegiveis: Array<{ conexao: any; intervaloHoras: number }> = [];
    const erros: Array<{ conexaoId: string; instituicaoCodigo: string; motivo: string }> = [];
    let conexoesSucesso = 0;
    let dadosBrutosCriadosTotal = 0;

    try {
      elegiveis = await this.obterConexoesElegiveis();

      for (const item of elegiveis) {
        const { conexao } = item;
        try {
          const resultado = await this.coletarDadosBrutosConexao(conexao.id);
          conexoesSucesso++;
          dadosBrutosCriadosTotal += resultado.dadosBrutosGerados;
        } catch (err: unknown) {
          const motivo = err instanceof Error ? err.message : String(err);
          erros.push({
            conexaoId: conexao.id,
            instituicaoCodigo: conexao.instituicaoCodigo,
            motivo,
          });

          // Atualizar mensagem de erro na conexão
          await prisma.conexaoBancaria.update({
            where: { id: conexao.id },
            data: { mensagemErro: motivo },
          }).catch(() => {});

          openFinanceEventBus.emitSyncError({
            usuarioId: conexao.usuarioId,
            conexaoId: conexao.id,
            instituicaoCodigo: conexao.instituicaoCodigo,
            erro: motivo,
            timestamp: new Date(),
          });
        }
      }
    } finally {
      this.isRunningCycle = false;
    }

    const fim = new Date();
    const duracaoMs = fim.getTime() - inicio.getTime();

    const resultado: SchedulerExecutionResult = {
      jobId,
      inicio,
      fim,
      duracaoMs,
      conexoesElegiveisTotal: elegiveis.length,
      conexoesProcessadasSucesso: conexoesSucesso,
      conexoesComErro: erros.length,
      dadosBrutosCriadosTotal,
      erros,
    };

    openFinanceEventBus.emitJobCompleted({
      jobId,
      conexoesVerificadas: elegiveis.length,
      conexoesSincronizadas: conexoesSucesso,
      erros: erros.length,
      dadosBrutosGerados: dadosBrutosCriadosTotal,
      duracaoMs,
    });

    return resultado;
  }
}

export const openFinanceSchedulerService = new OpenFinanceSchedulerService();
