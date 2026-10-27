import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { prisma } from '../../infrastructure/database/prisma.ts';

describe('Funcionalidade: Catálogo de Lojas e Regras Automáticas de Categorização por Vendedor', () => {
  let app: FastifyInstance;
  let authToken: string;
  let usuarioId: string;
  let contaId: string;
  let categoriaAlimentacaoId: string;
  let categoriaOutrosId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Cria usuário de teste exclusivo
    const email = `test-regras-vendedor-${Date.now()}@evolvi.app`;
    const resAuth = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        email,
        senha: 'SenhaForte123!',
        nome: 'Usuario Teste Regras Vendedor',
      },
    });

    expect(resAuth.statusCode).toBe(201);
    const bodyAuth = JSON.parse(resAuth.body);
    authToken = bodyAuth.token;
    usuarioId = bodyAuth.usuario.id;

    // 2. Cria conta bancária
    const conta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta Corrente Santander',
        tipo: 'CONTA_CORRENTE',
      },
    });
    contaId = conta.id;

    // 3. Categorias de teste
    let catAlim = await prisma.categoria.findFirst({
      where: {
        OR: [
          { nome: { equals: 'Alimentação', mode: 'insensitive' } },
          { nome: { equals: 'Alimentacao', mode: 'insensitive' } },
        ],
      },
    });
    if (!catAlim) {
      catAlim = await prisma.categoria.create({ data: { nome: 'Alimentação' } });
    }
    categoriaAlimentacaoId = catAlim.id;

    let catOutros = await prisma.categoria.findFirst({
      where: { nome: { equals: 'Outros', mode: 'insensitive' } },
    });
    if (!catOutros) {
      catOutros = await prisma.categoria.create({ data: { nome: 'Outros' } });
    }
    categoriaOutrosId = catOutros.id;
  });

  afterAll(async () => {
    if (usuarioId) {
      await prisma.regraVendedorCategoria.deleteMany({ where: { usuarioId } });
      await prisma.suspeitaMovimento.deleteMany({ where: { usuarioId } });
      await prisma.movimento.deleteMany({ where: { usuarioId } });
      await prisma.conta.deleteMany({ where: { usuarioId } });
      await prisma.categoria.deleteMany({ where: { usuarioId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    }
    if (app) {
      await app.close();
    }
  });

  it('1. Deve salvar regra no catálogo e propagar para lançamentos similares da mesma loja ao aplicar DEFINIR_CATEGORIA', async () => {
    // Cria 3 lançamentos do mesmo estabelecimento (MS-EMBALAGENS) em Outros
    const mov1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        descricao: 'COMPRA CARTAO - MS-EMBALAGENS LOJA 01',
        valor: 150.0,
        dataMovimento: new Date('2026-10-10'),
        competencia: '2026-10',
        natureza: 'DESPESA',
        categoriaId: categoriaOutrosId,
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    const mov2 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        descricao: 'MS-EMBALAGENS VILA VELHA',
        valor: 85.0,
        dataMovimento: new Date('2026-10-12'),
        competencia: '2026-10',
        natureza: 'DESPESA',
        categoriaId: categoriaOutrosId,
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    const mov3 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        descricao: 'PGTO MS-EMBALAGENS MATRIZ',
        valor: 42.0,
        dataMovimento: new Date('2026-10-15'),
        competencia: '2026-10',
        natureza: 'DESPESA',
        categoriaId: categoriaOutrosId,
        categoriaFixadaPeloUsuario: false,
        validadoDedupe: 'N',
      },
    });

    // Cria suspeita pendente para mov1 e mov2
    const suspeita1 = await prisma.suspeitaMovimento.create({
      data: {
        usuarioId,
        movimentoId: mov1.id,
        tipo: 'SUSPEITA_CATEGORIZACAO',
        confianca: 0.95,
        motivo: 'Lançamento em Outros',
        status: 'PENDENTE',
      },
    });

    const suspeita2 = await prisma.suspeitaMovimento.create({
      data: {
        usuarioId,
        movimentoId: mov2.id,
        tipo: 'SUSPEITA_CATEGORIZACAO',
        confianca: 0.95,
        motivo: 'Lançamento em Outros',
        status: 'PENDENTE',
      },
    });

    // 1. Consulta suspeitas via GET /api/movimentos/suspeitas
    const resGetSuspeitas = await app.inject({
      method: 'GET',
      url: '/api/movimentos/suspeitas',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(resGetSuspeitas.statusCode).toBe(200);
    const bodySuspeitas = JSON.parse(resGetSuspeitas.body);
    const itemSuspeita = bodySuspeitas.suspeitasCategorizacao.find(
      (s: any) => s.id === suspeita1.id
    );
    expect(itemSuspeita).toBeDefined();
    expect(itemSuspeita.termoVendedor).toContain('MS-EMBALAGENS');
    expect(itemSuspeita.totalSimilaresVendedor).toBeGreaterThanOrEqual(2);

    // 2. Aplica veredito DEFINIR_CATEGORIA com propagarMesmoVendedor=true e memorizarRegraVendedor=true
    const resVeredito = await app.inject({
      method: 'POST',
      url: `/api/movimentos/suspeitas/${suspeita1.id}/veredito`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        acao: 'DEFINIR_CATEGORIA',
        categoriaId: categoriaAlimentacaoId,
        propagarMesmoVendedor: true,
        memorizarRegraVendedor: true,
      },
    });

    expect(resVeredito.statusCode).toBe(200);
    const bodyVeredito = JSON.parse(resVeredito.body);
    expect(bodyVeredito.sucesso).toBe(true);
    expect(bodyVeredito.regraMemorizada).toBe(true);
    expect(bodyVeredito.vendedorPropagados).toBeGreaterThanOrEqual(2);

    // 3. Verifica se regra foi persistida no banco
    const regraNoBanco = await prisma.regraVendedorCategoria.findFirst({
      where: {
        usuarioId,
        categoriaId: categoriaAlimentacaoId,
      },
    });
    expect(regraNoBanco).toBeDefined();
    expect(regraNoBanco?.termoVendedor).toBe('MS-EMBALAGENS');

    // 4. Verifica se os movimentos mov2 e mov3 foram atualizados e travados
    const mov2Atualizado = await prisma.movimento.findUnique({ where: { id: mov2.id } });
    const mov3Atualizado = await prisma.movimento.findUnique({ where: { id: mov3.id } });

    expect(mov2Atualizado?.categoriaId).toBe(categoriaAlimentacaoId);
    expect(mov2Atualizado?.categoriaFixadaPeloUsuario).toBe(true);
    expect(mov3Atualizado?.categoriaId).toBe(categoriaAlimentacaoId);
    expect(mov3Atualizado?.categoriaFixadaPeloUsuario).toBe(true);

    // 5. Verifica se a suspeita de mov2 foi resolvida automaticamente
    const suspeita2Atualizada = await prisma.suspeitaMovimento.findUnique({ where: { id: suspeita2.id } });
    expect(suspeita2Atualizada?.status).toBe('RESOLVIDO');
  });

  it('2. Deve listar as regras no endpoint GET /api/categorias/regras-vendedor e permitir exclusão via DELETE', async () => {
    // Lista regras
    const resList = await app.inject({
      method: 'GET',
      url: '/api/categorias/regras-vendedor',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(resList.statusCode).toBe(200);
    const bodyList = JSON.parse(resList.body);
    expect(bodyList.regras).toBeInstanceOf(Array);
    expect(bodyList.regras.length).toBeGreaterThanOrEqual(1);

    const regraCriada = bodyList.regras.find((r: any) => r.termoVendedor === 'MS-EMBALAGENS');
    expect(regraCriada).toBeDefined();
    expect(regraCriada.categoriaId).toBe(categoriaAlimentacaoId);

    // Exclui a regra criada
    const resDel = await app.inject({
      method: 'DELETE',
      url: `/api/categorias/regras-vendedor/${regraCriada.id}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(resDel.statusCode).toBe(200);
    const bodyDel = JSON.parse(resDel.body);
    expect(bodyDel.sucesso).toBe(true);

    // Confirma que não existe mais no banco
    const regraAposDel = await prisma.regraVendedorCategoria.findUnique({
      where: { id: regraCriada.id },
    });
    expect(regraAposDel).toBeNull();
  });

  it('3. Deve categorizar somente a compra e suas parcelas irmãs sem propagar para outras compras do vendedor e sem salvar regra no catálogo', async () => {
    // Cria compra parcelada da Amazon (3 parcelas de R$ 50,00)
    const compraParcelada1 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        descricao: 'Amazon - Parcela 1/3',
        valor: 50.0,
        dataMovimento: new Date('2026-06-01'),
        competencia: '2026-06',
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: null,
      },
    });

    const compraParcelada2 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        descricao: 'Amazon - Parcela 2/3',
        valor: 50.0,
        dataMovimento: new Date('2026-07-01'),
        competencia: '2026-07',
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: null,
      },
    });

    const compraParcelada3 = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        descricao: 'Amazon - Parcela 3/3',
        valor: 50.0,
        dataMovimento: new Date('2026-08-01'),
        competencia: '2026-08',
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: null,
      },
    });

    // Cria outra compra distinta da Amazon (ex: compra à vista de livros de R$ 120,00)
    const outraCompraAmazon = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        descricao: 'Amazon Marketplace Livros',
        valor: 120.0,
        dataMovimento: new Date('2026-06-15'),
        competencia: '2026-06',
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        categoriaId: null,
      },
    });

    const suspeitaAmazonParcela1 = await prisma.suspeitaMovimento.create({
      data: {
        usuarioId,
        movimentoId: compraParcelada1.id,
        tipo: 'SUSPEITA_CATEGORIZACAO',
        confianca: 0.95,
        status: 'PENDENTE',
        motivo: 'Compra sem categoria definida',
      },
    });

    // Usuário categoriza Parcela 1/3 como "Alimentação", mas escolhe:
    // propagarMesmoVendedor = false (apenas esta compra + parcelas)
    // memorizarRegraVendedor = false (não salvar regra para a loja toda)
    const resVeredito = await app.inject({
      method: 'POST',
      url: `/api/movimentos/suspeitas/${suspeitaAmazonParcela1.id}/veredito`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        acao: 'DEFINIR_CATEGORIA',
        categoriaId: categoriaAlimentacaoId,
        propagarMesmoVendedor: false,
        memorizarRegraVendedor: false,
      },
    });

    expect(resVeredito.statusCode).toBe(200);
    const bodyVeredito = JSON.parse(resVeredito.body);
    expect(bodyVeredito.sucesso).toBe(true);
    expect(bodyVeredito.regraMemorizada).toBe(false);
    expect(bodyVeredito.parcelasPropagadas).toBe(2); // Parcela 2/3 e 3/3
    expect(bodyVeredito.vendedorPropagados).toBe(0); // NÃO propagou para outraCompraAmazon

    // 1. Verifica se as 3 parcelas foram categorizadas
    const p1Atualizada = await prisma.movimento.findUnique({ where: { id: compraParcelada1.id } });
    const p2Atualizada = await prisma.movimento.findUnique({ where: { id: compraParcelada2.id } });
    const p3Atualizada = await prisma.movimento.findUnique({ where: { id: compraParcelada3.id } });

    expect(p1Atualizada?.categoriaId).toBe(categoriaAlimentacaoId);
    expect(p2Atualizada?.categoriaId).toBe(categoriaAlimentacaoId);
    expect(p3Atualizada?.categoriaId).toBe(categoriaAlimentacaoId);

    // 2. Verifica que a outra compra da Amazon PERMANECEU intacta (sem categoria)
    const outraCompraAtualizada = await prisma.movimento.findUnique({ where: { id: outraCompraAmazon.id } });
    expect(outraCompraAtualizada?.categoriaId).toBeNull();
    expect(outraCompraAtualizada?.categoriaFixadaPeloUsuario).toBe(false);

    // 3. Verifica que NENHUMA regra no catálogo foi gravada para "AMAZON"
    const regraAmazon = await prisma.regraVendedorCategoria.findFirst({
      where: {
        usuarioId,
        termoVendedor: { contains: 'AMAZON', mode: 'insensitive' },
      },
    });
    expect(regraAmazon).toBeNull();
  });
});
