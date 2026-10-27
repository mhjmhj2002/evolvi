import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { FaturaConciliacaoService } from './fatura-conciliacao.service.js';

describe('BUG-21: Detecção e Conciliação de Pagamentos de Fatura de Cartão', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let usuarioToken: string;
  let contaCorrenteId: string;
  let contaCartaoId: string;
  let loteId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar usuário de teste
    const email = `user-bug21-${Date.now()}@teste.com`;
    const resCad = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario BUG-21 Fatura',
        email,
        senha: 'SenhaForte123!',
      },
    });
    const bodyCad = JSON.parse(resCad.body);
    usuarioId = bodyCad.usuario.id;
    usuarioToken = bodyCad.token;

    // 2. Criar contas
    const cc = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta Corrente Itaú',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaCorrenteId = cc.id;

    const cartao = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Cartão C6 Carbon',
        tipo: 'CARTAO_CREDITO',
      },
    });
    contaCartaoId = cartao.id;

    // 3. Criar lote de importação
    const lote = await prisma.loteImportacao.create({
      data: {
        usuarioId,
        caminhoDiretorio: `test-lote-${Date.now()}`,
        status: 'CONCLUIDO',
      },
    });
    loteId = lote.id;
  });

  afterAll(async () => {
    await prisma.suspeitaMovimento.deleteMany({ where: { usuarioId } });
    await prisma.movimento.deleteMany({ where: { usuarioId } });
    await prisma.arquivoImportacao.deleteMany({ where: { loteId } });
    await prisma.loteImportacao.deleteMany({ where: { usuarioId } });
    await prisma.conta.deleteMany({ where: { usuarioId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
  });

  it('deve conciliar caso a + b: mesmo valor da fatura, pago até o vencimento e descrição com termo de fatura (ex: PAG BOLETO BANCO C6 S.A.)', async () => {
    const dataVencimento = new Date('2026-09-15T12:00:00.000Z');
    const dataPagamento = new Date('2026-09-15T10:00:00.000Z');

    // 1. Cria o arquivo de fatura de cartão registrado
    const arquivoFatura = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        usuarioId,
        nomeArquivo: 'Fatura_C6_Setembro_2026.pdf',
        caminhoRelativo: 'Fatura_C6_Setembro_2026.pdf',
        status: 'PROCESSADO_FINAL',
        eFaturaCartao: true,
        faturaDataVencimento: dataVencimento,
        faturaValorTotal: 8410.03,
        faturaStatusValidacao: 'PENDENTE',
      },
    });

    // 2. Cria o lançamento de débito na conta corrente (inicialmente classificado como DESPESA)
    const movPagamento = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaCorrenteId,
        dataMovimento: dataPagamento,
        competencia: '2026-09',
        descricao: 'PAG BOLETO BANCO C6 S.A.',
        valor: 8410.03,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    // 3. Executa o serviço de conciliação de fatura
    const resultado = await FaturaConciliacaoService.executarParaUsuario(usuarioId);
    expect(resultado.totalFaturasConciliadas).toBe(1);

    // 4. Verifica que o movimento foi convertido em TRANSFERENCIA_PROPRIA
    const movAtualizado = await prisma.movimento.findUnique({
      where: { id: movPagamento.id },
    });
    expect(movAtualizado?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(movAtualizado?.categoriaId).toBeNull();

    // 5. Verifica que o arquivo foi atualizado com o id do movimento
    const arquivoAtualizado = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoFatura.id },
    });
    expect(arquivoAtualizado?.faturaPagamentoMovimentoId).toBe(movPagamento.id);
    expect(arquivoAtualizado?.faturaStatusValidacao).toBe('CONCILIADO');
  });

  it('deve conciliar caso c: pagamento após o vencimento com valor até 5% maior (juros/multa)', async () => {
    const dataVencimento = new Date('2026-09-10T12:00:00.000Z');
    const dataPagamentoAtrasado = new Date('2026-09-15T12:00:00.000Z');

    // Fatura de R$ 200,00 com vencimento em 10/09
    const arquivoFatura = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        usuarioId,
        nomeArquivo: 'Fatura_Bradescard_2026-09.pdf',
        caminhoRelativo: 'Fatura_Bradescard_2026-09.pdf',
        status: 'PROCESSADO_FINAL',
        eFaturaCartao: true,
        faturaDataVencimento: dataVencimento,
        faturaValorTotal: 200.0,
        faturaStatusValidacao: 'PENDENTE',
      },
    });

    // Pagamento em 15/09 (5 dias após) com valor R$ 204,50 (2,25% de juros/multa)
    const movPagamento = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaCorrenteId,
        dataMovimento: dataPagamentoAtrasado,
        competencia: '2026-09',
        descricao: 'PAG BOLETO BANCO BRADESCARD S A',
        valor: 204.5,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const resultado = await FaturaConciliacaoService.executarParaUsuario(usuarioId);
    expect(resultado.totalFaturasConciliadas).toBe(1);

    const movAtualizado = await prisma.movimento.findUnique({
      where: { id: movPagamento.id },
    });
    expect(movAtualizado?.natureza).toBe('TRANSFERENCIA_PROPRIA');

    const arquivoAtualizado = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoFatura.id },
    });
    expect(arquivoAtualizado?.faturaPagamentoMovimentoId).toBe(movPagamento.id);
    expect(arquivoAtualizado?.faturaStatusValidacao).toBe('CONCILIADO');
  });

  it('deve enviar para a Central de Suspeitas caso atenda apenas critério isolado (a isolado sem descrição clara de fatura)', async () => {
    const dataVencimento = new Date('2026-09-20T12:00:00.000Z');
    const dataDebito = new Date('2026-09-18T12:00:00.000Z');

    const arquivoFatura = await prisma.arquivoImportacao.create({
      data: {
        loteId,
        usuarioId,
        nomeArquivo: 'Fatura_Nubank_2026-09.pdf',
        caminhoRelativo: 'Fatura_Nubank_2026-09.pdf',
        status: 'PROCESSADO_FINAL',
        eFaturaCartao: true,
        faturaDataVencimento: dataVencimento,
        faturaValorTotal: 550.0,
        faturaStatusValidacao: 'PENDENTE',
      },
    });

    // Débito com mesmo valor na janela, mas com descrição genérica sem termos de fatura
    const movDebito = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaCorrenteId,
        dataMovimento: dataDebito,
        competencia: '2026-09',
        descricao: 'DEBITO DIVERSOS SERVICOS',
        valor: 550.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const resultado = await FaturaConciliacaoService.executarParaUsuario(usuarioId);
    expect(resultado.totalSuspeitasCriadas).toBe(1);

    // O movimento continua como DESPESA até veredito do usuário
    const movVerif = await prisma.movimento.findUnique({
      where: { id: movDebito.id },
    });
    expect(movVerif?.natureza).toBe('DESPESA');

    // Confirma que a suspeita foi aberta na Central
    const suspeita = await prisma.suspeitaMovimento.findFirst({
      where: {
        usuarioId,
        movimentoId: movDebito.id,
        tipo: 'SUSPEITA_APORTE',
      },
    });
    expect(suspeita).toBeDefined();
    expect(suspeita?.sugestaoNatureza).toBe('TRANSFERENCIA_PROPRIA');
  });
});
