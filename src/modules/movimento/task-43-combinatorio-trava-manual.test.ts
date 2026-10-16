import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  classificadorCombinatorioService,
  ClassificadorCombinatorioService,
} from './classificador-combinatorio.service.js';
import {
  MovimentoRecalculoService,
  VERSAO_REGRAS_MOVIMENTOS_ATUAL,
} from './movimento-recalculo.service.js';

describe('TASK-43: Inteligência Combinatória de Categorização e Trava de Ajuste Manual', () => {
  let app: FastifyInstance;
  let usuario1Id: string;
  let usuario1Token: string;
  let conta1Id: string;

  let usuario2Id: string;
  let conta2Id: string;

  let categoriaAlimentacaoId: string;
  let categoriaOutrosId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar Usuário 1
    const email1 = `user1-task43-${Date.now()}@teste.com`;
    const resCad1 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Task43 Um',
        email: email1,
        senha: 'SenhaForte123!',
      },
    });
    const body1 = JSON.parse(resCad1.body);
    usuario1Id = body1.usuario.id;
    usuario1Token = body1.token;

    const conta1 = await prisma.conta.create({
      data: {
        usuarioId: usuario1Id,
        nome: 'Conta Corrente 1',
        tipo: 'CONTA_CORRENTE',
      },
    });
    conta1Id = conta1.id;

    // 2. Criar Usuário 2 (Multi-tenant)
    const email2 = `user2-task43-${Date.now()}@teste.com`;
    const resCad2 = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Task43 Dois',
        email: email2,
        senha: 'SenhaForte123!',
      },
    });
    const body2 = JSON.parse(resCad2.body);
    usuario2Id = body2.usuario.id;

    const conta2 = await prisma.conta.create({
      data: {
        usuarioId: usuario2Id,
        nome: 'Conta Corrente 2',
        tipo: 'CONTA_CORRENTE',
      },
    });
    conta2Id = conta2.id;

    // Obter categoria Alimentação existente do seed POF
    const catAlim = await prisma.categoria.findFirst({
      where: {
        OR: [
          { nome: { equals: 'Alimentação', mode: 'insensitive' } },
          { nome: { equals: 'Alimentacao', mode: 'insensitive' } },
        ],
        categoriaPaiId: null,
      },
    });
    if (!catAlim) {
      throw new Error('Categoria Alimentação/Alimentacao não encontrada no seed.');
    }
    categoriaAlimentacaoId = catAlim.id;

    // Obter ou criar uma categoria genérica "Outros"
    let catOutros = await prisma.categoria.findFirst({
      where: { nome: 'Outros' },
    });
    if (!catOutros) {
      catOutros = await prisma.categoria.create({
        data: { nome: 'Outros' },
      });
    }
    categoriaOutrosId = catOutros.id;
  });

  describe('1. ClassificadorCombinatorioService (Motor de Regras Combinatórias)', () => {
    it('deve inferir "Alimentação" para compra contendo "barraca" realizada no sábado', () => {
      // 2026-10-17 é Sábado
      const inferencia = classificadorCombinatorioService.inferirCategoria(
        'BARRACA DO ZE VILA VELHA',
        '2026-10-17'
      );

      expect(inferencia).not.toBeNull();
      expect(inferencia?.categoriaSugerida).toBe('Alimentação');
      expect(inferencia?.diaSemana).toBe(6); // Sábado
      expect(inferencia?.confianca).toBeGreaterThanOrEqual(0.9);
      expect(inferencia?.regraId).toBe('FEIRA_FIM_DE_SEMANA');
    });

    it('deve inferir "Alimentação" para compra contendo "feira" realizada no domingo', () => {
      // 2026-10-18 é Domingo
      const inferencia = classificadorCombinatorioService.inferirCategoria(
        'FEIRA LIVRE PRAIA DA COSTA',
        '2026-10-18'
      );

      expect(inferencia).not.toBeNull();
      expect(inferencia?.categoriaSugerida).toBe('Alimentação');
      expect(inferencia?.diaSemana).toBe(0); // Domingo
      expect(inferencia?.confianca).toBeGreaterThanOrEqual(0.9);
    });

    it('não deve acionar a regra de feira de fim de semana para compra em quarta-feira comum sem termo de dias úteis', () => {
      // 2026-10-14 é Quarta-feira
      const inferencia = classificadorCombinatorioService.inferirCategoria(
        'BARRACA DO ZE',
        '2026-10-14'
      );

      // "BARRACA" só ativa em [0, 6] (fim de semana)
      expect(inferencia).toBeNull();
    });

    it('deve inferir "Alimentação" para "hortifruti" em dia útil (quarta-feira)', () => {
      // 2026-10-14 é Quarta-feira (dia 3)
      const inferencia = classificadorCombinatorioService.inferirCategoria(
        'HORTIFRUTI NATURAL DA TERRA',
        '2026-10-14'
      );

      expect(inferencia).not.toBeNull();
      expect(inferencia?.categoriaSugerida).toBe('Alimentação');
      expect(inferencia?.diaSemana).toBe(3);
    });
  });

  describe('2. Trava de Ajuste Manual (categoriaFixadaPeloUsuario)', () => {
    it('ao atualizar categoria via PUT /api/movimentos/:id, deve fixar categoriaFixadaPeloUsuario como true', async () => {
      const mov = await prisma.movimento.create({
        data: {
          usuarioId: usuario1Id,
          contaId: conta1Id,
          dataMovimento: new Date('2026-10-17T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'BARRACA DO JULIO FEIRA',
          valor: 75.0,
          natureza: 'DESPESA',
          status: 'CONCILIADO',
          categoriaFixadaPeloUsuario: false,
        },
      });

      const resPut = await app.inject({
        method: 'PUT',
        url: `/api/movimentos/${mov.id}`,
        headers: { authorization: `Bearer ${usuario1Token}` },
        payload: {
          categoriaId: categoriaOutrosId, // Usuário manualmente escolhe "Outros"
        },
      });

      expect(resPut.statusCode).toBe(200);

      const movAtualizado = await prisma.movimento.findUnique({
        where: { id: mov.id },
      });
      expect(movAtualizado?.categoriaId).toBe(categoriaOutrosId);
      expect(movAtualizado?.categoriaFixadaPeloUsuario).toBe(true);
    });

    it('na propagação por vendedor, lançamentos com categoriaFixadaPeloUsuario: true NUNCA devem ser alterados', async () => {
      // Cria 3 movimentos do mesmo vendedor ("BARRACA DO JULIO"):
      // Mov 1: Fixado manualmente em "Outros"
      const mov1Fixado = await prisma.movimento.create({
        data: {
          usuarioId: usuario1Id,
          contaId: conta1Id,
          dataMovimento: new Date('2026-10-10T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'BARRACA DO JULIO VILA VELHA',
          valor: 120.0,
          natureza: 'DESPESA',
          categoriaId: categoriaOutrosId,
          categoriaFixadaPeloUsuario: true, // TRAVA ATIVA
        },
      });

      // Mov 2: Não fixado (categoria nula)
      const mov2Livre = await prisma.movimento.create({
        data: {
          usuarioId: usuario1Id,
          contaId: conta1Id,
          dataMovimento: new Date('2026-10-12T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'BARRACA DO JULIO BRA',
          valor: 80.0,
          natureza: 'DESPESA',
          categoriaId: null,
          categoriaFixadaPeloUsuario: false,
        },
      });

      // Mov 3: Movimento de referência que dispara a propagação
      const mov3Origem = await prisma.movimento.create({
        data: {
          usuarioId: usuario1Id,
          contaId: conta1Id,
          dataMovimento: new Date('2026-10-15T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'Compra no débito - BARRACA DO JULIO',
          valor: 200.0,
          natureza: 'DESPESA',
          categoriaId: null,
          categoriaFixadaPeloUsuario: false,
        },
      });

      // Usuário altera o mov 3 e solicita propagar para mesmo vendedor
      const resPropagar = await app.inject({
        method: 'PUT',
        url: `/api/movimentos/${mov3Origem.id}`,
        headers: { authorization: `Bearer ${usuario1Token}` },
        payload: {
          categoriaId: categoriaAlimentacaoId,
          propagarMesmoVendedor: true,
        },
      });

      expect(resPropagar.statusCode).toBe(200);
      const body = JSON.parse(resPropagar.body);
      // Apenas o mov2Livre deve ser propagado (mov1Fixado é intocável)
      expect(body.totalPropagados).toBe(1);

      // Confere no banco:
      const mov1Pos = await prisma.movimento.findUnique({ where: { id: mov1Fixado.id } });
      const mov2Pos = await prisma.movimento.findUnique({ where: { id: mov2Livre.id } });
      const mov3Pos = await prisma.movimento.findUnique({ where: { id: mov3Origem.id } });

      expect(mov1Pos?.categoriaId).toBe(categoriaOutrosId); // PRESERVADO
      expect(mov1Pos?.categoriaFixadaPeloUsuario).toBe(true);

      expect(mov2Pos?.categoriaId).toBe(categoriaAlimentacaoId); // ATUALIZADO
      expect(mov3Pos?.categoriaId).toBe(categoriaAlimentacaoId); // ATUALIZADO
      expect(mov3Pos?.categoriaFixadaPeloUsuario).toBe(true);
    });
  });

  describe('3. Reaplicação de Regras Combinatórias no Login e Preservação de Lançamentos Fixados', () => {
    it('deve refinar categoria de lançamentos não-fixados e respeitar 100% dos lançamentos fixados manualmente', async () => {
      // Cria movimento 1: "FEIRINHA ORGÂNICA" no sábado (2026-10-17) sem categoria e sem trava
      const movLivre = await prisma.movimento.create({
        data: {
          usuarioId: usuario1Id,
          contaId: conta1Id,
          dataMovimento: new Date('2026-10-17T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'FEIRINHA ORGANICA VILA VELHA',
          valor: 95.0,
          natureza: 'DESPESA',
          categoriaId: null,
          categoriaFixadaPeloUsuario: false,
        },
      });

      // Cria movimento 2: "BARRACA DE PASTEL" no domingo (2026-10-18) mas com categoriaFixadaPeloUsuario = true
      const movFixado = await prisma.movimento.create({
        data: {
          usuarioId: usuario1Id,
          contaId: conta1Id,
          dataMovimento: new Date('2026-10-18T00:00:00.000Z'),
          competencia: '2026-10',
          descricao: 'BARRACA DE PASTEL DA FEIRA',
          valor: 35.0,
          natureza: 'DESPESA',
          categoriaId: categoriaOutrosId, // Categoria manual
          categoriaFixadaPeloUsuario: true, // TRAVA ATIVA
        },
      });

      // Força Usuário 1 na versão 2 (anterior à 3)
      await prisma.usuario.update({
        where: { id: usuario1Id },
        data: { versaoRegrasMovimentos: 2 },
      });

      // Executa verificação e recálculo
      const resultado = await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuario1Id);
      expect(resultado.recalculado).toBe(true);
      expect(resultado.versaoAplicada).toBe(VERSAO_REGRAS_MOVIMENTOS_ATUAL);
      expect(resultado.totalCategoriasRefinadasCombinatorio).toBeGreaterThanOrEqual(1);

      // Confere se o movimento livre recebeu "Alimentação"
      const movLivrePos = await prisma.movimento.findUnique({ where: { id: movLivre.id } });
      expect(movLivrePos?.categoriaId).toBe(categoriaAlimentacaoId);

      // Confere se o movimento fixado continuou INTACTO em "Outros"
      const movFixadoPos = await prisma.movimento.findUnique({ where: { id: movFixado.id } });
      expect(movFixadoPos?.categoriaId).toBe(categoriaOutrosId);
      expect(movFixadoPos?.categoriaFixadaPeloUsuario).toBe(true);

      // Verifica idempotência: segunda execução não reprocessa
      const segundaExecucao = await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuario1Id);
      expect(segundaExecucao.recalculado).toBe(false);
    });
  });
});
