import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoArquivoStagingCarregadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import {
  gerarChaveDedupe,
  extrairRaizComerciante,
  extrairInfoParcelamento,
  extrairFavorecidoObservacao,
  correspondemRegraVendedor,
} from '../../movimento/movimento.util.js';
import { classificadorCombinatorioService } from '../../movimento/classificador-combinatorio.service.js';
import { addMesesCompetencia } from '../../parcelamento/parcelamento.util.js';
import { inferirCompetenciaFaturaDocumento } from '../../movimento/movimento-recalculo.service.js';
import { randomUUID } from 'node:crypto';
import { StatusStagingLancamento } from '@prisma/client';
import { importacaoDiagnosticoService } from '../importacao-diagnostico.service.js';
import { inferirPeriodoExtrato, validarDatasContraPeriodo } from './validacao-consistencia-conteudo.util.js';
import { descricaoIndicaPagamentoFatura, descricaoIndicaTransferenciaPropria } from '../../movimento/natureza-movimento.util.js';

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
    tipoConta?: 'CONTA_CORRENTE' | 'POUPANCA' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | 'CARTEIRA_DINHEIRO' | null;
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
          if (tipoConta && c.tipo !== tipoConta) return false;
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
      } else if (tipoConta === 'POUPANCA') {
        nomeFinal = 'Poupança';
      } else if (tipoConta === 'INVESTIMENTO') {
        nomeFinal = 'Investimento';
      } else {
        nomeFinal = 'Conta Corrente';
      }
      if (arquivoOrigem) {
        nomeFinal += ` (${arquivoOrigem.replace(/\.[^/.]+$/, '')})`;
      }
    }

    const nomeNormalizado = this.normalizarNome(nomeFinal);
    const contaEncontrada = contasExistentes.find(
      (c) => this.normalizarNome(c.nome) === nomeNormalizado && (!tipoConta || c.tipo === tipoConta)
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
      const lote = await prisma.loteImportacao.findUnique({ where: { id: loteId }, select: { usuarioId: true } });
      if (!lote || (usuarioIdEsperado && lote.usuarioId !== usuarioIdEsperado)) {
        return this.executarConsolidacaoLoteInterno(loteId, usuarioIdEsperado);
      }
      const owner = randomUUID();
      const reservado = await prisma.$executeRaw`
        UPDATE lotes_importacao
        SET worker_owner = ${owner}, worker_lease_until = NOW() + INTERVAL '15 minutes',
            worker_attempts = worker_attempts + 1
        WHERE id = ${loteId}::uuid AND usuario_id = ${lote.usuarioId}::uuid
          AND (worker_lease_until IS NULL OR worker_lease_until < NOW())
      `;
      if (reservado !== 1) {
        return { loteId, sucesso: true, totalProcessados: 0, novosMovimentosInseridos: 0,
          duplicadasIgnoradas: 0, pagamentosFaturaConvertidos: 0, contasCriadas: 0,
          parcelamentosCriados: 0, erros: [] };
      }
      const heartbeat = setInterval(() => {
        void prisma.$executeRaw`UPDATE lotes_importacao SET worker_lease_until = NOW() + INTERVAL '15 minutes' WHERE id = ${loteId}::uuid AND usuario_id = ${lote.usuarioId}::uuid AND worker_owner = ${owner}`
          .catch((err) => console.error('[evolvi-worker:consolidacao] Falha ao renovar lease:', err));
      }, 60_000);
      try {
        return await this.executarConsolidacaoLoteInterno(loteId, lote.usuarioId);
      } finally {
        clearInterval(heartbeat);
        await prisma.$executeRaw`UPDATE lotes_importacao SET worker_owner = NULL, worker_lease_until = NULL WHERE id = ${loteId}::uuid AND usuario_id = ${lote.usuarioId}::uuid AND worker_owner = ${owner}`;
      }
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

  /** Reabre somente linhas sem evidência de movimento oficial, preservando duplicatas válidas. */
  public async reprocessarArquivoInconsistente(arquivoId: string, usuarioId: string): Promise<ConsolidacaoLoteResultado> {
    const arquivo = await prisma.arquivoImportacao.findFirst({
      where: { id: arquivoId, usuarioId },
      select: { id: true, loteId: true },
    });
    if (!arquivo) throw new Error('Arquivo de importação não encontrado para este usuário.');

    const historico = await prisma.historicoImportacaoArquivo.findFirst({
      where: { arquivoId, usuarioId },
      select: { contaId: true },
    });

    const linhas = await prisma.stagingLancamentoImportacao.findMany({ where: { arquivoId } });
    await prisma.$transaction(async (tx) => {
      for (const linha of linhas) {
        const movimento = await tx.movimento.findFirst({
          where: {
            usuarioId,
            contaId: historico?.contaId ?? undefined,
            dataMovimento: linha.dataMovimento,
            valor: Number(linha.valor),
            descricao: linha.descricao,
          },
          select: { id: true },
        });
        const ignoradoInformativo = linha.statusProcessamento === 'IGNORADO' && /linha informativa de pagamento em fatura de cartão/i.test(linha.observacao || '');
        if (!movimento && !ignoradoInformativo) {
          await tx.stagingLancamentoImportacao.update({ where: { id: linha.id }, data: { statusProcessamento: 'PENDENTE' } });
        }
      }
      await tx.arquivoImportacao.update({ where: { id: arquivoId }, data: { status: 'STAGING_CARREGADO', statusFinal: null, mensagemErro: null } });
    });
    return this.consolidarLote(arquivo.loteId, usuarioId);
  }

  private async executarConsolidacaoLoteInterno(
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
    await prisma.arquivoImportacao.updateMany({
      where: { loteId, usuarioId: lote.usuarioId, stagingLancamentos: { some: { statusProcessamento: 'PENDENTE' } } },
      data: { consolidacaoIniciadaEm: new Date(), consolidacaoFinalizadaEm: null },
    });

    // Lê staging em páginas estáveis por ID para manter memória limitada ao bloco.
    const paginaStaging = Math.max(1, Math.min(1000, Number(process.env.IMPORTACAO_CONSOLIDACAO_PAGE_SIZE) || 200));
    const totalPendentes = await prisma.stagingLancamentoImportacao.count({
      where: { loteId, statusProcessamento: 'PENDENTE' },
    });
    let stagingItens = await prisma.stagingLancamentoImportacao.findMany({
      where: {
        loteId,
        statusProcessamento: 'PENDENTE',
      },
      orderBy: { id: 'asc' },
      take: paginaStaging,
    });

    const resultado: ConsolidacaoLoteResultado = {
      loteId,
      sucesso: true,
      totalProcessados: totalPendentes,
      novosMovimentosInseridos: 0,
      duplicadasIgnoradas: 0,
      pagamentosFaturaConvertidos: 0,
      contasCriadas: 0,
      parcelamentosCriados: 0,
      erros: [],
    };
    const inicioConsolidacaoLote = Date.now();

    // Cache local de contas criadas/resolvidas no ciclo para não reconsultar desnecessariamente
    const cacheContas = new Map<string, { id: string; nome: string }>();
    const cacheCategorias = new Map<string, string | null>();
    const movimentosDaPagina = new Map<string, { id: string; chaveDedupe: string | null; contaId: string; dataMovimento: Date; valor: unknown; descricao: string }>();
    const chaveTexto = (contaId: string, data: Date, valor: number, descricao: string) => JSON.stringify([contaId, data.toISOString().slice(0, 10), valor.toFixed(2), descricao]);
    const registrarSuspeitaData = async (movimentoId: string, item: (typeof stagingItens)[number], dataOriginal: string, periodo: { inicio: string; fim: string }) => {
      const motivo = `Data extraída (${dataOriginal}) fora do período do documento (${periodo.inicio} a ${periodo.fim}); correção automática não foi segura. Arquivo: ${item.arquivoOrigem}.`;
      try {
        const existente = await prisma.suspeitaMovimento.findFirst({
          where: { usuarioId: lote.usuarioId, movimentoId, status: 'PENDENTE', motivo },
          select: { id: true },
        });
        if (!existente) await prisma.$executeRaw`
          INSERT INTO suspeitas_movimento (usuario_id, tipo, status, confianca, motivo, movimento_id)
          VALUES (${lote.usuarioId}::uuid, 'SUSPEITA_DATA_FORA_PERIODO'::"TipoSuspeitaMovimento", 'PENDENTE'::"StatusSuspeitaMovimento", 1, ${motivo}, ${movimentoId}::uuid)
        `;
      } catch (erro) {
        console.error('[ImportacaoConsolidacaoWorker] Falha ao registrar suspeita de data; movimento mantido sem falhar a importação:', erro);
        await importacaoDiagnosticoService.registrar(item.arquivoId, 'SUSPEITA_CONSISTENCIA', motivo, { movimentoId }).catch(() => undefined);
      }
    };

    // Mapeamento de contaId resolvido por arquivoId para catalogação com alta fidelidade
    const arquivoContasMap = new Map<string, string>();
    const faturasPorArquivo = new Map<string, string>();
    let catalogoInstituicoes: Array<{ id: string; nome_reduzido: string; nome_oficial: string; aliases: unknown }> | undefined;
    const resolverInstituicao = async (nome: string) => {
      const nomeNormalizado = nome.trim();
      if (!nomeNormalizado) throw new Error('Não foi possível identificar a instituição financeira do arquivo.');
      catalogoInstituicoes ??= await prisma.$queryRaw<Array<{ id: string; nome_reduzido: string; nome_oficial: string; aliases: unknown }>>`SELECT id, nome_reduzido, nome_oficial, aliases FROM instituicoes_financeiras WHERE ativo = true`;
      const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const alvo = normalizar(nomeNormalizado);
      const instituicao = catalogoInstituicoes.find((item) => [item.nome_reduzido, item.nome_oficial, ...(Array.isArray(item.aliases) ? item.aliases as string[] : [])]
        .some((candidato) => normalizar(candidato).includes(alvo) || alvo.includes(normalizar(candidato))));
      if (!instituicao) throw new Error('Instituição financeira do arquivo não consta no catálogo oficial.');
      return instituicao;
    };

    // BUG-29: todo lançamento importado precisa apontar para um documento
    // imutável. A instituição é resolvida exclusivamente pelo catálogo (não
    // por regras específicas de banco).
    const garantirFatura = async (item: (typeof stagingItens)[number], contaId: string): Promise<string | null> => {
      const existente = faturasPorArquivo.get(item.arquivoId);
      if (existente) return existente;
      const arquivo = lote.arquivos.find((a) => a.id === item.arquivoId);
      // Staging criado diretamente por rotinas internas/testes não representa
      // uma importação de arquivo. O contrato obrigatório vale para arquivos
      // recebidos, que sempre possuem hash de conteúdo.
      if (!arquivo?.hashConteudo) return null;
      // Uma tentativa anterior pode já ter criado a fatura a partir de outra
      // linha do documento. Reutilize-a sem depender dos campos desta linha.
      const faturaPersistida = await prisma.fatura.findFirst({
        where: { usuarioId: lote.usuarioId, hashArquivo: arquivo.hashConteudo },
        select: { id: true },
      });
      if (faturaPersistida) {
        faturasPorArquivo.set(item.arquivoId, faturaPersistida.id);
        return faturaPersistida.id;
      }
      const nomeInstituicao = (item.contaSugerida || '').trim();
      const instituicao = await resolverInstituicao(nomeInstituicao);
      const anoMes = item.dataMovimento.toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(anoMes)) throw new Error('Não foi possível identificar o ano/mês da fatura no arquivo.');
      const tipoDocumento = item.tipoConta === 'CARTAO_CREDITO' ? 'FATURA_CARTAO' : 'EXTRATO_CONTA';
      const idFatura = `${arquivo.hashConteudo}:${anoMes}:${tipoDocumento}`;
      const fatura = await prisma.$queryRaw<Array<{ id: string }>>`INSERT INTO faturas (usuario_id,instituicao_id,id_fatura,hash_arquivo,nome_arquivo_original,tipo_documento,ano_mes_fatura,conta_id,metadados_extracao) VALUES (${lote.usuarioId}::uuid,${instituicao.id}::uuid,${idFatura},${arquivo.hashConteudo},${arquivo.nomeArquivo},${tipoDocumento}::tipo_documento_rastreavel,${anoMes},${contaId}::uuid,${JSON.stringify({ arquivoId: arquivo.id })}::jsonb) ON CONFLICT (usuario_id,hash_arquivo) DO UPDATE SET instituicao_id=EXCLUDED.instituicao_id,conta_id=EXCLUDED.conta_id,nome_arquivo_original=EXCLUDED.nome_arquivo_original RETURNING id`;
      faturasPorArquivo.set(item.arquivoId, fatura[0].id);
      return fatura[0].id;
    };

    // Resolve cada documento antes de percorrer as linhas em ordem de ID. Testa
    // sugestões distintas do arquivo até achar uma instituição real no catálogo;
    // rótulos genéricos de conta não podem impedir o uso da evidência seguinte.
    for (const arquivo of lote.arquivos) {
      if (!arquivo.hashConteudo) continue;
      const faturaPersistida = await prisma.fatura.findFirst({
        where: { usuarioId: lote.usuarioId, hashArquivo: arquivo.hashConteudo },
        select: { id: true },
      });
      if (faturaPersistida) {
        faturasPorArquivo.set(arquivo.id, faturaPersistida.id);
        continue;
      }

      let cursorCandidata: string | undefined;
      let falhaPreResolucao: unknown;
      while (!faturasPorArquivo.has(arquivo.id)) {
        const candidatas = await prisma.stagingLancamentoImportacao.findMany({
          where: {
            loteId,
            arquivoId: arquivo.id,
            contaSugerida: { not: '' },
            ...(cursorCandidata ? { id: { gt: cursorCandidata } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        });
        if (!candidatas.length) break;

        for (const evidenciaDocumento of candidatas) {
          cursorCandidata = evidenciaDocumento.id;
          if (!evidenciaDocumento.contaSugerida?.trim()) continue;
          try {
            await resolverInstituicao(evidenciaDocumento.contaSugerida);
            const cacheKey = `${evidenciaDocumento.contaSugerida}_${evidenciaDocumento.tipoConta || ''}_${evidenciaDocumento.numeroConta || ''}_${evidenciaDocumento.digitosCartao || ''}_${evidenciaDocumento.arquivoOrigem}`;
            let contaInfo = cacheContas.get(cacheKey);
            if (!contaInfo) {
              const resConta = await this.obterOuAutoCadastrarConta({
                usuarioId: lote.usuarioId,
                contaSugerida: evidenciaDocumento.contaSugerida,
                tipoConta: evidenciaDocumento.tipoConta,
                arquivoOrigem: evidenciaDocumento.arquivoOrigem,
                numeroConta: evidenciaDocumento.numeroConta,
                digitosCartao: evidenciaDocumento.digitosCartao,
              });
              if (resConta.criadaAgora) resultado.contasCriadas++;
              contaInfo = { id: resConta.contaId, nome: resConta.contaNome };
              cacheContas.set(cacheKey, contaInfo);
            }
            arquivoContasMap.set(arquivo.id, contaInfo.id);
            await garantirFatura(evidenciaDocumento, contaInfo.id);
            break;
          } catch (erro) {
            // Continua procurando outra sugestão do mesmo documento. O erro
            // definitivo será atribuído à linha se nenhuma candidata servir.
            falhaPreResolucao = erro;
          }
        }
      }
      if (!faturasPorArquivo.has(arquivo.id) && falhaPreResolucao) {
        console.warn(`[ImportacaoConsolidacaoWorker] Nenhuma sugestão identificou uma instituição para o arquivo ${arquivo.id}:`, falhaPreResolucao);
      }
    }

    // Carrega regras de vendedor/favorecido do usuário para correspondência inteligente
    const regrasVendedorUsuario = await prisma.regraVendedorCategoria.findMany({
      where: { usuarioId: lote.usuarioId },
    });

    let cursorStaging: string | undefined;
    const ocorrenciasNoDocumento = new Map<string, number>();
    while (stagingItens.length > 0) {
    // Mantém o cache de candidatos limitado à página atual. Movimentos criados
    // em páginas anteriores já são encontrados na consulta em lote ao banco.
    movimentosDaPagina.clear();
    // Pré-carrega/resolução de contas uma vez por conta distinta na página.
    for (const item of stagingItens) {
      const cacheKey = `${item.contaSugerida || ''}_${item.tipoConta || ''}_${item.numeroConta || ''}_${item.digitosCartao || ''}_${item.arquivoOrigem}`;
      if (cacheContas.has(cacheKey)) continue;
      const resConta = await this.obterOuAutoCadastrarConta({ usuarioId: lote.usuarioId, contaSugerida: item.contaSugerida,
        tipoConta: item.tipoConta, arquivoOrigem: item.arquivoOrigem, numeroConta: item.numeroConta, digitosCartao: item.digitosCartao });
      if (resConta.criadaAgora) resultado.contasCriadas++;
      cacheContas.set(cacheKey, { id: resConta.contaId, nome: resConta.contaNome });
    }
    const idsArquivosPagina = [...new Set(stagingItens.map((item) => item.arquivoId).filter((id): id is string => Boolean(id)))];
    const inventariosPagina = idsArquivosPagina.length
      ? await prisma.inventarioIaArquivo.findMany({
        where: { usuarioId: lote.usuarioId, arquivoId: { in: idsArquivosPagina } },
        orderBy: { criadoEm: 'desc' },
        select: { arquivoId: true, dataInicial: true, dataFinal: true },
      })
      : [];
    const periodoInventarioPorArquivo = new Map<string, { dataInicial: Date | null; dataFinal: Date | null }>();
    for (const inventario of inventariosPagina) {
      if (!periodoInventarioPorArquivo.has(inventario.arquivoId)) {
        periodoInventarioPorArquivo.set(inventario.arquivoId, { dataInicial: inventario.dataInicial, dataFinal: inventario.dataFinal });
      }
    }

    // Uma consulta em lote substitui a busca de duplicata por linha para a página.
    const chavesDedupePagina = new Set<string>();
    const condicoesTextoPagina: Array<{ contaId: string; dataMovimento: Date; valor: number; descricao: string }> = [];
    const ocorrenciaPorStaging = new Map<string, number>();
    const contadoresPagina = new Map(ocorrenciasNoDocumento);
    for (const item of stagingItens) {
      const cacheKey = `${item.contaSugerida || ''}_${item.tipoConta || ''}_${item.numeroConta || ''}_${item.digitosCartao || ''}_${item.arquivoOrigem}`;
      const conta = cacheContas.get(cacheKey)!;
      const data = item.dataMovimento.toISOString().slice(0, 10);
      const valor = Number(item.valor);
      const assinatura = JSON.stringify([item.arquivoOrigem, conta.id, data, valor, item.descricao.trim().toLocaleLowerCase(), item.idOrigem || null]);
      const ocorrencia = (contadoresPagina.get(assinatura) || 0) + 1;
      contadoresPagina.set(assinatura, ocorrencia);
      ocorrenciaPorStaging.set(item.id, ocorrencia);
      chavesDedupePagina.add(gerarChaveDedupe({ contaId: conta.id, dataMovimento: data, valor, descricao: item.descricao, idOrigem: item.idOrigem, ocorrencia }));
      chavesDedupePagina.add(gerarChaveDedupe({ contaId: conta.id, dataMovimento: data, valor, descricao: item.descricao, ocorrencia }));
      condicoesTextoPagina.push({ contaId: conta.id, dataMovimento: item.dataMovimento, valor, descricao: item.descricao });
    }
    const movimentosPrecarregados = await prisma.movimento.findMany({
      where: { usuarioId: lote.usuarioId, OR: [
        { chaveDedupe: { in: [...chavesDedupePagina] } },
        ...condicoesTextoPagina.map((condicao) => ({ contaId: condicao.contaId, dataMovimento: condicao.dataMovimento, valor: condicao.valor, descricao: condicao.descricao })),
      ] },
      select: { id: true, chaveDedupe: true, contaId: true, dataMovimento: true, valor: true, descricao: true },
    });
    for (const movimento of movimentosPrecarregados) {
      movimentosDaPagina.set(chaveTexto(movimento.contaId, movimento.dataMovimento, Number(movimento.valor), movimento.descricao), movimento);
      if (movimento.chaveDedupe) movimentosDaPagina.set(movimento.chaveDedupe, movimento);
    }
    for (const [assinatura, ocorrencia] of contadoresPagina) ocorrenciasNoDocumento.set(assinatura, ocorrencia);

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

        const dataOriginal = item.dataMovimento.toISOString().slice(0, 10);
        const periodoInventario = item.arquivoId ? periodoInventarioPorArquivo.get(item.arquivoId) : undefined;
        const periodoFonte = inferirPeriodoExtrato(item.arquivoOrigem, periodoInventario?.dataInicial, periodoInventario?.dataFinal);
        let inconsistenciaData: { dataOriginal: string; periodo: { inicio: string; fim: string } } | null = null;
        if (periodoFonte) {
          const validacaoData = validarDatasContraPeriodo([dataOriginal], periodoFonte);
          if (validacaoData.datas[0]?.corrigida) {
            item.dataMovimento = new Date(`${validacaoData.datas[0].final}T00:00:00.000Z`);
            await prisma.stagingLancamentoImportacao.update({ where: { id: item.id }, data: { dataMovimento: item.dataMovimento } });
            await importacaoDiagnosticoService.registrar(item.arquivoId, 'CONSOLIDACAO', 'Data corrigida pela validação do período explícito do documento.', {
              stagingId: item.id, dataOriginal, dataCorrigida: validacaoData.datas[0].final, periodo: periodoFonte,
            });
          } else if (validacaoData.inconsistencias.length) {
            inconsistenciaData = { dataOriginal, periodo: { inicio: periodoFonte.inicio, fim: periodoFonte.fim } };
          }
        }

        if (item.arquivoId && !arquivoContasMap.has(item.arquivoId)) {
          arquivoContasMap.set(item.arquivoId, contaInfo.id);
        }

        const linhaQuitacaoInformativa = item.tipoConta === 'CARTAO_CREDITO' &&
          (Boolean(item.observacao?.includes('Informativo de quitação em fatura de cartão')) ||
            /pag(amento)?\s*(de)?\s*(fat(ura)?|cart[aã]o)|pagamento\s*recebido|cr[eé]dito\s*pagamento/i.test(item.descricao));
        if (linhaQuitacaoInformativa) {
          await prisma.stagingLancamentoImportacao.update({
            where: { id: item.id },
            data: {
              statusProcessamento: 'IGNORADO',
              movimentoId: null,
              motivoDescarte: 'QUITACAO_INFORMATIVA_FATURA',
              observacao: item.observacao || 'Linha informativa de pagamento em fatura de cartão; não representa um novo movimento.',
            },
          });
          resultado.duplicadasIgnoradas += 1;
          importacaoEventBus.emitTransacaoConsolidada({
            loteId, arquivoId: item.arquivoId, arquivoOrigem: item.arquivoOrigem,
            usuarioId: lote.usuarioId, stagingId: item.id, movimentoId: 'informativo',
            dataMovimento: item.dataMovimento.toISOString().split('T')[0], descricao: item.descricao,
            valor: Number(item.valor), natureza: 'TRANSFERENCIA_PROPRIA', contaNome: contaInfo.nome,
            duplicadaIgnorada: true, timestamp: new Date(),
          });
          continue;
        }

        const dataMovimentoStr = item.dataMovimento.toISOString().split('T')[0];
        const competencia = dataMovimentoStr.substring(0, 7);
        const valorNum = Number(item.valor);
        const ocorrencia = ocorrenciaPorStaging.get(item.id) || 1;
        const faturaId = await garantirFatura(item, contaInfo.id);

        // 1. Chave Dedupe determinística estruturada (com idOrigem se disponível)
        const chaveDedupe = gerarChaveDedupe({
          contaId: contaInfo.id,
          dataMovimento: dataMovimentoStr,
          valor: valorNum,
          descricao: item.descricao,
          idOrigem: item.idOrigem,
          ocorrencia,
        });

        // Chave Dedupe alternativa sem idOrigem para cruzar extratos onde idOrigem não foi extraído
        const chaveDedupeSemId = gerarChaveDedupe({
          contaId: contaInfo.id,
          dataMovimento: dataMovimentoStr,
          valor: valorNum,
          descricao: item.descricao,
          ocorrencia,
        });

        // Duplicatas da página e do banco foram pré-carregadas em uma consulta.
        const movimentoExistente = movimentosDaPagina.get(chaveDedupe) || movimentosDaPagina.get(chaveDedupeSemId) ||
          (ocorrencia === 1 ? movimentosDaPagina.get(chaveTexto(contaInfo.id, item.dataMovimento, valorNum, item.descricao)) : undefined);

        if (movimentoExistente) {
          resultado.duplicadasIgnoradas++;

          // Atualiza staging para IGNORADO
          await prisma.stagingLancamentoImportacao.update({
            where: { id: item.id },
            data: {
              statusProcessamento: 'IGNORADO',
              movimentoId: movimentoExistente.id,
              motivoDescarte: 'DUPLICATA_CONSOLIDADA',
            },
          });
          if (inconsistenciaData) await registrarSuspeitaData(movimentoExistente.id, item, inconsistenciaData.dataOriginal, inconsistenciaData.periodo);

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

        // 2. Classificação posterior: pagamentos de fatura, PIX/TED próprio e
        // resgates permanecem como lançamentos oficiais para revisão posterior.
        let naturezaFinal = item.natureza;
        let isPagamentoFaturaConvertido = false;
        const isPagamentoFatura = descricaoIndicaPagamentoFatura(item.descricao);


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

        const isTransferenciaPropriaExplicita = descricaoIndicaTransferenciaPropria(item.descricao);

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
        } else if (isTransferenciaPropriaExplicita) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
        }

        // 3. Resolução de Categoria POF (Prioridade: Regra do Usuário por Vendedor > Inteligência Combinatória TASK-43 > Sugestão de Arquivo)
        let categoriaIdFinal: string | null = null;
        let categoriaFixadaAutomaticamente = false;

        const raizComerciante = extrairRaizComerciante(item.descricao);
        const favorecidoObservacao = extrairFavorecidoObservacao(item.observacao);

        if (regrasVendedorUsuario.length > 0) {
          const regraEncontrada = regrasVendedorUsuario.find((regra) => {
            if (raizComerciante && correspondemRegraVendedor(raizComerciante, regra.termoVendedor)) {
              return true;
            }
            if (favorecidoObservacao && correspondemRegraVendedor(favorecidoObservacao, regra.termoVendedor)) {
              return true;
            }
            if (correspondemRegraVendedor(item.descricao, regra.termoVendedor)) {
              return true;
            }
            return false;
          });

          if (regraEncontrada) {
            categoriaIdFinal = regraEncontrada.categoriaId;
            categoriaFixadaAutomaticamente = true;
            // Incrementa o contador de uso da regra
            await prisma.regraVendedorCategoria.update({
              where: { id: regraEncontrada.id },
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

          const categoriaCacheKey = (categoriaParaBuscar || '').trim().toLocaleLowerCase('pt-BR');
          if (cacheCategorias.has(categoriaCacheKey)) {
            categoriaIdFinal = cacheCategorias.get(categoriaCacheKey) || null;
          } else {
            categoriaIdFinal = await this.resolverCategoriaPof(lote.usuarioId, categoriaParaBuscar);
            cacheCategorias.set(categoriaCacheKey, categoriaIdFinal);
          }
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
          await prisma.$transaction(async (tx) => {
          if (movimentoPrevistoExistente) {
            novoMovimento = await tx.movimento.update({
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
                ...(faturaId ? { faturaId } : {}),
                dataCompra: item.dataMovimento,
                competenciaContabil: competencia,
                competenciaFatura: competencia,
              } as any,
            });
          } else {
            novoMovimento = await tx.movimento.create({
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
                ...(faturaId ? { faturaId } : {}),
                dataCompra: item.dataMovimento,
                competenciaContabil: competencia,
                competenciaFatura: competencia,
              } as any,
            });
          }
          await tx.stagingLancamentoImportacao.update({
            where: { id: item.id },
            data: { statusProcessamento: 'PROCESSADO', movimentoId: novoMovimento.id, motivoDescarte: null },
          });
          resultado.novosMovimentosInseridos++;
          movimentosDaPagina.set(chaveDedupe, novoMovimento);
          movimentosDaPagina.set(chaveDedupeSemId, novoMovimento);
          if (ocorrencia === 1) movimentosDaPagina.set(chaveTexto(contaInfo.id, item.dataMovimento, valorNum, item.descricao), novoMovimento);
          });
          if (inconsistenciaData) await registrarSuspeitaData(novoMovimento.id, item, inconsistenciaData.dataOriginal, inconsistenciaData.periodo);
        } catch (createErr: any) {
          if (createErr?.code === 'P2002') {
            // Concorrência interceptada pela constraint UNIQUE do banco
            resultado.duplicadasIgnoradas++;

            const movSalvo = await prisma.movimento.findFirst({
              where: { usuarioId: lote.usuarioId, chaveDedupe },
            });

            if (!movSalvo) {
              const motivo = 'Conflito de unicidade sem movimento consolidado correspondente.';
              await prisma.stagingLancamentoImportacao.update({
                where: { id: item.id },
                data: { statusProcessamento: 'ERRO', motivoDescarte: null },
              });
              resultado.erros.push({ stagingId: item.id, motivo });
              continue;
            }

            await prisma.stagingLancamentoImportacao.update({
              where: { id: item.id },
              data: {
                statusProcessamento: 'IGNORADO',
                movimentoId: movSalvo.id,
                motivoDescarte: 'DUPLICATA_CONSOLIDADA',
              },
            });
            if (inconsistenciaData) await registrarSuspeitaData(movSalvo.id, item, inconsistenciaData.dataOriginal, inconsistenciaData.periodo);

            importacaoEventBus.emitTransacaoConsolidada({
              loteId,
              arquivoId: item.arquivoId,
              arquivoOrigem: item.arquivoOrigem,
              usuarioId: lote.usuarioId,
              stagingId: item.id,
              movimentoId: movSalvo.id,
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
          data: { statusProcessamento: 'PROCESSADO', movimentoId: novoMovimento.id, motivoDescarte: null },
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
        await importacaoDiagnosticoService.registrar(item.arquivoId, 'ERRO_CONSOLIDACAO', motivo, { stagingId: item.id });

        await prisma.stagingLancamentoImportacao.update({
          where: { id: item.id },
          data: { statusProcessamento: 'ERRO' },
        });
      }
    }

    cursorStaging = stagingItens[stagingItens.length - 1]?.id;
    if (!cursorStaging) break;
    stagingItens = await prisma.stagingLancamentoImportacao.findMany({
      where: {
        loteId,
        statusProcessamento: 'PENDENTE',
        id: { gt: cursorStaging },
      },
      orderBy: { id: 'asc' },
      take: paginaStaging,
    });
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

      const whereArquivo = { arquivoId: item.arquivoId };
      const stagingsPendentes = await prisma.stagingLancamentoImportacao.count({
        where: { ...whereArquivo, statusProcessamento: 'PENDENTE' },
      });
      const stagingsComErro = await prisma.stagingLancamentoImportacao.count({
        where: { ...whereArquivo, statusProcessamento: 'ERRO' },
      });
      const totalStagings = await prisma.stagingLancamentoImportacao.count({ where: whereArquivo });
      const linhasInformativasIgnoradas = await prisma.stagingLancamentoImportacao.count({
        where: { ...whereArquivo, statusProcessamento: 'IGNORADO', OR: [
          { motivoDescarte: 'QUITACAO_INFORMATIVA_FATURA' },
          { motivoDescarte: 'DUPLICATA_CONSOLIDADA' },
          { observacao: { contains: 'linha informativa de pagamento em fatura de cartão', mode: 'insensitive' } },
        ] },
      });

      // O status PROCESSADO só é válido quando existe o movimento oficial
      // correspondente. Linhas recém-criadas são verificadas por contagem e
      // vínculo; só registros legados sem vínculo exigem busca por atributos.
      const ondeLegado = {
        ...whereArquivo,
        movimentoId: null,
        statusProcessamento: { in: [StatusStagingLancamento.PROCESSADO, StatusStagingLancamento.IGNORADO] },
      };
      let cursorLegado: string | undefined;
      let stagingsLegados = await prisma.stagingLancamentoImportacao.findMany({
        where: ondeLegado,
        select: { id: true, statusProcessamento: true, dataMovimento: true, valor: true, descricao: true, observacao: true, motivoDescarte: true },
        orderBy: { id: 'asc' },
        take: paginaStaging,
      });
      let stagingSemMovimento = 0;
      while (stagingsLegados.length > 0) {
        const candidatos = stagingsLegados.filter((staging) =>
          !(staging.statusProcessamento === 'IGNORADO' &&
            (Boolean(staging.motivoDescarte) || /linha informativa de pagamento em fatura de cartão/i.test(staging.observacao || '')))
        );
        const movimentosLegados = candidatos.length > 0 ? await prisma.movimento.findMany({
          where: { usuarioId: lote.usuarioId, OR: candidatos.map((staging) => ({
            dataMovimento: staging.dataMovimento,
            valor: Number(staging.valor),
            descricao: staging.descricao,
          })) },
          select: { dataMovimento: true, valor: true, descricao: true },
        }) : [];
        const chavesLegadas = new Set(movimentosLegados.map((movimento) =>
          JSON.stringify([movimento.dataMovimento.toISOString().slice(0, 10), Number(movimento.valor).toFixed(2), movimento.descricao])
        ));
        for (const staging of candidatos) {
          const chave = JSON.stringify([staging.dataMovimento.toISOString().slice(0, 10), Number(staging.valor).toFixed(2), staging.descricao]);
          if (!chavesLegadas.has(chave)) stagingSemMovimento++;
        }
        cursorLegado = stagingsLegados[stagingsLegados.length - 1]?.id;
        if (!cursorLegado) break;
        stagingsLegados = await prisma.stagingLancamentoImportacao.findMany({
          where: { ...ondeLegado, id: { gt: cursorLegado } },
          select: { id: true, statusProcessamento: true, dataMovimento: true, valor: true, descricao: true, observacao: true, motivoDescarte: true },
          orderBy: { id: 'asc' },
          take: paginaStaging,
        });
      }

      // Duplicatas válidas podem ser reconhecidas pela chave de deduplicação,
      // sem igualdade textual perfeita. Nesse caso, a contagem de movimentos
      // persistidos para a origem do arquivo é a evidência oficial do lote.
      const arquivoOrigem = await prisma.stagingLancamentoImportacao.findFirst({
        where: whereArquivo,
        select: { arquivoOrigem: true },
      });
      const movimentosDaOrigem = await prisma.movimento.count({
        where: {
          usuarioId: lote.usuarioId,
          origemDocumento: `IA_LOTE_${arquivoOrigem?.arquivoOrigem || ''}`,
        },
      });
      const linhasSemMovimentoEsperado = totalStagings - linhasInformativasIgnoradas;
      if (movimentosDaOrigem >= linhasSemMovimentoEsperado) stagingSemMovimento = 0;

      const falhaIntegridade = stagingsComErro > 0 || stagingsPendentes > 0 || stagingSemMovimento > 0;

      if (!falhaIntegridade && totalStagings > 0) {
        const arqAtual = await prisma.arquivoImportacao.findUnique({
          where: { id: item.arquivoId },
        });

        // Um arquivo em ERRO pode ser recuperado após reprocessamento idempotente.
        if (arqAtual && arqAtual.status !== 'PROCESSADO_FINAL') {
          await prisma.arquivoImportacao.update({
            where: { id: item.arquivoId },
            data: {
              status: 'PROCESSADO_FINAL',
              statusFinal: 'SUCESSO',
              mensagemErro: null,
              duracaoConsolidacaoMs: Math.max(0, Date.now() - inicioConsolidacaoLote),
              consolidacaoFinalizadaEm: new Date(),
            },
          });

          importacaoEventBus.emitArquivoProgresso({
            loteId,
            arquivoId: arqAtual.id,
            usuarioId: lote.usuarioId,
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
      } else if (falhaIntegridade) {
        await prisma.arquivoImportacao.update({
          where: { id: item.arquivoId },
          data: {
            status: 'ERRO',
            statusFinal: 'FALHA',
            mensagemErro: `Consolidação incompleta: ${stagingsComErro} erro(s), ${stagingsPendentes} pendente(s), ${stagingSemMovimento} lançamento(s) sem movimento oficial ou duplicata válida.`,
            duracaoConsolidacaoMs: Math.max(0, Date.now() - inicioConsolidacaoLote),
            consolidacaoFinalizadaEm: new Date(),
          },
        });
      } else {
        await prisma.arquivoImportacao.update({
          where: { id: item.arquivoId },
          data: { status: 'ERRO', statusFinal: 'FALHA', mensagemErro: 'Arquivo possui staging sem lançamentos consolidados.', duracaoConsolidacaoMs: Math.max(0, Date.now() - inicioConsolidacaoLote), consolidacaoFinalizadaEm: new Date() },
        });
      }
    }

    // BUG-30: os movimentos podem ser inseridos ou reconhecidos como duplicados
    // depois que a fatura foi criada. Recalcula a auditoria a partir da fonte
    // oficial (movimentos vinculados), sempre isolando usuário e fatura.
    const faturaIds = [...new Set(faturasPorArquivo.values())];
    for (const faturaId of faturaIds) {
      const fatura = await prisma.fatura.findFirst({
        where: { id: faturaId, usuarioId: lote.usuarioId },
        select: {
          id: true,
          valorTotalDocumento: true,
          quantidadeLancamentosDocumento: true,
        },
      });
      if (!fatura) continue;

      const agregacao = await prisma.movimento.aggregate({
        where: { usuarioId: lote.usuarioId, faturaId: fatura.id },
        _count: { _all: true },
        _sum: { valor: true },
      });
      const quantidade = agregacao._count._all;
      const valorTotal = Number(agregacao._sum.valor ?? 0);
      const quantidadeConfere = fatura.quantidadeLancamentosDocumento == null ||
        fatura.quantidadeLancamentosDocumento === quantidade;
      const valorConfere = fatura.valorTotalDocumento == null ||
        Math.abs(Number(fatura.valorTotalDocumento) - valorTotal) <= 0.01;

      await prisma.fatura.updateMany({
        where: { id: fatura.id, usuarioId: lote.usuarioId },
        data: {
          quantidadeLancamentosImportados: quantidade,
          valorTotalLancamentos: valorTotal,
          statusConciliacao: quantidadeConfere && valorConfere ? 'OK' : 'DIVERGENTE',
        },
      });
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
            OR: [
              { statusFinal: null },
              { statusFinal: { not: 'DUPLICADO' } },
            ],
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

      // O snapshot inclui staging, inventário e tentativas antes da remoção da pasta temporária.
      const arquivosParaArquivar = await prisma.arquivoImportacao.findMany({
        where: { loteId }, select: { id: true, status: true, statusFinal: true },
      });
      for (const arquivo of arquivosParaArquivar) {
        await importacaoDiagnosticoService.finalizarArquivo(arquivo.id, arquivo.statusFinal || arquivo.status);
      }

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
