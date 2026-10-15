import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoArquivoStagingCarregadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { gerarChaveDedupe } from '../../movimento/movimento.util.js';

export interface ConsolidacaoLoteResultado {
  loteId: string;
  sucesso: boolean;
  totalProcessados: number;
  novosMovimentosInseridos: number;
  duplicadasIgnoradas: number;
  pagamentosFaturaConvertidos: number;
  contasCriadas: number;
  parcelamentosCriados: number;
  erros: Array<{ stagingId: string; motivo: string }>;
}

export class ImportacaoConsolidacaoWorkerService {
  private isListeningEvents: boolean = false;
  private boundListener?: (event: ImportacaoArquivoStagingCarregadoEvent) => void;

  constructor(autoListen: boolean = false) {
    if (autoListen) {
      this.setupEventListener();
    }
  }

  /**
   * Conecta o ouvinte orientado a eventos do barramento.
   * Quando um arquivo tiver sua carga de staging concluída, pode acionar a consolidação.
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    this.boundListener = (event: ImportacaoArquivoStagingCarregadoEvent) => {
      // Processa a consolidação dos itens pendentes do lote
      this.consolidarLote(event.loteId, event.usuarioId).catch((err) => {
        console.error(
          `[ImportacaoConsolidacaoWorker] Erro ao consolidar lote ${event.loteId}:`,
          err
        );
      });
    };

    importacaoEventBus.onArquivoStagingCarregado(this.boundListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_ARQUIVO_STAGING_CARREGADO,
        this.boundListener
      );
      this.boundListener = undefined;
      this.isListeningEvents = false;
    }
  }

  /**
   * Normaliza o nome da conta para matching heurístico tolerante a espaços/maiúsculas.
   */
  private normalizarNome(nome: string): string {
    return nome
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Obtém uma conta existente ou provisiona automaticamente uma nova conta sem travar o pipeline.
   */
  public async obterOuAutoCadastrarConta(params: {
    usuarioId: string;
    contaSugerida?: string | null;
    tipoConta?: 'CONTA_CORRENTE' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | 'CARTEIRA_DINHEIRO' | null;
    arquivoOrigem?: string;
  }): Promise<{ contaId: string; contaNome: string; criadaAgora: boolean }> {
    const { usuarioId, contaSugerida, tipoConta, arquivoOrigem } = params;

    // Define nome padrão se vazio
    let nomeFinal = contaSugerida?.trim();
    if (!nomeFinal) {
      if (tipoConta === 'CARTAO_CREDITO') {
        nomeFinal = 'Cartão de Crédito';
      } else {
        nomeFinal = 'Conta Corrente';
      }
      if (arquivoOrigem) {
        nomeFinal += ` (${arquivoOrigem.replace(/\.[^/.]+$/, '')})`;
      }
    }

    // Busca todas as contas do usuário para comparação flexível
    const contasExistentes = await prisma.conta.findMany({
      where: { usuarioId },
    });

    const nomeNormalizado = this.normalizarNome(nomeFinal);
    const contaEncontrada = contasExistentes.find(
      (c) => this.normalizarNome(c.nome) === nomeNormalizado
    );

    if (contaEncontrada) {
      return {
        contaId: contaEncontrada.id,
        contaNome: contaEncontrada.nome,
        criadaAgora: false,
      };
    }

    // Não existe: AUTO-CADASTRO SEM INTERRUPÇÃO
    const tipoFinal = tipoConta || 'CONTA_CORRENTE';

    const novaConta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: nomeFinal,
        tipo: tipoFinal,
        saldoInicial: 0,
        diaFechamento: tipoFinal === 'CARTAO_CREDITO' ? 1 : null,
        diaVencimento: tipoFinal === 'CARTAO_CREDITO' ? 10 : null,
      },
    });

    return {
      contaId: novaConta.id,
      contaNome: novaConta.nome,
      criadaAgora: true,
    };
  }

  /**
   * Resolve a categoria POF apropriada (do usuário ou padrão global) por nome aproximado.
   */
  public async resolverCategoriaPof(
    usuarioId: string,
    categoriaSugerida?: string | null
  ): Promise<string | null> {
    if (!categoriaSugerida || !categoriaSugerida.trim()) {
      return null;
    }

    const nomeBusca = categoriaSugerida.trim();

    // 1. Busca exata insensível a maiúsculas
    let categoria = await prisma.categoria.findFirst({
      where: {
        OR: [
          { usuarioId, nome: { equals: nomeBusca, mode: 'insensitive' } },
          { usuarioId: null, nome: { equals: nomeBusca, mode: 'insensitive' } },
        ],
      },
    });

    if (categoria) {
      return categoria.id;
    }

    // 2. Busca por contenção (ex: "Alimentação" em "Alimentação Fora do Domicílio")
    categoria = await prisma.categoria.findFirst({
      where: {
        OR: [
          { usuarioId, nome: { contains: nomeBusca, mode: 'insensitive' } },
          { usuarioId: null, nome: { contains: nomeBusca, mode: 'insensitive' } },
        ],
      },
    });

    return categoria ? categoria.id : null;
  }

  /**
   * Consolida todos os lançamentos em Staging com status PENDENTE de um lote.
   */
  public async consolidarLote(
    loteId: string,
    usuarioIdEsperado?: string
  ): Promise<ConsolidacaoLoteResultado> {
    const lote = await prisma.loteImportacao.findUnique({
      where: { id: loteId },
      include: {
        arquivos: true,
      },
    });

    if (!lote) {
      throw new Error(`Lote [${loteId}] não encontrado.`);
    }

    if (usuarioIdEsperado && lote.usuarioId !== usuarioIdEsperado) {
      throw new Error(
        `Violação de isolamento multi-tenant: lote ${loteId} pertence a outro usuário.`
      );
    }

    // Atualiza status do lote para CONSOLIDANDO
    await prisma.loteImportacao.update({
      where: { id: loteId },
      data: { status: 'CONSOLIDANDO' },
    });

    // Busca linhas pendentes de staging do lote
    const stagingItens = await prisma.stagingLancamentoImportacao.findMany({
      where: {
        loteId,
        statusProcessamento: 'PENDENTE',
      },
      orderBy: { dataMovimento: 'asc' },
    });

    const resultado: ConsolidacaoLoteResultado = {
      loteId,
      sucesso: true,
      totalProcessados: stagingItens.length,
      novosMovimentosInseridos: 0,
      duplicadasIgnoradas: 0,
      pagamentosFaturaConvertidos: 0,
      contasCriadas: 0,
      parcelamentosCriados: 0,
      erros: [],
    };

    // Cache local de contas criadas/resolvidas no ciclo para não reconsultar desnecessariamente
    const cacheContas = new Map<string, { id: string; nome: string }>();

    for (const item of stagingItens) {
      try {
        const cacheKey = `${item.contaSugerida || ''}_${item.tipoConta || ''}_${item.arquivoOrigem}`;
        let contaInfo = cacheContas.get(cacheKey);

        if (!contaInfo) {
          const resConta = await this.obterOuAutoCadastrarConta({
            usuarioId: lote.usuarioId,
            contaSugerida: item.contaSugerida,
            tipoConta: item.tipoConta,
            arquivoOrigem: item.arquivoOrigem,
          });

          if (resConta.criadaAgora) {
            resultado.contasCriadas++;
          }

          contaInfo = { id: resConta.contaId, nome: resConta.contaNome };
          cacheContas.set(cacheKey, contaInfo);
        }

        const dataMovimentoStr = item.dataMovimento.toISOString().split('T')[0];
        const competencia = dataMovimentoStr.substring(0, 7);
        const valorNum = Number(item.valor);

        // 1. Chave Dedupe determinística
        const chaveDedupe = gerarChaveDedupe({
          contaId: contaInfo.id,
          dataMovimento: dataMovimentoStr,
          valor: valorNum,
          descricao: item.descricao,
        });

        // Verificar duplicata no banco de movimentos oficiais
        const movimentoExistente = await prisma.movimento.findFirst({
          where: {
            usuarioId: lote.usuarioId,
            chaveDedupe,
          },
        });

        if (movimentoExistente) {
          resultado.duplicadasIgnoradas++;

          // Atualiza staging para IGNORADO
          await prisma.stagingLancamentoImportacao.update({
            where: { id: item.id },
            data: { statusProcessamento: 'IGNORADO' },
          });

          // Notifica evento com status de duplicata ignorada
          importacaoEventBus.emitTransacaoConsolidada({
            loteId,
            arquivoId: item.arquivoId,
            arquivoOrigem: item.arquivoOrigem,
            usuarioId: lote.usuarioId,
            stagingId: item.id,
            movimentoId: movimentoExistente.id,
            dataMovimento: dataMovimentoStr,
            descricao: item.descricao,
            valor: valorNum,
            natureza: item.natureza,
            contaNome: contaInfo.nome,
            duplicadaIgnorada: true,
            timestamp: new Date(),
          });

          continue;
        }

        // 2. Regra Anti-Dupla Contagem: pagamento de fatura vira TRANSFERENCIA_PROPRIA
        let naturezaFinal = item.natureza;
        let isPagamentoFaturaConvertido = false;
        if (
          /pag(amento)?\s*(de)?\s*fat(ura)?|fatura\s*cart[aã]o|debito\s*automatico\s*fatura/i.test(
            item.descricao
          )
        ) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
          isPagamentoFaturaConvertido = true;
          resultado.pagamentosFaturaConvertidos++;
        }

        // 3. Resolução de Categoria POF
        const categoriaId = await this.resolverCategoriaPof(
          lote.usuarioId,
          item.categoriaSugerida
        );

        // 4. Inserção Atômica do Movimento Oficial
        const novoMovimento = await prisma.movimento.create({
          data: {
            usuarioId: lote.usuarioId,
            contaId: contaInfo.id,
            categoriaId,
            dataMovimento: item.dataMovimento,
            competencia,
            descricao: item.descricao,
            valor: valorNum,
            natureza: naturezaFinal,
            status: 'CONCILIADO',
            chaveDedupe,
            origemDocumento: `IA_LOTE_${item.arquivoOrigem}`,
            observacao: item.observacao || null,
          },
        });

        resultado.novosMovimentosInseridos++;

        // 5. Suporte a Parcelamento se identificado parcelaAtual e totalParcelas
        if (
          item.parcelaAtual &&
          item.totalParcelas &&
          item.totalParcelas > 1 &&
          naturezaFinal === 'DESPESA'
        ) {
          // Checar se já existe parcelamento ativo com descrição similar
          const parcelamentoExistente = await prisma.parcelamento.findFirst({
            where: {
              usuarioId: lote.usuarioId,
              descricao: item.descricao,
              totalParcelas: item.totalParcelas,
            },
          });

          if (!parcelamentoExistente) {
            const valorTotal = valorNum * item.totalParcelas;
            const primeiroVencimento = competencia;
            // Estima último vencimento adicionando meses
            const [ano, mes] = competencia.split('-').map(Number);
            const dataFim = new Date(ano, mes - 1 + (item.totalParcelas - 1), 1);
            const ultimoVencimento = `${dataFim.getFullYear()}-${String(
              dataFim.getMonth() + 1
            ).padStart(2, '0')}`;

            await prisma.parcelamento.create({
              data: {
                usuarioId: lote.usuarioId,
                contaId: contaInfo.id,
                categoriaId,
                descricao: item.descricao,
                valorTotal,
                parcelaValor: valorNum,
                parcelaAtual: item.parcelaAtual,
                totalParcelas: item.totalParcelas,
                primeiroVencimento,
                ultimoVencimento,
                status: 'ATIVO',
              },
            });
            resultado.parcelamentosCriados++;
          }
        }

        // 6. Atualizar staging para PROCESSADO
        await prisma.stagingLancamentoImportacao.update({
          where: { id: item.id },
          data: { statusProcessamento: 'PROCESSADO' },
        });

        // 7. Emitir evento de transação individual consolidada para a UI em tempo real
        importacaoEventBus.emitTransacaoConsolidada({
          loteId,
          arquivoId: item.arquivoId,
          arquivoOrigem: item.arquivoOrigem,
          usuarioId: lote.usuarioId,
          stagingId: item.id,
          movimentoId: novoMovimento.id,
          dataMovimento: dataMovimentoStr,
          descricao: item.descricao,
          valor: valorNum,
          natureza: naturezaFinal,
          contaNome: contaInfo.nome,
          categoriaNome: item.categoriaSugerida || undefined,
          duplicadaIgnorada: false,
          pagamentoFaturaConvertido: isPagamentoFaturaConvertido,
          timestamp: new Date(),
        });
      } catch (err: unknown) {
        const motivo = err instanceof Error ? err.message : String(err);
        resultado.erros.push({ stagingId: item.id, motivo });

        await prisma.stagingLancamentoImportacao.update({
          where: { id: item.id },
          data: { statusProcessamento: 'ERRO' },
        });
      }
    }

    // 8. Atualizar status dos arquivos para PROCESSADO_FINAL se todos os seus stagings foram concluídos
    // Seleciona arquivos que possuem registros na staging deste lote
    const stagingArquivosIds = await prisma.stagingLancamentoImportacao.findMany({
      where: { loteId },
      select: { arquivoId: true },
      distinct: ['arquivoId'],
    });

    for (const item of stagingArquivosIds) {
      if (!item.arquivoId) continue;

      const stagingsPendentes = await prisma.stagingLancamentoImportacao.count({
        where: {
          arquivoId: item.arquivoId,
          statusProcessamento: 'PENDENTE',
        },
      });

      if (stagingsPendentes === 0) {
        const arqAtual = await prisma.arquivoImportacao.findUnique({
          where: { id: item.arquivoId },
        });

        if (arqAtual && arqAtual.status !== 'PROCESSADO_FINAL' && arqAtual.status !== 'ERRO') {
          await prisma.arquivoImportacao.update({
            where: { id: item.arquivoId },
            data: {
              status: 'PROCESSADO_FINAL',
              mensagemErro: null,
            },
          });

          importacaoEventBus.emitArquivoProgresso({
            loteId,
            arquivoId: arqAtual.id,
            nomeArquivo: arqAtual.nomeArquivo,
            status: 'PROCESSADO_FINAL',
            mensagem: 'Lançamentos consolidados e integrados aos movimentos oficiais.',
            timestamp: new Date(),
          });
        }
      }
    }


    // 9. Verificar se ainda restam arquivos não finalizados no lote
    const arquivosNaoFinalizados = await prisma.arquivoImportacao.count({
      where: {
        loteId,
        status: { notIn: ['PROCESSADO_FINAL', 'ERRO'] },
      },
    });

    const stagingsRestantes = await prisma.stagingLancamentoImportacao.count({
      where: {
        loteId,
        statusProcessamento: 'PENDENTE',
      },
    });

    // Só encerra o lote se TODOS os arquivos já tiverem sido processados (final ou erro)
    // e não houver mais nenhum staging pendente.
    if (arquivosNaoFinalizados === 0 && stagingsRestantes === 0) {
      const arquivosComErro = await prisma.arquivoImportacao.count({
        where: { loteId, status: 'ERRO' },
      });
      const arquivosTotal = await prisma.arquivoImportacao.count({
        where: { loteId },
      });

      let statusLoteFinal: 'CONCLUIDO' | 'ERRO_PARCIAL' | 'ERRO_TOTAL' = 'CONCLUIDO';
      if (arquivosComErro === arquivosTotal && arquivosTotal > 0) {
        statusLoteFinal = 'ERRO_TOTAL';
      } else if (arquivosComErro > 0 || resultado.erros.length > 0) {
        statusLoteFinal = 'ERRO_PARCIAL';
      }

      const arquivosProcessadosCount = await prisma.arquivoImportacao.count({
        where: { loteId, status: 'PROCESSADO_FINAL' },
      });

      await prisma.loteImportacao.update({
        where: { id: loteId },
        data: {
          status: statusLoteFinal,
          arquivosProcessados: arquivosProcessadosCount,
        },
      });

      // 10. Emite evento de lote concluído
      importacaoEventBus.emitLoteConcluido({
        loteId,
        usuarioId: lote.usuarioId,
        totalArquivos: arquivosTotal,
        totalTransacoesImportadas: resultado.novosMovimentosInseridos,
        totalDuplicadasIgnoradas: resultado.duplicadasIgnoradas,
        totalContasCriadas: resultado.contasCriadas,
        timestamp: new Date(),
      });
    }

    return resultado;
  }
}

export const importacaoConsolidacaoWorkerService = new ImportacaoConsolidacaoWorkerService();
