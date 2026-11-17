import fs from 'fs/promises';
import path from 'path';
import { env } from '../../../config/env.js';
import { importacaoDiagnosticoService } from '../importacao-diagnostico.service.js';

/** Remove arquivos temporários já encerrados do usuário após autenticação. */
export class LimpezaUploadsLoginWorkerService {
  private listening = false;
  private timer?: NodeJS.Timeout;

  public setupEventListener(): void {
    if (this.listening) return;
    this.startSweep();
    this.listening = true;
  }

  public removeEventListener(): void {
    this.listening = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public startSweep(): void {
    if (this.timer) return;
    void this.limparSpoolAntigo().catch((erro) => console.error('[evolvi-worker:limpeza-uploads] Falha na limpeza do spool:', erro));
    this.timer = setInterval(() => {
      void this.limparSpoolAntigo().catch((erro) => console.error('[evolvi-worker:limpeza-uploads] Falha na limpeza do spool:', erro));
    }, 60 * 60 * 1000);
  }

  private async limparSpoolAntigo(): Promise<void> {
    const spool = path.resolve(process.cwd(), env.UPLOADS_DIR, '.spool');
    const raiz = path.resolve(process.cwd(), env.UPLOADS_DIR);
    if (!spool.startsWith(`${raiz}${path.sep}`)) throw new Error('Caminho de spool inválido.');
    let entradas: import('fs').Dirent[];
    try { entradas = await fs.readdir(spool, { withFileTypes: true }); } catch (erro: any) {
      if (erro?.code === 'ENOENT') return;
      throw erro;
    }
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    for (const entrada of entradas) {
      if (!entrada.isFile()) continue;
      const alvo = path.resolve(spool, entrada.name);
      if (!alvo.startsWith(`${spool}${path.sep}`)) continue;
      const info = await fs.stat(alvo);
      if (info.mtimeMs < limite) await fs.rm(alvo, { force: true });
    }
    try {
      await fs.rmdir(spool);
    } catch (erro: any) {
      if (erro?.code !== 'ENOENT' && erro?.code !== 'ENOTEMPTY' && erro?.code !== 'EEXIST') throw erro;
    }
  }

  public async limparParaUsuario(usuarioId: string): Promise<{ removidos: number }> {
    return { removidos: await importacaoDiagnosticoService.limparTodosArtefatosUsuario(usuarioId) };
  }
}

export const limpezaUploadsLoginWorkerService = new LimpezaUploadsLoginWorkerService();
