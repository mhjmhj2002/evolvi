import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../infrastructure/database/prisma.js';
import { importacaoEventBus } from '../../infrastructure/events/importacao-event-bus.js';

export interface SalvarArquivoInput {
  nomeOriginal: string;
  buffer: Buffer;
  mimeType?: string;
}

export interface RecepcionarLoteInput {
  usuarioId: string;
  arquivos: SalvarArquivoInput[];
}

export interface LoteCriadoResponse {
  loteId: string;
  status: string;
  caminhoDiretorio: string;
  totalArquivos: number;
  arquivos: {
    id: string;
    nomeArquivo: string;
    tamanhoBytes: number;
    mimeType: string | null;
    status: string;
  }[];
}

export class ImportacaoStorageService {
  private baseUploadDir: string;

  constructor(baseUploadDir: string = 'uploads') {
    this.baseUploadDir = baseUploadDir;
  }

  /**
   * Gera o padrão estrito de diretório temporário:
   * uploads/yyyy-mm-dd-hh-mm-ss-{usuarioId}/
   */
  public gerarCaminhoDiretorioLote(usuarioId: string, dataReferencia: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yyyy = dataReferencia.getFullYear();
    const mm = pad(dataReferencia.getMonth() + 1);
    const dd = pad(dataReferencia.getDate());
    const hh = pad(dataReferencia.getHours());
    const min = pad(dataReferencia.getMinutes());
    const ss = pad(dataReferencia.getSeconds());

    const folderName = `${yyyy}-${mm}-${dd}-${hh}-${min}-${ss}-${usuarioId}`;
    return path.join(this.baseUploadDir, folderName);
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

  /**
   * Recepciona lote de arquivos, grava em disco no diretório temporário
   * e persiste registros de lote e arquivos no PostgreSQL.
   */
  public async recepcionarLote(input: RecepcionarLoteInput): Promise<LoteCriadoResponse> {
    const { usuarioId, arquivos } = input;

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
      });
    }

    // Persiste Lote e Arquivos atômica e transacionalmente no PostgreSQL
    const lote = await prisma.$transaction(async (tx) => {
      const novoLote = await tx.loteImportacao.create({
        data: {
          usuarioId,
          caminhoDiretorio,
          totalArquivos: arquivosSalvos.length,
          arquivosProcessados: 0,
          status: 'RECEPCIONADO',
        },
      });

      const arquivosCriados = [];
      for (const arq of arquivosSalvos) {
        const arqCriado = await tx.arquivoImportacao.create({
          data: {
            loteId: novoLote.id,
            nomeArquivo: arq.nomeArquivo,
            caminhoRelativo: arq.caminhoRelativo,
            tamanhoBytes: BigInt(arq.tamanhoBytes),
            mimeType: arq.mimeType,
            status: 'RECEPCIONADO',
          },
        });
        arquivosCriados.push(arqCriado);
      }

      return {
        ...novoLote,
        arquivos: arquivosCriados,
      };
    });

    // Emite evento no barramento assíncrono para os workers
    importacaoEventBus.emitLoteRecepcionado({
      loteId: lote.id,
      usuarioId,
      totalArquivos: lote.totalArquivos,
      caminhoDiretorio: lote.caminhoDiretorio,
      recepcionadoEm: lote.criadoEm,
    });

    return {
      loteId: lote.id,
      status: lote.status,
      caminhoDiretorio: lote.caminhoDiretorio,
      totalArquivos: lote.totalArquivos,
      arquivos: lote.arquivos.map((a) => ({
        id: a.id,
        nomeArquivo: a.nomeArquivo,
        tamanhoBytes: Number(a.tamanhoBytes),
        mimeType: a.mimeType,
        status: a.status,
      })),
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
          orderBy: { criadoEm: 'asc' },
        },
      },
    });

    if (!lote) {
      return null;
    }

    return {
      id: lote.id,
      usuarioId: lote.usuarioId,
      caminhoDiretorio: lote.caminhoDiretorio,
      totalArquivos: lote.totalArquivos,
      arquivosProcessados: lote.arquivosProcessados,
      status: lote.status,
      criadoEm: lote.criadoEm,
      atualizadoEm: lote.atualizadoEm,
      arquivos: lote.arquivos.map((a) => ({
        id: a.id,
        loteId: a.loteId,
        nomeArquivo: a.nomeArquivo,
        caminhoRelativo: a.caminhoRelativo,
        tamanhoBytes: Number(a.tamanhoBytes),
        mimeType: a.mimeType,
        status: a.status,
        mensagemErro: a.mensagemErro,
        criadoEm: a.criadoEm,
        atualizadoEm: a.atualizadoEm,
      })),
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
          select: {
            id: true,
            nomeArquivo: true,
            status: true,
            tamanhoBytes: true,
          },
        },
      },
    });

    return lotes.map((lote) => ({
      id: lote.id,
      caminhoDiretorio: lote.caminhoDiretorio,
      totalArquivos: lote.totalArquivos,
      arquivosProcessados: lote.arquivosProcessados,
      status: lote.status,
      criadoEm: lote.criadoEm,
      atualizadoEm: lote.atualizadoEm,
      arquivos: lote.arquivos.map((a) => ({
        id: a.id,
        nomeArquivo: a.nomeArquivo,
        status: a.status,
        tamanhoBytes: Number(a.tamanhoBytes),
      })),
    }));
  }
}
