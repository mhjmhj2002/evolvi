import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Diretório base de uploads. Este script roda com `dotenv/config` cru e NÃO importa
// src/config/env.ts de propósito (sem dependência nova) — mantenha o default abaixo
// espelhando o default de UPLOADS_DIR em src/config/env.ts.
// Valor vazio/em branco cai no default — mesma regra do preprocess de src/config/env.ts.
const UPLOADS_DIR_ENV = process.env.UPLOADS_DIR;
const UPLOADS_DIR =
  UPLOADS_DIR_ENV && UPLOADS_DIR_ENV.trim() !== '' ? UPLOADS_DIR_ENV : 'uploads';
// Base SEMPRE absoluta: toda remoção de disco é validada contra este caminho.
const BASE_UPLOADS_ABS = path.resolve(process.cwd(), UPLOADS_DIR);

type ResultadoGuarda = { ok: true; absoluto: string } | { ok: false; motivo: string };

interface ResumoRemocaoArquivos {
  removidos: number;
  inexistentes: number;
  preservados: number;
  falhas: number;
  arquivosRemovidos: number;
}

/** `true` quando o caminho contém o segmento '..' (Path Traversal explícito). */
function temSegmentoInseguro(caminho: string): boolean {
  return caminho
    .replace(/\\/g, '/')
    .split('/')
    .some(parte => parte === '..');
}

/**
 * GUARDA OBRIGATÓRIA — executada ANTES de qualquer fs.rm.
 * Só devolve ok=true quando o alvo está ESTRITAMENTE DENTRO de BASE_UPLOADS_ABS:
 *  1. não contém '..' (nem bruto, nem após normalização);
 *  2. não é o próprio diretório base (o base nunca é removido);
 *  3. path.relative(base -> alvo) não é vazio, não começa com '..' e não é absoluto.
 * Exemplo barrado: base `uploads` + usuarioId `../outro` => path.join colapsa para
 * `<cwd>/outro`, o relative vira `../outro` e a remoção é abortada.
 */
function validarAlvoDentroDaBase(caminhoCandidato: string): ResultadoGuarda {
  if (temSegmentoInseguro(caminhoCandidato)) {
    return { ok: false, motivo: 'contém ".." após normalização' };
  }

  const absoluto = path.resolve(caminhoCandidato);
  if (temSegmentoInseguro(absoluto)) {
    return { ok: false, motivo: 'contém ".." após normalização' };
  }

  const relativo = path.relative(BASE_UPLOADS_ABS, absoluto);
  if (relativo === '') {
    return { ok: false, motivo: 'é o próprio diretório base de uploads' };
  }
  if (relativo === '..' || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo)) {
    return { ok: false, motivo: `está fora do diretório base (${BASE_UPLOADS_ABS})` };
  }

  return { ok: true, absoluto };
}

async function diretorioExiste(caminhoAbsoluto: string): Promise<boolean> {
  try {
    const info = await fs.stat(caminhoAbsoluto);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** Contagem barata de arquivos (relatório): um único readdir recursivo. */
async function contarArquivos(caminhoAbsoluto: string): Promise<number> {
  try {
    const entradas = await fs.readdir(caminhoAbsoluto, { recursive: true, withFileTypes: true });
    return entradas.filter(entrada => entrada.isFile()).length;
  } catch {
    return 0;
  }
}

async function removerDiretorioSeguro(
  rotulo: string,
  caminhoCandidato: string,
  resumo: ResumoRemocaoArquivos
): Promise<void> {
  const guarda = validarAlvoDentroDaBase(caminhoCandidato);
  if (!guarda.ok) {
    resumo.preservados += 1;
    console.warn(
      `⚠️  PRESERVADO pela guarda de segurança: ${rotulo} (${caminhoCandidato}) — ${guarda.motivo}`
    );
    return;
  }

  if (!(await diretorioExiste(guarda.absoluto))) {
    resumo.inexistentes += 1;
    console.log(`- Já não existia (nada a remover): ${rotulo} (${guarda.absoluto})`);
    return;
  }

  const arquivos = await contarArquivos(guarda.absoluto);

  try {
    // try/catch por caminho: um diretório que desapareça entre a checagem e o rm
    // (ou sem permissão) não aborta a limpeza dos demais.
    await fs.rm(guarda.absoluto, { recursive: true, force: true });
    resumo.removidos += 1;
    resumo.arquivosRemovidos += arquivos;
    console.log(`✔ Removido: ${rotulo} (${guarda.absoluto}) — ${arquivos} arquivo(s)`);
  } catch (erro) {
    resumo.falhas += 1;
    console.error(`❌ Falha ao remover ${rotulo} (${guarda.absoluto}):`, erro);
  }
}

async function main() {
  const emailAlvo = process.env.EMAIL_ALVO || 'mhjmhj2002@gmail.com';
  console.log('==============================================================================');
  console.log('       EVOLVI — SCRIPT DE LIMPEZA E RESET DE IMPORTAÇÕES DO USUÁRIO           ');
  console.log('==============================================================================');
  console.log(`Buscando usuário pelo e-mail: ${emailAlvo}...`);

  const usuario = await prisma.usuario.findUnique({
    where: { email: emailAlvo },
    select: { id: true, nome: true, email: true },
  });

  if (!usuario) {
    throw new Error(`Usuário com e-mail "${emailAlvo}" não foi encontrado no banco de dados.`);
  }

  console.log(`✔ Usuário identificado: ${usuario.nome} (${usuario.email}) - ID: ${usuario.id}\n`);

  // Preservação de configurações de IA
  const totalIas = await prisma.configuracaoIaUsuario.count({
    where: { usuarioId: usuario.id },
  });
  console.log(`🛡️  CONFIGURAÇÕES DE IA PRESERVADAS: ${totalIas} credenciais/modelos cadastrados.`);

  // TASK-49: Histórico de gastos de IA (uso_ia_logs) NÃO é dado de importação e
  // é sempre preservado — nunca incluir usoIaLog.deleteMany neste script.
  const totalUsosIa = await prisma.usoIaLog.count({
    where: { usuarioId: usuario.id },
  });
  console.log(`🛡️  HISTÓRIO DE GASTOS DE IA PRESERVADO: ${totalUsosIa} registros em uso_ia_logs.`);

  // Lotes precisam ser lidos ANTES da transação: ela os exclui. Guardamos o
  // caminhoDiretorio (layout antigo 'uploads/<folder>') para apagar o disco depois.
  const lotes = await prisma.loteImportacao.findMany({
    where: { usuarioId: usuario.id },
    select: { id: true, caminhoDiretorio: true },
  });

  console.log('\nExecutando limpeza em transação atômica isolada por usuarioId...');

  const resultado = await prisma.$transaction(async tx => {
    // 1. Suspeitas de movimento (Central de Validação)
    const delSuspeitas = await tx.suspeitaMovimento.deleteMany({
      where: { usuarioId: usuario.id },
    });

    // 2. Rateios de movimentos
    const delRateios = await tx.movimentoRateio.deleteMany({
      where: { movimento: { usuarioId: usuario.id } },
    });

    // 3. Desvincular transferências entre movimentos para evitar restrições de FK autorreferencial
    await tx.movimento.updateMany({
      where: { usuarioId: usuario.id },
      data: { transferenciaVinculoId: null },
    });

    // 4. Movimentos financeiros (Extratos e Faturas)
    const delMovimentos = await tx.movimento.deleteMany({
      where: { usuarioId: usuario.id },
    });

    // 5. Histórico e alertas de conciliação
    const delHistorico = await tx.historicoImportacaoArquivo.deleteMany({
      where: { usuarioId: usuario.id },
    });
    const delAlertas = await tx.alertaConciliacao.deleteMany({
      where: { usuarioId: usuario.id },
    });

    // 6. Contratos de Parcelamento
    const delParcelamentos = await tx.parcelamento.deleteMany({
      where: { usuarioId: usuario.id },
    });

    // 7. Staging de lançamentos de importação
    const delStaging = await tx.stagingLancamentoImportacao.deleteMany({
      where: { lote: { usuarioId: usuario.id } },
    });

    // 7.1. TASK-50: tentativas de extração por arquivo (tentativas_arquivo_importacao).
    // Deve ocorrer ANTES da exclusão dos arquivos. `uso_ia_logs` (TASK-49) é preservado.
    const delTentativas = await tx.tentativaArquivoImportacao.deleteMany({
      where: { usuarioId: usuario.id },
    });

    // 8. Desvincula reenvios (auto-relacionamento arquivoOriginalId) antes de excluir arquivos
    await tx.arquivoImportacao.updateMany({
      where: { usuarioId: usuario.id },
      data: { arquivoOriginalId: null },
    });

    // 9. Arquivos de importação
    const delArquivos = await tx.arquivoImportacao.deleteMany({
      where: { usuarioId: usuario.id },
    });

    // 10. Lotes de importação
    const delLotes = await tx.loteImportacao.deleteMany({
      where: { usuarioId: usuario.id },
    });

    // 11. Dados brutos Open Finance (caso existam)
    const delDadosBrutos = await tx.dadoBrutoOpenFinance.deleteMany({
      where: { usuarioId: usuario.id },
    });

    return {
      delSuspeitas: delSuspeitas.count,
      delRateios: delRateios.count,
      delMovimentos: delMovimentos.count,
      delHistorico: delHistorico.count,
      delAlertas: delAlertas.count,
      delParcelamentos: delParcelamentos.count,
      delStaging: delStaging.count,
      delTentativas: delTentativas.count,
      delArquivos: delArquivos.count,
      delLotes: delLotes.count,
      delDadosBrutos: delDadosBrutos.count,
    };
  });

  console.log('\n==============================================================================');
  console.log('                          RELATÓRIO DE LIMPEZA                                ');
  console.log('==============================================================================');
  console.log(`- Movimentos Financeiros excluídos:       ${resultado.delMovimentos}`);
  console.log(`- Rateios de Movimentos excluídos:         ${resultado.delRateios}`);
  console.log(`- Suspeitas / Central Validação limpas:   ${resultado.delSuspeitas}`);
  console.log(`- Contratos de Parcelamento excluídos:    ${resultado.delParcelamentos}`);
  console.log(`- Alertas de Conciliação limpos:           ${resultado.delAlertas}`);
  console.log(`- Histórico de Arquivos catalogados:      ${resultado.delHistorico}`);
  console.log(`- Registros na Tabela Staging excluídos:  ${resultado.delStaging}`);
  console.log(`- Tentativas de Extração excluídas:        ${resultado.delTentativas}`);
  console.log(`- Arquivos de Importação excluídos:        ${resultado.delArquivos}`);
  console.log(`- Lotes de Importação excluídos:           ${resultado.delLotes}`);
  console.log(`- Dados Brutos Open Finance excluídos:     ${resultado.delDadosBrutos}`);
  console.log('------------------------------------------------------------------------------');

  const checagemIas = await prisma.configuracaoIaUsuario.findMany({
    where: { usuarioId: usuario.id },
    select: { provedor: true, modelo: true },
  });
  console.log('✔ Credenciais de IA intactas:');
  for (const ia of checagemIas) {
    console.log(`  * ${ia.provedor} (${ia.modelo})`);
  }

  // ---------------------------------------------------------------------------
  // Remoção dos ARQUIVOS FÍSICOS — somente DEPOIS da transação: se ela falhasse e
  // desse rollback, os registros continuariam vivos e não podemos apagar o disco.
  // Escopo estritamente do usuário alvo: base/<usuarioId> + pastas dos lotes dele.
  // ---------------------------------------------------------------------------
  const resumoArquivos: ResumoRemocaoArquivos = {
    removidos: 0,
    inexistentes: 0,
    preservados: 0,
    falhas: 0,
    arquivosRemovidos: 0,
  };

  console.log('\n==============================================================================');
  console.log('                    ARQUIVOS FÍSICOS DE UPLOAD (DISCO)                        ');
  console.log('==============================================================================');
  console.log(`Diretório base de uploads: ${BASE_UPLOADS_ABS}`);

  if (await diretorioExiste(BASE_UPLOADS_ABS)) {
    // Layout NOVO: uma pasta por usuário (<base>/<usuarioId>).
    // `usuario.id` é UUID (Prisma @db.Uuid) e, portanto, é preservado tal e qual por
    // sanitizarSegmentoPath() em ImportacaoStorageService — o nome da pasta gerada pela
    // aplicação é idêntico a usuario.id. Se um dia o id deixar de ser UUID, alinhe aqui
    // a mesma sanitização usada em src/modules/importacao/importacao-storage.service.ts.
    const pastaUsuario = path.join(BASE_UPLOADS_ABS, usuario.id);

    // Layout ANTIGO: cada lote tinha caminhoDiretorio 'uploads/<folder>' e os
    // arquivos viviam em <base>/<folder>. Mapeamos o nome da pasta para a base atual.
    const pastasLote = new Map<string, string>();
    for (const lote of lotes) {
      const caminhoLote = lote.caminhoDiretorio;
      if (!caminhoLote || !caminhoLote.trim()) continue;
      const pasta = path.join(BASE_UPLOADS_ABS, path.basename(caminhoLote));
      if (!pastasLote.has(pasta)) pastasLote.set(pasta, lote.id);
    }

    const alvos: { rotulo: string; caminho: string }[] = [
      { rotulo: 'pasta do usuário', caminho: pastaUsuario },
      ...Array.from(pastasLote, ([caminho, loteId]) => ({
        rotulo: `lote ${loteId.slice(0, 8)} (layout antigo)`,
        caminho,
      })),
    ];

    const visitados = new Set<string>();
    for (const alvo of alvos) {
      const chave = path.resolve(alvo.caminho);
      if (visitados.has(chave)) continue;
      visitados.add(chave);
      await removerDiretorioSeguro(alvo.rotulo, alvo.caminho, resumoArquivos);
    }
  } else {
    console.log(
      `ℹ️  Diretório base de uploads não encontrado (${BASE_UPLOADS_ABS}). Nada a remover no disco.`
    );
  }

  console.log('------------------------------------------------------------------------------');
  console.log(`- Diretórios de upload removidos:          ${resumoArquivos.removidos}`);
  console.log(`- Diretórios que já não existiam:          ${resumoArquivos.inexistentes}`);
  console.log(`- Diretórios preservados pela guarda:      ${resumoArquivos.preservados}`);
  if (resumoArquivos.falhas > 0) {
    console.log(`- Diretórios com falha de remoção:         ${resumoArquivos.falhas}`);
  }
  console.log(`- Arquivos físicos removidos (contagem):   ${resumoArquivos.arquivosRemovidos}`);
  console.log('------------------------------------------------------------------------------');
  console.log(`✔ Apenas os arquivos físicos do usuário ${usuario.email} foram removidos.`);
  console.log('==============================================================================');
  console.log('✔ Limpeza concluída com sucesso! O usuário está pronto para nova importação.');
  console.log('==============================================================================');
}

main()
  .catch(e => {
    console.error('❌ Erro durante a limpeza:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
