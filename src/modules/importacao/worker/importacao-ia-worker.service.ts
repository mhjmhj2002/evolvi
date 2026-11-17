import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  importacaoEventBus,
  ImportacaoEventBus,
  ImportacaoLoteRecepcionadoEvent,
} from '../../../infrastructure/events/importacao-event-bus.js';
import { IIaExtratorClient, GeminiIaExtratorClient, InventarioDocumentoIa } from './ia-extrator.client.js';
import { ArquivoConsolidadoIa, arquivoConsolidadoIaSchema } from './ia-extrator.schema.js';
import { ImportacaoTentativasService } from '../importacao-tentativas.service.js';
import { inferirTipoDocumentoImportado } from '../classificacao-documento.util.js';
import { randomUUID } from 'node:crypto';
import { PdfTextExtractor } from '../../conector/parsers/pdf-text-extractor.js';
import { importacaoDiagnosticoService } from '../importacao-diagnostico.service.js';
import { classificarDocumentoWorker } from './classificador-documento-worker.js';


export interface ProcessamentoArquivoResultado {
  arquivoId: string;
  nomeArquivo: string;
  sucesso: boolean;
  totalTransacoes: number;
  caminhoConsolidado?: string;
  erro?: string;
  /** TASK-50: provedor de IA que efetivamente concluiu a extração. */
  provedorUtilizado?: string;
  modeloUtilizado?: string;
  /** TASK-50: total de tentativas acumuladas do arquivo após esta execução. */
  totalTentativas?: number;
}

/** TASK-50: alvo de uma execução de extração (provedor + modelo). */
export interface AlvoExtracaoIa {
  provedor: string;
  modelo?: string;
}

export interface ProcessamentoLoteIaResultado {
  loteId: string;
  totalArquivos: number;
  arquivosProcessadosComSucesso: number;
  arquivosComErro: number;
  resultados: ProcessamentoArquivoResultado[];
}

export class ImportacaoIaWorkerService {
  private isProcessing: boolean = false;
  private isListeningEvents: boolean = false;
  private extratorClient: IIaExtratorClient;
  private baseDir: string;

  private boundListener?: (event: ImportacaoLoteRecepcionadoEvent) => void;

  constructor(extratorClient?: IIaExtratorClient, baseDir: string = process.cwd(), autoListen: boolean = false) {
    this.extratorClient = extratorClient || new GeminiIaExtratorClient();
    this.baseDir = baseDir;
    if (autoListen) {
      this.setupEventListener();
    }
  }

  /**
   * Conecta o ouvinte orientado a eventos do barramento de importação.
   */
  public setupEventListener(): void {
    if (this.isListeningEvents) {
      return;
    }

    console.log('[evolvi-worker:importacao-ia] Inicializando ouvinte de lotes de importação...');

    this.boundListener = (event: ImportacaoLoteRecepcionadoEvent) => {
      console.log(`[evolvi-worker:importacao-ia] Lote [${event.loteId}] recebido (${event.totalArquivos} arquivos) para usuário [${event.usuarioId}]. Iniciando extração IA...`);
      // Processamento assíncrono desacoplado
      this.processarLote(event.loteId, {
        provedorIa: event.provedorIa,
        modeloIa: event.modeloIa,
      }).catch((err) => {
        console.error(`[evolvi-worker:importacao-ia] Erro ao processar lote ${event.loteId} via evento:`, err);
      });
    };

    importacaoEventBus.onLoteRecepcionado(this.boundListener);
    this.isListeningEvents = true;
  }

  public removeEventListener(): void {
    if (this.boundListener) {
      importacaoEventBus.removeListener(
        ImportacaoEventBus.EVENT_LOTE_RECEPCIONADO,
        this.boundListener
      );
      this.boundListener = undefined;
      this.isListeningEvents = false;
    }
  }

  /**
   * Processa todos os arquivos de um lote sequencialmente (1 arquivo por vez).
   */
  public async processarLote(
    loteId: string,
    opcoes?: { provedorIa?: string; modeloIa?: string }
  ): Promise<ProcessamentoLoteIaResultado> {
    const lote = await prisma.loteImportacao.findUnique({
      where: { id: loteId },
      include: {
        usuario: {
          select: { id: true, nome: true },
        },
      },
    });

    if (!lote) {
      throw new Error(`Lote ${loteId} não encontrado.`);
    }

    // Busca arquivos pendentes (status RECEPCIONADO ou ENVIADO_IA) ordenados por data de criação.
    // TASK-50: arquivos marcados como já importados anteriormente aguardam confirmação
    // explícita do usuário e não entram no pipeline.
    const arquivosPendentes = await prisma.arquivoImportacao.findMany({
      where: {
        loteId,
        status: { in: ['RECEPCIONADO', 'ENVIADO_IA'] },
        jaImportadoAnteriormente: false,
      },
      orderBy: { criadoEm: 'asc' },
    });

    if (arquivosPendentes.length === 0) {
      await ImportacaoTentativasService.recalcularContadoresLote(loteId);
      return {
        loteId,
        totalArquivos: 0,
        arquivosProcessadosComSucesso: 0,
        arquivosComErro: 0,
        resultados: [],
      };
    }

    // Atualiza status do lote para PROCESSANDO_IA
    await prisma.loteImportacao.update({
      where: { id: loteId },
      data: {
        status: 'PROCESSANDO_IA',
        iniciadoEm: lote.iniciadoEm ?? new Date(),
        iaSelecionada: opcoes?.modeloIa || opcoes?.provedorIa || lote.iaSelecionada,
      },
    });

    // Buscar contexto do usuário (contas cadastradas e categorias POF)
    const [contas, categorias] = await Promise.all([
      prisma.conta.findMany({
        where: { usuarioId: lote.usuarioId, ativo: true },
        select: { id: true, nome: true, tipo: true, numeroConta: true, agencia: true },
      }),
      prisma.categoria.findMany({
        where: {
          OR: [{ usuarioId: null }, { usuarioId: lote.usuarioId }],
        },
        select: { id: true, nome: true },
        orderBy: { ordem: 'asc' },
      }),
    ]);

    const dataReferencia = new Date().toISOString().split('T')[0];
    const contexto = {
      contas,
      categorias,
      dataReferencia,
      nomeTitular: lote.usuario?.nome || null,
    };

    // TASK-50: cadeia de provedores de IA (principal + fallbacks configurados do usuário)
    const alvos = await this.montarCadeiaProvedores({
      usuarioId: lote.usuarioId,
      provedorIa: opcoes?.provedorIa,
      modeloIa: opcoes?.modeloIa,
    });

    const resultados: ProcessamentoArquivoResultado[] = [];

    // PROCESSAMENTO SEQUENCIAL ESTRITO: 1 arquivo por vez
    for (const arquivo of arquivosPendentes) {
      const resultadoArquivo = await this.processarArquivoIndividual({
        lote,
        arquivo,
        contexto,
        provedorIa: opcoes?.provedorIa,
        modeloIa: opcoes?.modeloIa,
        alvos,
      });
      resultados.push(resultadoArquivo);

      // Atualiza progresso do lote contando todos os arquivos já concluídos com sucesso no lote
      const totalProcessadosNoLote = await prisma.arquivoImportacao.count({
        where: {
          loteId,
          status: { in: ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'] },
        },
      });
      await prisma.loteImportacao.updateMany({
        where: { id: loteId },
        data: {
          arquivosProcessados: totalProcessadosNoLote,
        },
      });

      // TASK-50: recalcula contadores agregados ao final de cada arquivo
      await ImportacaoTentativasService.recalcularContadoresLote(loteId);
    }

    // Avalia fechamento do lote em caso de falha catastrófica de todos os arquivos
    const erros = resultados.filter((r) => !r.sucesso).length;
    const sucessos = resultados.filter((r) => r.sucesso).length;

    if (erros > 0 && sucessos === 0) {
      await prisma.loteImportacao.updateMany({
        where: { id: loteId },
        data: {
          status: 'ERRO_TOTAL',
          finalizadoEm: new Date(),
        },
      });
    } else {
      // Verifica se ainda há algum arquivo pendente ativo para IA
      const restantesAtivos = await prisma.arquivoImportacao.count({
        where: {
          loteId,
          status: { in: ['RECEPCIONADO', 'ENVIADO_IA'] },
          jaImportadoAnteriormente: false,
        },
      });

      if (restantesAtivos === 0) {
        await prisma.loteImportacao.updateMany({
          where: { id: loteId },
          data: { finalizadoEm: new Date() },
        });
      }
    }

    await ImportacaoTentativasService.recalcularContadoresLote(loteId);

    return {
      loteId,
      totalArquivos: arquivosPendentes.length,
      arquivosProcessadosComSucesso: sucessos,
      arquivosComErro: erros,
      resultados,
    };
  }

  /**
   * TASK-50: monta a cadeia de execução de provedores de IA para o arquivo.
   *
   * - Quando um provedor é explicitamente solicitado pela tela, ele é o único alvo.
   * - Fallbacks só entram quando a seleção é automática (sem provedorIa explícito).
   */
  public async montarCadeiaProvedores(params: {
    usuarioId: string;
    provedorIa?: string;
    modeloIa?: string;
  }): Promise<AlvoExtracaoIa[]> {
    const { usuarioId, provedorIa, modeloIa } = params;

    // A escolha explícita do usuário é soberana: nunca executar outro provedor
    // em segundo plano, mesmo que existam configurações de fallback no perfil.
    if (provedorIa) {
      return [{ provedor: provedorIa, modelo: modeloIa }];
    }

    const configurados = await prisma.configuracaoIaUsuario.findMany({
      where: { usuarioId },
      select: { provedor: true, modelo: true },
      orderBy: { atualizadoEm: 'desc' },
    });

    const alvos: AlvoExtracaoIa[] = [];
    const jaAdicionados = new Set<string>();

    const adicionar = (provedor: string, modelo?: string | null) => {
      const chave = `${provedor}::${modelo || ''}`;
      if (jaAdicionados.has(chave) || jaAdicionados.has(`${provedor}::`)) return;
      if (!modelo && alvos.some((a) => a.provedor === provedor)) return;
      jaAdicionados.add(chave);
      alvos.push({ provedor, modelo: modelo || undefined });
    };

    if (configurados.length > 0) {
      adicionar(configurados[0].provedor, configurados[0].modelo);
    } else {
      adicionar('GEMINI', modeloIa);
    }

    for (const cfg of configurados) {
      if (!alvos.some((a) => a.provedor === cfg.provedor)) {
        adicionar(cfg.provedor, cfg.modelo);
      }
    }

    return alvos;
  }

  /**
   * Processa um arquivo individual do lote, chama o extrator de IA,
   * valida as transações extraídas, gera o arquivo consolidado físico no disco
   * e emite eventos em tempo real.
   */
  public async processarArquivoIndividual(params: {
    lote: { id: string; usuarioId: string; caminhoDiretorio: string };
    arquivo: {
      id: string;
      nomeArquivo: string;
      caminhoRelativo: string;
      mimeType: string | null;
    };
    contexto: {
      contas: { id: string; nome: string; tipo: string }[];
      categorias: { id: string; nome: string }[];
      dataReferencia: string;
      nomeTitular?: string | null;
    };
    provedorIa?: string;
    modeloIa?: string;
    /** TASK-50: cadeia de provedores a tentar (principal + fallbacks). */
    alvos?: AlvoExtracaoIa[];
  }): Promise<ProcessamentoArquivoResultado> {
    const { lote, arquivo, contexto, provedorIa, modeloIa } = params;
    const owner = randomUUID();
    const reservado = await prisma.$executeRaw`
      UPDATE arquivos_importacao
      SET worker_owner = ${owner}, worker_stage = 'IA',
          worker_lease_until = NOW() + INTERVAL '20 minutes', worker_attempts = worker_attempts + 1
      WHERE id = ${arquivo.id}::uuid
        AND EXISTS (SELECT 1 FROM lotes_importacao l WHERE l.id = arquivos_importacao.lote_id AND l.usuario_id = ${lote.usuarioId}::uuid)
        AND status IN ('RECEPCIONADO', 'ENVIADO_IA', 'ERRO')
        AND ja_importado_anteriormente = FALSE
        AND (worker_lease_until IS NULL OR worker_lease_until < NOW())
    `;
    if (reservado !== 1) {
      return { arquivoId: arquivo.id, nomeArquivo: arquivo.nomeArquivo, sucesso: false, totalTransacoes: 0, erro: 'Arquivo já reservado por outra execução.' };
    }
    const heartbeat = setInterval(() => {
      void prisma.$executeRaw`UPDATE arquivos_importacao SET worker_lease_until = NOW() + INTERVAL '20 minutes' WHERE id = ${arquivo.id}::uuid AND worker_owner = ${owner} AND EXISTS (SELECT 1 FROM lotes_importacao l WHERE l.id = arquivos_importacao.lote_id AND l.usuario_id = ${lote.usuarioId}::uuid)`
        .catch((err) => console.error('[evolvi-worker:importacao-ia] Falha ao renovar lease:', err));
    }, 60_000);

    try {
      // 1. Atualiza status para ENVIADO_IA
      await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: { status: 'ENVIADO_IA', mensagemErro: null, extracaoIniciadaEm: new Date(), extracaoFinalizadaEm: null },
      });

      importacaoEventBus.emitArquivoProgresso({
        loteId: lote.id,
        arquivoId: arquivo.id,
        usuarioId: lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'ENVIADO_IA',
        timestamp: new Date(),
      });

      // 2. Leitura física do arquivo do lote no disco
      const caminhoFisicoArquivo = path.resolve(
        this.baseDir,
        lote.caminhoDiretorio,
        arquivo.caminhoRelativo
      );
      const buffer = await fs.readFile(caminhoFisicoArquivo);
      const instituicoesConhecidas = await prisma.instituicaoFinanceira.findMany({
        where: { ativo: true }, select: { nomeOficial: true, nomeReduzido: true, aliases: true },
      }).catch(() => []);
      const classificacao = classificarDocumentoWorker({
        nomeArquivo: arquivo.nomeArquivo, conteudoBuffer: buffer, instituicoes: instituicoesConhecidas,
      });

      // TASK-55: cria a evidência antes da extração. Clientes legados recebem
      // um inventário provisório e ele é completado após a extração.
      let inventario: InventarioDocumentoIa = {
        paginasTotais: null, paginasComMovimentos: [], registrosPorPagina: [],
        quantidadeEsperada: null, somaAbsolutaEsperada: null,
        tipoDocumento: 'OUTRO', confianca: 0, observacoes: 'Inventário não disponível para o cliente de IA.',
      };
      if (this.extratorClient.inventariarDocumento) {
        try {
          inventario = await this.extratorClient.inventariarDocumento({
            nomeArquivo: arquivo.nomeArquivo, mimeType: arquivo.mimeType,
            conteudoBuffer: buffer, usuarioId: lote.usuarioId, provedorIa, modeloIa,
            contexto: { dataReferencia: contexto.dataReferencia, nomeTitular: contexto.nomeTitular },
            classificacao,
          });
        } catch (err) {
          // Persiste a tentativa de inventário também quando a chamada falha.
          // O status PENDENTE/confiança zero bloqueará qualquer consolidação.
          inventario.observacoes = `Falha ao inventariar o documento: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      inventario.observacoes = [
        inventario.observacoes,
        `Classificação do worker: ${classificacao.instituicao || 'instituição não identificada'} (${classificacao.origemInstituicao}); ${classificacao.tipoDocumento} (${classificacao.origemTipo}).`,
      ].filter(Boolean).join(' ');
      const inventarioPersistido = await prisma.inventarioIaArquivo.create({
        data: {
          usuarioId: lote.usuarioId, arquivoId: arquivo.id, provedor: (provedorIa || 'GEMINI').slice(0, 30),
          modelo: (modeloIa || 'desconhecido').slice(0, 80), paginasTotais: inventario.paginasTotais ?? 1,
          paginasComMovimentos: inventario.paginasComMovimentos || [], registrosPorPagina: inventario.registrosPorPagina,
          paginas: { create: Array.from({ length: inventario.paginasTotais ?? 1 }, (_, indice) => {
            const pagina = indice + 1;
            const expectativa = inventario.registrosPorPagina.find((item) => item.pagina === pagina)?.quantidade;
            return {
              usuario: { connect: { id: lote.usuarioId } }, pagina,
              possuiMovimentos: expectativa == null ? false : expectativa > 0,
              quantidadeEsperada: expectativa ?? null,
              divergencias: inventario.paginaAtribuicaoDisponivel === false || inventario.paginasSemTexto?.includes(pagina)
                ? { atribuicaoDePaginaIndisponivel: true }
                : undefined,
            };
          }) },
          quantidadeEsperada: inventario.quantidadeEsperada ?? null,
          dataInicial: inventario.dataInicial ? new Date(inventario.dataInicial) : null,
          dataFinal: inventario.dataFinal ? new Date(inventario.dataFinal) : null,
          somaAbsolutaEsperada: inventario.somaAbsolutaEsperada ?? null, tipoDocumento: inventario.tipoDocumento,
          confianca: inventario.confianca, observacoes: inventario.observacoes ?? null,
        },
      });

      // TASK-50: cadeia de execução — cada provedor tentado gera 1 tentativa própria.
      const alvos: AlvoExtracaoIa[] =
        params.alvos && params.alvos.length > 0
          ? params.alvos
          : [{ provedor: provedorIa || 'GEMINI', modelo: modeloIa }];

      let transacoesExtraidas: Awaited<ReturnType<IIaExtratorClient['extrairTransacoes']>> = [];
      let provedorUtilizado = alvos[0].provedor;
      let modeloUtilizado = alvos[0].modelo;
      let tentativaIaId: string | null = null;
      const errosPorProvedor: string[] = [];

      for (const alvo of alvos) {
        provedorUtilizado = alvo.provedor;
        modeloUtilizado = alvo.modelo;

        const inicioTentativa = Date.now();
        let usoIaLogId: string | null = null;
        let sucessoNaTentativa = false;
        let mensagemErroTentativa: string | null = null;
        let totalTransacoesTentativa = 0;

        try {
          // 3. Chamada de extração de IA (com provedor e chave segura do usuário no banco)
          transacoesExtraidas = await this.extratorClient.extrairTransacoes({
            nomeArquivo: arquivo.nomeArquivo,
            mimeType: arquivo.mimeType,
            conteudoBuffer: buffer,
            usuarioId: lote.usuarioId,
            provedorIa: alvo.provedor,
            modeloIa: alvo.modelo,
            // TASK-49: vincula o log de consumo de IA ao lote/arquivo de importação
            loteId: lote.id,
            arquivoId: arquivo.id,
            classificacao,
            // TASK-50: handoff explícito do id do log criado em uso_ia_logs
            aoRegistrarUsoIa: (logId) => {
              usoIaLogId = logId;
            },
            contexto,
          });

          sucessoNaTentativa = true;
          totalTransacoesTentativa = transacoesExtraidas?.length ?? 0;
        } catch (errTentativa: unknown) {
          mensagemErroTentativa = errTentativa instanceof Error ? errTentativa.message : String(errTentativa);
        }

        const duracaoMs = Date.now() - inicioTentativa;

        // Registra a tentativa (SUCESSO ou FALHA) e correlaciona o log de IA
        const tentativa = await ImportacaoTentativasService.registrarTentativa({
          usuarioId: lote.usuarioId,
          arquivoId: arquivo.id,
          provedor: alvo.provedor,
          modelo: alvo.modelo || 'desconhecido',
          status: sucessoNaTentativa ? 'SUCESSO' : 'FALHA',
          mensagemErro: mensagemErroTentativa,
          totalTransacoesExtraidas: totalTransacoesTentativa,
          duracaoMs,
          usoIaLogId,
        });
        tentativaIaId = tentativa.id;

        await ImportacaoTentativasService.correlacionarUsoIaLog({
          tentativaId: tentativa.id,
          usuarioId: lote.usuarioId,
          arquivoId: arquivo.id,
          usoIaLogIdExplicito: usoIaLogId,
        });

        await prisma.arquivoImportacao.update({
          where: { id: arquivo.id },
          data: { ultimoProvedor: alvo.provedor.slice(0, 30) },
        });

        if (sucessoNaTentativa) {
          break;
        }

        errosPorProvedor.push(`${alvo.provedor}: ${mensagemErroTentativa}`);
        transacoesExtraidas = [];
      }

      // Associa lançamentos ao segmento de origem e grava a contagem real em
      // todas as páginas, inclusive aquelas que não tiveram movimentos.
      const paginasTotais = inventarioPersistido.paginasTotais ?? 1;
      transacoesExtraidas = transacoesExtraidas.map((transacao) => ({
        ...transacao,
        paginaOrigem: transacao.paginaOrigem ?? (paginasTotais === 1 ? 1 : null),
      }));
      const paginasInvalidas = transacoesExtraidas.some((transacao) =>
        transacao.paginaOrigem == null || transacao.paginaOrigem < 1 || transacao.paginaOrigem > paginasTotais,
      );
      const origemDePaginaIndisponivel = inventario.paginaAtribuicaoDisponivel === false ||
        (inventario.paginasSemTexto?.length ?? 0) > 0;
      if (!paginasInvalidas && !origemDePaginaIndisponivel && errosPorProvedor.length === 0) {
        const quantidades = Array.from({ length: paginasTotais }, () => ({ quantidade: 0, somaAbsoluta: 0 }));
        for (const transacao of transacoesExtraidas) {
          const pagina = quantidades[transacao.paginaOrigem! - 1];
          pagina.quantidade += 1;
          pagina.somaAbsoluta += Math.abs(transacao.valor);
        }
        await prisma.$transaction(quantidades.map((contagem, indice) => prisma.inventarioIaPagina.updateMany({
          where: { inventarioId: inventarioPersistido.id, usuarioId: lote.usuarioId, pagina: indice + 1 },
          data: {
            quantidadeExtraida: contagem.quantidade,
            somaAbsolutaExtraida: contagem.somaAbsoluta,
            possuiMovimentos: contagem.quantidade > 0,
          },
        })));
        await prisma.inventarioIaArquivo.update({
          where: { id: inventarioPersistido.id },
          data: { paginasComMovimentos: quantidades.flatMap((item, indice) => item.quantidade ? [indice + 1] : []) },
        });
      }

      if (tentativaIaId) {
        await prisma.inventarioIaArquivo.update({
          where: { id: inventarioPersistido.id },
          data: { tentativaId: tentativaIaId, provedor: provedorUtilizado.slice(0, 30), modelo: (modeloUtilizado || 'desconhecido').slice(0, 80) },
        });
      }

      // 4. Validação e Reconhecimento de Documento Válido sem Movimentação (BUG-08)
      if (!transacoesExtraidas || transacoesExtraidas.length === 0) {
        // Verifica se é um documento financeiro legítimo sem movimentação (ex: CSV apenas com cabeçalho ou fatura zerada R$ 0,00)
        let isDocumentoVazioLegitimo = false;
        const ext = path.extname(arquivo.nomeArquivo).toLowerCase();

        if (ext === '.csv' || ext === '.ofx' || ext === '.json') {
          const texto = buffer.toString('utf-8').trim();
          const linhas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (linhas.length <= 1) {
            isDocumentoVazioLegitimo = true;
          }
        }

        if (ext === '.pdf') {
          const textoPdf = PdfTextExtractor.extrairTexto(buffer);
          if (
            textoPdf &&
            (/voc[eê]\s+n[aã]o\s+consumiu\s+nada/i.test(textoPdf) ||
              /total\s+(a\s+pagar|da\s+fatura)[\s\S]{0,50}r\$\s*0[,.]00/i.test(textoPdf) ||
              /n[aã]o\s+h[aá]\s+gastos\s+pendentes/i.test(textoPdf))
          ) {
            isDocumentoVazioLegitimo = true;
          }
        }

        if (isDocumentoVazioLegitimo) {
          if (errosPorProvedor.length > 0) throw new Error('Documento sem extração confirmada; não foi possível registrar a cobertura por página.');
          // Documento válido sem lançamentos no período (ex: fatura zerada ou mês sem movimentação)
          await prisma.arquivoImportacao.update({
            where: { id: arquivo.id },
            data: {
              status: 'PROCESSADO_FINAL',
              statusFinal: 'VAZIO',
              mensagemErro: null,
              extracaoFinalizadaEm: new Date(),
            },
          });

          importacaoEventBus.emitArquivoProgresso({
            loteId: lote.id,
            arquivoId: arquivo.id,
            usuarioId: lote.usuarioId,
            nomeArquivo: arquivo.nomeArquivo,
            status: 'PROCESSADO_FINAL',
            mensagem: 'Documento financeiro válido sem movimentação ou com total R$ 0,00 no período (CONCLUIDO_VAZIO).',
            timestamp: new Date(),
          });

          importacaoEventBus.emitArquivoConsolidadoFinal({
            loteId: lote.id,
            arquivoId: arquivo.id,
            usuarioId: lote.usuarioId,
            nomeArquivo: arquivo.nomeArquivo,
            timestamp: new Date(),
          });

          // Limpeza imediata do arquivo físico original (sem transações, já registrado no BD)
          try {
            await fs.unlink(caminhoFisicoArquivo);
          } catch {
            // Ignora se não existir
          }

          return {
            arquivoId: arquivo.id,
            nomeArquivo: arquivo.nomeArquivo,
            sucesso: true,
            totalTransacoes: 0,
            provedorUtilizado,
            modeloUtilizado,
          };
        }

        // Se algum provedor falhou, propaga a mensagem real da última falha
        if (errosPorProvedor.length > 0) {
          throw new Error(
            `A IA não conseguiu processar este documento. Tentativas: ${errosPorProvedor.join(' | ')}`
          );
        }

        throw new Error(
          `A IA não identificou transações válidas no documento "${arquivo.nomeArquivo}".`
        );
      }

      // Clientes antigos sem endpoint de inventário ainda deixam uma evidência
      // auditável coerente com a extração realizada.
      if (!this.extratorClient.inventariarDocumento) {
        await prisma.inventarioIaArquivo.update({ where: { id: inventarioPersistido.id }, data: {
          quantidadeEsperada: transacoesExtraidas.length,
          somaAbsolutaEsperada: transacoesExtraidas.reduce((s, t) => s + t.valor, 0),
          confianca: 1, status: 'CONFERENTE', observacoes: null,
          divergencias: { quantidade: { esperado: transacoesExtraidas.length, extraido: transacoesExtraidas.length } },
        }});
      }

      // Validação schema Zod
      const payloadConsolidado: ArquivoConsolidadoIa = {
        loteId: lote.id,
        arquivoId: arquivo.id,
        nomeArquivoOrigem: arquivo.nomeArquivo,
        totalTransacoes: transacoesExtraidas.length,
        geradoEm: new Date().toISOString(),
        metadados: {
          provedor: provedorUtilizado || provedorIa || 'GEMINI',
          modelo: modeloUtilizado || modeloIa || 'gemini-3.8-flash',
          tentativas: 1,
        },
        transacoes: transacoesExtraidas,
      };

      const validacao = arquivoConsolidadoIaSchema.safeParse(payloadConsolidado);
      if (!validacao.success) {
        throw new Error(
          `Formato de transações extraídas inválido: ${validacao.error.issues.map((i) => i.message).join(', ')}`
        );
      }

      // 5. Geração do Arquivo Físico Consolidado na pasta do lote
      // Padrão: consolidado_{arquivoId}.json
      const nomeConsolidado = `consolidado_${arquivo.id}.json`;
      const pastaLoteFisico = path.resolve(this.baseDir, lote.caminhoDiretorio);
      const caminhoFisicoConsolidado = path.resolve(
        pastaLoteFisico,
        nomeConsolidado
      );

      // Garante que o diretório físico do lote exista antes de salvar o JSON consolidado
      await fs.mkdir(pastaLoteFisico, { recursive: true });

      await fs.writeFile(
        caminhoFisicoConsolidado,
        JSON.stringify(validacao.data, null, 2),
        'utf-8'
      );
      await importacaoDiagnosticoService.copiarJson(arquivo.id, caminhoFisicoConsolidado);
      await importacaoDiagnosticoService.registrar(arquivo.id, 'EXTRACAO_IA', 'Extração concluída.', {
        transacoes: transacoesExtraidas.length, provedor: provedorUtilizado, modelo: modeloUtilizado,
      });

      // Classificação e metadados só podem vir da extração estruturada da IA;
      // nome do arquivo e regex sobre texto livre não são evidência de documento.
      const eFaturaCartao = inferirTipoDocumentoImportado(transacoesExtraidas) === 'FATURA_CARTAO';
      const faturaDataVencimento: Date | null = null;
      let faturaValorTotal: number | null = null;
      if (eFaturaCartao && transacoesExtraidas.length > 0) {
        const comprasEfetivas = transacoesExtraidas.filter((t) => !t.isPagamentoFatura);
        const totalLiquido = comprasEfetivas.reduce((acc, t) => {
          return t.natureza === 'RECEITA' ? acc - t.valor : acc + t.valor;
        }, 0);
        if (totalLiquido > 0) {
          faturaValorTotal = Number(totalLiquido.toFixed(2));
        }
      }

      // 6. Atualização de status no banco para IA_CONCLUIDO e salvamento de metadados da fatura (BUG-21)
      const arquivoAtualizado = await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: {
          status: 'IA_CONCLUIDO',
          extracaoFinalizadaEm: new Date(),
          // A extração foi concluída, mas ainda não houve persistência oficial.
          // SUCESSO só pode ser atribuído pelo worker de consolidação.
          statusFinal: null,
          mensagemErro: null,
          ultimoProvedor: (provedorUtilizado || 'GEMINI').slice(0, 30),
          eFaturaCartao,
          faturaDataVencimento,
          faturaValorTotal,
          faturaStatusValidacao: eFaturaCartao ? 'PENDENTE' : null,
        },
        select: { totalTentativas: true },
      });

      // 7. Notificações / Eventos de conclusão do arquivo
      importacaoEventBus.emitArquivoProgresso({
        loteId: lote.id,
        arquivoId: arquivo.id,
        usuarioId: lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'IA_CONCLUIDO',
        mensagem: `${transacoesExtraidas.length} transações extraídas e consolidadas com sucesso.`,
        timestamp: new Date(),
      });

      importacaoEventBus.emitArquivoConsolidadoPronto({
        loteId: lote.id,
        arquivoId: arquivo.id,
        usuarioId: lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        caminhoConsolidado: path.join(lote.caminhoDiretorio, nomeConsolidado),
        totalTransacoes: transacoesExtraidas.length,
        timestamp: new Date(),
      });

      return {
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: true,
        totalTransacoes: transacoesExtraidas.length,
        caminhoConsolidado: caminhoFisicoConsolidado,
        provedorUtilizado,
        modeloUtilizado,
        totalTentativas: arquivoAtualizado.totalTentativas,
      };
    } catch (err: unknown) {
      const mensagemErro = err instanceof Error ? err.message : String(err);

      // Registra erro no banco
      const arquivoComErro = await prisma.arquivoImportacao.update({
        where: { id: arquivo.id },
        data: {
          status: 'ERRO',
          statusFinal: 'FALHA',
          mensagemErro,
          extracaoFinalizadaEm: new Date(),
        },
        select: { totalTentativas: true },
      });
      await importacaoDiagnosticoService.registrar(arquivo.id, 'ERRO_EXTRACAO_IA', mensagemErro);
      await importacaoDiagnosticoService.finalizarArquivo(arquivo.id, 'ERRO');

      // TASK-50: garante ao menos uma tentativa FALHA registrada para o arquivo
      // (cobre falhas anteriores a qualquer chamada de IA — ex.: leitura do disco).
      if (arquivoComErro.totalTentativas === 0) {
        const tentativaFallback = await ImportacaoTentativasService.registrarTentativa({
          usuarioId: lote.usuarioId,
          arquivoId: arquivo.id,
          provedor: provedorIa || 'GEMINI',
          modelo: modeloIa || 'desconhecido',
          status: 'FALHA',
          mensagemErro,
          totalTransacoesExtraidas: 0,
          duracaoMs: 0,
        });
        await ImportacaoTentativasService.correlacionarUsoIaLog({
          tentativaId: tentativaFallback.id,
          usuarioId: lote.usuarioId,
          arquivoId: arquivo.id,
        });
      }

      importacaoEventBus.emitArquivoProgresso({
        loteId: lote.id,
        arquivoId: arquivo.id,
        usuarioId: lote.usuarioId,
        nomeArquivo: arquivo.nomeArquivo,
        status: 'ERRO',
        mensagem: mensagemErro,
        timestamp: new Date(),
      });

      return {
        arquivoId: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        sucesso: false,
        totalTransacoes: 0,
        erro: mensagemErro,
        totalTentativas: arquivoComErro.totalTentativas,
      };
    } finally {
      clearInterval(heartbeat);
      await prisma.$executeRaw`UPDATE arquivos_importacao SET worker_owner = NULL, worker_lease_until = NULL, worker_stage = NULL WHERE id = ${arquivo.id}::uuid AND worker_owner = ${owner} AND EXISTS (SELECT 1 FROM lotes_importacao l WHERE l.id = arquivos_importacao.lote_id AND l.usuario_id = ${lote.usuarioId}::uuid)`;
    }
  }

  /**
   * Reprocessa individualmente um arquivo com falha (status ERRO) usando a IA e modelo informados.
   * Não afeta o progresso dos demais arquivos já concluídos do lote.
   */
  public async reprocessarArquivoIndividualComIa(params: {
    arquivoId: string;
    usuarioId: string;
    provedorIa?: string;
    modeloIa?: string;
  }): Promise<ProcessamentoArquivoResultado> {
    const { arquivoId, usuarioId, provedorIa, modeloIa } = params;

    // Busca o arquivo garantindo posse do lote pelo usuário (segurança multi-tenant)
    const arquivo = await prisma.arquivoImportacao.findFirst({
      where: {
        id: arquivoId,
        lote: {
          usuarioId,
        },
      },
      include: {
        lote: {
          select: {
            id: true,
            usuarioId: true,
            caminhoDiretorio: true,
            status: true,
          },
        },
      },
    });

    if (!arquivo) {
      throw new Error(`Arquivo ${arquivoId} não encontrado ou não pertence ao usuário.`);
    }

    // Limpeza imediata de mensagem de erro anterior no reprocessamento
    await prisma.arquivoImportacao.update({
      where: { id: arquivoId },
      data: { mensagemErro: null },
    });

    // Busca contexto do usuário (contas cadastradas, categorias POF e perfil do usuário)
    const [usuario, contas, categorias] = await Promise.all([
      prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { id: true, nome: true },
      }),
      prisma.conta.findMany({
        where: { usuarioId, ativo: true },
        select: { id: true, nome: true, tipo: true },
      }),
      prisma.categoria.findMany({
        where: {
          OR: [{ usuarioId: null }, { usuarioId }],
        },
        select: { id: true, nome: true },
        orderBy: { ordem: 'asc' },
      }),
    ]);

    const dataReferencia = new Date().toISOString().split('T')[0];
    const contexto = {
      contas,
      categorias,
      dataReferencia,
      nomeTitular: usuario?.nome || null,
    };

    // Executa a extração para este arquivo individual
    const resultado = await this.processarArquivoIndividual({
      lote: arquivo.lote,
      arquivo: {
        id: arquivo.id,
        nomeArquivo: arquivo.nomeArquivo,
        caminhoRelativo: arquivo.caminhoRelativo,
        mimeType: arquivo.mimeType,
      },
      contexto,
      provedorIa,
      modeloIa,
    });

    // Se o arquivo teve sucesso, recalcula contadores e restaura status do lote se necessário
    if (resultado.sucesso) {
      const arquivosDoLote = await prisma.arquivoImportacao.findMany({
        where: { loteId: arquivo.lote.id },
        select: { status: true },
      });

      const concluidos = arquivosDoLote.filter((a) =>
        ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(a.status)
      ).length;

      const erros = arquivosDoLote.filter((a) => a.status === 'ERRO').length;

      // Se o lote estava em ERRO_TOTAL ou ERRO_PARCIAL e agora tem arquivos com sucesso:
      let novoStatusLote = arquivo.lote.status;
      if (arquivo.lote.status === 'ERRO_TOTAL') {
        novoStatusLote = 'PROCESSANDO_IA';
      } else if (arquivo.lote.status === 'ERRO_PARCIAL' && erros === 0) {
        novoStatusLote = 'PROCESSANDO_IA';
      }

      await prisma.loteImportacao.update({
        where: { id: arquivo.lote.id },
        data: {
          arquivosProcessados: concluidos,
          status: novoStatusLote,
        },
      });
    }

    // TASK-50: cada reprocessamento/troca de IA já gerou uma nova tentativa;
    // recalcula os contadores agregados do lote ao final.
    await ImportacaoTentativasService.recalcularContadoresLote(arquivo.lote.id);

    return resultado;
  }
}

export const importacaoIaWorkerService = new ImportacaoIaWorkerService();
