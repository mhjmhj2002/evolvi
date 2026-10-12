import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ensureAuthenticated } from '../../middlewares/auth.middleware.js';
import { createCustomSubcategoriaSchema } from './categoria.schema.js';
import { normalizarCestaCategorias } from './categoria-normalization.service.js';

export const categoriaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('preHandler', ensureAuthenticated);

  // GET /api/categorias
  // Retorna árvore de categorias e subcategorias com peso bruto e % normalizado
  app.get('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    // Buscar categorias principais (raiz) globais do sistema ou do usuário
    const categoriasRaiz = await prisma.categoria.findMany({
      where: {
        categoriaPaiId: null,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });

    // Buscar todas as subcategorias globais ou do usuário
    const subcategorias = await prisma.categoria.findMany({
      where: {
        categoriaPaiId: { not: null },
        OR: [{ usuarioId: null }, { usuarioId }],
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });

    // Mapear categorias raízes para objetos com tipos numéricos
    const categoriasFormatadas = categoriasRaiz.map((cat) => ({
      ...cat,
      pesoBrutoReferencia: cat.pesoBrutoReferencia !== null ? Number(cat.pesoBrutoReferencia) : 0,
      referenciaNormalizadaPct: cat.referenciaNormalizadaPct !== null ? Number(cat.referenciaNormalizadaPct) : 0,
    }));

    // Normalizar cesta para garantir fechamento rigoroso em exatamente 100.00%
    const categoriasNormalizadas = normalizarCestaCategorias(categoriasFormatadas);

    // Agrupar subcategorias por categoriaPaiId
    const subcategoriasPorPai = new Map<string, typeof subcategorias>();
    for (const sub of subcategorias) {
      if (!sub.categoriaPaiId) continue;
      const list = subcategoriasPorPai.get(sub.categoriaPaiId) || [];
      list.push(sub);
      subcategoriasPorPai.set(sub.categoriaPaiId, list);
    }

    // Montar a árvore final
    const arvore = categoriasNormalizadas.map((cat) => {
      const filhas = (subcategoriasPorPai.get(cat.id) || []).map((sub) => ({
        ...sub,
        pesoBrutoReferencia: sub.pesoBrutoReferencia !== null ? Number(sub.pesoBrutoReferencia) : null,
        referenciaNormalizadaPct: sub.referenciaNormalizadaPct !== null ? Number(sub.referenciaNormalizadaPct) : null,
      }));

      return {
        ...cat,
        subcategorias: filhas,
      };
    });

    const somaNormalizada = Number(
      categoriasNormalizadas.reduce((acc, c) => acc + c.referenciaNormalizadaPct, 0).toFixed(2)
    );

    return reply.status(200).send({
      totalCategoriasRaiz: arvore.length,
      somaReferenciaNormalizadaPct: somaNormalizada,
      categorias: arvore,
    });
  });

  // POST /api/categorias
  // Criação de subcategoria personalizada do usuário
  app.post('/', async (request, reply) => {
    const usuarioId = request.user.sub;

    const parseResult = createCustomSubcategoriaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados inválidos para criação da subcategoria',
        issues: parseResult.error.issues,
      });
    }

    const { nome, categoriaPaiId, descricao } = parseResult.data;

    // Verificar se a categoria pai existe (global ou do próprio usuário)
    const categoriaPai = await prisma.categoria.findFirst({
      where: {
        id: categoriaPaiId,
        categoriaPaiId: null, // Deve ser uma categoria raiz
        OR: [{ usuarioId: null }, { usuarioId }],
      },
    });

    if (!categoriaPai) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Categoria pai não encontrada ou não é uma categoria raiz válida.',
      });
    }

    // Verificar se já existe subcategoria com o mesmo nome para esta categoria pai (global ou do usuário)
    const existente = await prisma.categoria.findFirst({
      where: {
        nome: { equals: nome, mode: 'insensitive' },
        categoriaPaiId,
        OR: [{ usuarioId: null }, { usuarioId }],
      },
    });

    if (existente) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Já existe uma subcategoria com este nome para a categoria selecionada.',
      });
    }

    const novaSubcategoria = await prisma.categoria.create({
      data: {
        usuarioId,
        categoriaPaiId,
        nome,
        descricao: descricao || null,
        pesoBrutoReferencia: null,
        referenciaNormalizadaPct: null,
      },
    });

    return reply.status(201).send({
      message: 'Subcategoria criada com sucesso.',
      categoria: {
        ...novaSubcategoria,
        pesoBrutoReferencia: null,
        referenciaNormalizadaPct: null,
      },
    });
  });
};
