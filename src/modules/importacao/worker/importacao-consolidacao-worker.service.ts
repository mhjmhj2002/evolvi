import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoArquivoStagingCarregadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { gerarChaveDedupe, extrairRaizComerciante, extrairInfoParcelamento } from '../../movimento/movimento.util.js';
import { classificadorCombinatorioService } from '../../movimento/classificador-combinatorio.service.js';
import { addMesesCompetencia } from '../../parcelamento/parcelamento.util.js';
import { inferirCompetenciaFaturaDocumento } from '../../movimento/movimento-recalculo.service.js';

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

    console.log('[evolvi-worker:consolidacao] Inicializando ouvinte de consolidação de staging...');

    this.boundListener = (event: ImportacaoArquivoStagingCarregadoEvent) => {
      console.log(`[evolvi-worker:consolidacao] Staging carregado (${event.totalLinhasStaging} linhas) para arquivo [${event.nomeArquivo}]. Consolidando movimentos...`);
      // Processa a consolidação dos itens pendentes do lote
      this.consolidarLote(event.loteId, event.usuarioId).catch((err) => {
        console.error(
          `[evolvi-worker:consolidacao] Erro ao consolidar lote ${event.loteId}:`,
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
   * Evita fragmentação (BUG-16) buscando primeiro por identificadores unívocos (numeroConta, digitosCartao).
   */
  public async obterOuAutoCadastrarConta(params: {
    usuarioId: string;
    contaSugerida?: string | null;
    tipoConta?: 'CONTA_CORRENTE' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | 'CARTEIRA_DINHEIRO' | null;
    arquivoOrigem?: string;
    numeroConta?: string | null;
    digitosCartao?: string | null;
  }): Promise<{ contaId: string; contaNome: string; criadaAgora: boolean }> {
    const { usuarioId, contaSugerida, tipoConta, arquivoOrigem, numeroConta, digitosCartao } = params;

    // Busca todas as contas do usuário para comparação flexível e vinculação unívoca
    const contasExistentes = await prisma.conta.findMany({
      where: { usuarioId },
    });

    // 1. Identificação prioritária por número de conta corrente (se presente, suportando com/sem dígito)
    if (numeroConta && numeroConta.trim()) {
      const rawNum = numeroConta.trim();
      const numLimpo = rawNum.replace(/\D/g, '');
      const baseNum = rawNum.split(/[-–—]/)[0].replace(/\D/g, '');

      if (numLimpo) {
        const contaPorNumero = contasExistentes.find((c) => {
          if (!c.numeroConta) return false;
          const cRaw = c.numeroConta.trim();
          const cLimpo = cRaw.replace(/\D/g, '');
          const cBase = cRaw.split(/[-–—]/)[0].replace(/\D/g, '');
          return cLimpo === numLimpo || (baseNum && cBase && baseNum === cBase);
        });

        if (contaPorNumero) {
          return {
            contaId: contaPorNumero.id,
            contaNome: contaPorNumero.nome,
            criadaAgora: false,
          };
        }
      }
    }

    // 2. Identificação prioritária por dígitos do cartão (se presente)
    if (digitosCartao && digitosCartao.trim()) {
      const digitosLimpos = digitosCartao.trim().replace(/\D/g, '');
      if (digitosLimpos) {
        const contaPorCartao = contasExistentes.find(
          (c) => c.digitosCartao && c.digitosCartao.replace(/\D/g, '') === digitosLimpos
        );
        if (contaPorCartao) {
          return {
            contaId: contaPorCartao.id,
            contaNome: contaPorCartao.nome,
            criadaAgora: false,
          };
        }
      }
    }

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

    const nomeNormalizado = this.normalizarNome(nomeFinal);
    const contaEncontrada = contasExistentes.find(
      (c) => this.normalizarNome(c.nome) === nomeNormalizado
    );

    if (contaEncontrada) {
      // Se a conta encontrada não possuía numeroConta ou digitosCartao e agora temos, enriquece a conta
      const dadosAtualizar: { numeroConta?: string; digitosCartao?: string } = {};
      if (numeroConta && !contaEncontrada.numeroConta) {
        dadosAtualizar.numeroConta = numeroConta.trim();
      }
      if (digitosCartao && !contaEncontrada.digitosCartao) {
        dadosAtualizar.digitosCartao = digitosCartao.trim();
      }
      if (Object.keys(dadosAtualizar).length > 0) {
        await prisma.conta.update({
          where: { id: contaEncontrada.id },
          data: dadosAtualizar,
        });
      }

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
        numeroConta: numeroConta ? numeroConta.trim() : null,
        digitosCartao: digitosCartao ? digitosCartao.trim() : null,
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

    // Mapeamento de contaId resolvido por arquivoId para catalogação com alta fidelidade
    const arquivoContasMap = new Map<string, string>();

    for (const item of stagingItens) {
      try {
        const cacheKey = `${item.contaSugerida || ''}_${item.tipoConta || ''}_${item.numeroConta || ''}_${item.digitosCartao || ''}_${item.arquivoOrigem}`;
        let contaInfo = cacheContas.get(cacheKey);

        if (!contaInfo) {
          const resConta = await this.obterOuAutoCadastrarConta({
            usuarioId: lote.usuarioId,
            contaSugerida: item.contaSugerida,
            tipoConta: item.tipoConta,
            arquivoOrigem: item.arquivoOrigem,
            numeroConta: item.numeroConta,
            digitosCartao: item.digitosCartao,
          });

          if (resConta.criadaAgora) {
            resultado.contasCriadas++;
          }

          contaInfo = { id: resConta.contaId, nome: resConta.contaNome };
          cacheContas.set(cacheKey, contaInfo);
        }

        if (item.arquivoId && !arquivoContasMap.has(item.arquivoId)) {
          arquivoContasMap.set(item.arquivoId, contaInfo.id);
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
          /pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|fatura\s*cart[aã]o|debito\s*automatico\s*fatura|pag\s*fatura/i.test(
            item.descricao
          ) ||
          (/pag\s*boleto|pagamento\s*boleto|pagto\s*boleto/i.test(item.descricao) &&
            /nu\s*pagamentos|nubank|c6\s*bank|banco\s*c6|bradescard|itaucard|cart[aã]o|credicard|santander\s*cart[oõ]es/i.test(item.descricao));


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

        const isAporteInvestimento =
          /aplica[cç][aã]o\s*(de)?\s*(cdb|rdb|lci|lca|tesouro|fundo|investimento|financeira)?|(?:\b|^)(cdb|rdb|lci|lca)(?:\b|$)|tesouro\s*direto|dep[oó]sito\s*poupan[cç]a|compra\s*a[cç][oõ]es|(?:\b|^)investimento(?:\b|$)/i.test(
            item.descricao
          );

        if (isSalarioOuPlr) {
          // Prevalência absoluta de salário/PLR: SEMPRE RECEITA operacional
          naturezaFinal = 'RECEITA';
        } else if (isPagamentoFatura) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
          isPagamentoFaturaConvertido = true;
          resultado.pagamentosFaturaConvertidos++;
        } else if (isResgateInvestimento) {
          // Resgates de investimentos (CDB, poupança, etc.) retornando para conta são transferências entre patrimônio líquido
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
        } else if (isAporteInvestimento) {
          // Identificação de investimentos / aportes patrimoniais novos de saída (TASK-44)
          naturezaFinal = 'APORTE_PATRIMONIAL';
        } else if (isTransferenciaPropriaTitular) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
        }

        // 3. Resolução de Categoria POF (Prioridade: Regra do Usuário por Vendedor > Inteligência Combinatória TASK-43 > Sugestão de Arquivo)
        let categoriaIdFinal: string | null = null;
        let categoriaFixadaAutomaticamente = false;

        const raizComerciante = extrairRaizComerciante(item.descricao);
        if (raizComerciante && raizComerciante.length >= 3) {
          const regraVendedor = await prisma.regraVendedorCategoria.findFirst({
            where: {
              usuarioId: lote.usuarioId,
              termoVendedor: { equals: raizComerciante, mode: 'insensitive' },
            },
          });
          if (regraVendedor) {
            categoriaIdFinal = regraVendedor.categoriaId;
            categoriaFixadaAutomaticamente = true;
            // Incrementa o contador de uso da regra
            await prisma.regraVendedorCategoria.update({
              where: { id: regraVendedor.id },
              data: {
                totalAplicacoes: { increment: 1 },
                atualizadoEm: new Date(),
              },
            }).catch(() => {});
          }
        }

        if (!categoriaIdFinal) {
          let categoriaParaBuscar = item.categoriaSugerida;
          const inferenciaComb = classificadorCombinatorioService.inferirCategoria(
            item.descricao,
            item.dataMovimento,
            valorNum
          );
          if (inferenciaComb && inferenciaComb.confianca >= 0.90) {
            categoriaParaBuscar = inferenciaComb.categoriaSugerida;
          }

          categoriaIdFinal = await this.resolverCategoriaPof(
            lote.usuarioId,
            categoriaParaBuscar
          );
        }

        // 4. Inserção Atômica do Movimento Oficial com tratamento de concorrência P2002
        let novoMovimento: any;

        // Se existir um movimento PREVISTO correspondente (gerado previamente pelo parcelamento),
        // promovemos o lançamento previsto para CONCILIADO com os dados oficiais da fatura
        let movimentoPrevistoExistente: any = null;
        if (item.parcelaAtual && item.totalParcelas && item.totalParcelas > 1) {
          const infoParcItem = extrairInfoParcelamento(item.descricao);
          const pBase = (infoParcItem?.prefixoBase || item.descricao).trim();
          const candidatosPrevistos = await prisma.movimento.findMany({
            where: {
              usuarioId: lote.usuarioId,
              contaId: contaInfo.id,
              status: 'PREVISTO',
              natureza: naturezaFinal,
            },
          });
          movimentoPrevistoExistente = candidatosPrevistos.find((mp) => {
            const infoMp = extrairInfoParcelamento(mp.descricao);
            if (!infoMp) return false;
            const bMp = infoMp.prefixoBase.trim().toUpperCase();
            return (
              (bMp === pBase.toUpperCase() || bMp.includes(pBase.toUpperCase()) || pBase.toUpperCase().includes(bMp)) &&
              infoMp.parcelaAtual === item.parcelaAtual &&
              infoMp.totalParcelas === item.totalParcelas
            );
          });
        }

        try {
          if (movimentoPrevistoExistente) {
            novoMovimento = await prisma.movimento.update({
              where: { id: movimentoPrevistoExistente.id },
              data: {
                dataMovimento: item.dataMovimento,
                competencia,
                descricao: item.descricao,
                valor: valorNum,
                categoriaId: categoriaIdFinal,
                categoriaFixadaPeloUsuario: categoriaFixadaAutomaticamente,
                validadoDedupe: categoriaFixadaAutomaticamente ? 'S' : 'N',
                status: 'CONCILIADO',
                chaveDedupe,
                idOrigem: item.idOrigem || null,
                origemDocumento: `IA_LOTE_${item.arquivoOrigem}`,
                observacao: item.observacao || null,
              },
            });
            resultado.novosMovimentosInseridos++;
          } else {
            novoMovimento = await prisma.movimento.create({
              data: {
                usuarioId: lote.usuarioId,
                contaId: contaInfo.id,
                categoriaId: categoriaIdFinal,
                categoriaFixadaPeloUsuario: categoriaFixadaAutomaticamente,
                validadoDedupe: categoriaFixadaAutomaticamente ? 'S' : 'N',
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
          }
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

        // 5. Suporte a Parcelamento se identificado parcelaAtual e totalParcelas (BUG-18)
        if (
          item.parcelaAtual &&
          item.totalParcelas &&
          item.totalParcelas > 1 &&
          naturezaFinal === 'DESPESA'
        ) {
          const infoParc = extrairInfoParcelamento(item.descricao);
          const prefixoBase = (infoParc?.prefixoBase || item.descricao).trim();

          // Buscar contratos existentes para o usuário, mesma conta e total de parcelas
          const parcelamentosCandidatos = await prisma.parcelamento.findMany({
            where: {
              usuarioId: lote.usuarioId,
              contaId: contaInfo.id,
              totalParcelas: item.totalParcelas,
            },
          });

          // Casar por prefixoBase idêntico (case-insensitive) ou descrição exata
          const parcelamentoExistente = parcelamentosCandidatos.find((p) => {
            if (p.descricao.toLowerCase() === item.descricao.toLowerCase()) return true;
            const pInfo = extrairInfoParcelamento(p.descricao);
            const pBase = (pInfo?.prefixoBase || p.descricao).trim().toLowerCase();
            return pBase === prefixoBase.toLowerCase();
          });

          if (parcelamentoExistente) {
            // Se já existe, atualiza a maior parcela observada e avança status caso atinja o total
            const novaParcela = Math.max(parcelamentoExistente.parcelaAtual, item.parcelaAtual);
            const statusAtualizado =
              novaParcela >= item.totalParcelas ? 'QUITADO' : parcelamentoExistente.status;

            await prisma.parcelamento.update({
              where: { id: parcelamentoExistente.id },
              data: {
                descricao: prefixoBase,
                parcelaAtual: novaParcela,
                status: statusAtualizado,
              },
            });
          } else {
            // Se for fatura de cartão de crédito, a exigibilidade da parcela é a competência da fatura
            const compFatura = inferirCompetenciaFaturaDocumento(item.arquivoOrigem);
            const competenciaBase = compFatura || competencia;
            const valorTotal = valorNum * item.totalParcelas;
            const primeiroVencimento = addMesesCompetencia(competenciaBase, -(item.parcelaAtual - 1));
            const ultimoVencimento = addMesesCompetencia(primeiroVencimento, item.totalParcelas - 1);
            const statusInicial = item.parcelaAtual >= item.totalParcelas ? 'QUITADO' : 'ATIVO';

            await prisma.parcelamento.create({
              data: {
                usuarioId: lote.usuarioId,
                contaId: contaInfo.id,
                categoriaId: categoriaIdFinal,
                descricao: prefixoBase,
                valorTotal,
                parcelaValor: valorNum,
                parcelaAtual: item.parcelaAtual,
                totalParcelas: item.totalParcelas,
                primeiroVencimento,
                ultimoVencimento,
                status: statusInicial,
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

          // Dispara evento de conclusão de arquivo consolidado para os workers pós-importação
          importacaoEventBus.emitArquivoConsolidadoFinal({
            loteId,
            arquivoId: arqAtual.id,
            usuarioId: lote.usuarioId,
            nomeArquivo: arqAtual.nomeArquivo,
            timestamp: new Date(),
          });

          // TASK-41: Catalogar analiticamente no HistoricoImportacaoArquivo e verificar lacunas
          try {
            const { conciliacaoService } = await import('../conciliacao.service.js');
            const contaIdResolvido = arquivoContasMap.get(arqAtual.id);
            await conciliacaoService.catalogarArquivo({
              usuarioId: lote.usuarioId,
              arquivoId: arqAtual.id,
              loteId,
              contaId: contaIdResolvido,
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
    // Arquivos em RECEPCIONADO marcados como duplicados (jaImportadoAnteriormente) ou finalizados
    // não impedem o encerramento do lote.
    const arquivosNaoFinalizados = await prisma.arquivoImportacao.count({
      where: {
        loteId,
        status: { notIn: ['PROCESSADO_FINAL', 'ERRO'] },
        AND: [
          {
            OR: [
              { jaImportadoAnteriormente: false },
              { status: 'ENVIADO_IA' },
            ],
          },
          {
            NOT: { statusFinal: 'DUPLICADO' },
          },
        ],
      },
    });

    const stagingsRestantes = await prisma.stagingLancamentoImportacao.count({
      where: {
        loteId,
        statusProcessamento: 'PENDENTE',
      },
    });

    // Só encerra o lote se TODOS os arquivos ativos já tiverem sido processados (final ou erro)
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
        where: {
          loteId,
          OR: [
            { status: 'PROCESSADO_FINAL' },
            { jaImportadoAnteriormente: true },
            { statusFinal: { in: ['DUPLICADO', 'VAZIO'] } },
          ],
        },
      });

      await prisma.loteImportacao.update({
        where: { id: loteId },
        data: {
          status: statusLoteFinal,
          arquivosProcessados: arquivosProcessadosCount,
        },
      });

      // Reavalia lacunas de conciliação para garantir que alertas atendidos saiam imediatamente da fila
      try {
        const { conciliacaoService } = await import('../conciliacao.service.js');
        await conciliacaoService.verificarLacunas(lote.usuarioId);
      } catch (errLacunas) {
        console.error(
          `[ImportacaoConsolidacaoWorker] Erro ao reavaliar lacunas após conclusão do lote ${loteId}:`,
          errLacunas
        );
      }

      // 10. Emite evento de lote concluído (dispara workers de recalculo, deduplicacao e parcelamento)
      importacaoEventBus.emitLoteConcluido({
        loteId,
        usuarioId: lote.usuarioId,
        totalArquivos: arquivosTotal,
        totalTransacoesImportadas: resultado.novosMovimentosInseridos,
        totalDuplicadasIgnoradas: resultado.duplicadasIgnoradas,
        totalContasCriadas: resultado.contasCriadas,
        timestamp: new Date(),
      });

      // 11. Limpeza do diretório temporário do lote: todos os dados e lançamentos já estão no banco
      if (lote.caminhoDiretorio) {
        try {
          const caminhoAbsoluto = path.resolve(process.cwd(), lote.caminhoDiretorio);
          await fs.rm(caminhoAbsoluto, { recursive: true, force: true });
        } catch {
          // Ignora se o diretório já foi excluído
        }
      }
    }

    return resultado;
  }
}

export const importacaoConsolidacaoWorkerService = new ImportacaoConsolidacaoWorkerService();
