import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => Number(args[args.indexOf(name) + 1]) || fallback;
const files = flag('--files', 5);
const sizeMb = flag('--size-mb', 20);

if (args[0] !== '--child' || !['buffer', 'stream'].includes(args[1])) {
  throw new Error('Uso: node --expose-gc scripts/benchmark-importacao-upload.mjs --child <buffer|stream> --files <n> --size-mb <MiB>');
}

const modo = args[1];
const bytesPorArquivo = sizeMb * 1024 * 1024;
const amostraInicial = process.memoryUsage().rss;
let picoRss = amostraInicial;
const monitor = setInterval(() => { picoRss = Math.max(picoRss, process.memoryUsage().rss); }, 5);
const inicio = performance.now();
let bytesProcessados = 0;

if (modo === 'buffer') {
  const arquivos = [];
  for (let indice = 0; indice < files; indice += 1) {
    const partes = [];
    for (let offset = 0; offset < bytesPorArquivo; offset += 64 * 1024) {
      partes.push(Buffer.alloc(Math.min(64 * 1024, bytesPorArquivo - offset), indice));
    }
    const buffer = Buffer.concat(partes);
    bytesProcessados += buffer.length;
    arquivos.push(buffer); // Equivale ao array de buffers do fluxo multipart anterior.
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  picoRss = Math.max(picoRss, process.memoryUsage().rss);
  void arquivos;
} else {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'evolvi-upload-bench-'));
  try {
    for (let indice = 0; indice < files; indice += 1) {
      let restante = bytesPorArquivo;
      const hash = createHash('sha256');
      const fonte = Readable.from((async function* () {
        while (restante > 0) {
          const tamanho = Math.min(64 * 1024, restante);
          restante -= tamanho;
          yield Buffer.alloc(tamanho, indice);
        }
      })());
      const medirHash = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); bytesProcessados += chunk.length; callback(null, chunk); } });
      await pipeline(fonte, medirHash, createWriteStream(path.join(dir, `${indice}.bin`), { flags: 'wx' }));
      hash.digest('hex');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    picoRss = Math.max(picoRss, process.memoryUsage().rss);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

clearInterval(monitor);
console.log(JSON.stringify({ modo, bytesProcessados, tempoMs: Math.round(performance.now() - inicio), rssInicialBytes: amostraInicial, picoRssBytes: picoRss, aumentoRssBytes: Math.max(0, picoRss - amostraInicial) }));
