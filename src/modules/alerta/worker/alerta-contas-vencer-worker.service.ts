import { prisma } from '../../../infrastructure/database/prisma.js';
import { authEventBus, UsuarioAutenticadoEvent } from '../../../infrastructure/events/auth-event-bus.js';
import {
  StatusContaPagar,
  StatusAlertaSistema,
  SeveridadeAlerta,
} from '@prisma/client';
import { alertaService } from '../alerta.service.js';
import { contaPagarService } from '../../conta-pagar/conta-pagar.service.js';

export interface ResumoProcessamentoAlertas {
  usuarioId: string;
  totalContasAvaliadas: number;
  totalAlertasCriados: number;
  totalAlertasExistentes: number;
}

export class AlertaContasVencerWorkerService {
  private timerSweep: NodeJS.Timeout | null = null;
  private isSweepRunning: boolean = false;
  private intervalSweepMs: number = 60 * 60 * 1000; // Sweep periódico a cada 1 hora

  public setupEventListener(): void {
    console.log('[evolvi-worker:alertas-contas] Inicializando ouvinte de eventos de contas a vencer...');
    authEventBus.onUsuarioAutenticado(async (event: UsuarioAutenticadoEvent) => {
      try {
        console.log(
          `[evolvi-worker:alertas-contas] Usuário [${event.usuarioId}] autenticado. Verificando alertas...`
        );
        await this.processarAlertasUsuario(event.usuarioId);
      } catch (err) {
        console.error(
          `[evolvi-worker:alertas-contas] Erro ao validar alertas no login para [${event.usuarioId}]:`,
          err
        );
      }
    });
  }

  public removeEventListener(): void {
    console.log('[evolvi-worker:alertas-contas] Removendo ouvintes...');
    this.stopSweep();
  }

  public startSweep(intervalMs?: number): void {
    if (intervalMs) this.intervalSweepMs = intervalMs;
    if (this.timerSweep) clearInterval(this.timerSweep);

    this.timerSweep = setInterval(async () => {
      if (this.isSweepRunning) return;
      this.isSweepRunning = true;
      try {
        await this.executarSweepTodosUsuarios();
      } catch (err) {
        console.error('[evolvi-worker:alertas-contas] Erro no sweep periódico de alertas:', err);
      } finally {
        this.isSweepRunning = false;
      }
    }, this.intervalSweepMs);
  }

  public stopSweep(): void {
    if (this.timerSweep) {
      clearInterval(this.timerSweep);
      this.timerSweep = null;
    }
  }

  /**
   * Executa varredura para todos os usuários cadastrados
   */
  public async executarSweepTodosUsuarios(): Promise<number> {
    const usuarios = await prisma.usuario.findMany({ select: { id: true } });
    let totalAlertas = 0;
    for (const u of usuarios) {
      const res = await this.processarAlertasUsuario(u.id);
      totalAlertas += res.totalAlertasCriados;
    }
    return totalAlertas;
  }

  /**
   * Processa regras de alerta ativas para o usuário:
   * 1. CONTA_A_VENCER e CONTA_VENCIDA (lê diasAntecedencia e status da tabela regras_alerta)
   * 2. IMPORTACAO_PENDENTE_MES (se for dia 1º ou após o fechamento do mês e não houver importações)
   */
  public async processarAlertasUsuario(
    usuarioId: string,
    dataReferencia: Date = new Date()
  ): Promise<ResumoProcessamentoAlertas> {
    // 0. Virada automática do mês (a partir do dia 1º 00:00:00 se não renovado ainda)
    try {
      await contaPagarService.verificarERenovarCicloMensal(usuarioId, dataReferencia);
    } catch (cicloErr) {
      console.error(`[evolvi-worker:alertas-contas] Erro ao verificar ciclo mensal [${usuarioId}]:`, cicloErr);
    }

    // 1. Obter regras ativas configuradas para este usuário no banco
    const regraContaVencer = await alertaService.obterRegraPorCodigo(usuarioId, 'CONTA_A_VENCER');
    const regraContaVencida = await alertaService.obterRegraPorCodigo(usuarioId, 'CONTA_VENCIDA');
    const regraImportacao = await alertaService.obterRegraPorCodigo(usuarioId, 'IMPORTACAO_PENDENTE_MES');

    let totalAlertasCriados = 0;
    let totalAlertasExistentes = 0;
    let totalContasAvaliadas = 0;

    // Se nenhuma regra de contas estiver ativa, não processa contas
    const monitorarContas = Boolean(regraContaVencer?.ativo || regraContaVencida?.ativo);

    if (monitorarContas) {
      const params = (regraContaVencer?.parametros as any) || {};
      const diasAlerta = typeof params.diasAntecedencia === 'number' ? params.diasAntecedencia : 3;

      const hoje = new Date(dataReferencia);
      hoje.setUTCHours(0, 0, 0, 0);

      const dataLimiteAlerta = new Date(hoje);
      dataLimiteAlerta.setUTCDate(dataLimiteAlerta.getUTCDate() + diasAlerta);
      dataLimiteAlerta.setUTCHours(23, 59, 59, 999);

      const contasPendentes = await prisma.contaPagar.findMany({
        where: {
          usuarioId,
          status: { in: [StatusContaPagar.PENDENTE, StatusContaPagar.AGENDADO] },
        },
      });

      totalContasAvaliadas = contasPendentes.length;

      const anoHoje = hoje.getUTCFullYear();
      const mesHoje = hoje.getUTCMonth(); // 0 a 11
      const ultDiaMesHoje = new Date(Date.UTC(anoHoje, mesHoje + 1, 0)).getUTCDate();

      for (const conta of contasPendentes) {
        // Obter data de vencimento prevista:
        // Se a conta tem dataVencimento no mês atual ou posterior, usamos ela.
        // Se a conta é recorrente (baseada no diaVencimento), projetamos a data no mês de referência.
        let vDate: Date;
        if (conta.diaVencimento && conta.diaVencimento >= 1 && conta.diaVencimento <= 31) {
          const diaEfetivo = Math.min(conta.diaVencimento, ultDiaMesHoje);
          vDate = new Date(Date.UTC(anoHoje, mesHoje, diaEfetivo));
        } else if (conta.dataVencimento) {
          vDate = new Date(conta.dataVencimento);
          vDate.setUTCHours(0, 0, 0, 0);
        } else {
          vDate = new Date(Date.UTC(anoHoje, mesHoje, 10));
        }

        const diffMs = vDate.getTime() - hoje.getTime();
        const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        // Se o vencimento está além do limite de dias configurado para alerta de antecedência, ignora
        if (diffDias > diasAlerta) {
          continue;
        }

        const isVencida = diffDias < 0;
        const isHoje = diffDias === 0;

        // Se está vencida mas a regra CONTA_VENCIDA estiver desligada pelo usuário, pula
        if (isVencida && regraContaVencida && !regraContaVencida.ativo) {
          continue;
        }

        // Se está a vencer mas a regra CONTA_A_VENCER estiver desligada pelo usuário, pula
        if (!isVencida && regraContaVencer && !regraContaVencer.ativo) {
          continue;
        }

        const tipo = isVencida ? 'CONTA_VENCIDA' : 'CONTA_A_VENCER';
        const severidade: SeveridadeAlerta = isVencida
          ? SeveridadeAlerta.URGENTE
          : isHoje
          ? SeveridadeAlerta.ATENCAO
          : SeveridadeAlerta.INFO;

        const isAgendado = conta.status === StatusContaPagar.AGENDADO;
        const sufixoStatus = isAgendado ? ' (Pagamento Agendado)' : '';

        const valorFormatado =
          conta.valor !== null && conta.valor !== undefined
            ? Number(conta.valor).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })
            : conta.valorVariavel
            ? 'Valor Variável'
            : 'A definir';
        const dataFormatadaIso = vDate.toISOString().split('T')[0];

        let titulo = '';
        let mensagem = '';

        if (isVencida) {
          const diasAtraso = Math.abs(diffDias);
          titulo = `Conta Vencida: ${conta.descricao}${sufixoStatus}`;
          mensagem = `A conta "${conta.descricao}" (${valorFormatado}) venceu há ${diasAtraso} dia(s) (${dataFormatadaIso}) e consta como ${conta.status.toLowerCase()}.`;
        } else if (isHoje) {
          titulo = `Vence Hoje: ${conta.descricao}${sufixoStatus}`;
          mensagem = `A conta "${conta.descricao}" (${valorFormatado}) vence HOJE (${dataFormatadaIso}).`;
        } else {
          titulo = `Conta a Vencer: ${conta.descricao}${sufixoStatus}`;
          mensagem = `A conta "${conta.descricao}" (${valorFormatado}) vence em ${diffDias} dia(s) (${dataFormatadaIso}).`;
        }

        const alertaExistente = await prisma.alertaSistema.findFirst({
          where: {
            usuarioId,
            entidadeId: conta.id,
            entidadeTipo: 'CONTA_PAGAR',
          },
        });

        if (alertaExistente) {
          // Se o usuário já cancelou este alerta, respeitamos e não recriamos
          if (alertaExistente.status === StatusAlertaSistema.CANCELADO) {
            totalAlertasExistentes++;
            continue;
          }

          if (
            alertaExistente.tipo !== tipo ||
            alertaExistente.severidade !== severidade ||
            alertaExistente.titulo !== titulo
          ) {
            await prisma.alertaSistema.update({
              where: { id: alertaExistente.id },
              data: {
                tipo,
                severidade,
                titulo,
                mensagem,
                status: StatusAlertaSistema.PENDENTE,
              },
            });
          }
          totalAlertasExistentes++;
        } else {
          await prisma.alertaSistema.create({
            data: {
              usuarioId,
              regraAlertaId: isVencida ? regraContaVencida?.id : regraContaVencer?.id,
              tipo,
              severidade,
              titulo,
              mensagem,
              entidadeTipo: 'CONTA_PAGAR',
              entidadeId: conta.id,
              dataPrevisao: vDate,
              status: StatusAlertaSistema.PENDENTE,
              metadata: {
                valor: conta.valor !== null && conta.valor !== undefined ? Number(conta.valor) : null,
                valorVariavel: conta.valorVariavel,
                tipoContaPagar: conta.tipoContaPagar,
                statusConta: conta.status,
                diasRestantes: diffDias,
                dataVencimento: dataFormatadaIso,
              },
            },
          });
          totalAlertasCriados++;
        }
      }
    }

    // 2. Validação da regra data-driven IMPORTACAO_PENDENTE_MES (ex: dia 1º ou mês finalizado)
    if (regraImportacao && regraImportacao.ativo) {
      const hoje = new Date(dataReferencia);
      const diaDoMes = hoje.getUTCDate();
      const paramsImp = (regraImportacao.parametros as any) || {};
      const diaGatilho = typeof paramsImp.diaDoMesGatilho === 'number' ? paramsImp.diaDoMesGatilho : 1;

      // Se estamos a partir do dia configurado
      if (diaDoMes >= diaGatilho && diaDoMes <= diaGatilho + 5) {
        // Calcular mês anterior no formato YYYY-MM
        const anoRef = hoje.getUTCFullYear();
        const mesRef = hoje.getUTCMonth(); // 0-based
        const mesAnteriorDate = new Date(Date.UTC(anoRef, mesRef - 1, 1));
        const compAnterior = `${mesAnteriorDate.getUTCFullYear()}-${String(
          mesAnteriorDate.getUTCMonth() + 1
        ).padStart(2, '0')}`;

        // Verifica se houve importações ou conciliações nessa competência
        const totalImportacoesMesAnterior = await prisma.historicoImportacaoArquivo.count({
          where: {
            usuarioId,
            competencia: compAnterior,
          },
        });

        if (totalImportacoesMesAnterior === 0) {
          const alertaExistente = await prisma.alertaSistema.findFirst({
            where: {
              usuarioId,
              tipo: 'IMPORTACAO_PENDENTE_MES',
              metadata: {
                path: ['competencia'],
                equals: compAnterior,
              },
            },
          });

          if (!alertaExistente) {
            await prisma.alertaSistema.create({
              data: {
                usuarioId,
                regraAlertaId: regraImportacao.id,
                tipo: 'IMPORTACAO_PENDENTE_MES',
                severidade: regraImportacao.severidadePadrao,
                titulo: regraImportacao.templateTitulo || 'Fechamento do Mês Anterior Pendente',
                mensagem:
                  regraImportacao.templateMensagem ||
                  `O mês ${compAnterior} foi concluído. Lembre-se de importar os extratos e faturas para conciliação.`,
                status: StatusAlertaSistema.PENDENTE,
                metadata: {
                  competencia: compAnterior,
                },
              },
            });
            totalAlertasCriados++;
          }
        }
      }
    }

    return {
      usuarioId,
      totalContasAvaliadas,
      totalAlertasCriados,
      totalAlertasExistentes,
    };
  }
}

export const alertaContasVencerWorkerService = new AlertaContasVencerWorkerService();
