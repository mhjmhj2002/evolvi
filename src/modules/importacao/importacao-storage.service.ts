import fs from 'fs/promises';
import path from 'path';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { importacaoEventBus } from '../../infrastructure/events/importacao-event-bus.js';
import {
  ImportacaoTentativasService,
  AlertaDuplicidadeArquivo,
  OrigemLote,
} from './importacao-tentativas.service.js';

export interface SalvarArquivoInput {
  nomeOriginal: string;
  buffer: Buffer;
  mimeType?: string;
}

export interface RecepcionarLoteInput {
  usuarioId: string;
  arquivos: SalvarArquivoInput[];
  provedorIa?: string;
  modeloIa?: string;
  /** TASK-50: força o reprocessamento mesmo quando o arquivo é apontado como duplicado. */
  forcarReprocessamento?: boolean;
  /** TASK-50: origem do lote (upload avulso ou pasta inteira). Inferida quando ausente. */
  origem?: OrigemLote;
}

export interface ArquivoRecepcionadoResponse {
  id: string;
  nomeArquivo: string;
  tamanhoBytes: number;
  mimeType: string | null;
  status: string;
  hashConteudo?: string | null;
  totalTentativas?: number;
  jaImportadoAnteriormente?: boolean;
  arquivoOriginalId?: string | null;
  statusFinal?: string | null;
}

export interface LoteCriadoResponse {
  loteId: string;
  status: string;
  origem: OrigemLote;
  iaSelecionada: string | null;
  caminhoDiretorio: string;
  totalArquivos: number;
  totalSucesso: number;
  totalFalha: number;
  totalDuplicados: number;
  totalLancamentos: number;
  arquivos: ArquivoRecepcionadoResponse[];
  /** TASK-50: alertas de duplicidade que exigem confirmação explícita do usuário. */
  alertasDuplicidade: AlertaDuplicidadeArquivo[];
  requerConfirmacaoReprocessamento: boolean;
}

export class ImportacaoStorageService {
  private baseUploadDir: string;

  constructor(baseUploadDir: string = env.UPLOADS_DIR) {
    this.baseUploadDir = baseUploadDir;
  }

  /**
   * Gera o padrão estrito de diretório temporário (uma subpasta por usuário):
   * {UPLOADS_DIR}/{usuarioId}/yyyy-mm-dd-hh-mm-ss-{usuarioId}/
   */
  public gerarCaminhoDiretorioLote(usuarioId: string, dataReferencia: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yyyy = dataReferencia.getFullYear();
    const mm = pad(dataReferencia.getMonth() + 1);
    const dd = pad(dataReferencia.getDate());
    const hh = pad(dataReferencia.getHours());
    const min = pad(dataReferencia.getMinutes());
    const ss = pad(dataReferencia.getSeconds());

    // Garante que o usuarioId seja um único segmento de path (sem barras nem '..')
    const usuarioSegmento = this.sanitizarSegmentoPath(usuarioId);
    const folderName = `${yyyy}-${mm}-${dd}-${hh}-${min}-${ss}-${usuarioSegmento}`;
    return path.join(this.baseUploadDir, usuarioSegmento, folderName);
  }

  /**
   * Reduz um valor a um único segmento seguro de path, removendo separadores,
   * referências a '..' e caracteres não alfanuméricos (usado para o usuarioId vindo do JWT).
   */
  private sanitizarSegmentoPath(valor: string): string {
    const limpo = (valor || '').replace(/[^a-zA-Z0-9_-]/g, '');
    return limpo === '' ? 'sem-usuario' : limpo;
  }

  /**
   * Sanitiza caminhos de subpastas (como em uploads de pastas inteiras via webkitdirectory)
   * prevenindo ataques de Path Traversal (ex: ../, caminhos absolutos).
   */
  public sanitizarCaminhoRelativo(caminhoOriginal: string): string {
    // Normaliza separadores de diretório e remove referências inseguras
    const normalizado = caminhoOriginal.replace(/\\/g, '/');
    const partes = normalizado
      .split('/')
      .filter((p) => p.trim() !== '' && p !== '.' && p !== '..');

    if (partes.length === 0) {
      return `arquivo_${Date.now()}`;
    }

    return partes.join(path.sep);
  }

  /** TASK-50: infere a origem do lote pela presença de caminhos de subpasta nos nomes. */
  public inferirOrigem(arquivos: SalvarArquivoInput[]): OrigemLote {
    const temSubpasta = arquivos.some((a) => {
      const nome = (a.nomeOriginal || '').replace(/\\/g, '/');
      return nome.includes('/');
    });
    return temSubpasta ? 'PASTA' : 'UPLOAD';
  }

  /**
   * Recepciona lote de arquivos, grava em disco no diretório temporário
   * e persiste registros de lote e arquivos no PostgreSQL.
   *
   * TASK-50: calcula SHA-256 de cada arquivo e detecta duplicidade por
   * (usuarioId + nome) ou (usuarioId + hash), registrando a tentativa DUPLICADO.
   */
  public async recepcionarLote(input: RecepcionarLoteInput): Promise<LoteCriadoResponse> {
    const { usuarioId, arquivos } = input;
    const forcar = Boolean(input.forcarReprocessamento);

    if (!arquivos || arquivos.length === 0) {
      throw new Error('Nenhum arquivo enviado para importação.');
    }

    const agora = new Date();
    const caminhoDiretorio = this.gerarCaminhoDiretorioLote(usuarioId, agora);
    const caminhoAbsolutoDiretorio = path.resolve(process.cwd(), caminhoDiretorio);

    // Cria o diretório temporário no disco de forma recursiva
    await fs.mkdir(caminhoAbsolutoDiretorio, { recursive: true });

    // Salva fisicamente cada arquivo no diretório temporário
    const arquivosSalvos: {
      nomeArquivo: string;
      caminhoRelativo: string;
      tamanhoBytes: number;
      mimeType: string | null;
      hashConteudo: string;
    }[] = [];

    for (const arq of arquivos) {
      const caminhoRelativo = this.sanitizarCaminhoRelativo(arq.nomeOriginal);
      const caminhoFisicoArquivo = path.join(caminhoAbsolutoDiretorio, caminhoRelativo);

      // Garante que subpastas (se houver no caminho relativo) sejam criadas
      const subpasta = path.dirname(caminhoFisicoArquivo);
      await fs.mkdir(subpasta, { recursive: true });

      // Grava o arquivo físico
      await fs.writeFile(caminhoFisicoArquivo, arq.buffer);

      arquivosSalvos.push({
        nomeArquivo: path.basename(caminhoRelativo),
        caminhoRelativo,
        tamanhoBytes: arq.buffer.length,
        mimeType: arq.mimeType || 'application/octet-stream',
        hashConteudo: ImportacaoTentativasService.calcularHashConteudo(arq.buffer),
      });
    }

    const origem: OrigemLote = input.origem || this.inferirOrigem(arquivos);
    const iaSelecionada = input.modeloIa || input.provedorIa || null;

    // Persiste Lote e Arquivos atômica e transacionalmente no PostgreSQL
    const lote = await prisma.$transaction(async (tx) => {
      const novoLote = await tx.loteImportacao.create({
        data: {
          usuarioId,
          caminhoDiretorio,
          origem,
          iaSelecionada,
          totalArquivos: arquivosSalvos.length,
          arquivosProcessados: 0,
          status: 'RECEPCIONADO',
          iniciadoEm: agora,
        },
      });

      const arquivosCriados: any[] = [];
      const alertasDuplicidade: AlertaDuplicidadeArquivo[] = [];

      for (const arq of arquivosSalvos) {
        // Detecção de duplicidade restrita ao mesmo usuarioId (multi-tenant).
        // Arquivos reenvios nunca servem de referência, evitando cadeias.
        const { duplicado, motivos, ocorrencias } =
          await ImportacaoTentativasService.detectarDuplicidade({
            usuarioId,
            nomeArquivo: arq.nomeArquivo,
            hashConteudo: arq.hashConteudo,
            db: tx,
          });

        const arquivoOriginalId = duplicado ? ocorrencias[0].id : null;

        const arqCriado = await tx.arquivoImportacao.create({
          data: {
            loteId: novoLote.id,
            usuarioId,
            nomeArquivo: arq.nomeArquivo,
            caminhoRelativo: arq.caminhoRelativo,
            tamanhoBytes: BigInt(arq.tamanhoBytes),
            mimeType: arq.mimeType,
            status: 'RECEPCIONADO',
            hashConteudo: arq.hashConteudo,
            // Com forçar reprocessamento o arquivo segue para o pipeline normal
            jaImportadoAnteriormente: duplicado && !forcar,
            arquivoOriginalId,
            statusFinal: duplicado && !forcar ? 'DUPLICADO' : null,
            // A tentativa DUPLICADO é registrada logo abaixo com numeroTentativa 1
            totalTentativas: duplicado ? 1 : 0,
            ultimoProvedor: null,
          },
        });

        if (duplicado) {
          const detalheMotivos = motivos
            .map((m) => (m === 'MESMO_NOME' ? 'mesmo nome de arquivo' : 'mesmo conteúdo (SHA-256)'))
            .join(' e ');

          await tx.tentativaArquivoImportacao.create({
            data: {
              usuarioId,
              arquivoId: arqCriado.id,
              numeroTentativa: 1,
              provedor: 'DETECCAO_DUPLICIDADE',
              modelo: 'sha256',
              status: 'DUPLICADO',
              mensagemErro: `Arquivo já importado anteriormente pelo usuário: ${detalheMotivos}.${
                forcar ? ' Reprocessamento confirmado pelo usuário.' : ''
              }`,
              totalTransacoesExtraidas: 0,
              duracaoMs: 0,
            },
          });

          alertasDuplicidade.push({
            arquivoId: arqCriado.id,
            nomeArquivo: arq.nomeArquivo,
            jaImportadoAnteriormente: duplicado && !forcar,
            motivos,
            arquivoOriginalId,
            ocorrencias,
          });
        }

        arquivosCriados.push(arqCriado);
      }

      const contadores = await ImportacaoTentativasService.recalcularContadoresLote(
        novoLote.id,
        tx as any
      );

      return {
        ...novoLote,
        ...contadores,
        arquivos: arquivosCriados,
        alertasDuplicidade,
      };
    });

    // Emite evento no barramento assíncrono para os workers
    importacaoEventBus.emitLoteRecepcionado({
      loteId: lote.id,
      usuarioId,
      totalArquivos: lote.totalArquivos,
      caminhoDiretorio: lote.caminhoDiretorio,
      recepcionadoEm: lote.criadoEm,
      provedorIa: input.provedorIa,
      modeloIa: input.modeloIa,
    });

    return {
      loteId: lote.id,
      status: lote.status,
      origem: lote.origem as OrigemLote,
      iaSelecionada: lote.iaSelecionada,
      caminhoDiretorio: lote.caminhoDiretorio,
      totalArquivos: lote.totalArquivos,
      totalSucesso: lote.totalSucesso,
      totalFalha: lote.totalFalha,
      totalDuplicados: lote.totalDuplicados,
      totalLancamentos: lote.totalLancamentos,
      arquivos: lote.arquivos.map((a: any) => this.formatarArquivoRecepcionado(a)),
      alertasDuplicidade: lote.alertasDuplicidade,
      requerConfirmacaoReprocessamento: lote.alertasDuplicidade.some(
        (a: AlertaDuplicidadeArquivo) => a.jaImportadoAnteriormente
      ),
    };
  }

  private formatarArquivoRecepcionado(a: any): ArquivoRecepcionadoResponse {
    return {
      id: a.id,
      nomeArquivo: a.nomeArquivo,
      tamanhoBytes: Number(a.tamanhoBytes),
      mimeType: a.mimeType,
      status: a.status,
      hashConteudo: a.hashConteudo,
      totalTentativas: a.totalTentativas,
      jaImportadoAnteriormente: a.jaImportadoAnteriormente,
      arquivoOriginalId: a.arquivoOriginalId,
      statusFinal: a.statusFinal,
    };
  }

  /**
   * Consulta os detalhes de um lote garantindo estrito isolamento multi-tenant.
   */
  public async obterLotePorId(loteId: string, usuarioId: string) {
    const lote = await prisma.loteImportacao.findFirst({
      where: {
        id: loteId,
        usuarioId,
      },
      include: {
        arquivos: {
          orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!lote) {
      return null;
    }

    // Buscar contadores de staging agrupados por arquivo
    const stagingStats = await prisma.stagingLancamentoImportacao.groupBy({
      by: ['arquivoId', 'statusProcessamento'],
      where: {
        loteId,
      },
      _count: {
        _all: true,
      },
    });

    const statsMap = new Map<
      string,
      { totalLinhas: number; pendente: number; processado: number; ignorado: number; erro: number }
    >();

    for (const stat of stagingStats) {
      if (!stat.arquivoId) continue;
      const current = statsMap.get(stat.arquivoId) || {
        totalLinhas: 0,
        pendente: 0,
        processado: 0,
        ignorado: 0,
        erro: 0,
      };
      const count = stat._count._all;
      current.totalLinhas += count;
      if (stat.statusProcessamento === 'PENDENTE') current.pendente += count;
      else if (stat.statusProcessamento === 'PROCESSADO') current.processado += count;
      else if (stat.statusProcessamento === 'IGNORADO') current.ignorado += count;
      else if (stat.statusProcessamento === 'ERRO') current.erro += count;
      statsMap.set(stat.arquivoId, current);
    }

    // TASK-50: total consolidado de tentativas do lote (soma de arquivos.totalTentativas)
    const totalTentativasLote = lote.arquivos.reduce((acc, a) => acc + (a.totalTentativas ?? 0), 0);

    const arquivosFormatados = lote.arquivos.map((a) => {
      const stats = statsMap.get(a.id) || {
        totalLinhas: 0,
        pendente: 0,
        processado: 0,
        ignorado: 0,
        erro: 0,
      };
      return {
        id: a.id,
        loteId: a.loteId,
        nomeArquivo: a.nomeArquivo,
        caminhoRelativo: a.caminhoRelativo,
        tamanhoBytes: Number(a.tamanhoBytes),
        mimeType: a.mimeType,
        status: a.status,
        mensagemErro: a.mensagemErro,
        hashConteudo: a.hashConteudo,
        totalTentativas: a.totalTentativas,
        statusFinal: a.statusFinal,
        jaImportadoAnteriormente: a.jaImportadoAnteriormente,
        arquivoOriginalId: a.arquivoOriginalId,
        ultimoProvedor: a.ultimoProvedor,
        criadoEm: a.criadoEm,
        atualizadoEm: a.atualizadoEm,
        stagingStats: stats,
      };
    });

    // Cálculos consolidados para as 4 etapas
    const totalArquivos = lote.totalArquivos;
    const arquivosIaConcluidos = arquivosFormatados.filter((a) =>
      ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(a.status)
    ).length;
    const arquivosStagingCarregados = arquivosFormatados.filter((a) =>
      ['STAGING_CARREGADO', 'PROCESSADO_FINAL'].includes(a.status)
    ).length;
    const arquivosConsolidados = arquivosFormatados.filter(
      (a) => a.status === 'PROCESSADO_FINAL'
    ).length;

    const totalLinhasStaging = Array.from(statsMap.values()).reduce(
      (acc, s) => acc + s.totalLinhas,
      0
    );
    const linhasConsolidadas = Array.from(statsMap.values()).reduce(
      (acc, s) => acc + s.processado + s.ignorado,
      0
    );

    return {
      id: lote.id,
      usuarioId: lote.usuarioId,
      caminhoDiretorio: lote.caminhoDiretorio,
      origem: lote.origem,
      iaSelecionada: lote.iaSelecionada,
      totalArquivos: lote.totalArquivos,
      totalSucesso: lote.totalSucesso,
      totalFalha: lote.totalFalha,
      totalDuplicados: lote.totalDuplicados,
      totalLancamentos: lote.totalLancamentos,
      arquivosProcessados: lote.arquivosProcessados,
      status: lote.status,
      iniciadoEm: lote.iniciadoEm,
      finalizadoEm: lote.finalizadoEm,
      criadoEm: lote.criadoEm,
      atualizadoEm: lote.atualizadoEm,
      totalTentativas: totalTentativasLote,
      metricasProgresso: {
        upload: {
          concluido: totalArquivos,
          total: totalArquivos,
          porcentagem: 100,
        },
        ia: {
          concluido: arquivosIaConcluidos,
          total: totalArquivos,
          porcentagem: totalArquivos > 0 ? Math.round((arquivosIaConcluidos / totalArquivos) * 100) : 0,
        },
        staging: {
          concluido: arquivosStagingCarregados,
          total: totalArquivos,
          porcentagem: totalArquivos > 0 ? Math.round((arquivosStagingCarregados / totalArquivos) * 100) : 0,
          totalLinhas: totalLinhasStaging,
        },
        consolidacao: {
          concluido: arquivosConsolidados,
          total: totalArquivos,
          porcentagem: totalArquivos > 0 ? Math.round((arquivosConsolidados / totalArquivos) * 100) : 0,
          linhasConsolidadas,
          totalLinhas: totalLinhasStaging,
        },
      },
      arquivos: arquivosFormatados,
    };
  }

  /**
   * Lista lotes do usuário autenticado com paginação e filtro opcional por status.
   */
  public async listarLotesUsuario(
    usuarioId: string,
    options?: { status?: string; limite?: number }
  ) {
    const where: any = { usuarioId };
    if (options?.status) {
      where.status = options.status;
    }

    const lotes = await prisma.loteImportacao.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: options?.limite ?? 20,
      include: {
        arquivos: {
          orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            nomeArquivo: true,
            status: true,
            tamanhoBytes: true,
            totalTentativas: true,
            jaImportadoAnteriormente: true,
          },
        },
      },
    });

    return lotes.map((lote) => ({
      id: lote.id,
      caminhoDiretorio: lote.caminhoDiretorio,
      origem: lote.origem,
      iaSelecionada: lote.iaSelecionada,
      totalArquivos: lote.totalArquivos,
      totalSucesso: lote.totalSucesso,
      totalFalha: lote.totalFalha,
      totalDuplicados: lote.totalDuplicados,
      totalLancamentos: lote.totalLancamentos,
      arquivosProcessados: lote.arquivosProcessados,
      status: lote.status,
      iniciadoEm: lote.iniciadoEm,
      finalizadoEm: lote.finalizadoEm,
      criadoEm: lote.criadoEm,
      atualizadoEm: lote.atualizadoEm,
      arquivos: lote.arquivos.map((a) => ({
        id: a.id,
        nomeArquivo: a.nomeArquivo,
        status: a.status,
        tamanhoBytes: Number(a.tamanhoBytes),
        totalTentativas: a.totalTentativas,
        jaImportadoAnteriormente: a.jaImportadoAnteriormente,
      })),
    }));
  }

  /**
   * Exclui um arquivo de importação individual (por exemplo, com erro de leitura ou incompatível),
   * removendo seus dados vinculados em staging e apagando os arquivos físicos (original e consolidado).
   * Recalcula os contadores e status do lote pai.
   */
  public async excluirArquivoImportacao(arquivoId: string, usuarioId: string) {
    const arquivo = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoId },
      include: {
        lote: true,
      },
    });

    if (!arquivo) {
      throw new Error(`Arquivo de importação [${arquivoId}] não encontrado.`);
    }

    if (arquivo.lote.usuarioId !== usuarioId) {
      throw new Error(`Acesso negado: o arquivo ${arquivoId} não pertence ao usuário.`);
    }

    // 1. Remover arquivos físicos no disco (arquivo original e consolidado se existir)
    if (arquivo.lote.caminhoDiretorio) {
      const pastaLote = path.resolve(process.cwd(), arquivo.lote.caminhoDiretorio);
      if (arquivo.caminhoRelativo) {
        const caminhoFisicoOriginal = path.resolve(pastaLote, arquivo.caminhoRelativo);
        try {
          await fs.unlink(caminhoFisicoOriginal);
        } catch {
          // Arquivo pode já ter sido excluído ou não existir fisicamente
        }
      }

      const caminhoConsolidado = path.resolve(pastaLote, `consolidado_${arquivo.id}.json`);
      try {
        await fs.unlink(caminhoConsolidado);
      } catch {
        // Ignora caso não exista
      }
    }

    const loteId = arquivo.loteId;

    // 2. Exclusão no banco de dados e recálculo das métricas do lote
    await prisma.$transaction(async (tx) => {
      // 2.1 Remove registros em staging vinculados ao arquivo
      await tx.stagingLancamentoImportacao.deleteMany({
        where: { arquivoId },
      });

      // 2.2 Remove o histórico de tentativas do arquivo (TASK-50)
      await tx.tentativaArquivoImportacao.deleteMany({
        where: { arquivoId },
      });

      // 2.3 Remove o registro do arquivo de importação
      await tx.arquivoImportacao.delete({
        where: { id: arquivoId },
      });

      // 2.4 Recalcula totais do lote
      const totalRestante = await tx.arquivoImportacao.count({
        where: { loteId },
      });

      const processadosRestantes = await tx.arquivoImportacao.count({
        where: {
          loteId,
          status: { in: ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'] },
        },
      });

      const errosRestantes = await tx.arquivoImportacao.count({
        where: { loteId, status: 'ERRO' },
      });

      let novoStatusLote = arquivo.lote.status;
      if (totalRestante === 0) {
        novoStatusLote = 'CONCLUIDO';
      } else if (errosRestantes === 0 && (arquivo.lote.status === 'ERRO_PARCIAL' || arquivo.lote.status === 'ERRO_TOTAL')) {
        // Se não há mais erros no lote, reavalia
        if (processadosRestantes === totalRestante) {
          novoStatusLote = 'CONCLUIDO';
        } else {
          novoStatusLote = 'PROCESSANDO_IA';
        }
      }

      await tx.loteImportacao.update({
        where: { id: loteId },
        data: {
          totalArquivos: totalRestante,
          arquivosProcessados: processadosRestantes,
          status: novoStatusLote,
        },
      });

      await ImportacaoTentativasService.recalcularContadoresLote(loteId, tx as any);
    });

    return {
      sucesso: true,
      arquivoId,
      loteId,
      nomeArquivo: arquivo.nomeArquivo,
    };
  }
}
