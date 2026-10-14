import { spawnSync } from 'child_process';
import zlib from 'zlib';

/**
 * Utilitário robusto de extração de texto de PDFs.
 *
 * Estratégia de extração em cascata:
 * 1. CLI `pdftotext` (Poppler) com `-layout` preservando alinhamento tabular de colunas;
 * 2. Fallback nativo: Leitura e descompressão de streams FlateDecode (`/Filter /FlateDecode`)
 *    do PDF via `zlib.inflateSync`, extraindo blocos de texto PDF (`(...) Tj` e `[...] TJ`).
 *
 * Garante que NUNCA caracteres binários brutos de PDF comprimido sejam interpretados
 * cegamente como texto cru.
 */
export class PdfTextExtractor {
  /**
   * Extrai o texto limpo de um buffer PDF.
   * Retorna string vazia ou nula se o buffer for ilegível ou corrompido.
   */
  public static extrairTexto(buffer: Buffer): string {
    if (!buffer || buffer.length === 0) {
      return '';
    }

    // 1. Tentar pdftotext do sistema operacional
    try {
      const child = spawnSync('pdftotext', ['-layout', '-', '-'], {
        input: buffer,
        encoding: 'utf-8',
        maxBuffer: 25 * 1024 * 1024,
      });

      if (child.status === 0 && child.stdout && child.stdout.trim().length > 0) {
        return child.stdout;
      }
    } catch {
      // Ignora erro de spawn (ex: pdftotext não disponível no path) e tenta fallback nativo
    }

    // 2. Fallback nativo Node.js: descompressão de streams PDF FlateDecode
    try {
      const textoNativo = this.extrairTextoStreamsNativo(buffer);
      if (textoNativo && textoNativo.trim().length > 0) {
        return textoNativo;
      }
    } catch {
      // Falha na descompressão nativa
    }

    return '';
  }

  /**
   * Extrai texto de objetos stream FlateDecode no PDF sem dependências externas.
   */
  private static extrairTextoStreamsNativo(buffer: Buffer): string {
    const raw = buffer.toString('latin1');
    const streamRegex = /stream[\r\n]+([\s\S]*?)endstream/g;
    let match: RegExpExecArray | null;
    let textoAcumulado = '';

    while ((match = streamRegex.exec(raw)) !== null) {
      const streamBytes = Buffer.from(match[1], 'latin1');
      try {
        const decompressed = zlib.inflateSync(streamBytes).toString('latin1');

        // Operadores de texto do PDF:
        // (Texto) Tj
        const tjRegex = /\(([^)]+)\)\s*Tj/g;
        let tjMatch: RegExpExecArray | null;
        let achouTexto = false;
        while ((tjMatch = tjRegex.exec(decompressed)) !== null) {
          textoAcumulado += tjMatch[1] + ' ';
          achouTexto = true;
        }

        // [(T1) -10 (T2)] TJ
        const arrayTjRegex = /\[(.*?)\]\s*TJ/g;
        let arrMatch: RegExpExecArray | null;
        while ((arrMatch = arrayTjRegex.exec(decompressed)) !== null) {
          const pedacos = arrMatch[1].match(/\(([^)]+)\)/g);
          if (pedacos) {
            for (const p of pedacos) {
              textoAcumulado += p.slice(1, -1) + ' ';
              achouTexto = true;
            }
          }
        }

        if (achouTexto) {
          textoAcumulado += '\n';
        }
      } catch {
        // Stream não comprimido com zlib ou imagem/fonte embutida
      }
    }

    return textoAcumulado;
  }
}
