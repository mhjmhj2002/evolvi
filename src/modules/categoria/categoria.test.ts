import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Categorias e Benchmarks POF (E2E / Integração)', () => {
  let app: FastifyInstance;

  const testUser = {
    nome: 'Usuario Categorias Teste',
    email: `cat_test_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 7500.0,
  };

  let tokenUser: string;
  let idUser: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const resp = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: testUser,
    });
    const body = JSON.parse(resp.body);
    tokenUser = body.token;
    idUser = body.usuario.id;
  });

  afterAll(async () => {
    if (idUser) {
      await prisma.categoria.deleteMany({
        where: { usuarioId: idUser },
      });
      await prisma.usuario.deleteMany({
        where: { id: idUser },
      });
    }
    await app.close();
  });

  it('deve retornar a árvore completa de categorias com a soma normalizada fechando em 100,00%', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/categorias',
      headers: { authorization: `Bearer ${tokenUser}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.totalCategoriasRaiz).toBeGreaterThanOrEqual(21);
    expect(body.somaReferenciaNormalizadaPct).toBe(100.00);
    expect(Array.isArray(body.categorias)).toBe(true);

    // Verificar se categorias possuem subcategorias embutidas
    const moradia = body.categorias.find((c: { nome: string }) => c.nome === 'Moradia');
    expect(moradia).toBeDefined();
    expect(moradia.referenciaNormalizadaPct).toBeGreaterThan(0);
    expect(Array.isArray(moradia.subcategorias)).toBe(true);
    expect(moradia.subcategorias.length).toBeGreaterThan(0);

    // A soma manual de todas as categorias raízes também deve fechar em 100.00
    const somaReal = body.categorias.reduce(
      (acc: number, c: { referenciaNormalizadaPct: number }) => acc + c.referenciaNormalizadaPct,
      0
    );
    expect(Number(somaReal.toFixed(2))).toBe(100.00);
  });

  it('deve permitir criar uma subcategoria personalizada vinculada ao usuário', async () => {
    // 1. Obter ID da categoria pai (ex: Alimentacao)
    const catPai = await prisma.categoria.findFirst({
      where: { nome: 'Alimentacao', categoriaPaiId: null },
    });
    expect(catPai).toBeDefined();

    const nomeSub = `Delivery Especial Teste ${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/categorias',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: nomeSub,
        categoriaPaiId: catPai!.id,
        descricao: 'Subcategoria personalizada para testes',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.categoria).toBeDefined();
    expect(body.categoria.nome).toBe(nomeSub);
    expect(body.categoria.usuarioId).toBe(idUser);
    expect(body.categoria.categoriaPaiId).toBe(catPai!.id);

    // 2. Verificar que a nova subcategoria aparece na árvore para este usuário
    const treeResp = await app.inject({
      method: 'GET',
      url: '/api/categorias',
      headers: { authorization: `Bearer ${tokenUser}` },
    });
    const treeBody = JSON.parse(treeResp.body);
    const alimentacao = treeBody.categorias.find((c: { id: string }) => c.id === catPai!.id);
    const subCriada = alimentacao.subcategorias.find((s: { nome: string }) => s.nome === nomeSub);
    expect(subCriada).toBeDefined();
  });

  it('deve rejeitar criação de subcategoria duplicada para a mesma categoria pai', async () => {
    const catPai = await prisma.categoria.findFirst({
      where: { nome: 'Moradia', categoriaPaiId: null },
    });

    const nomeDuplicado = `Sub Duplicada ${Date.now()}`;

    // Criação inicial
    const resp1 = await app.inject({
      method: 'POST',
      url: '/api/categorias',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: nomeDuplicado,
        categoriaPaiId: catPai!.id,
      },
    });
    expect(resp1.statusCode).toBe(201);

    // Tentativa duplicada
    const resp2 = await app.inject({
      method: 'POST',
      url: '/api/categorias',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: nomeDuplicado,
        categoriaPaiId: catPai!.id,
      },
    });
    expect(resp2.statusCode).toBe(409);
    const errorBody = JSON.parse(resp2.body);
    expect(errorBody.error).toBe('Conflict');
  });

  it('deve rejeitar criação de subcategoria com categoria pai inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/categorias',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Sub Invalida',
        categoriaPaiId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(response.statusCode).toBe(404);
  });
});
