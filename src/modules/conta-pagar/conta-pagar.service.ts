import { prisma } from '../../infrastructure/database/prisma.js';
import {
  CriarContaPagarInput,
  AtualizarContaPagarInput,
  QueryContasPagarInput,
} from './conta-pagar.schema.js';
import { StatusContaPagar, StatusAlertaSistema } from '@prisma/client';

export interface ResultadoCicloMensalContasPagar {
  usuarioId: string;
  competenciaAtual: string;
  renovado: boolean;
  motivo: string;
  totalContasRenovadas: number;
}

export class ContaPagarService {
  /**
   * Valida e executa a virada automática do mês para as contas a pagar do usuário.
   * Regra:
   * - A partir do dia 01 do mês às 00:00:00 (mês corrente YYYY-MM).
   * - Verifica na tabela `controle_ciclos_mensais_contas_pagar` se a competência atual já foi renovada.
   * - Se já foi renovada, NÃO altera nada (mantém os pagamentos e agendamentos em andamento).
   * - Se for a primeira vez no mês atual:
   *   1. Reseta as contas recorrentes para PENDENTE (e limpa dataPagamento).
   *   2. Projeta a nova dataVencimento no mês atual usando o diaVencimento cadastrado.
   *   3. Se a conta for de valor variável (ex: fatura de cartão), zera o valor (null) para o novo mês.
   *   4. Registra a competência em `controle_ciclos_mensais_contas_pagar` de forma atômica e idempotente.
   */
  public async verificarERenovarCicloMensal(
    usuarioId: string,
    dataReferencia: Date = new Date()
  ): Promise<ResultadoCicloMensalContasPagar> {
    const ano = dataReferencia.getUTCFullYear();
    const mes = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const competenciaAtual = `${ano}-${mes}`;

    // 1. Verificar se a competência atual já foi processada/renovada para este usuário
    const cicloExistente = await prisma.controleCicloMensalContasPagar.findUnique({
      where: {
        usuarioId_competencia: {
          usuarioId,
          competencia: competenciaAtual,
        },
      },
    });

    if (cicloExistente) {
      return {
        usuarioId,
        competenciaAtual,
        renovado: false,
        motivo: 'Competência atual já renovada anteriormente. Mantendo status atual em andamento.',
        totalContasRenovadas: 0,
      };
    }

    // 2. Buscar todas as contas a pagar ativas cadastradas para o usuário
    const contas = await prisma.contaPagar.findMany({
      where: {
        usuarioId,
        status: { not: StatusContaPagar.CANCELADO },
      },
    });

    if (contas.length === 0) {
      // Registra o ciclo como concluído mesmo sem contas para não rodar desnecessariamente
      await prisma.controleCicloMensalContasPagar.create({
        data: {
          usuarioId,
          competencia: competenciaAtual,
          renovadoEm: dataReferencia,
          totalContasRenovadas: 0,
        },
      });

      return {
        usuarioId,
        competenciaAtual,
        renovado: true,
        motivo: 'Ciclo registrado. Usuário não possui contas a pagar cadastradas.',
        totalContasRenovadas: 0,
      };
    }

    // Último dia do mês corrente
    const ultDiaMes = new Date(Date.UTC(ano, Number(mes), 0)).getUTCDate();
    let totalRenovadas = 0;

    // 3. Executar renovação em transação
    await prisma.$transaction(async (tx) => {
      for (const conta of contas) {
        // Se a conta já pertencia explicitamente à competência atual, não mexe
        if (conta.competenciaReferencia === competenciaAtual) {
          continue;
        }

        const diaEfetivo = Math.min(conta.diaVencimento, ultDiaMes);
        const novaDataVenc = new Date(Date.UTC(ano, Number(mes) - 1, diaEfetivo));

        // Para faturas de cartão ou contas com valor variável, zera o valor para ser informado no novo mês
        const novoValor = conta.valorVariavel || conta.tipoContaPagar === 'FATURA_CARTAO' ? null : conta.valor;

        await tx.contaPagar.update({
          where: { id: conta.id },
          data: {
            status: StatusContaPagar.PENDENTE,
            dataPagamento: null,
            dataVencimento: novaDataVenc,
            valor: novoValor,
            competenciaReferencia: competenciaAtual,
          },
        });

        // Limpar alertas antigos resolvidos ou pendentes da competência anterior para essa conta
        await tx.alertaSistema.deleteMany({
          where: {
            usuarioId,
            entidadeId: conta.id,
            entidadeTipo: 'CONTA_PAGAR',
          },
        });

        totalRenovadas++;
      }

      // 4. Gravar registro soberano de ciclo renovado
      await tx.controleCicloMensalContasPagar.upsert({
        where: {
          usuarioId_competencia: {
            usuarioId,
            competencia: competenciaAtual,
          },
        },
        create: {
          usuarioId,
          competencia: competenciaAtual,
          renovadoEm: dataReferencia,
          totalContasRenovadas: totalRenovadas,
        },
        update: {
          renovadoEm: dataReferencia,
          totalContasRenovadas: totalRenovadas,
        },
      });
    });

    return {
      usuarioId,
      competenciaAtual,
      renovado: true,
      motivo: `Mês virou! ${totalRenovadas} contas a pagar renovadas com status zerado (Pendente) para a competência ${competenciaAtual}.`,
      totalContasRenovadas: totalRenovadas,
    };
  }

  /**
   * Cria um novo vencimento de conta a pagar recorrente (baseado em diaVencimento)
   */
  public async criar(usuarioId: string, dados: CriarContaPagarInput) {
    const dia = dados.diaVencimento;

    // Se informada uma data completa, mantém; senão projeta para o mês corrente/próximo
    let dataVenc: Date;
    if (dados.dataVencimento) {
      dataVenc = new Date(`${dados.dataVencimento}T00:00:00Z`);
    } else {
      const agora = new Date();
      const ano = agora.getUTCFullYear();
      const mes = agora.getUTCMonth(); // 0 a 11
      const ultDiaMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
      const diaEfetivo = Math.min(dia, ultDiaMes);
      dataVenc = new Date(Date.UTC(ano, mes, diaEfetivo));
    }

    // Se for fatura de cartão ou marcado como valor variável sem valor fixo
    const ehFatura = dados.tipoContaPagar === 'FATURA_CARTAO';
    const valorVariavel = dados.valorVariavel ?? (ehFatura && (dados.valor === null || dados.valor === undefined));

    const agora = new Date();
    const competenciaAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;

    const contaPagar = await prisma.contaPagar.create({
      data: {
        usuarioId,
        descricao: dados.descricao.trim(),
        valor: dados.valor !== undefined && dados.valor !== null ? dados.valor : null,
        valorVariavel,
        tipoContaPagar: dados.tipoContaPagar || 'OUTRO',
        diaVencimento: dia,
        dataVencimento: dataVenc,
        competenciaReferencia: competenciaAtual,
        categoriaId: dados.categoriaId || null,
        contaId: dados.contaId || null,
        recorrenciaId: dados.recorrenciaId || null,
        essencial: dados.essencial ?? true,
        codigoBarras: dados.codigoBarras || null,
        observacoes: dados.observacoes || null,
        status: (dados.status as StatusContaPagar) || StatusContaPagar.PENDENTE,
      },
      include: {
        categoria: { select: { id: true, nome: true } },
        conta: { select: { id: true, nome: true, tipo: true } },
      },
    });

    return contaPagar;
  }

  /**
   * Lista contas a pagar do usuário com filtros opcionais
   * Sempre valida se o mês virou antes de listar.
   */
  public async listar(usuarioId: string, filtros?: QueryContasPagarInput) {
    // Validação automática da virada do mês ao abrir a tela/listar
    try {
      await this.verificarERenovarCicloMensal(usuarioId);
    } catch (err) {
      console.error(`[ContaPagarService] Erro ao verificar ciclo mensal [${usuarioId}]:`, err);
    }

    const where: any = { usuarioId };

    if (filtros?.status) {
      where.status = filtros.status as StatusContaPagar;
    }

    if (filtros?.competencia) {
      const [ano, mes] = filtros.competencia.split('-').map(Number);
      const dataInicio = new Date(Date.UTC(ano, mes - 1, 1));
      const dataFim = new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));
      where.dataVencimento = {
        gte: dataInicio,
        lte: dataFim,
      };
    } else if (filtros?.dataInicio || filtros?.dataFim) {
      where.dataVencimento = {};
      if (filtros.dataInicio) {
        where.dataVencimento.gte = new Date(`${filtros.dataInicio}T00:00:00Z`);
      }
      if (filtros.dataFim) {
        where.dataVencimento.lte = new Date(`${filtros.dataFim}T23:59:59Z`);
      }
    }

    const contas = await prisma.contaPagar.findMany({
      where,
      include: {
        categoria: { select: { id: true, nome: true } },
        conta: { select: { id: true, nome: true, tipo: true } },
      },
      orderBy: [{ diaVencimento: 'asc' }, { descricao: 'asc' }],
    });

    return contas;
  }

  /**
   * Busca conta a pagar por ID
   */
  public async obterPorId(usuarioId: string, id: string) {
    const conta = await prisma.contaPagar.findFirst({
      where: { id, usuarioId },
      include: {
        categoria: { select: { id: true, nome: true } },
        conta: { select: { id: true, nome: true, tipo: true } },
      },
    });

    if (!conta) {
      throw new Error('Conta a pagar não encontrada');
    }

    return conta;
  }

  /**
   * Atualiza dados de uma conta a pagar (dia, valor, status, etc)
   */
  public async atualizar(usuarioId: string, id: string, dados: AtualizarContaPagarInput) {
    const contaAtual = await this.obterPorId(usuarioId, id);

    const updateData: any = {};
    if (dados.descricao !== undefined) updateData.descricao = dados.descricao.trim();
    if (dados.valor !== undefined) updateData.valor = dados.valor;
    if (dados.valorVariavel !== undefined) updateData.valorVariavel = dados.valorVariavel;
    if (dados.tipoContaPagar !== undefined) updateData.tipoContaPagar = dados.tipoContaPagar;
    if (dados.diaVencimento !== undefined) {
      updateData.diaVencimento = dados.diaVencimento;
      // Atualizar dataVencimento calculada para manter consistência
      const baseDate = contaAtual.dataVencimento ? new Date(contaAtual.dataVencimento) : new Date();
      const ano = baseDate.getUTCFullYear();
      const mes = baseDate.getUTCMonth();
      const ultDiaMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
      const diaEfetivo = Math.min(dados.diaVencimento, ultDiaMes);
      updateData.dataVencimento = new Date(Date.UTC(ano, mes, diaEfetivo));
    }
    if (dados.dataVencimento !== undefined) {
      updateData.dataVencimento = dados.dataVencimento
        ? new Date(`${dados.dataVencimento}T00:00:00Z`)
        : null;
    }
    if (dados.dataPagamento !== undefined) {
      updateData.dataPagamento = dados.dataPagamento
        ? new Date(`${dados.dataPagamento}T00:00:00Z`)
        : null;
    }
    if (dados.status !== undefined) {
      updateData.status = dados.status as StatusContaPagar;
      if (dados.status === StatusContaPagar.PAGO && !dados.dataPagamento) {
        updateData.dataPagamento = new Date();
      }
    }
    if (dados.categoriaId !== undefined) updateData.categoriaId = dados.categoriaId;
    if (dados.contaId !== undefined) updateData.contaId = dados.contaId;
    if (dados.recorrenciaId !== undefined) updateData.recorrenciaId = dados.recorrenciaId;
    if (dados.essencial !== undefined) updateData.essencial = dados.essencial;
    if (dados.codigoBarras !== undefined) updateData.codigoBarras = dados.codigoBarras;
    if (dados.observacoes !== undefined) updateData.observacoes = dados.observacoes;

    const atualizado = await prisma.contaPagar.update({
      where: { id },
      data: updateData,
      include: {
        categoria: { select: { id: true, nome: true } },
        conta: { select: { id: true, nome: true, tipo: true } },
      },
    });

    // Se foi marcada como PAGA ou CANCELADA, resolver alertas pendentes vinculados
    if (dados.status === StatusContaPagar.PAGO || dados.status === StatusContaPagar.CANCELADO) {
      await prisma.alertaSistema.updateMany({
        where: {
          entidadeId: id,
          entidadeTipo: 'CONTA_PAGAR',
          status: { in: [StatusAlertaSistema.PENDENTE, StatusAlertaSistema.VISUALIZADO] },
        },
        data: {
          status:
            dados.status === StatusContaPagar.PAGO
              ? StatusAlertaSistema.RESOLVIDO
              : StatusAlertaSistema.CANCELADO,
          motivoCancelamento:
            dados.status === StatusContaPagar.PAGO
              ? 'Conta liquidada pelo usuário'
              : 'Conta cancelada',
        },
      });
    }

    return atualizado;
  }

  /**
   * Sincroniza/importa compromissos recorrentes da tabela `Recorrencia` para `ContaPagar`
   * garantindo idempotência (sem duplicar).
   */
  public async sincronizarRecorrencias(usuarioId: string) {
    const recorrenciasAtivas = await prisma.recorrencia.findMany({
      where: {
        usuarioId,
        status: 'ATIVA',
      },
      include: {
        categoria: true,
      },
    });

    if (recorrenciasAtivas.length === 0) {
      return {
        totalProcessadas: 0,
        totalImportadas: 0,
        totalExistentes: 0,
        contas: [],
      };
    }

    // Buscar contas já cadastradas para este usuário
    const contasExistentes = await prisma.contaPagar.findMany({
      where: { usuarioId },
      select: {
        id: true,
        descricao: true,
        diaVencimento: true,
        recorrenciaId: true,
      },
    });

    const setRecorrenciasId = new Set(
      contasExistentes.map((c) => c.recorrenciaId).filter(Boolean)
    );
    const setChavesDescDia = new Set(
      contasExistentes.map(
        (c) => `${c.descricao.trim().toLowerCase()}___${c.diaVencimento}`
      )
    );

    let totalImportadas = 0;
    let totalExistentes = 0;
    const novasContasCriadas = [];

    const agora = new Date();
    const anoAtual = agora.getUTCFullYear();
    const mesAtual = agora.getUTCMonth();
    const competenciaAtual = `${anoAtual}-${String(mesAtual + 1).padStart(2, '0')}`;

    for (const rec of recorrenciasAtivas) {
      const diaVencimento = rec.diaPrevisto && rec.diaPrevisto >= 1 && rec.diaPrevisto <= 31
        ? rec.diaPrevisto
        : 10;

      const descNormalizada = rec.descricao.trim().toLowerCase();
      const chaveDescDia = `${descNormalizada}___${diaVencimento}`;

      // Idempotência: Se já vinculado pelo ID da recorrência ou por descrição + dia
      if (setRecorrenciasId.has(rec.id) || setChavesDescDia.has(chaveDescDia)) {
        totalExistentes++;
        continue;
      }

      // Calcular data de vencimento prevista para o mês corrente
      const ultDiaMes = new Date(Date.UTC(anoAtual, mesAtual + 1, 0)).getUTCDate();
      const diaEfetivo = Math.min(diaVencimento, ultDiaMes);
      const dataVenc = new Date(Date.UTC(anoAtual, mesAtual, diaEfetivo));

      const ehFatura = descNormalizada.includes('fatura') || descNormalizada.includes('cartao') || descNormalizada.includes('cartão');

      const novaConta = await prisma.contaPagar.create({
        data: {
          usuarioId,
          descricao: rec.descricao.trim(),
          valor: rec.valorReferencia,
          valorVariavel: ehFatura,
          tipoContaPagar: ehFatura ? 'FATURA_CARTAO' : 'OUTRO',
          diaVencimento,
          dataVencimento: dataVenc,
          competenciaReferencia: competenciaAtual,
          categoriaId: rec.categoriaId || null,
          recorrenciaId: rec.id,
          essencial: rec.essencial,
          status: StatusContaPagar.PENDENTE,
          observacoes: 'Importada automaticamente de compromissos recorrentes',
        },
        include: {
          categoria: { select: { id: true, nome: true } },
          conta: { select: { id: true, nome: true, tipo: true } },
        },
      });

      // Adiciona aos conjuntos para evitar duplicidade dentro da própria iteração
      setRecorrenciasId.add(rec.id);
      setChavesDescDia.add(chaveDescDia);
      novasContasCriadas.push(novaConta);
      totalImportadas++;
    }

    return {
      totalProcessadas: recorrenciasAtivas.length,
      totalImportadas,
      totalExistentes,
      contas: novasContasCriadas,
    };
  }

  /**
   * Exclui uma conta a pagar
   */
  public async excluir(usuarioId: string, id: string) {
    await this.obterPorId(usuarioId, id);

    // Remove alertas vinculados
    await prisma.alertaSistema.deleteMany({
      where: {
        entidadeId: id,
        entidadeTipo: 'CONTA_PAGAR',
      },
    });

    return prisma.contaPagar.delete({
      where: { id },
    });
  }
}

export const contaPagarService = new ContaPagarService();
