import fs from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoArquivoConsolidadoProntoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import {
  ArquivoConsolidadoIa,
  arquivoConsolidadoIaSchema,
} from './ia-extrator.schema.js';
import { ImportacaoTentativasService } from '../importacao-tentativas.service.js';
import { randomUUID } from 'node:crypto';
import { importacaoDiagnosticoService } from '../importacao-diagnostico.service.js';
import { inferirPeriodoExtrato, validarDatasContraPeriodo } from './validacao-consistencia-conteudo.util.js';

export interface CargaStagingResultado {
  loteId: string;
  arquivoId: string;
  nomeArquivo: string;
  sucesso: boolean;
  totalLinhasCarregadas: number;
  erro?: string;
}

export class ImportacaoStagingWorkerService {
  private baseDir: string;
  private isListeningEvents: boolean = false;
  private boundListener?: (event: ImportacaoArquivoConsolidadoProntoEvent) => void;

  constructor(baseDir: string = process.cwd(), autoListen: boolean = false) {
    this.baseDir = baseDir;
    if (autoListen) {
      this.setupEventListener();
    }
  }

  /**
   * Conecta o ouvinte orientado a eventos do barramento de importação.
   * Quando um arquivo consolidado estiver pronto, o Worker 2 carrega imediatamente para a staging.
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    console.log('[evolvi-worker:staging] Inicializando ouvinte de arquivos consolidados para staging...');

    this.boundListener = (event: ImportacaoArquivoConsolidadoProntoEvent) => {
      console.log(`[evolvi-worker:staging] Arquivo [${event.nomeArquivo}] pronto (${event.totalTransacoes} transações). Carregando na staging...`);
      this.carregarArquivoParaStaging(event.arquivoId, event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:staging] Erro ao carregar arquivo ${event.arquivoId} para staging:`,
          err
        );
      });
    };

    importacaoEventBus.onArquivoConsolidadoPronto(this.boundListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_ARQUIVO_CONSOLIDADO_PRONTO,
        this.boundListener
      );
      this.boundListener = undefined;
      this.isListeningEvents = false;
    }
  }

  /**
   * Carrega os dados de um arquivo consolidado físico diretamente para a tabela de staging.
   */
  public async carregarArquivoParaStaging(
    arquivoId: string,
    usuarioIdEsperado?: string
  ): Promise<CargaStagingResultado> {
    const arquivo = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoId },
      include: {
        lote: true,
      },
    });

    if (!arquivo) {
      throw new Error(`Arquivo de importação [${arquivoId}] não encontrado.`);
    }

    // Isolamento multi-tenant
    if (usuarioIdEsperado && arquivo.lote.usuarioId !== usuarioIdEsperado) {
      throw new Error(
        `Violação de isolamento multi-tenant: arquivo ${arquivoId} pertence a outro usuário.`
      );
    }

    const owner = randomUUID();
    const reserva = await prisma.$executeRaw`
      UPDATE arquivos_importacao
      SET worker_owner = ${owner}, worker_stage = 'STAGING',
          worker_lease_until = NOW() + INTERVAL '10 minutes', worker_attempts = worker_attempts + 1,
          staging_iniciado_em = NOW(), staging_finalizado_em = NULL
      WHERE id = ${arquivo.id}::uuid
        AND EXISTS (SELECT 1 FROM lotes_importacao l WHERE l.id = arquivos_importacao.lote_id AND l.usuario_id = ${arquivo.lote.usuarioId}::uuid)
        AND status = 'IA_CONCLUIDO'
        AND (worker_lease_until IS NULL OR worker_lease_until < NOW())
    `;
    if (reserva !== 1) {
      return {
        loteId: arquivo.loteId, arquivoId: arquivo.id, nomeArquivo: arquivo.nomeArquivo,
        sucesso: arquivo.status === 'STAGING_CARREGADO', totalLinhasCarregadas: 0,
        ...(arquivo.status === 'STAGING_CARREGADO' ? {} : { erro: 'Arquivo já reservado ou não está pronto para staging.' }),
      };
    }
    const heartbeat = setInterval(() => {
      void prisma.$executeRaw`UPDATE arquivos_importacao SET worker_lease_until = NOW() + INTERVAL '10 minutes' WHERE id = ${arquivo.id}::uuid AND worker_owner = ${owner} AND EXISTS (SELECT 1 FROM lotes_importacao l WHERE l.id = arquivos_importacao.lote_id AND l.usuario_id = ${arquivo.lote.usuarioId}::uuid)`
        .catch((err) => console.error('[evolvi-worker:staging] Falha ao renovar lease:', err));
    }, 60_000);

    // Atualiza status do lote para CARGA_STAGING se ainda estiver em etapas anteriores
    if (['RECEPCIONADO', 'PROCESSANDO_IA'].includes(arquivo.lote.status)) {
      await prisma.loteImportacao.update({
        where: { id: arquivo.loteId },
        data: { status: 'CARGA_STAGING' },
      });
    }

    const nomeConsolidado = `consolidado_${arquivo.id}.json`;
    const inicioStaging = Date.now();
    const caminhoFisicoConsolidado = path.resolve(
      this.baseDir,
      arquivo.lote.caminhoDiretorio,
      nomeConsolidado
    );

    try {
      const conteudoJson = await fs.readFile(caminhoFisicoConsolidado, 'utf-8');
      const dadosConsolidados = JSON.parse(conteudoJson) as ArquivoConsolidadoIa;

      const validacao = arquivoConsolidadoIaSchema.safeParse(dadosConsolidados);
      if (!validacao.success) {
        throw new Error(
          `Arquivo consolidado corrompido ou inválido: ${validacao.error.issues
            .map((i) => i.message)
            .join(', ')}`
        );
      }

      let transacoes = validacao.data.transacoes;
      await importacaoDiagnosticoService.registrar(arquivo.id, 'STAGING', 'Carga de staging iniciada.', { transacoes: transacoes.length });

      // TASK-55: bloqueia apenas divergências verificáveis. Quando o inventário
      // não fornece nenhuma métrica, registra INCOMPLETO e deixa a extração seguir.
      const inventario = await prisma.inventarioIaArquivo.findFirst({
        where: { arquivoId: arquivo.id, usuarioId: arquivo.lote.usuarioId },
        orderBy: { criadoEm: 'desc' },
      });
      const somaExtraida = transacoes.reduce((soma, tx) => soma + Math.abs(tx.valor), 0);
      const divergencias: Record<string, unknown> = {};
      let inconsistenciasDatas: Array<{ indice: number; data: string; periodo: { inicio: string; fim: string; origem: string } }> = [];
      const verificacoesIndisponiveis: string[] = [];
      let paginaInventarioIdPorNumero = new Map<number, string>();
      const periodoExtrato = inferirPeriodoExtrato(arquivo.nomeArquivo, inventario?.dataInicial, inventario?.dataFinal);
      if (periodoExtrato) {
        const validacaoDatas = validarDatasContraPeriodo(transacoes.map((tx) => tx.dataMovimento), periodoExtrato);
        if (validacaoDatas.inconsistencias.length) {
          inconsistenciasDatas = validacaoDatas.inconsistencias;
          await importacaoDiagnosticoService.registrar(arquivo.id, 'STAGING', 'Datas fora do período foram encaminhadas à validação da consolidação.', {
            periodo: periodoExtrato,
            inconsistencias: inconsistenciasDatas,
          });
        } else {
          const corrigidas = validacaoDatas.datas.filter((data) => data.corrigida);
          transacoes = transacoes.map((tx, indice) => ({ ...tx, dataMovimento: validacaoDatas.datas[indice].final }));
          if (corrigidas.length) {
            await importacaoDiagnosticoService.registrar(arquivo.id, 'STAGING', 'Datas fora do período do extrato corrigidas pelo período explícito da fonte.', {
              periodo: periodoExtrato,
              datasCorrigidas: corrigidas.map((data) => ({ de: data.original, para: data.final })),
            });
          }
        }
      }
      if (!inventario) verificacoesIndisponiveis.push('inventario');
      else {
        if (inventario.quantidadeEsperada == null) verificacoesIndisponiveis.push('quantidade');
        else if (inventario.quantidadeEsperada !== transacoes.length) {
          divergencias.quantidade = { esperado: inventario.quantidadeEsperada, extraido: transacoes.length };
        }
        if (inventario.somaAbsolutaEsperada == null) verificacoesIndisponiveis.push('soma');
        else if (Math.abs(Number(inventario.somaAbsolutaEsperada) - somaExtraida) > 0.01) {
          divergencias.soma = { esperado: Number(inventario.somaAbsolutaEsperada), extraido: somaExtraida };
        }
        if (inventario.paginasTotais != null) {
          const paginasInventario = await prisma.inventarioIaPagina.findMany({
            where: { inventarioId: inventario.id, usuarioId: arquivo.lote.usuarioId },
            orderBy: { pagina: 'asc' },
          });
          paginaInventarioIdPorNumero = new Map(paginasInventario.map((pagina) => [pagina.pagina, pagina.id]));
          const paginaPorNumero = new Map(paginasInventario.map((pagina) => [pagina.pagina, pagina]));
          const contagensExtraidas = new Array(inventario.paginasTotais).fill(0);
          const origemAusente = transacoes.some((transacao) => {
            const pagina = transacao.paginaOrigem;
            if (!Number.isInteger(pagina) || pagina == null || pagina < 1 || pagina > inventario.paginasTotais!) return true;
            contagensExtraidas[pagina - 1] += 1;
            return false;
          });
          const paginasComContagemAusente = paginaPorNumero.size !== inventario.paginasTotais ||
            Array.from({ length: inventario.paginasTotais }, (_, indice) => indice + 1)
              .some((pagina) => paginaPorNumero.get(pagina)?.quantidadeExtraida == null);
          const paginasComOrigemIndisponivel = paginasInventario
            .filter((pagina) => pagina.divergencias != null)
            .map((pagina) => pagina.pagina);
          const totalPersistidoPorPagina = paginasInventario.reduce((total, pagina) => total + (pagina.quantidadeExtraida ?? 0), 0);
          const contagensDivergentes = Array.from({ length: inventario.paginasTotais }, (_, indice) => {
            const pagina = paginaPorNumero.get(indice + 1);
            return !pagina || pagina.quantidadeExtraida !== contagensExtraidas[indice];
          }).some(Boolean);
          if (origemAusente || paginasComContagemAusente || paginasComOrigemIndisponivel.length > 0 || contagensDivergentes || totalPersistidoPorPagina !== transacoes.length) {
            divergencias.paginas = {
              paginasPersistidas: paginasInventario.length,
              paginasTotaisDocumento: inventario.paginasTotais,
              registrosPersistidosPorPagina: totalPersistidoPorPagina,
              registrosExtraidos: transacoes.length,
              origemAusente,
              paginasComContagemAusente,
              paginasComOrigemIndisponivel,
              contagensDivergentes,
            };
          } else if (Array.isArray(inventario.registrosPorPagina) && inventario.registrosPorPagina.length > 0) {
            const esperados = inventario.registrosPorPagina as Array<{ pagina?: number; quantidade?: number }>;
            const divergenciasEsperadas = esperados.filter((esperado) => {
              if (!Number.isInteger(esperado.pagina) || esperado.pagina! < 1 || esperado.pagina! > inventario.paginasTotais!) return true;
              return paginaPorNumero.get(esperado.pagina!)?.quantidadeExtraida !== esperado.quantidade;
            });
            if (divergenciasEsperadas.length > 0) divergencias.paginasEsperadas = divergenciasEsperadas;
          }
        }
        const temMetricasVerificaveis = inventario.quantidadeEsperada != null || inventario.somaAbsolutaEsperada != null ||
          (Array.isArray(inventario.registrosPorPagina) && inventario.registrosPorPagina.length > 0);
        if (temMetricasVerificaveis && Number(inventario.confianca) < 0.5) divergencias.confianca = Number(inventario.confianca);
        await prisma.inventarioIaArquivo.update({
          where: { id: inventario.id },
          data: {
            status: Object.keys(divergencias).length || inconsistenciasDatas.length
              ? 'DIVERGENTE'
              : temMetricasVerificaveis
                ? 'CONFERENTE'
                : 'INCOMPLETO',
            divergencias: { ...divergencias, ...(inconsistenciasDatas.length ? { consistenciaDatas: { periodo: periodoExtrato, inconsistencias: inconsistenciasDatas } } : {}), ...(verificacoesIndisponiveis.length ? { verificacoesIndisponiveis } : {}) } as Prisma.InputJsonObject,
          },
        });
      }
      if (Object.keys(divergencias).length) {
        throw new Error(`Reconciliação IA divergente; staging bloqueado: ${JSON.stringify(divergencias)}`);
      }

      // Bulk insert atômico na tabela de staging
      await prisma.$transaction(async (tx) => {
        // Remove eventuais registros prévios do mesmo arquivo para garantir idempotência
        await tx.stagingLancamentoImportacao.deleteMany({
          where: { arquivoId: arquivo.id },
        });

        // Prepara dados e executa bulk insert atômico via createMany
        const registrosParaInserir = transacoes.map((txItem) => {
          const dataMovimentoDate = new Date(`${txItem.dataMovimento}T00:00:00.000Z`);

          let tipoContaFinal: 'CONTA_CORRENTE' | 'POUPANCA' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | null = null;
          if (txItem.tipoConta === 'CARTAO_CREDITO') {
            tipoContaFinal = 'CARTAO_CREDITO';
          } else if (txItem.tipoConta === 'CONTA_CORRENTE') {
            tipoContaFinal = 'CONTA_CORRENTE';
          } else if (txItem.tipoConta === 'POUPANCA') {
            tipoContaFinal = 'POUPANCA';
          } else if (txItem.tipoConta === 'INVESTIMENTO') {
            tipoContaFinal = 'INVESTIMENTO';
          }

          // BUG-13: Se for linha de pagamento recebido/quitação dentro de fatura de cartão de crédito,
          // deve ser marcado como IGNORADO para não duplicar com o débito da conta corrente
          const isQuitaçãoFaturaCartao =
            tipoContaFinal === 'CARTAO_CREDITO' &&
            (txItem.isPagamentoFatura ||
              /pag(amento)?\s*(de)?\s*(fat(ura)?|cart[aã]o)|pagamento\s*recebido|cr[eé]dito\s*pagamento/i.test(
                txItem.descricao
              ) ||
              /informativ[ao]\s*de\s*quita[cç][aã]o/i.test(txItem.observacao || ''));

          // Todo lançamento extraído deve permanecer disponível para auditoria
          // e classificação posterior. A natureza de pagamento/fatura não é
          // motivo para descartar a linha nesta etapa.
          const statusProcessamento = 'PENDENTE' as const;
          const observacaoFinal = isQuitaçãoFaturaCartao
            ? `${txItem.observacao || ''}${txItem.observacao ? ' • ' : ''}Pagamento de fatura identificado; mantido para classificação posterior.`
            : txItem.observacao || null;

          return {
            loteId: arquivo.loteId,
            arquivoId: arquivo.id,
            arquivoOrigem: arquivo.nomeArquivo,
            dataMovimento: dataMovimentoDate,
            descricao: txItem.descricao,
            valor: txItem.valor,
            natureza: txItem.natureza,
            contaSugerida: txItem.contaSugerida || null,
            tipoConta: tipoContaFinal,
            numeroConta: txItem.numeroConta || null,
            digitosCartao: txItem.digitosCartao || null,
            categoriaSugerida: txItem.categoriaSugerida || null,
            parcelaAtual: txItem.parcelaAtual || null,
            totalParcelas: txItem.totalParcelas || null,
            idOrigem: txItem.idOrigem || null,
            observacao: observacaoFinal,
            paginaOrigem: txItem.paginaOrigem ?? null,
            inventarioPaginaId: txItem.paginaOrigem == null
              ? null
              : paginaInventarioIdPorNumero.get(txItem.paginaOrigem) ?? null,
            statusProcessamento,
          };
        });

        if (registrosParaInserir.length > 0) {
          await tx.stagingLancamentoImportacao.createMany({
            data: registrosParaInserir,
          });
        }

        // Atualiza status do arquivo para STAGING_CARREGADO
        await tx.arquivoImportacao.update({
          where: { id: arquivo.id },
          data: {
            status: 'STAGING_CARREGADO',
            mensagemErro: null,
          },
        });
      });

      // Recalcula contadores do lote (incluindo totalLancamentos atualizado com a carga de staging)
      await ImportacaoTentativasService.recalcularContadoresLote(arquivo.loteId);
      await importacaoDiagnosticoService.registrar(arquivo.id, 'STAGING', 'Carga de staging concluída.', { transacoes: transacoes.length });

      // Emite evento de progresso e de conclusão da staging
      importacaoEventBus.emitArquivoProgresso({
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        usuarioId: arquivo.lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'STAGING_CARREGADO',
        mensagem: `${transacoes.length} registros inseridos com sucesso na tabela de staging.`,
        timestamp: new Date(),
      });

      importacaoEventBus.emitArquivoStagingCarregado({
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        usuarioId: arquivo.lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        totalLinhasStaging: transacoes.length,
        timestamp: new Date(),
      });

      // Limpeza imediata de arquivos temporários do disco após persistência garantida na base
      try {
        await fs.unlink(caminhoFisicoConsolidado);
      } catch {
        // Ignora se o consolidado já tiver sido removido
      }

      if (arquivo.caminhoRelativo) {
        const caminhoFisicoOriginal = path.resolve(
          this.baseDir,
          arquivo.lote.caminhoDiretorio,
          arquivo.caminhoRelativo
        );
        try {
          await fs.unlink(caminhoFisicoOriginal);
        } catch {
          // Ignora se já tiver sido removido ou não existir fisicamente
        }
      }

      return {
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: true,
        totalLinhasCarregadas: transacoes.length,
      };
    } catch (err: unknown) {
      const mensagemErro = err instanceof Error ? err.message : String(err);

      await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: {
          status: 'ERRO',
          mensagemErro,
        },
      });
      await importacaoDiagnosticoService.registrar(arquivo.id, 'ERRO_STAGING', mensagemErro);
      await importacaoDiagnosticoService.finalizarArquivo(arquivo.id, 'ERRO');

      importacaoEventBus.emitArquivoProgresso({
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        usuarioId: arquivo.lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'ERRO',
        mensagem: `Erro na carga de staging: ${mensagemErro}`,
        timestamp: new Date(),
      });

      return {
        loteId: arquivo.loteId,
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: false,
        totalLinhasCarregadas: 0,
        erro: mensagemErro,
      };
    } finally {
      clearInterval(heartbeat);
      await prisma.$executeRaw`UPDATE arquivos_importacao SET duracao_staging_ms = ${Math.max(0, Date.now() - inicioStaging)}, staging_finalizado_em = NOW(), worker_owner = NULL, worker_lease_until = NULL, worker_stage = NULL WHERE id = ${arquivo.id}::uuid AND worker_owner = ${owner} AND EXISTS (SELECT 1 FROM lotes_importacao l WHERE l.id = arquivos_importacao.lote_id AND l.usuario_id = ${arquivo.lote.usuarioId}::uuid)`;
    }
  }

  /**
   * Processa a carga de staging de todos os arquivos de um lote que já estejam em IA_CONCLUIDO.
   */
  public async carregarLoteParaStaging(loteId: string, usuarioId?: string): Promise<CargaStagingResultado[]> {
    const lote = await prisma.loteImportacao.findUnique({
      where: { id: loteId },
      include: {
        arquivos: {
          where: {
            status: 'IA_CONCLUIDO',
          },
          orderBy: { criadoEm: 'asc' },
        },
      },
    });

    if (!lote) {
      throw new Error(`Lote [${loteId}] não encontrado.`);
    }

    if (usuarioId && lote.usuarioId !== usuarioId) {
      throw new Error(`Violação de isolamento multi-tenant: lote ${loteId} pertence a outro usuário.`);
    }

    const resultados: CargaStagingResultado[] = [];
    for (const arquivo of lote.arquivos) {
      const res = await this.carregarArquivoParaStaging(arquivo.id, lote.usuarioId);
      resultados.push(res);
    }

    return resultados;
  }
}

export const importacaoStagingWorkerService = new ImportacaoStagingWorkerService();
