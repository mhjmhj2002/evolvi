import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  ValidacaoDeduplicacaoService,
  saoDistintosPorIdentificador,
  saoDuplicatasSemanticas,
  calcularSimilaridadeTexto,
} from './validacao-deduplicacao.service.js';

describe('BUG-22: Resolução Automática de Duplicatas Óbvias (R1 e R2)', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let usuarioToken: string;
  let contaNubankId: string;
  let contaOutroBancoId: string;
  let categoriaMensalidadeId: string;
  let categoriaOutrosId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar usuário de teste
    const email = `user-bug22-${Date.now()}@teste.com`;
    const resCad = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario BUG-22 Teste',
        email,
        senha: 'SenhaForte123!',
      },
    });
    const bodyCad = JSON.parse(resCad.body);
    usuarioId = bodyCad.usuario.id;
    usuarioToken = bodyCad.token;

    // 2. Criar contas
    const contaNu = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Nubank Conta Corrente',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaNubankId = contaNu.id;

    const contaOutra = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Nubank Cartão de Crédito',
        tipo: 'CARTAO_CREDITO',
      },
    });
    contaOutroBancoId = contaOutra.id;

    // 3. Categorias
    let catMensalidade = await prisma.categoria.findFirst({
      where: { nome: { equals: 'Mensalidade', mode: 'insensitive' } },
    });
    if (!catMensalidade) {
      catMensalidade = await prisma.categoria.create({ data: { nome: 'Mensalidade' } });
    }
    categoriaMensalidadeId = catMensalidade.id;

    let catOutros = await prisma.categoria.findFirst({
      where: { nome: { equals: 'Outros', mode: 'insensitive' } },
    });
    if (!catOutros) {
      catOutros = await prisma.categoria.create({ data: { nome: 'Outros' } });
    }
    categoriaOutrosId = catOutros.id;
  });

  afterAll(async () => {
    await prisma.suspeitaMovimento.deleteMany({ where: { usuarioId } });
    await prisma.movimento.deleteMany({ where: { usuarioId } });
    await prisma.conta.deleteMany({ where: { usuarioId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
  });

  it('deve auto-resolver caso R1: mesmo dia, mesmo valor, mesma conta e variação com hífen ("Pagamento de boleto efetuado - UP" vs "Pagamento de boleto efetuado UP")', async () => {
    const dataRef = new Date('2026-08-04T12:00:00.000Z');

    // Registro #1: Mais categorizado (Mensalidade)
    const mov1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaNubankId,
        dataMovimento: dataRef,
        competencia: '2026-08',
        descricao: 'Pagamento de boleto efetuado - UP',
        valor: 1621.83,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: categoriaMensalidadeId,
        origemDocumento: 'extrato-nubank.csv',
        validadoDedupe: 'N',
      },
    });

    // Registro #2: Genérico (Outros)
    const mov2 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaNubankId,
        dataMovimento: dataRef,
        competencia: '2026-08',
        descricao: 'Pagamento de boleto efetuado UP',
        valor: 1621.83,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: categoriaOutrosId,
        origemDocumento: 'lote-ia.pdf',
        validadoDedupe: 'N',
      },
    });

    // Executa a malha fina de deduplicação
    const resultado = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId);

    expect(resultado.totalDuplicatasExcluidas).toBe(1);

    // Consulta os movimentos restantes no banco
    const restantes = await prisma.movimento.findMany({
      where: {
        usuarioId,
        dataMovimento: dataRef,
        valor: 1621.83,
      },
    });

    expect(restantes.length).toBe(1);
    expect(restantes[0].id).toBe(mov1.id);
    expect(restantes[0].categoriaId).toBe(categoriaMensalidadeId);
    expect(restantes[0].validadoDedupe).toBe('S');

    // Confirma que não foi parar como suspeita pendente
    const suspeitas = await prisma.suspeitaMovimento.findMany({
      where: {
        usuarioId,
        OR: [{ movimentoId: mov1.id }, { movimentoSecundarioId: mov2.id }],
      },
    });
    expect(suspeitas.length).toBe(0);
  });

  it('deve auto-resolver caso R2: mesmo dia, mesmo valor, mesma instituição com similaridade > 50%', async () => {
    const dataRef = new Date('2026-08-10T14:00:00.000Z');

    const movA = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaNubankId,
        dataMovimento: dataRef,
        competencia: '2026-08',
        descricao: 'DROGASIL FILIAL CENTRO SP',
        valor: 85.9,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const movB = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaOutroBancoId, // mesma instituição (Nubank)
        dataMovimento: dataRef,
        competencia: '2026-08',
        descricao: 'DROGASIL FILIAL CENTRO',
        valor: 85.9,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const resultado = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId);
    expect(resultado.totalDuplicatasExcluidas).toBe(1);

    const todosMovs = await prisma.movimento.findMany({
      where: { usuarioId },
    });

    const restantes = todosMovs.filter(m => m.id === resultado.detalhesExclusoes[0]?.idPreservado);
    expect(restantes.length).toBe(1);
    expect(restantes[0].validadoDedupe).toBe('S');
  });
});
