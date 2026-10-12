import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import {
  queryVencimentosSchema,
  ItemCronogramaVencimento,
  CronogramaVencimentosResponse,
} from './compromisso.schema.js';

/**
 * Converte YYYY-MM em número de meses desde o ano zero para cálculo de distância.
 */
function compToMonths(comp: string): number {
  const [ano, mes] = comp.split('-').map(Number);
  return ano * 12 + mes;
}

export const compromissoRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/compromissos/vencimentos?competencia=YYYY-MM
  app.get('/vencimentos', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = queryVencimentosSchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Competência inválida ou ausente. Use o formato YYYY-MM (ex: 2026-10)',
        issues: parseResult.error.issues,
      });
    }

    const { competencia } = parseResult.data;
    const [anoStr, mesStr] = competencia.split('-');
    const ano = parseInt(anoStr, 10);
    const mes = parseInt(mesStr, 10);
    // Último dia do mês consultado
    const ultimoDiaDoMes = new Date(ano, mes, 0).getDate();

    // 1. Buscar recorrências ativas do usuário
    const recorrencias = await prisma.recorrencia.findMany({
      where: {
        usuarioId,
        status: 'ATIVA',
      },
      include: {
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: {
        diaPrevisto: 'asc',
      },
    });

    // 2. Buscar parcelamentos ativos do usuário
    const parcelamentos = await prisma.parcelamento.findMany({
      where: {
        usuarioId,
        status: 'ATIVO',
      },
      include: {
        conta: {
          select: {
            id: true,
            nome: true,
            tipo: true,
            diaVencimento: true,
          },
        },
        categoria: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
    });

    const itens: ItemCronogramaVencimento[] = [];

    // Mapear recorrências para o cronograma
    for (const rec of recorrencias) {
      const dia = rec.diaPrevisto ? Math.min(rec.diaPrevisto, ultimoDiaDoMes) : 10; // default dia 10 se não informado
      const dataVencimentoPrevista = `${competencia}-${String(dia).padStart(2, '0')}`;
      const valor = Number(rec.valorReferencia);

      itens.push({
        tipo: 'RECORRENCIA',
        origemId: rec.id,
        descricao: rec.descricao,
        valor,
        diaVencimento: dia,
        dataVencimentoPrevista,
        essencial: rec.essencial,
        categoria: rec.categoria,
        conta: null,
      });
    }

    // Mapear parcelamentos que incidem na competência consultada
    const targetMonths = compToMonths(competencia);

    for (const parc of parcelamentos) {
      const primeiroMonths = compToMonths(parc.primeiroVencimento);
      const ultimoMonths = compToMonths(parc.ultimoVencimento);

      // O parcelamento está ativo nesta competência se targetMonths estiver entre primeiro e ultimo
      if (targetMonths >= primeiroMonths && targetMonths <= ultimoMonths) {
        // Calcular número da parcela nesta competência
        // Ex: primeiro = 2026-08 (parc 1). Se target = 2026-10, diff = 2 -> parcela = 1 + 2 = 3.
        const diffMeses = targetMonths - primeiroMonths;
        const parcelaNoMes = diffMeses + 1;

        // Dia de vencimento: usar diaVencimento da conta vinculada (ex: cartão) ou dia padrão 10
        const diaBase = parc.conta?.diaVencimento ?? 10;
        const dia = Math.min(diaBase, ultimoDiaDoMes);
        const dataVencimentoPrevista = `${competencia}-${String(dia).padStart(2, '0')}`;

        const valor = Number(parc.parcelaValor);
        const totalParcelas = parc.totalParcelas;
        const parcelasAposMes = Math.max(0, totalParcelas - parcelaNoMes);
        const saldoAposMes = Number((parcelasAposMes * valor).toFixed(2));

        itens.push({
          tipo: 'PARCELAMENTO',
          origemId: parc.id,
          descricao: `${parc.descricao} (${parcelaNoMes}/${totalParcelas})`,
          valor,
          diaVencimento: dia,
          dataVencimentoPrevista,
          categoria: parc.categoria,
          conta: parc.conta
            ? {
                id: parc.conta.id,
                nome: parc.conta.nome,
                tipo: parc.conta.tipo,
              }
            : null,
          parcelamentoInfo: {
            parcelaAtualNoMes: parcelaNoMes,
            totalParcelas,
            saldoDevedorRestanteAposMes: saldoAposMes,
          },
        });
      }
    }

    // Ordenar itens unificados por dia de vencimento crescente e descrição
    itens.sort((a, b) => {
      if (a.diaVencimento !== b.diaVencimento) {
        return a.diaVencimento - b.diaVencimento;
      }
      return a.descricao.localeCompare(b.descricao);
    });

    const totalRecorrencias = Number(
      itens
        .filter((i) => i.tipo === 'RECORRENCIA')
        .reduce((sum, i) => sum + i.valor, 0)
        .toFixed(2)
    );

    const totalParcelamentos = Number(
      itens
        .filter((i) => i.tipo === 'PARCELAMENTO')
        .reduce((sum, i) => sum + i.valor, 0)
        .toFixed(2)
    );

    const totalPrevistoMes = Number((totalRecorrencias + totalParcelamentos).toFixed(2));

    const responsePayload: CronogramaVencimentosResponse = {
      competencia,
      totalPrevistoMes,
      totalRecorrencias,
      totalParcelamentos,
      itens,
    };

    return reply.status(200).send(responsePayload);
  });
};
