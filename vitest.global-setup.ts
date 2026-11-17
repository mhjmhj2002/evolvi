import fs from 'node:fs/promises';
import path from 'node:path';

const raizUploadsTeste = path.resolve(process.cwd(), '.local/test-uploads');
const diretoriosFixtureTeste = [
  'uploads/test-bug-07',
  'uploads/test-bug-08',
  'uploads/test-bug-10',
  'uploads/test-regressao-integridade',
].map((diretorio) => path.resolve(process.cwd(), diretorio));

async function limparArtefatosDeTeste(): Promise<void> {
  await fs.rm(raizUploadsTeste, { recursive: true, force: true });
  await Promise.all(diretoriosFixtureTeste.map((diretorio) =>
    fs.rm(diretorio, { recursive: true, force: true })
  ));

  // Remove somente a raiz legada se estiver vazia; arquivos alheios são preservados.
  try {
    await fs.rmdir(path.resolve(process.cwd(), 'uploads'));
  } catch (erro: any) {
    if (erro?.code !== 'ENOENT' && erro?.code !== 'ENOTEMPTY' && erro?.code !== 'EEXIST') throw erro;
  }
}

export async function setup(): Promise<() => Promise<void>> {
  await limparArtefatosDeTeste();
  return limparArtefatosDeTeste;
}
