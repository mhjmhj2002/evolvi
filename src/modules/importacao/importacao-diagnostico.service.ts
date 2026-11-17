import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';

const execFileAsync = promisify(execFile);
const idadeMaximaMarcadorAtivoMs = 24 * 60 * 60 * 1000;

/** Guarda evidências em uploads/<usuario>/<hash> e mantém apenas o ZIP ao concluir. */
export class ImportacaoDiagnosticoService {
  private raizUploads(): string {
    return path.resolve(process.cwd(), env.UPLOADS_DIR);
  }

  private validarSegmento(valor: string, nome: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(valor)) throw new Error(`${nome} inválido para artefato de diagnóstico.`);
  }

  private raizUsuario(usuarioId: string): string {
    this.validarSegmento(usuarioId, 'usuarioId');
    const raiz = this.raizUploads();
    const destino = path.resolve(raiz, usuarioId);
    if (!destino.startsWith(`${raiz}${path.sep}`)) throw new Error('Caminho de uploads do usuário inválido.');
    return destino;
  }

  private diretorioHash(usuarioId: string, hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Hash inválido para artefato de diagnóstico.');
    const raizUsuario = this.raizUsuario(usuarioId);
    const destino = path.resolve(raizUsuario, hash);
    if (!destino.startsWith(`${raizUsuario}${path.sep}`)) throw new Error('Caminho do pacote de diagnóstico inválido.');
    return destino;
  }

  /** Apaga todos os artefatos anteriores do usuário, sem preservar lotes ativos. */
  public async limparTodosArtefatosUsuario(usuarioId: string): Promise<number> {
    const raizUsuario = this.raizUsuario(usuarioId);
    let removidos = 0;
    let entradas: string[] = [];
    try {
      entradas = await fs.readdir(raizUsuario);
    } catch (erro: any) {
      if (erro?.code !== 'ENOENT') throw erro;
    }

    // Login e nova importação podem acontecer enquanto o worker ainda processa
    // um lote. Preserve o pacote ativo até o worker arquivá-lo. Marcadores
    // antigos expiram para que uma queda do processo não deixe lixo permanente.
    const ativos: Array<{ arquivoId: string; hash: string; marcador: string }> = [];
    for (const entrada of entradas.filter((nome) => /^\.ativo-[a-f0-9-]+\.json$/.test(nome))) {
      const marcador = path.join(raizUsuario, entrada);
      try {
        const stat = await fs.stat(marcador);
        if (Date.now() - stat.mtimeMs > idadeMaximaMarcadorAtivoMs) {
          await fs.rm(marcador, { force: true });
          removidos += 1;
          continue;
        }
        const dados = JSON.parse(await fs.readFile(marcador, 'utf8')) as { arquivoId?: string; hashConteudo?: string };
        const arquivoId = entrada.slice('.ativo-'.length, -'.json'.length);
        if (dados.arquivoId === arquivoId && /^[a-f0-9]{64}$/.test(dados.hashConteudo || '')) {
          ativos.push({ arquivoId, hash: dados.hashConteudo!, marcador: entrada });
        }
      } catch (erro: any) {
        if (erro?.code !== 'ENOENT') {
          // Um marcador recente e ilegível é preservado por segurança.
          ativos.push({ arquivoId: '', hash: '', marcador: entrada });
        }
      }
    }

    if (ativos.length === 0) {
      removidos += entradas.length;
      await fs.rm(raizUsuario, { recursive: true, force: true });
    } else if (ativos.some((ativo) => !ativo.hash)) {
      // Se não der para interpretar um marcador ativo, não arrisque apagar o
      // pacote correspondente. Uma chamada posterior o removerá após expirar.
    } else {
      const preservar = new Set<string>();
      for (const ativo of ativos) {
        preservar.add(ativo.marcador);
        if (!ativo.hash) continue;
        preservar.add(ativo.hash);
        preservar.add(`${ativo.hash}.zip`);
        preservar.add(`${ativo.hash}.${ativo.arquivoId}.zip.tmp`);
      }
      for (const entrada of entradas) {
        if (preservar.has(entrada)) continue;
        await fs.rm(path.join(raizUsuario, entrada), { recursive: true, force: true });
        removidos += 1;
      }
    }

    // Remove também os artefatos da versão antiga, que ficavam fora da pasta do usuário.
    const raizUploads = this.raizUploads();
    const legado = path.resolve(raizUploads, '.diagnosticos', usuarioId);
    const raizLegado = path.resolve(raizUploads, '.diagnosticos');
    if (legado.startsWith(`${raizLegado}${path.sep}`)) {
      await fs.rm(legado, { recursive: true, force: true });
    }
    return removidos;
  }

  private async dadosArquivo(arquivoId: string) {
    return prisma.arquivoImportacao.findUnique({
      where: { id: arquivoId },
      include: { lote: { select: { usuarioId: true, id: true, caminhoDiretorio: true, origem: true, iaSelecionada: true, status: true } } },
    });
  }

  public async iniciarArquivo(arquivoId: string, caminhoOriginal: string, provedor?: string, modelo?: string): Promise<void> {
    const arquivo = await this.dadosArquivo(arquivoId);
    if (!arquivo?.hashConteudo) return;
    const pasta = this.diretorioHash(arquivo.lote.usuarioId, arquivo.hashConteudo);
    await fs.mkdir(pasta, { recursive: true });
    const raizUsuario = this.raizUsuario(arquivo.lote.usuarioId);
    await fs.mkdir(raizUsuario, { recursive: true });
    await fs.writeFile(path.join(raizUsuario, `.ativo-${arquivo.id}.json`), JSON.stringify({
      arquivoId: arquivo.id, hashConteudo: arquivo.hashConteudo, iniciadoEm: new Date().toISOString(),
    }), 'utf8');
    const extensao = path.extname(arquivo.nomeArquivo).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) || '.bin';
    await fs.copyFile(caminhoOriginal, path.join(pasta, `original${extensao}`));
    await fs.writeFile(path.join(pasta, 'metadados.json'), JSON.stringify({
      arquivoId: arquivo.id, loteId: arquivo.loteId, usuarioId: arquivo.lote.usuarioId,
      nomeOriginal: arquivo.nomeArquivo, hashConteudo: arquivo.hashConteudo,
      tamanhoBytes: String(arquivo.tamanhoBytes), mimeType: arquivo.mimeType,
      provedor, modelo, recebidoEm: arquivo.uploadFinalizadoEm,
      lote: arquivo.lote,
    }, null, 2));
    await this.registrar(arquivoId, 'UPLOAD', 'Arquivo original copiado para o pacote de diagnóstico.');
  }

  public async registrar(arquivoId: string, etapa: string, mensagem: string, detalhes?: unknown): Promise<void> {
    try {
      const arquivo = await this.dadosArquivo(arquivoId);
      if (!arquivo?.hashConteudo) return;
      const pasta = this.diretorioHash(arquivo.lote.usuarioId, arquivo.hashConteudo);
      await fs.mkdir(pasta, { recursive: true });
      const linha = JSON.stringify({ data: new Date().toISOString(), etapa, mensagem, ...(detalhes === undefined ? {} : { detalhes }) });
      await fs.appendFile(path.join(pasta, 'pipeline.log'), `${linha}\n`, 'utf8');
    } catch (erro) {
      console.error(`[evolvi-importacao-diagnostico] Falha ao registrar arquivo ${arquivoId}:`, erro);
    }
  }

  public async copiarJson(arquivoId: string, caminhoJson: string): Promise<void> {
    const arquivo = await this.dadosArquivo(arquivoId);
    if (!arquivo?.hashConteudo) return;
    const pasta = this.diretorioHash(arquivo.lote.usuarioId, arquivo.hashConteudo);
    await fs.mkdir(pasta, { recursive: true });
    await fs.copyFile(caminhoJson, path.join(pasta, 'extracao.json'));
    await this.registrar(arquivoId, 'EXTRACAO_IA', 'JSON estruturado copiado para o pacote.');
  }

  public async finalizarArquivo(arquivoId: string, status?: string): Promise<void> {
    try {
      const arquivo = await this.dadosArquivo(arquivoId);
      if (!arquivo?.hashConteudo) return;
      const pasta = this.diretorioHash(arquivo.lote.usuarioId, arquivo.hashConteudo);
      await fs.mkdir(pasta, { recursive: true });
      const raizLote = path.resolve(process.cwd(), arquivo.lote.caminhoDiretorio);

      // O original e a extração ficam no pacote desde a recepção. Se algum
      // fluxo os removeu antes da consolidação, recupere-os da pasta do lote,
      // que só é removida depois deste arquivamento.
      const extensao = path.extname(arquivo.nomeArquivo).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) || '.bin';
      const caminhoOriginalPacote = path.join(pasta, `original${extensao}`);
      try { await fs.access(caminhoOriginalPacote); }
      catch {
        const caminhoOriginalLote = path.resolve(raizLote, arquivo.caminhoRelativo);
        if (caminhoOriginalLote.startsWith(`${raizLote}${path.sep}`)) {
          try {
            const conteudo = await fs.readFile(caminhoOriginalLote);
            const hash = createHash('sha256').update(conteudo).digest('hex');
            if (hash === arquivo.hashConteudo) await fs.writeFile(caminhoOriginalPacote, conteudo);
          } catch { /* o pacote fica sinalizado como incompleto logo abaixo */ }
        }
      }
      const caminhoExtracao = path.join(pasta, 'extracao.json');
      try { await fs.access(caminhoExtracao); }
      catch {
        const caminhoConsolidado = path.join(raizLote, `consolidado_${arquivo.id}.json`);
        try { await fs.copyFile(caminhoConsolidado, caminhoExtracao); }
        catch { /* o pacote fica sinalizado como incompleto logo abaixo */ }
      }

      const resultadoSucesso = ['SUCESSO', 'PROCESSADO_FINAL', 'CONCLUIDO'].includes((status || arquivo.statusFinal || arquivo.status).toUpperCase());
      if (resultadoSucesso) {
        const faltantes: string[] = [];
        try { await fs.access(caminhoOriginalPacote); } catch { faltantes.push('original'); }
        try { await fs.access(caminhoExtracao); } catch { faltantes.push('extracao.json'); }
        if (faltantes.length) {
          throw new Error(`Pacote incompleto para arquivo concluído; evidência ausente: ${faltantes.join(', ')}.`);
        }
      }

      const [tentativas, inventarios, staging, checkpoints] = await Promise.all([
        prisma.tentativaArquivoImportacao.findMany({ where: { arquivoId }, orderBy: { criadoEm: 'asc' } }),
        prisma.inventarioIaArquivo.findMany({ where: { arquivoId, usuarioId: arquivo.lote.usuarioId }, include: { paginas: { orderBy: { pagina: 'asc' } } }, orderBy: { criadoEm: 'asc' } }),
        prisma.stagingLancamentoImportacao.findMany({ where: { arquivoId }, orderBy: { criadoEm: 'asc' } }),
        prisma.checkpointChunkIa.findMany({ where: { arquivoId, usuarioId: arquivo.lote.usuarioId }, orderBy: { indice: 'asc' } }),
      ]);
      const movimentoIds = staging.map((item) => item.movimentoId).filter((id): id is string => Boolean(id));
      const movimentos = movimentoIds.length
        ? await prisma.movimento.findMany({ where: { usuarioId: arquivo.lote.usuarioId, id: { in: movimentoIds } } })
        : [];
      await fs.writeFile(path.join(pasta, 'estado-final.json'), JSON.stringify({
        arquivo: { ...arquivo, tamanhoBytes: String(arquivo.tamanhoBytes) }, tentativas, inventarios, checkpoints, movimentos,
        staging: staging.map((item) => ({ ...item, valor: String(item.valor) })),
      }, null, 2));
      await this.registrar(arquivoId, 'FIM', `Processamento finalizado${status ? ` com status ${status}` : ''}.`);
      const raizUsuario = this.raizUsuario(arquivo.lote.usuarioId);
      const temporario = path.join(raizUsuario, `${arquivo.hashConteudo}.${arquivo.id}.zip.tmp`);
      const zipFinal = path.join(raizUsuario, `${arquivo.hashConteudo}.zip`);
      await fs.mkdir(raizUsuario, { recursive: true });
      await execFileAsync('zip', ['-qr', temporario, '.'], { cwd: pasta });
      await fs.rename(temporario, zipFinal);
      await fs.rm(pasta, { recursive: true, force: true });
      await fs.rm(path.join(raizUsuario, `.ativo-${arquivo.id}.json`), { force: true });
    } catch (erro) {
      console.error(`[evolvi-importacao-diagnostico] Falha ao finalizar pacote ${arquivoId}:`, erro);
    }
  }
}

export const importacaoDiagnosticoService = new ImportacaoDiagnosticoService();
