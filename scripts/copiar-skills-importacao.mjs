import fs from 'node:fs';
import path from 'node:path';

const origem = path.resolve('src/modules/importacao/worker/skills');
const destino = path.resolve('dist/modules/importacao/worker/skills');

fs.mkdirSync(destino, { recursive: true });
for (const nome of fs.readdirSync(destino).filter((arquivo) => arquivo.endsWith('.md'))) {
  fs.unlinkSync(path.join(destino, nome));
}
for (const nome of fs.readdirSync(origem).filter((arquivo) => arquivo.endsWith('.md'))) {
  fs.copyFileSync(path.join(origem, nome), path.join(destino, nome));
}
