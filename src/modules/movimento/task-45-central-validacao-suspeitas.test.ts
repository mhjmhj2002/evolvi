import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { MovimentoRecalculoService } from './movimento-recalculo.service.js';
import { ValidacaoDeduplicacaoService } from './validacao-deduplicacao.service.js';

describe('TASK-45: Central de Validação de Suspeitas do Usuário (Malha Fina & Decisões Soberanas)', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let usuarioToken: string;
  let outroUsuarioId: string;
  let outroUsuarioToken: string;
  let contaId: string;
  let categoriaAlimentacaoId: string;
  let categoriaInvestimentosId: string;
  let categoriaOutrosId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar usuário principal
    const email = `user-task45-${Date.now()}@teste.com`;
    const resCad = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Task45 Suspeitas',
        email,
        senha: 'SenhaForte123!',
      },
    });
    const bodyCad = JSON.parse(resCad.body);
    usuarioId = bodyCad.usuario.id;
    usuarioToken = bodyCad.token;

    // 2. Criar outro usuário para isolamento multi-tenant
    const emailOutro = `outro-task45-${Date.now()}@teste.com`;
    const resCadOutro = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Outro Usuario Task45',
        email: emailOutro,
        senha: 'SenhaForte123!',
      },
    });
    const bodyOutro = JSON.parse(resCadOutro.body);
    outroUsuarioId = bodyOutro.usuario.id;
    outroUsuarioToken = bodyOutro.token;

    // 3. Criar conta para usuário principal
    const conta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta Corrente Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaId = conta.id;

    // 4. Categorias de teste
    let catAlim = await prisma.categoria.findFirst({
      where: {
        OR: [
          { nome: { equals: 'Alimentação', mode: 'insensitive' } },
          { nome: { equals: 'Alimentacao', mode: 'insensitive' } },
        ],
      },
    });
    if (!catAlim) {
      catAlim = await prisma.categoria.findFirst({ where: { categoriaPaiId: null } });
    }
    categoriaAlimentacaoId = catAlim!.id;

    let catInv = await prisma.categoria.findFirst({
      where: { nome: { contains: 'Investimentos', mode: 'insensitive' } },
    });
    if (!catInv) {
      catInv = await prisma.categoria.create({ data: { nome: 'Investimentos' } });
    }
    categoriaInvestimentosId = catInv.id;

    let catOutros = await prisma.categoria.findFirst({
      where: { nome: { equals: 'Outros', mode: 'insensitive' } },
    });
    if (!catOutros) {
      catOutros = await prisma.categoria.create({ data: { nome: 'Outros' } });
    }
    categoriaOutrosId = catOutros.id;
  });

  afterAll(async () => {
    await prisma.movimento.deleteMany({
      where: { usuarioId: { in: [usuarioId, outroUsuarioId] } },
    });
    await prisma.conta.deleteMany({
      where: { usuarioId: { in: [usuarioId, outroUsuarioId] } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: [usuarioId, outroUsuarioId] } },
    });
  });

  it('1. GET /api/movimentos/suspeitas deve detectar suspeitas de duplicata, aportes e categorização com isolamento multi-tenant', async () => {
    const dataRef = new Date('2026-10-15T00:00:00.000Z');

    // Cria par com suspeita de duplicata para usuarioId
    const movA = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-10',
        descricao: 'COMPRA DROGA RAIA FARMACIA',
        valor: 95.5,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const movB = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-10',
        descricao: 'DROGA RAIA - FARMACIA 14/10',
        valor: 95.5,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    // Cria movimento suspeito de aporte (está como DESPESA com termos de CDB)
    const movAporte = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-10',
        descricao: 'APLICAÇÃO DE CDB LIQUIDEZ DIARIA',
        valor: 2000.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    // Cria movimento sem categoria de alta materialidade em "Outros"
    const movOutros = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: categoriaOutrosId,
        dataMovimento: new Date('2026-10-18T00:00:00.000Z'), // Domingo
        competencia: '2026-10',
        descricao: 'BARRACA DE PASTEL DA FEIRA',
        valor: 120.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    // Consulta fila de suspeitas do usuário principal
    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas',
      headers: { authorization: `Bearer ${usuarioToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.totalPendentes).toBeGreaterThanOrEqual(3);
    expect(body.suspeitasDuplicatas.length).toBeGreaterThanOrEqual(1);
    expect(body.suspeitasAportes.length).toBeGreaterThanOrEqual(1);
    expect(body.suspeitasCategorizacao.length).toBeGreaterThanOrEqual(1);

    // Garante que o outro usuário não vê nada (multi-tenant)
    const resOutro = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas',
      headers: { authorization: `Bearer ${outroUsuarioToken}` },
    });
    const bodyOutro = JSON.parse(resOutro.body);
    expect(bodyOutro.totalPendentes).toBe(0);
    expect(bodyOutro.suspeitasDuplicatas.length).toBe(0);
  });

  it('2. POST /api/movimentos/suspeitas/:id/veredito - Resolução de Duplicata (Descartar uma e Imunizar a outra)', async () => {
    const dataRef = new Date('2026-10-12T00:00:00.000Z');

    const mov1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-10',
        descricao: 'PIX ENVIADO MERCADO CENTRAL',
        valor: 180.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const mov2 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-10',
        descricao: 'PIX ENVIADO - MERCADO CENTRAL',
        valor: 180.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    // Usuário arbitra que mov2 deve ser descartado, preservando mov1
    const res = await app.inject({
      method: 'POST',
      url: `/api/movimentos/suspeitas/${mov1.id}/veredito`,
      headers: { authorization: `Bearer ${usuarioToken}` },
      payload: {
        acao: 'CONFIRMAR_DUPLICATA_DESCARTAR',
        duplicataId: mov2.id,
        observacao: 'Descartado duplicata via Central de Validação',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sucesso).toBe(true);

    // Confere que mov2 foi excluído do banco
    const mov2NoBanco = await prisma.movimento.findUnique({ where: { id: mov2.id } });
    expect(mov2NoBanco).toBeNull();

    // Confere que mov1 foi preservado e blindado soberanamente
    const mov1NoBanco = await prisma.movimento.findUnique({ where: { id: mov1.id } });
    expect(mov1NoBanco).toBeDefined();
    expect(mov1NoBanco?.validadoDedupe).toBe('S');
    expect(mov1NoBanco?.categoriaFixadaPeloUsuario).toBe(true);
    expect(mov1NoBanco?.observacao).toContain('Central de Validação');
  });

  it('3. POST /api/movimentos/suspeitas/:id/veredito - Resolução de Duplicata (Confirmar Compras Distintas e Preservar Ambos)', async () => {
    const dataRef = new Date('2026-10-14T00:00:00.000Z');

    const movA = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-10',
        descricao: 'BARRACA DO JULIO ALMOCO',
        valor: 45.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const movB = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-10',
        descricao: 'BARRACA DO JULIO JANTAR',
        valor: 45.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    // Usuário emite veredito confirmando que são compras distintas legítimas
    const res = await app.inject({
      method: 'POST',
      url: `/api/movimentos/suspeitas/${movA.id}/veredito`,
      headers: { authorization: `Bearer ${usuarioToken}` },
      payload: {
        acao: 'CONFIRMAR_DISTINTOS_PRESERVAR',
        duplicataId: movB.id,
      },
    });

    expect(res.statusCode).toBe(200);

    const movANoBanco = await prisma.movimento.findUnique({ where: { id: movA.id } });
    const movBNoBanco = await prisma.movimento.findUnique({ where: { id: movB.id } });

    expect(movANoBanco).toBeDefined();
    expect(movBNoBanco).toBeDefined();
    expect(movANoBanco?.validadoDedupe).toBe('S');
    expect(movANoBanco?.categoriaFixadaPeloUsuario).toBe(true);
    expect(movBNoBanco?.validadoDedupe).toBe('S');
    expect(movBNoBanco?.categoriaFixadaPeloUsuario).toBe(true);

    // Executa a malha fina com reprocessarTudo e garante que NENHUM dos dois é apagado
    await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioId, {
      reprocessarTudo: true,
    });

    const movAAposMalha = await prisma.movimento.findUnique({ where: { id: movA.id } });
    const movBAposMalha = await prisma.movimento.findUnique({ where: { id: movB.id } });
    expect(movAAposMalha).toBeDefined();
    expect(movBAposMalha).toBeDefined();
  });

  it('4. POST /api/movimentos/suspeitas/:id/veredito - Resolução de Natureza (Converter em Aporte Patrimonial)', async () => {
    const mov = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: new Date('2026-10-10T00:00:00.000Z'),
        competencia: '2026-10',
        descricao: 'COMPRA ATIVOS DE RENDA FIXA',
        valor: 5000.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/movimentos/suspeitas/${mov.id}/veredito`,
      headers: { authorization: `Bearer ${usuarioToken}` },
      payload: {
        acao: 'CONVERTER_APORTE_PATRIMONIAL',
        categoriaId: categoriaInvestimentosId,
      },
    });

    expect(res.statusCode).toBe(200);
    const movAtualizado = await prisma.movimento.findUnique({ where: { id: mov.id } });
    expect(movAtualizado?.natureza).toBe('APORTE_PATRIMONIAL');
    expect(movAtualizado?.categoriaId).toBe(categoriaInvestimentosId);
    expect(movAtualizado?.categoriaFixadaPeloUsuario).toBe(true);
    expect(movAtualizado?.validadoDedupe).toBe('S');
  });

  it('5. Garantia de Imunização: MovimentoRecalculoService NUNCA deve alterar registros validados soberanamente pelo usuário', async () => {
    // Movimento validado como DESPESA pelo usuário com termo que a IA acharia que é aporte
    const movDespesaValidada = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: new Date('2026-10-05T00:00:00.000Z'),
        competencia: '2026-10',
        descricao: 'INVESTIMENTO EM CURSO PROFISSIONALIZANTE',
        valor: 650.0,
        natureza: 'DESPESA',
        categoriaId: categoriaAlimentacaoId,
        categoriaFixadaPeloUsuario: true, // Imunizado
        validadoDedupe: 'S',             // Validado soberano
      },
    });

    // Forçar recálculo completo de regras
    await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuarioId, true);

    const aposRecalculo = await prisma.movimento.findUnique({
      where: { id: movDespesaValidada.id },
    });

    // Deve permanecer DESPESA e com a categoria original intacta!
    expect(aposRecalculo?.natureza).toBe('DESPESA');
    expect(aposRecalculo?.categoriaId).toBe(categoriaAlimentacaoId);
    expect(aposRecalculo?.categoriaFixadaPeloUsuario).toBe(true);
    expect(aposRecalculo?.validadoDedupe).toBe('S');
  });

  it('6. GET /api/movimentos/suspeitas NÃO deve levantar suspeita de duplicata para compras distintas (ex: Supermercados Bh vs Cacau Show) com similaridade < 50%', async () => {
    const dataCompra = new Date('2026-06-16T12:00:00.000Z');

    // Supermercados Bh
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataCompra,
        competencia: '2026-06',
        descricao: 'Supermercados Bh',
        valor: 33.94,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    // Cacau Show (mesmo dia, mesmo valor R$ 33.94, mesma conta)
    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataCompra,
        competencia: '2026-06',
        descricao: 'Cacau Show',
        valor: 33.94,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas',
      headers: { authorization: `Bearer ${usuarioToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // O par 'Supermercados Bh' e 'Cacau Show' NÃO deve figurar entre as suspeitas de duplicata
    const parCacauSupermercado = body.suspeitasDuplicatas.find(
      (s: any) =>
        (s.movimentoA.descricao.includes('Supermercados Bh') && s.movimentoB.descricao.includes('Cacau Show')) ||
        (s.movimentoA.descricao.includes('Cacau Show') && s.movimentoB.descricao.includes('Supermercados Bh'))
    );
    expect(parCacauSupermercado).toBeUndefined();
  });

  it('7. GET /api/movimentos/suspeitas DEVE levantar suspeita de duplicata para nomes semelhantes >= 50% (ex: Padaria Central vs Padaria Central Ltda)', async () => {
    const dataCompra = new Date('2026-07-20T10:00:00.000Z');

    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataCompra,
        competencia: '2026-07',
        descricao: 'Padaria Central Centro',
        valor: 45.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataCompra,
        competencia: '2026-07',
        descricao: 'Padaria Central',
        valor: 45.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas?similaridadeMinima=0.5',
      headers: { authorization: `Bearer ${usuarioToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const parPadaria = body.suspeitasDuplicatas.find(
      (s: any) =>
        s.movimentoA.descricao.includes('Padaria Central') && s.movimentoB.descricao.includes('Padaria Central')
    );
    expect(parPadaria).toBeDefined();
    expect(parPadaria.confianca).toBeGreaterThanOrEqual(0.5);
  });

  it('8. GET /api/movimentos/suspeitas - Não deve apontar suspeita de duplicata para PIXs com mesmo prefixo mas favorecidos distintos', async () => {
    const dataPix = new Date('2026-05-18T00:00:00.000Z');

    const pix1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataPix,
        competencia: '2026-05',
        descricao: 'PIX ENVIADO - Lissette Dangen Labarca E',
        valor: 500.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
        idOrigem: 'DOC-194582',
      },
    });

    const pix2 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataPix,
        competencia: '2026-05',
        descricao: 'PIX ENVIADO - Daniela Beatriz Labarca H',
        valor: 500.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
        idOrigem: 'DOC-748948',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas',
      headers: { authorization: `Bearer ${usuarioToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // O par com favorecidos distintos NÃO deve constar na fila de suspeitas de duplicatas
    const parPix = body.suspeitasDuplicatas.find(
      (s: any) =>
        (s.movimentoA.id === pix1.id && s.movimentoB.id === pix2.id) ||
        (s.movimentoA.id === pix2.id && s.movimentoB.id === pix1.id)
    );
    expect(parPix).toBeUndefined();
  });

  it('9. GET /api/movimentos/suspeitas NÃO deve levantar suspeita de duplicata para TRANSFERENCIA_PROPRIA entre contas distintas (contrapartidas de débito e crédito)', async () => {
    // Cria outra conta para o mesmo usuário
    const outraConta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Nubank',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 0,
      },
    });

    const dataTransf = new Date('2026-07-28T00:00:00.000Z');

    const movDebito = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId, // Conta Inter
        dataMovimento: dataTransf,
        competencia: '2026-07',
        descricao: 'Transferência enviada pelo Pix - MANUEL ALEJANDRO HINOJOSA JARA (Transferência enviada)',
        valor: 50.0,
        natureza: 'TRANSFERENCIA_PROPRIA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const movCredito = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: outraConta.id, // Conta Nubank
        dataMovimento: dataTransf,
        competencia: '2026-07',
        descricao: 'Pix recebido - Manuel Alejandro Hinojosa Jara',
        valor: 50.0,
        natureza: 'TRANSFERENCIA_PROPRIA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas',
      headers: { authorization: `Bearer ${usuarioToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const parTransf = body.suspeitasDuplicatas.find(
      (s: any) =>
        (s.movimentoA.id === movDebito.id && s.movimentoB.id === movCredito.id) ||
        (s.movimentoA.id === movCredito.id && s.movimentoB.id === movDebito.id)
    );
    expect(parTransf).toBeUndefined();
  });

  it('10. POST /api/movimentos/suspeitas/:id/veredito - Resolução de Natureza (Converter em Transferência Própria e Vincular)', async () => {
    const outraConta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Neon',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 0,
      },
    });

    const dataRef = new Date('2026-08-01T00:00:00.000Z');

    const movA = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-08',
        descricao: 'PIX ENVIADO TITULAR',
        valor: 200.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const movB = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: outraConta.id,
        dataMovimento: dataRef,
        competencia: '2026-08',
        descricao: 'PIX RECEBIDO TITULAR',
        valor: 200.0,
        natureza: 'RECEITA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/movimentos/suspeitas/${movA.id}/veredito`,
      headers: { authorization: `Bearer ${usuarioToken}` },
      payload: {
        acao: 'CONVERTER_TRANSFERENCIA_PROPRIA',
        duplicataId: movB.id,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sucesso).toBe(true);

    const movAAtualizado = await prisma.movimento.findUnique({ where: { id: movA.id } });
    const movBAtualizado = await prisma.movimento.findUnique({ where: { id: movB.id } });

    expect(movAAtualizado?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(movAAtualizado?.transferenciaVinculoId).toBe(movB.id);
    expect(movAAtualizado?.validadoDedupe).toBe('S');
    expect(movAAtualizado?.categoriaFixadaPeloUsuario).toBe(true);

    expect(movBAtualizado?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    expect(movBAtualizado?.transferenciaVinculoId).toBe(movA.id);
    expect(movBAtualizado?.validadoDedupe).toBe('S');
    expect(movBAtualizado?.categoriaFixadaPeloUsuario).toBe(true);
  });

  it('11. GET /api/movimentos/suspeitas NÃO deve levantar suspeita de duplicata para compras parceladas com "(Parcela 02 de 03)"', async () => {
    const dataRef = new Date('2026-05-16T00:00:00.000Z');

    const movP2 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-05',
        descricao: 'DECATHLON (Parcela 02 de 03)',
        valor: 56.66,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const movP3 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-05',
        descricao: 'DECATHLON (Parcela 03 de 03)',
        valor: 56.66,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas',
      headers: { authorization: `Bearer ${usuarioToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const parDecathlon = body.suspeitasDuplicatas.find(
      (s: any) =>
        (s.movimentoA.id === movP2.id && s.movimentoB.id === movP3.id) ||
        (s.movimentoA.id === movP3.id && s.movimentoB.id === movP2.id)
    );
    expect(parDecathlon).toBeUndefined();
  });

  it('12. DEFINIR_CATEGORIA deve propagar categoria para parcelas irmãs e resolver suas suspeitas pendentes', async () => {
    // Cria 2 parcelas de uma compra parcelada "CURSO X - Parcela 1/2" e "CURSO X - Parcela 2/2"
    const movP1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: new Date('2026-07-10T00:00:00.000Z'),
        competencia: '2026-07',
        descricao: 'CURSO X - Parcela 1/2',
        valor: 150.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: categoriaOutrosId,
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    const movP2 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: new Date('2026-08-10T00:00:00.000Z'),
        competencia: '2026-08',
        descricao: 'CURSO X - Parcela 2/2',
        valor: 150.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: categoriaOutrosId,
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    // Cria suspeita pendente para a parcela 2
    const suspP2 = await prisma.suspeitaMovimento.create({
      data: {
        usuarioId,
        movimentoId: movP2.id,
        tipo: 'SUSPEITA_CATEGORIZACAO',
        status: 'PENDENTE',
        confianca: 0.65,
        motivo: 'Alta materialidade em Outros',
      },
    });

    // Aplica veredito DEFINIR_CATEGORIA na parcela 1
    const res = await app.inject({
      method: 'POST',
      url: `/api/movimentos/suspeitas/${movP1.id}/veredito`,
      headers: { authorization: `Bearer ${usuarioToken}` },
      payload: {
        acao: 'DEFINIR_CATEGORIA',
        categoriaId: categoriaAlimentacaoId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sucesso).toBe(true);
    expect(body.parcelasPropagadas).toBe(1);

    // Confere se a parcela 2 foi atualizada automaticamente
    const p2Atualizado = await prisma.movimento.findUnique({ where: { id: movP2.id } });
    expect(p2Atualizado?.categoriaId).toBe(categoriaAlimentacaoId);
    expect(p2Atualizado?.categoriaFixadaPeloUsuario).toBe(true);
    expect(p2Atualizado?.validadoDedupe).toBe('S');

    // Confere se a suspeita da parcela 2 foi resolvida
    const suspP2Atualizada = await prisma.suspeitaMovimento.findUnique({ where: { id: suspP2.id } });
    expect(suspP2Atualizada?.status).toBe('RESOLVIDO');
    expect(suspP2Atualizada?.acaoAplicada).toBe('DEFINIR_CATEGORIA');
  });

  it('13. SuspeitaMovimentoWorkerService NÃO deve levantar SUSPEITA_CATEGORIZACAO para despesas que já estão mapeadas em Aportes Patrimoniais', async () => {
    const dataRef = new Date('2026-05-25T00:00:00.000Z');

    // 1. Cria conta de investimentos (ex: PagBank / Neon)
    const contaInvest = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta PagBank Invest',
        tipo: 'INVESTIMENTO',
      },
    });

    // 2. Cria o Aporte Patrimonial já registrado (ex: R$ 10.000 na conta de investimento)
    const aporte = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId: contaInvest.id,
        dataMovimento: dataRef,
        competencia: '2026-05',
        descricao: 'Renda Fixa - Aplicacao em CDB',
        valor: 10000.0,
        natureza: 'APORTE_PATRIMONIAL',
        status: 'CONCILIADO',
        categoriaFixadaPeloUsuario: true,
        validadoDedupe: 'S',
      },
    });

    // 3. Cria a despesa/débito correspondente na conta corrente (ex: Pix enviado R$ 10.000 do Inter)
    const despesaCorrespondente = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        dataMovimento: dataRef,
        competencia: '2026-05',
        descricao: 'Pix enviado',
        valor: 10000.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: null, // Sem categoria
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'S',
      },
    });

    // 4. Executa a catalogação do worker
    const { SuspeitaMovimentoWorkerService } = await import('./suspeita-movimento-worker.service.js');
    await SuspeitaMovimentoWorkerService.catalogarSuspeitasParaUsuario(usuarioId);

    // 5. Verifica que a despesa NÃO gerou SUSPEITA_CATEGORIZACAO
    const suspeitaGerada = await prisma.suspeitaMovimento.findFirst({
      where: {
        usuarioId,
        movimentoId: despesaCorrespondente.id,
        tipo: 'SUSPEITA_CATEGORIZACAO',
      },
    });

    expect(suspeitaGerada).toBeNull();
  });
});


