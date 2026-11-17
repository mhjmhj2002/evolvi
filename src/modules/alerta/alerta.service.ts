import { prisma } from '../../infrastructure/database/prisma.js';
import {
  CriarAlertaInput,
  QueryAlertasInput,
  AtualizarStatusAlertaInput,
  CriarRegraAlertaInput,
  AtualizarRegraAlertaInput,
} from './alerta.schema.js';
import { StatusAlertaSistema, SeveridadeAlerta } from '@prisma/client';

export const REGRAS_PADRAO_SISTEMA: Array<CriarRegraAlertaInput> = [
  {
    codigo: 'CONTA_A_VENCER',
    nome: 'Contas a Vencer',
    descricao: 'Dispara notificações com antecedência parametrizada para compromissos e contas a pagar',
    tipoGatilho: 'VERIFICACAO_DIARIA',
    severidadePadrao: 'INFO',
    ativo: true,
    parametros: { diasAntecedencia: 3 },
    templateTitulo: 'Conta a Vencer: {{descricao}}',
    templateMensagem: 'A conta "{{descricao}}" no valor de {{valor}} vence em {{dias}} dia(s).',
  },
  {
    codigo: 'CONTA_VENCIDA',
    nome: 'Contas Vencidas',
    descricao: 'Alerta urgente sobre contas pendentes que ultrapassaram a data de vencimento',
    tipoGatilho: 'VERIFICACAO_DIARIA',
    severidadePadrao: 'URGENTE',
    ativo: true,
    parametros: {},
    templateTitulo: 'Conta Vencida: {{descricao}}',
    templateMensagem: 'A conta "{{descricao}}" no valor de {{valor}} venceu há {{dias}} dia(s).',
  },
  {
    codigo: 'IMPORTACAO_PENDENTE_MES',
    nome: 'Lembrete de Fechamento de Mês',
    descricao: 'Dispara no início do mês lembrando de importar o extrato do mês que finalizou',
    tipoGatilho: 'CRON_AGENDADO',
    severidadePadrao: 'ATENCAO',
    ativo: true,
    parametros: { diaDoMesGatilho: 1 },
    templateTitulo: 'Fechamento do Mês Anterior Pendente',
    templateMensagem: 'O mês anterior foi concluído. Lembre-se de importar os extratos e faturas para conciliação.',
  },
];

export class AlertaService {
  // =========================================================================
  // 1. GESTÃO DE REGRAS DE ALERTA (CRUD Orientado a Dados)
  // =========================================================================

  /**
   * Garante que o usuário possua as regras padrão inicializadas (idempotente)
   */
  public async garantirRegrasPadrao(usuarioId: string) {
    for (const regraPadrao of REGRAS_PADRAO_SISTEMA) {
      await prisma.regraAlerta.upsert({
        where: {
          usuarioId_codigo: {
            usuarioId,
            codigo: regraPadrao.codigo,
          },
        },
        create: {
          usuarioId,
          codigo: regraPadrao.codigo,
          nome: regraPadrao.nome,
          descricao: regraPadrao.descricao,
          tipoGatilho: regraPadrao.tipoGatilho || 'VERIFICACAO_DIARIA',
          severidadePadrao: (regraPadrao.severidadePadrao || 'INFO') as SeveridadeAlerta,
          ativo: regraPadrao.ativo ?? true,
          parametros: regraPadrao.parametros || {},
          templateTitulo: regraPadrao.templateTitulo,
          templateMensagem: regraPadrao.templateMensagem,
        },
        update: {},
      });
    }
  }

  /**
   * Lista todas as regras de alerta configuradas para o usuário
   */
  public async listarRegras(usuarioId: string) {
    await this.garantirRegrasPadrao(usuarioId);

    return prisma.regraAlerta.findMany({
      where: { usuarioId },
      orderBy: [{ ativo: 'desc' }, { codigo: 'asc' }],
    });
  }

  /**
   * Obtém uma regra de alerta pelo código
   */
  public async obterRegraPorCodigo(usuarioId: string, codigo: string) {
    await this.garantirRegrasPadrao(usuarioId);

    return prisma.regraAlerta.findUnique({
      where: {
        usuarioId_codigo: {
          usuarioId,
          codigo,
        },
      },
    });
  }

  /**
   * Cria uma nova regra dinâmica de alerta para o usuário
   */
  public async criarRegra(usuarioId: string, dados: CriarRegraAlertaInput) {
    return prisma.regraAlerta.create({
      data: {
        usuarioId,
        codigo: dados.codigo,
        nome: dados.nome,
        descricao: dados.descricao,
        tipoGatilho: dados.tipoGatilho || 'CRON_AGENDADO',
        severidadePadrao: (dados.severidadePadrao || 'INFO') as SeveridadeAlerta,
        ativo: dados.ativo ?? true,
        parametros: dados.parametros || {},
        templateTitulo: dados.templateTitulo,
        templateMensagem: dados.templateMensagem,
      },
    });
  }

  /**
   * Atualiza uma regra de alerta (nome, ativo, parâmetros JSON, templates)
   */
  public async atualizarRegra(usuarioId: string, id: string, dados: AtualizarRegraAlertaInput) {
    const regra = await prisma.regraAlerta.findFirst({
      where: { id, usuarioId },
    });

    if (!regra) {
      throw new Error('Regra de alerta não encontrada para este usuário.');
    }

    return prisma.regraAlerta.update({
      where: { id },
      data: {
        ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
        ...(dados.descricao !== undefined ? { descricao: dados.descricao } : {}),
        ...(dados.tipoGatilho !== undefined ? { tipoGatilho: dados.tipoGatilho } : {}),
        ...(dados.severidadePadrao !== undefined
          ? { severidadePadrao: dados.severidadePadrao as SeveridadeAlerta }
          : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
        ...(dados.parametros !== undefined ? { parametros: dados.parametros } : {}),
        ...(dados.templateTitulo !== undefined ? { templateTitulo: dados.templateTitulo } : {}),
        ...(dados.templateMensagem !== undefined ? { templateMensagem: dados.templateMensagem } : {}),
      },
    });
  }

  /**
   * Exclui uma regra personalizada de alerta
   */
  public async excluirRegra(usuarioId: string, id: string) {
    const regra = await prisma.regraAlerta.findFirst({
      where: { id, usuarioId },
    });

    if (!regra) {
      throw new Error('Regra de alerta não encontrada para este usuário.');
    }

    return prisma.regraAlerta.delete({
      where: { id },
    });
  }

  // =========================================================================
  // 2. DISPARO E CONSULTA DE ALERTAS (Instâncias emitidas para o Usuário)
  // =========================================================================

  /**
   * Cria uma ocorrência de alerta genérico
   */
  public async criarAlerta(usuarioId: string, dados: CriarAlertaInput) {
    return prisma.alertaSistema.create({
      data: {
        usuarioId,
        regraAlertaId: dados.regraAlertaId,
        tipo: dados.tipo,
        severidade: (dados.severidade || 'INFO') as SeveridadeAlerta,
        titulo: dados.titulo,
        mensagem: dados.mensagem,
        entidadeTipo: dados.entidadeTipo,
        entidadeId: dados.entidadeId,
        dataPrevisao: dados.dataPrevisao ? new Date(`${dados.dataPrevisao}T00:00:00Z`) : null,
        dataExpiracao: dados.dataExpiracao ? new Date(dados.dataExpiracao) : null,
        metadata: dados.metadata ? JSON.parse(JSON.stringify(dados.metadata)) : undefined,
      },
    });
  }

  /**
   * Lista alertas do usuário com filtros opcionais
   */
  public async listarAlertas(usuarioId: string, filtros?: QueryAlertasInput) {
    const where: any = { usuarioId };

    if (filtros?.apenasAtivos) {
      where.status = {
        in: [StatusAlertaSistema.PENDENTE, StatusAlertaSistema.VISUALIZADO],
      };
    } else if (filtros?.status) {
      where.status = filtros.status as StatusAlertaSistema;
    }

    if (filtros?.tipo) {
      where.tipo = filtros.tipo;
    }

    return prisma.alertaSistema.findMany({
      where,
      include: {
        regraAlerta: {
          select: { id: true, codigo: true, nome: true },
        },
      },
      orderBy: [{ severidade: 'desc' }, { criadoEm: 'desc' }],
    });
  }

  /**
   * Retorna contadores de alertas
   */
  public async obterResumoAlertas(usuarioId: string) {
    const [totalPendentes, totalGeral] = await Promise.all([
      prisma.alertaSistema.count({
        where: {
          usuarioId,
          status: StatusAlertaSistema.PENDENTE,
        },
      }),
      prisma.alertaSistema.count({
        where: { usuarioId },
      }),
    ]);

    return {
      totalPendentes,
      totalGeral,
    };
  }

  /**
   * Atualiza status do alerta
   */
  public async atualizarStatus(
    usuarioId: string,
    alertaId: string,
    dados: AtualizarStatusAlertaInput
  ) {
    const alerta = await prisma.alertaSistema.findFirst({
      where: { id: alertaId, usuarioId },
    });

    if (!alerta) {
      throw new Error('Alerta não encontrado para este usuário.');
    }

    return prisma.alertaSistema.update({
      where: { id: alertaId },
      data: {
        status: dados.status as StatusAlertaSistema,
        motivoCancelamento: dados.motivoCancelamento,
      },
    });
  }

  /**
   * Marca todos os alertas pendentes como visualizados
   */
  public async marcarTodosVisualizados(usuarioId: string) {
    return prisma.alertaSistema.updateMany({
      where: {
        usuarioId,
        status: StatusAlertaSistema.PENDENTE,
      },
      data: {
        status: StatusAlertaSistema.VISUALIZADO,
      },
    });
  }

  /**
   * Exclui alerta
   */
  public async excluirAlerta(usuarioId: string, alertaId: string) {
    const alerta = await prisma.alertaSistema.findFirst({
      where: { id: alertaId, usuarioId },
    });

    if (!alerta) {
      throw new Error('Alerta não encontrado para este usuário.');
    }

    return prisma.alertaSistema.delete({
      where: { id: alertaId },
    });
  }
}

export const alertaService = new AlertaService();
