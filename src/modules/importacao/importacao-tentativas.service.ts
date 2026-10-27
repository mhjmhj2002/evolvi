import crypto from 'crypto';
import { prisma } from '../../infrastructure/database/prisma.js';

/**
 * TASK-50 — Gestão de Importação: Lote → Arquivo → Detalhe.
 *
 * Serviço responsável por:
 *  - calcular hash SHA-256 do conteúdo de um arquivo recebido;
 *  - detectar duplicidade (mesmo `usuarioId` + mesmo nome OU mesmo hash);
 *  - registrar o histórico imutável de tentativas (`tentativas_arquivo_importacao`);
 *  - recalcular os contadores agregados do lote (arquivos/sucesso/falha/duplicados/lançamentos).
 */

export type StatusTentativa = 'SUCESSO' | 'FALHA' | 'DUPLICADO';
export type MotivoDuplicidade = 'MESMO_NOME' | 'MESMO_HASH';
export type OrigemLote = 'UPLOAD' | 'PASTA';

export interface AlertaDuplicidadeArquivo {
  arquivoId: string;
  nomeArquivo: string;
  jaImportadoAnteriormente: boolean;
  motivos: MotivoDuplicidade[];
  arquivoOriginalId: string | null;
  ocorrencias: {
    id: string;
    nomeArquivo: string;
    loteId: string;
    criadoEm: Date;
    mesmoNome: boolean;
    mesmoHash: boolean;
  }[];
}

export interface RegistrarTentativaInput {
  usuarioId: string;
  arquivoId: string;
  provedor: string;
  modelo: string;
  status: StatusTentativa;
  mensagemErro?: string | null;
  totalTransacoesExtraidas?: number;
  duracaoMs?: number;
  usoIaLogId?: string | null;
}

export class ImportacaoTentativasService {
  /** Calcula o hash SHA-256 (hex) do conteúdo binário de um arquivo. */
  public static calcularHashConteudo(conteudo: Buffer | string): string {
    return crypto
      .createHash('sha256')
      .update(typeof conteudo === 'string' ? Buffer.from(conteudo, 'utf-8') : conteudo)
      .digest('hex');
  }

  /**
   * Detecta se o arquivo recebido já foi importado anteriormente pelo MESMO usuário.
   * Regra: mesmo `nomeArquivo` OU mesmo `hashConteudo` em qualquer lote anterior do usuário.
   * Arquivos que já são reenvios (flag `jaImportadoAnteriormente`) nunca servem de referência,
   * evitando cadeias de duplicidade.
   */
  /**
   * Calcula motivos e ocorrências a partir de candidatos já carregados do banco.
   * Função pura, compartilhada entre a recepção (upload) e a verificação avulsa.
   */
  public static avaliarCandidatos(params: {
    nomeArquivo: string;
    hashConteudo: string;
    candidatos: {
      id: string;
      nomeArquivo: string;
      loteId: string;
      hashConteudo: string | null;
      criadoEm: Date;
    }[];
  }): {
    duplicado: boolean;
    motivos: MotivoDuplicidade[];
    ocorrencias: AlertaDuplicidadeArquivo['ocorrencias'];
  } {
    const { nomeArquivo, hashConteudo, candidatos } = params;

    const ocorrencias = candidatos.map((c) => ({
      id: c.id,
      nomeArquivo: c.nomeArquivo,
      loteId: c.loteId,
      criadoEm: c.criadoEm,
      mesmoNome: c.nomeArquivo === nomeArquivo,
      mesmoHash: Boolean(hashConteudo) && c.hashConteudo === hashConteudo,
    }));

    const motivos: MotivoDuplicidade[] = [];
    if (ocorrencias.some((o) => o.mesmoNome)) motivos.push('MESMO_NOME');
    if (ocorrencias.some((o) => o.mesmoHash)) motivos.push('MESMO_HASH');

    return { duplicado: motivos.length > 0, motivos, ocorrencias };
  }

  public static async detectarDuplicidade(params: {
    usuarioId: string;
    nomeArquivo: string;
    hashConteudo: string;
    ignorarArquivoIds?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db?: any;
  }): Promise<{
    duplicado: boolean;
    motivos: MotivoDuplicidade[];
    ocorrencias: AlertaDuplicidadeArquivo['ocorrencias'];
  }> {
    const { usuarioId, nomeArquivo, hashConteudo } = params;
    const ignorar = params.ignorarArquivoIds ?? [];
    const db = params.db ?? prisma;

    const candidatos = await db.arquivoImportacao.findMany({
      where: {
        usuarioId,
        jaImportadoAnteriormente: false,
        id: ignorar.length > 0 ? { notIn: ignorar } : undefined,
        OR: [{ nomeArquivo }, { hashConteudo }],
      },
      select: {
        id: true,
        nomeArquivo: true,
        loteId: true,
        hashConteudo: true,
        criadoEm: true,
      },
      orderBy: { criadoEm: 'asc' },
      take: 20,
    });

    return ImportacaoTentativasService.avaliarCandidatos({
      nomeArquivo,
      hashConteudo,
      candidatos,
    });
  }

  /**
   * Registra uma nova tentativa (execução) para o arquivo.
   * O `numeroTentativa` é derivado de um incremento atômico em `arquivos_importacao.total_tentativas`,
   * garantindo sequência por arquivo mesmo com execuções concorrentes.
   */
  public static async registrarTentativa(input: RegistrarTentativaInput) {
    const arquivo = await prisma.arquivoImportacao.update({
      where: { id: input.arquivoId },
      data: { totalTentativas: { increment: 1 } },
      select: { id: true, totalTentativas: true, loteId: true, usuarioId: true },
    });

    const tentativa = await prisma.tentativaArquivoImportacao.create({
      data: {
        usuarioId: input.usuarioId,
        arquivoId: input.arquivoId,
        numeroTentativa: arquivo.totalTentativas,
        provedor: (input.provedor || 'DESCONHECIDO').slice(0, 30),
        modelo: (input.modelo || 'desconhecido').slice(0, 80),
        status: input.status,
        mensagemErro: input.mensagemErro ?? null,
        totalTransacoesExtraidas: input.totalTransacoesExtraidas ?? 0,
        duracaoMs: Math.max(0, Math.round(input.duracaoMs ?? 0)),
        usoIaLogId: input.usoIaLogId ?? null,
      },
    });

    return tentativa;
  }

  /**
   * Correlaciona a tentativa com o log de telemetria de IA (`uso_ia_logs`, TASK-49).
   * Preferência explícita (handoff de id), com fallback pelo log mais recente do
   * arquivo+usuário que ainda não esteja vinculado a nenhuma tentativa.
   */
  public static async correlacionarUsoIaLog(params: {
    tentativaId: string;
    usuarioId: string;
    arquivoId: string;
    usoIaLogIdExplicito?: string | null;
    criadoAPartirDe?: Date;
    /** Funcionalidade de IA aceitável no fallback (evita atribuição cruzada). */
    funcionalidade?: 'EXTRACAO_EXTRATO' | 'CATEGORIZACAO' | 'RECLASSIFICACAO' | 'CHAT' | 'OUTROS';
  }): Promise<string | null> {
    const { tentativaId, usuarioId, arquivoId } = params;

    if (params.usoIaLogIdExplicito) {
      await prisma.tentativaArquivoImportacao.update({
        where: { id: tentativaId },
        data: { usoIaLogId: params.usoIaLogIdExplicito },
      });
      return params.usoIaLogIdExplicito;
    }

    const jaVinculados = await prisma.tentativaArquivoImportacao.findMany({
      where: { usuarioId, arquivoId, usoIaLogId: { not: null } },
      select: { usoIaLogId: true },
    });

    const log = await prisma.usoIaLog.findFirst({
      where: {
        usuarioId,
        arquivoId,
        // Só correlaciona logs da mesma funcionalidade (o histórico de tentativas
        // é exclusivo de extração; sem este filtro um log de categorização do
        // mesmo arquivo poderia ser atribuído à tentativa de extração).
        funcionalidade: params.funcionalidade ?? 'EXTRACAO_EXTRATO',
        id: {
          notIn: jaVinculados
            .map(t => t.usoIaLogId)
            .filter((id): id is string => Boolean(id)),
        },
        criadoEm: params.criadoAPartirDe ? { gte: params.criadoAPartirDe } : undefined,
      },
      orderBy: { criadoEm: 'desc' },
      select: { id: true },
    });

    if (!log) return null;

    await prisma.tentativaArquivoImportacao.update({
      where: { id: tentativaId },
      data: { usoIaLogId: log.id },
    });

    return log.id;
  }

  /** Lista as tentativas de um arquivo com isolamento multi-tenant e paginação. */
  public static async listarTentativasArquivo(params: {
    usuarioId: string;
    arquivoId: string;
    pagina?: number;
    limite?: number;
    status?: StatusTentativa;
  }) {
    const pagina = Math.max(1, params.pagina ?? 1);
    const limite = Math.min(100, Math.max(1, params.limite ?? 20));

    const where = {
      usuarioId: params.usuarioId,
      arquivoId: params.arquivoId,
      ...(params.status ? { status: params.status } : {}),
    };

    const [total, tentativas] = await Promise.all([
      prisma.tentativaArquivoImportacao.count({ where }),
      prisma.tentativaArquivoImportacao.findMany({
        where,
        orderBy: { numeroTentativa: 'asc' },
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);

    return {
      arquivoId: params.arquivoId,
      total,
      pagina,
      limite,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
      tentativas,
    };
  }

  /**
   * Recalcula os contadores agregados do lote a partir do estado real dos arquivos
   * e dos lançamentos em staging.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static async recalcularContadoresLote(loteId: string, db: any = prisma) {
    const arquivos = await db.arquivoImportacao.findMany({
      where: { loteId },
      select: { id: true, status: true, statusFinal: true, jaImportadoAnteriormente: true },
    });

    const STATUS_IA_CONCLUIDA = ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'];

    let totalSucesso = 0;
    let totalFalha = 0;
    let totalDuplicados = 0;

    for (const a of arquivos) {
      if (a.statusFinal === 'DUPLICADO') {
        totalDuplicados += 1;
      } else if (a.statusFinal === 'FALHA' || (a.statusFinal == null && a.status === 'ERRO')) {
        totalFalha += 1;
      } else if (
        a.statusFinal === 'SUCESSO' ||
        a.statusFinal === 'VAZIO' ||
        (a.statusFinal == null && STATUS_IA_CONCLUIDA.includes(a.status))
      ) {
        totalSucesso += 1;
      } else if (a.jaImportadoAnteriormente) {
        totalDuplicados += 1;
      }
    }

    const totalLancamentos = await db.stagingLancamentoImportacao.count({
      where: { loteId },
    });

    const contadores = {
      totalArquivos: arquivos.length,
      totalSucesso,
      totalFalha,
      totalDuplicados,
      totalLancamentos,
    };

    await db.loteImportacao.update({
      where: { id: loteId },
      data: contadores,
    });

    return contadores;
  }
}

export const importacaoTentativasService = ImportacaoTentativasService;
