import { prisma } from '../../infrastructure/database/prisma.js';
import { TipoDocumentoImportado, TipoAlertaConciliacao, StatusAlertaConciliacao } from '@prisma/client';

export interface CatalogarArquivoInput {
  usuarioId: string;
  arquivoId: string;
  loteId: string;
}

export interface DispensarAlertaInput {
  usuarioId: string;
  alertaId: string;
  motivoDispensa: string;
}

export class ConciliacaoService {
  /**
   * Cataloga metadados estruturados do arquivo em HistoricoImportacaoArquivo
   * após a consolidação completa de seus lançamentos staging.
   */
  public async catalogarArquivo(input: CatalogarArquivoInput): Promise<any> {
    const { usuarioId, arquivoId, loteId } = input;

    // 1. Busca os lançamentos consolidados vinculados a este arquivo
    const stagings = await prisma.stagingLancamentoImportacao.findMany({
      where: {
        arquivoId,
        statusProcessamento: 'PROCESSADO',
      },
      orderBy: { dataMovimento: 'asc' },
    });

    if (stagings.length === 0) {
      // Se não há lançamentos processados com sucesso, não cria histórico analítico
      return null;
    }

    const arquivo = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoId },
    });

    const nomeArquivo = arquivo?.nomeArquivo || '';
    const totalTransacoes = stagings.length;
    const periodoInicio = stagings[0].dataMovimento;
    const periodoFim = stagings[stagings.length - 1].dataMovimento;

    // Soma valores absolutos para valorTotal
    const valorTotal = stagings.reduce((acc, s) => acc + Math.abs(Number(s.valor)), 0);

    // Heurística de TipoDocumento e Instituição
    let tipoDocumento: TipoDocumentoImportado = TipoDocumentoImportado.OUTRO;
    const nomeLower = (nomeArquivo + ' ' + (stagings[0].contaSugerida || '')).toLowerCase();

    if (
      nomeLower.includes('fatura') ||
      nomeLower.includes('card') ||
      nomeLower.includes('cartao') ||
      nomeLower.includes('credit')
    ) {
      tipoDocumento = TipoDocumentoImportado.FATURA_CARTAO;
    } else if (
      nomeLower.includes('invest') ||
      nomeLower.includes('cdb') ||
      nomeLower.includes('renda fixa')
    ) {
      tipoDocumento = TipoDocumentoImportado.EXTRATO_INVESTIMENTO;
    } else if (
      nomeLower.includes('extrato') ||
      nomeLower.includes('conta') ||
      nomeLower.includes('statement')
    ) {
      tipoDocumento = TipoDocumentoImportado.EXTRATO_CONTA_CORRENTE;
    }

    // Instituição
    let instituicao = 'Outros';
    if (nomeLower.includes('nubank')) instituicao = 'Nubank';
    else if (nomeLower.includes('c6')) instituicao = 'C6 Bank';
    else if (nomeLower.includes('inter')) instituicao = 'Banco Inter';
    else if (nomeLower.includes('itau')) instituicao = 'Itaú';
    else if (nomeLower.includes('santander')) instituicao = 'Santander';
    else if (nomeLower.includes('pagbank') || nomeLower.includes('pagseguro')) instituicao = 'PagBank';
    else if (nomeLower.includes('mercado pago')) instituicao = 'Mercado Pago';
    else if (stagings[0].contaSugerida) {
      instituicao = stagings[0].contaSugerida.replace(/Conta\s+|Cartão\s+/gi, '').trim() || 'Outros';
    }

    // Competência de referência (YYYY-MM baseada na data final do período)
    const ano = periodoFim.getUTCFullYear();
    const mes = String(periodoFim.getUTCMonth() + 1).padStart(2, '0');
    const competencia = `${ano}-${mes}`;

    // Conta vinculada (se houver correspondência com contas do usuário)
    let contaId: string | null = null;
    const conta = await prisma.conta.findFirst({
      where: {
        usuarioId,
        nome: { contains: instituicao, mode: 'insensitive' },
      },
    });
    if (conta) {
      contaId = conta.id;
    }

    // Cria ou atualiza o registro de catálogo (upsert por arquivoId)
    const historico = await prisma.historicoImportacaoArquivo.upsert({
      where: { arquivoId },
      create: {
        usuarioId,
        arquivoId,
        contaId,
        tipoDocumento,
        instituicao,
        competencia,
        dataVencimento: tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO ? periodoFim : null,
        periodoInicio,
        periodoFim,
        totalTransacoes,
        valorTotal,
      },
      update: {
        contaId,
        tipoDocumento,
        instituicao,
        competencia,
        dataVencimento: tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO ? periodoFim : null,
        periodoInicio,
        periodoFim,
        totalTransacoes,
        valorTotal,
      },
    });

    // Dispara checagem e atualização de lacunas para o usuário
    await this.verificarLacunas(usuarioId);

    return historico;
  }

  /**
   * Motor de Avaliação de Lacunas Temporais e Auto-Resolução de Alertas.
   * Analisa as contas ativas do usuário marcadas com monitorarConciliacao = true.
   */
  public async verificarLacunas(usuarioId: string): Promise<any> {
    const contas = await prisma.conta.findMany({
      where: {
        usuarioId,
        ativo: true,
        monitorarConciliacao: true,
      },
    });

    for (const conta of contas) {
      // 1. Busca históricos associados à conta
      const historicos = await prisma.historicoImportacaoArquivo.findMany({
        where: {
          usuarioId,
          contaId: conta.id,
        },
        orderBy: { competencia: 'asc' },
      });

      if (historicos.length === 0) continue;

      // 2. Extrai conjunto de competências presentes no histórico
      const competenciasSet = new Set(historicos.map((h) => h.competencia));

      // 3. Resolve automaticamente alertas pendentes para competências que já foram importadas
      const alertasPendentes = await prisma.alertaConciliacao.findMany({
        where: {
          usuarioId,
          contaId: conta.id,
          status: StatusAlertaConciliacao.PENDENTE,
        },
      });

      for (const alerta of alertasPendentes) {
        if (competenciasSet.has(alerta.competencia)) {
          await prisma.alertaConciliacao.update({
            where: { id: alerta.id },
            data: {
              status: StatusAlertaConciliacao.RESOLVIDO,
              resolvidoEm: new Date(),
            },
          });
        }
      }

      // 4. Detecção de lacunas cronológicas entre a menor e maior competência
      const comps = Array.from(competenciasSet).sort();
      if (comps.length < 2) continue;

      const compMin = comps[0];
      const compMax = comps[comps.length - 1];

      const [minY, minM] = compMin.split('-').map(Number);
      const [maxY, maxM] = compMax.split('-').map(Number);

      let curY = minY;
      let curM = minM;

      while (curY < maxY || (curY === maxY && curM <= maxM)) {
        const compStr = `${curY}-${String(curM).padStart(2, '0')}`;

        if (!competenciasSet.has(compStr)) {
          // Verifica se já existe alerta dispensado ou pendente para este mês
          const alertaExistente = await prisma.alertaConciliacao.findFirst({
            where: {
              usuarioId,
              contaId: conta.id,
              competencia: compStr,
            },
          });

          if (!alertaExistente) {
            const isCartao = conta.tipo === 'CARTAO_CREDITO';
            const tipoAlerta = isCartao
              ? TipoAlertaConciliacao.FATURA_NAO_IMPORTADA
              : TipoAlertaConciliacao.EXTRATO_LACUNA_TEMPORAL;

            const titulo = isCartao
              ? `Fatura Faltante: ${conta.nome} (${compStr})`
              : `Extrato com Lacuna: ${conta.nome} (${compStr})`;

            const descricao = isCartao
              ? `Não localizamos a fatura do cartão ${conta.nome} para a competência ${compStr}. Foram identificadas faturas anteriores e posteriores.`
              : `Não localizamos o extrato da conta ${conta.nome} para a competência ${compStr}. Existe intervalo temporal descontinuado entre importações.`;

            await prisma.alertaConciliacao.create({
              data: {
                usuarioId,
                contaId: conta.id,
                tipoAlerta,
                titulo,
                descricao,
                competencia: compStr,
                status: StatusAlertaConciliacao.PENDENTE,
              },
            });
          }
        }

        curM++;
        if (curM > 12) {
          curM = 1;
          curY++;
        }
      }
    }

    return this.listarAlertas(usuarioId);
  }

  /**
   * Lista alertas ativos do usuário (PENDENTE por padrão, ou todos)
   */
  public async listarAlertas(usuarioId: string, status?: StatusAlertaConciliacao) {
    return prisma.alertaConciliacao.findMany({
      where: {
        usuarioId,
        ...(status ? { status } : { status: StatusAlertaConciliacao.PENDENTE }),
      },
      include: {
        conta: {
          select: { id: true, nome: true, tipo: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  /**
   * Dispensa um alerta manualmente com motivo (ex: SEM_GASTOS, CONTA_ENCERRADA, etc.)
   */
  public async dispensarAlerta(input: DispensarAlertaInput) {
    const { usuarioId, alertaId, motivoDispensa } = input;

    const alerta = await prisma.alertaConciliacao.findFirst({
      where: { id: alertaId, usuarioId },
    });

    if (!alerta) {
      throw new Error('Alerta de conciliação não encontrado para este usuário.');
    }

    const atualizado = await prisma.alertaConciliacao.update({
      where: { id: alertaId },
      data: {
        status: StatusAlertaConciliacao.DISPENSADO,
        motivoDispensa,
        resolvidoEm: new Date(),
      },
    });

    // Se o motivo for CONTA_ENCERRADA, desativa o monitoramento para competências futuras da conta
    if (motivoDispensa === 'CONTA_ENCERRADA' && alerta.contaId) {
      await prisma.conta.update({
        where: { id: alerta.contaId },
        data: {
          monitorarConciliacao: false,
          ativo: false,
        },
      });
    }

    return atualizado;
  }

  /**
   * Lista o histórico catalogado de arquivos importados
   */
  public async listarHistoricoArquivos(usuarioId: string) {
    return prisma.historicoImportacaoArquivo.findMany({
      where: { usuarioId },
      include: {
        arquivo: {
          select: { id: true, nomeArquivo: true, status: true, tamanhoBytes: true },
        },
        conta: {
          select: { id: true, nome: true, tipo: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }
}

export const conciliacaoService = new ConciliacaoService();
