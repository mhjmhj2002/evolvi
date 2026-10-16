import { prisma } from '../src/infrastructure/database/prisma.js';
import { conciliacaoService } from '../src/modules/importacao/conciliacao.service.js';

async function main() {
  const usuarioId = 'fb0c118e-ac2e-4a8f-8c59-718844841351';

  // Busca todos os arquivos processados do usuário
  const arquivos = await prisma.arquivoImportacao.findMany({
    where: {
      lote: { usuarioId },
      status: 'PROCESSADO_FINAL',
    },
    include: { lote: true },
  });

  console.log(`Encontrados ${arquivos.length} arquivos processados para o usuário principal.`);

  for (const arq of arquivos) {
    try {
      const hist = await conciliacaoService.catalogarArquivo({
        usuarioId,
        arquivoId: arq.id,
        loteId: arq.loteId,
      });
      if (hist) {
        console.log(`✔ Catalogado: ${arq.nomeArquivo} => ${hist.instituicao} (${hist.competencia}) - ${hist.totalTransacoes} transações`);
      } else {
        console.log(`- Sem itens consolidados: ${arq.nomeArquivo}`);
      }
    } catch (err) {
      console.error(`Erro ao catalogar ${arq.nomeArquivo}:`, err);
    }
  }

  // Executa checagem de lacunas
  const alertas = await conciliacaoService.verificarLacunas(usuarioId);
  console.log(`Alertas de conciliação ativos: ${alertas.length}`);
  alertas.forEach((a: any) => {
    console.log(`- [${a.tipoAlerta}] ${a.titulo} (${a.competencia})`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
