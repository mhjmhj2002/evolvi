import { importacaoConsolidacaoWorkerService } from '../src/modules/importacao/worker/importacao-consolidacao-worker.service.js';
import { prisma } from '../src/infrastructure/database/prisma.js';

async function main() {
  const usuarioId = 'fb0c118e-ac2e-4a8f-8c59-718844841351';

  // 1. Obter ou criar Conta PagBank
  let conta = await prisma.conta.findFirst({
    where: {
      usuarioId,
      nome: { contains: 'PagBank', mode: 'insensitive' },
    },
  });

  if (!conta) {
    conta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta PagBank',
        tipo: 'CONTA_CORRENTE',
        ativo: true,
      },
    });
    console.log('Conta PagBank criada:', conta.id);
  } else {
    console.log('Conta PagBank já existente:', conta.id);
  }

  // 2. Criar Lote de Importação
  const lote = await prisma.loteImportacao.create({
    data: {
      usuarioId,
      caminhoDiretorio: 'ingestao-manual/pagbank',
      totalArquivos: 1,
      arquivosProcessados: 0,
      status: 'CARGA_STAGING',
    },
  });

  // 3. Criar ArquivoImportacao
  const arquivo = await prisma.arquivoImportacao.create({
    data: {
      loteId: lote.id,
      nomeArquivo: 'PRINT_CHAT_PAGBANK_2026-01_a_2026-09.json',
      mimeType: 'application/json',
      caminhoRelativo: 'PRINT_CHAT_PAGBANK_2026-01_a_2026-09.json',
      status: 'STAGING_CARREGADO',
    },
  });

  // 4. Lançamentos extraídos dos comprovantes/prints da conta PagBank
  const pagbankItems = [
    {
      dataMovimento: new Date('2026-03-04T12:00:00Z'),
      descricao: 'Pix recebido - Manuel Alejandro Hinojosa Jara',
      valor: 5000.0,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Transferência Interna',
      observacao: 'Fonte manual: captura do app PagBank enviada no chat em 16/09/2026.',
    },
    {
      dataMovimento: new Date('2026-03-04T12:00:00Z'),
      descricao: 'Renda Fixa - Aplicacao em CDB',
      valor: 5000.0,
      natureza: 'DESPESA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Investimentos',
      observacao: 'Aplicacao em CDB identificada no print do app.',
    },
    {
      dataMovimento: new Date('2026-04-20T12:00:00Z'),
      descricao: 'Renda Fixa - Resgate de CDB',
      valor: 3400.0,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Investimentos',
      observacao: 'Resgate de CDB identificado no print do app.',
    },
    {
      dataMovimento: new Date('2026-04-22T12:00:00Z'),
      descricao: 'Pix enviado - Manuel Alejandro Hinojosa Jara',
      valor: 3400.0,
      natureza: 'DESPESA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Transferência Interna',
      observacao: 'Transferencia entre contas proprias.',
    },
    {
      dataMovimento: new Date('2026-04-22T12:00:00Z'),
      descricao: 'Renda Fixa - Resgate de CDB',
      valor: 450.0,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Investimentos',
      observacao: 'Resgate de CDB identificado no print do app.',
    },
    {
      dataMovimento: new Date('2026-04-22T12:00:00Z'),
      descricao: 'Pix enviado - Manuel Alejandro Hinojosa Jara',
      valor: 300.0,
      natureza: 'DESPESA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Transferência Interna',
      observacao: 'Transferencia entre contas proprias.',
    },
    {
      dataMovimento: new Date('2026-05-20T12:00:00Z'),
      descricao: 'Rendimento da conta',
      valor: 1.31,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Rendimentos',
      observacao: 'Rendimento liquido sobre dinheiro em conta.',
    },
    {
      dataMovimento: new Date('2026-05-25T12:00:00Z'),
      descricao: 'Pix recebido - Manuel Alejandro Hinojosa Jara',
      valor: 10000.0,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Transferência Interna',
      observacao: 'Transferencia entre contas proprias.',
    },
    {
      dataMovimento: new Date('2026-05-25T12:00:00Z'),
      descricao: 'Renda Fixa - Aplicacao em CDB',
      valor: 10000.0,
      natureza: 'DESPESA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Investimentos',
      observacao: 'Aplicacao em CDB identificada no print do app.',
    },
    {
      dataMovimento: new Date('2026-06-20T12:00:00Z'),
      descricao: 'Rendimento da conta',
      valor: 1.29,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Rendimentos',
      observacao: 'Rendimento liquido sobre dinheiro em conta.',
    },
    {
      dataMovimento: new Date('2026-07-22T12:00:00Z'),
      descricao: 'Rendimento da conta',
      valor: 1.31,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Rendimentos',
      observacao: 'Rendimento liquido sobre dinheiro em conta.',
    },
    {
      dataMovimento: new Date('2026-08-22T12:00:00Z'),
      descricao: 'Rendimento da conta',
      valor: 1.29,
      natureza: 'RECEITA' as const,
      contaSugerida: 'Conta PagBank',
      tipoConta: 'CONTA_CORRENTE' as const,
      categoriaSugerida: 'Rendimentos',
      observacao: 'Rendimento liquido sobre dinheiro em conta.',
    },
  ];

  for (const item of pagbankItems) {
    await prisma.stagingLancamentoImportacao.create({
      data: {
        loteId: lote.id,
        arquivoId: arquivo.id,
        arquivoOrigem: 'PRINT_CHAT_PAGBANK_2026-01_a_2026-09',
        dataMovimento: item.dataMovimento,
        descricao: item.descricao,
        valor: item.valor,
        natureza: item.natureza,
        contaSugerida: item.contaSugerida,
        tipoConta: item.tipoConta,
        categoriaSugerida: item.categoriaSugerida,
        observacao: item.observacao,
        statusProcessamento: 'PENDENTE',
      },
    });
  }

  console.log('Staging preparado com 12 itens. Iniciando consolidação...');
  const res = await importacaoConsolidacaoWorkerService.consolidarLote(lote.id, usuarioId);
  console.log('Resultado da consolidação:', JSON.stringify(res, null, 2));

  const totalMovs = await prisma.movimento.count({
    where: { contaId: conta.id },
  });
  console.log(`Total de movimentos na Conta PagBank no banco: ${totalMovs}`);
}

main()
  .catch((err) => {
    console.error('Erro na execução:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
