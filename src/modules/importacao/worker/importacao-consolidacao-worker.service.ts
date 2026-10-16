import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoArquivoStagingCarregadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { gerarChaveDedupe } from '../../movimento/movimento.util.js';
import { classificadorCombinatorioService } from '../../movimento/classificador-combinatorio.service.js';

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
  // Mutex / Lock de fila serializada por loteId para eliminar concorrência
  private locksPorLote: Map<string, Promise<any>> = new Map();

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
    const nomeSemAcento = nomeBusca.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 1. Busca exata insensível a maiúsculas (com e sem acento)
    let categoria = await prisma.categoria.findFirst({
      where: {
        OR: [
          { usuarioId, nome: { equals: nomeBusca, mode: 'insensitive' } },
          { usuarioId: null, nome: { equals: nomeBusca, mode: 'insensitive' } },
          { usuarioId, nome: { equals: nomeSemAcento, mode: 'insensitive' } },
          { usuarioId: null, nome: { equals: nomeSemAcento, mode: 'insensitive' } },
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
          { usuarioId, nome: { contains: nomeSemAcento, mode: 'insensitive' } },
          { usuarioId: null, nome: { contains: nomeSemAcento, mode: 'insensitive' } },
        ],
      },
    });

    return categoria ? categoria.id : null;
  }

  /**
   * Consolida todos os lançamentos em Staging com status PENDENTE de um lote.
   * Utiliza fila serializada por loteId para impedir race conditions de arquivos do mesmo lote.
   */
  public async consolidarLote(
    loteId: string,
    usuarioIdEsperado?: string
  ): Promise<ConsolidacaoLoteResultado> {
    const lockAnterior = this.locksPorLote.get(loteId) || Promise.resolve();

    const operacaoAtual = (async () => {
      await lockAnterior.catch(() => {});
      return this.executarConsolidacaoLoteInterno(loteId, usuarioIdEsperado);
    })();

    this.locksPorLote.set(loteId, operacaoAtual);

    try {
      return await operacaoAtual;
    } finally {
      if (this.locksPorLote.get(loteId) === operacaoAtual) {
        this.locksPorLote.delete(loteId);
      }
    }
  }

  private async executarConsolidacaoLoteInterno(
    loteId: string,
    usuarioIdEsperado?: string
  ): Promise<ConsolidacaoLoteResultado> {
    const lote = await prisma.loteImportacao.findUnique({
      where: { id: loteId },
      include: {
        arquivos: true,
        usuario: {
          select: { id: true, nome: true },
        },
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

        // 1. Chave Dedupe determinística estruturada (com idOrigem se disponível)
        const chaveDedupe = gerarChaveDedupe({
          contaId: contaInfo.id,
          dataMovimento: dataMovimentoStr,
          valor: valorNum,
          descricao: item.descricao,
          idOrigem: item.idOrigem,
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

        // BUG-13: Se o item for em conta de cartão de crédito e corresponder a quitação/pagamento recebido,
        // ele é puramente compensatório/informativo na fatura e deve ser ignorado para não duplicar com o débito da conta corrente
        const isQuitacaoEmCartao =
          item.tipoConta === 'CARTAO_CREDITO' &&
          (/pag(amento)?\s*(de)?\s*(fat(ura)?|cart[aã]o)|pagamento\s*recebido|cr[eé]dito\s*pagamento/i.test(
            item.descricao
          ) ||
            /informativ[ao]\s*de\s*quita[cç][aã]o/i.test(item.observacao || ''));

        if (isQuitacaoEmCartao) {
          resultado.duplicadasIgnoradas++;

          await prisma.stagingLancamentoImportacao.update({
            where: { id: item.id },
            data: {
              statusProcessamento: 'IGNORADO',
              observacao: 'Linha informativa de pagamento em fatura de cartão (ignorado para evitar redundância)',
            },
          });

          continue;
        }

        // 2. Regra Anti-Dupla Contagem (Anti-Inflação): pagamento de fatura, PIX/TED próprio e resgates viram TRANSFERENCIA_PROPRIA
        let naturezaFinal = item.natureza;
        let isPagamentoFaturaConvertido = false;
        const descUpper = item.descricao.toUpperCase();

        const isPagamentoFatura =
          /pag(amento)?\s*(de)?\s*fat(ura)?|fatura\s*cart[aã]o|debito\s*automatico\s*fatura/i.test(
            item.descricao
          );

        const isResgateInvestimento =
          /resgate\s*(de)?\s*(cdb|poupanc|investimento|rdb|lci|lca|tesouro)/i.test(
            item.descricao
          );

        // Regra Universal de Proventos, Salários e PLR:
        // Expressões padronizadas bancárias de crédito de folha, conta salário ou PLR
        // prevalecem SEMPRE como RECEITA, mesmo que o nome do titular conste na TED/crédito
        const isSalarioOuPlr =
          /ted\s*conta\s*sal[aá]rio|cred\s*(ted\s*)?sal[aá]rio|folha\s*pag(amento)?|remunera[cç][aã]o|pagamento\s*de\s*sal[aá]rio|(?:\b|^)plr(?:\b|$)|participa[cç][aã]o\s*lucros|b[oô]nus\s*salarial|abono\s*salarial|13[oº]?\s*sal[aá]rio|sal[aá]rio\s*mensal/i.test(
            item.descricao
          );

        // Verifica se a descrição de entrada contém o nome do titular cadastrado
        let isTransferenciaPropriaTitular = false;
        const nomeTitular = lote.usuario?.nome;
        if (nomeTitular) {
          const partesNome = nomeTitular
            .trim()
            .split(/\s+/)
            .filter((p) => p.length >= 3);
          const containsNomeCompleto = descUpper.includes(nomeTitular.toUpperCase());
          const containsPartesSignificativas =
            partesNome.length >= 2 &&
            partesNome.every((p) => descUpper.includes(p.toUpperCase()));

          if (containsNomeCompleto || containsPartesSignificativas) {
            isTransferenciaPropriaTitular = true;
          }
        }

        if (isSalarioOuPlr) {
          // Prevalência absoluta de salário/PLR: SEMPRE RECEITA operacional
          naturezaFinal = 'RECEITA';
        } else if (isPagamentoFatura) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
          isPagamentoFaturaConvertido = true;
          resultado.pagamentosFaturaConvertidos++;
        } else if (isResgateInvestimento) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
        } else if (isTransferenciaPropriaTitular) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
        }

        // 3. Resolução de Categoria POF (com suporte a Inteligência Combinatória TASK-43)
        let categoriaParaBuscar = item.categoriaSugerida;
        const inferenciaComb = classificadorCombinatorioService.inferirCategoria(
          item.descricao,
          item.dataMovimento,
          valorNum
        );
        if (inferenciaComb && inferenciaComb.confianca >= 0.90) {
          categoriaParaBuscar = inferenciaComb.categoriaSugerida;
        }

        const categoriaId = await this.resolverCategoriaPof(
          lote.usuarioId,
          categoriaParaBuscar
        );

        // 4. Inserção Atômica do Movimento Oficial com tratamento de concorrência P2002
        let novoMovimento: any;
        try {
          novoMovimento = await prisma.movimento.create({
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
              idOrigem: item.idOrigem || null,
              origemDocumento: `IA_LOTE_${item.arquivoOrigem}`,
              observacao: item.observacao || null,
            },
          });

          resultado.novosMovimentosInseridos++;
        } catch (createErr: any) {
          if (createErr?.code === 'P2002') {
            // Concorrência interceptada pela constraint UNIQUE do banco
            resultado.duplicadasIgnoradas++;

            await prisma.stagingLancamentoImportacao.update({
              where: { id: item.id },
              data: { statusProcessamento: 'IGNORADO' },
            });

            const movSalvo = await prisma.movimento.findFirst({
              where: { usuarioId: lote.usuarioId, chaveDedupe },
            });

            importacaoEventBus.emitTransacaoConsolidada({
              loteId,
              arquivoId: item.arquivoId,
              arquivoOrigem: item.arquivoOrigem,
              usuarioId: lote.usuarioId,
              stagingId: item.id,
              movimentoId: movSalvo?.id || 'duplicada',
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
          throw createErr;
        }

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

          // TASK-41: Catalogar analiticamente no HistoricoImportacaoArquivo e verificar lacunas
          try {
            const { conciliacaoService } = await import('../conciliacao.service.js');
            await conciliacaoService.catalogarArquivo({
              usuarioId: lote.usuarioId,
              arquivoId: arqAtual.id,
              loteId,
            });
          } catch (errCatalog) {
            console.error(
              `[ImportacaoConsolidacaoWorker] Erro ao catalogar histórico do arquivo ${arqAtual.id}:`,
              errCatalog
            );
          }
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
