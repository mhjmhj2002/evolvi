import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

describe('Auth & Isolamento de Contexto (E2E / Integração)', () => {
  let app: FastifyInstance;

  const testUserA = {
    nome: 'Usuario Alpha',
    email: `alpha_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 5500.5,
  };

  const testUserB = {
    nome: 'Usuario Beta',
    email: `beta_${Date.now()}@teste.com`,
    senha: 'OutraSenha456!',
    rendaBaseMensal: 3200.0,
  };

  let tokenUserA: string;
  let tokenUserB: string;
  let idUserA: string;
  let idUserB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    // Limpar dados criados no teste
    if (idUserA || idUserB) {
      await prisma.usuario.deleteMany({
        where: {
          id: {
            in: [idUserA, idUserB].filter(Boolean),
          },
        },
      });
    }
    await app.close();
  });

  describe('Fluxo de Cadastro e Login', () => {
    it('deve cadastrar um novo usuário com sucesso e retornar token JWT e cookie HttpOnly', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/cadastro',
        payload: testUserA,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.usuario).toBeDefined();
      expect(body.usuario.id).toBeDefined();
      expect(body.usuario.email).toBe(testUserA.email.toLowerCase());
      expect(body.usuario.nome).toBe(testUserA.nome);
      expect(body.token).toBeDefined();

      idUserA = body.usuario.id;
      tokenUserA = body.token;

      // Validar cookie HttpOnly retornado
      const cookieHeader = response.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
      const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join(';') : String(cookieHeader);
      expect(cookieStr).toContain('token=');
      expect(cookieStr).toContain('HttpOnly');
    });

    it('deve rejeitar cadastro com e-mail duplicado (HTTP 409)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/cadastro',
        payload: testUserA,
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Já existe um usuário');
    });

    it('deve cadastrar o segundo usuário para testes de isolamento', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/cadastro',
        payload: testUserB,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      idUserB = body.usuario.id;
      tokenUserB = body.token;
    });

    it('deve efetuar login com credenciais corretas', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: testUserA.email,
          senha: testUserA.senha,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      expect(body.usuario.email).toBe(testUserA.email.toLowerCase());
    });

    it('deve rejeitar login com senha incorreta (HTTP 401)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: testUserA.email,
          senha: 'senha-totalmente-errada',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('incorretos');
    });

    it('deve efetuar logout limpando o cookie', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
      });

      expect(response.statusCode).toBe(200);
      const cookieHeader = response.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
    });
  });

  describe('Proteção e Isolamento de Contexto do Usuário', () => {
    it('deve rejeitar requisição em rota protegida sem autenticação (HTTP 401)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usuario/perfil',
      });

      expect(response.statusCode).toBe(401);
    });

    it('deve permitir acesso ao perfil via Header Authorization Bearer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usuario/perfil',
        headers: {
          authorization: `Bearer ${tokenUserA}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.usuario.id).toBe(idUserA);
      expect(body.usuario.email).toBe(testUserA.email.toLowerCase());
      expect(body.usuario.rendaBaseMensal).toBe(5500.5);
    });

    it('deve permitir acesso ao perfil via Cookie HttpOnly token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usuario/perfil',
        cookies: {
          token: tokenUserA,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.usuario.id).toBe(idUserA);
      expect(body.usuario.email).toBe(testUserA.email.toLowerCase());
    });

    it('deve garantir isolamento: Usuário B consulta seu próprio perfil e não vê dados de A', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usuario/perfil',
        headers: {
          authorization: `Bearer ${tokenUserB}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.usuario.id).toBe(idUserB);
      expect(body.usuario.id).not.toBe(idUserA);
      expect(body.usuario.email).toBe(testUserB.email.toLowerCase());
      expect(body.usuario.rendaBaseMensal).toBe(3200.0);
    });

    it('deve atualizar renda-base do Usuário A sem afetar o Usuário B', async () => {
      const responseUpdate = await app.inject({
        method: 'PUT',
        url: '/api/usuario/renda-base',
        headers: {
          authorization: `Bearer ${tokenUserA}`,
        },
        payload: {
          rendaBaseMensal: 7200.0,
        },
      });

      expect(responseUpdate.statusCode).toBe(200);
      const bodyUpdate = JSON.parse(responseUpdate.body);
      expect(bodyUpdate.usuario.rendaBaseMensal).toBe(7200.0);

      // Checar se Usuário B permaneceu inalterado
      const perfilB = await app.inject({
        method: 'GET',
        url: '/api/usuario/perfil',
        headers: {
          authorization: `Bearer ${tokenUserB}`,
        },
      });

      const bodyB = JSON.parse(perfilB.body);
      expect(bodyB.usuario.rendaBaseMensal).toBe(3200.0);
    });

    it('deve persistir a alteração de renda no banco', async () => {
      const userInDb = await prisma.usuario.findUnique({
        where: { id: idUserA },
      });

      expect(userInDb).toBeDefined();
      expect(Number(userInDb?.rendaBaseMensal)).toBe(7200.0);
    });

    it('deve calcular a média 6M de receitas e sugerir complemento editável (TASK-26)', async () => {
      // Criar conta para registrar movimentos
      const conta = await prisma.conta.create({
        data: {
          usuarioId: idUserA,
          nome: 'Conta Corrente Salário',
          tipo: 'CONTA_CORRENTE',
          saldoInicial: 0,
        },
      });

      // Inserir receitas nos últimos meses fechados (ex: 2026-04 a 2026-09 com ref 2026-10)
      // 4 meses com 5000 cada = 20000 total. Média em 6 meses = 20000 / 6 = 3333.33
      await prisma.movimento.createMany({
        data: [
          {
            usuarioId: idUserA,
            contaId: conta.id,
            competencia: '2026-04',
            dataMovimento: new Date('2026-04-05'),
            descricao: 'Salário Abril',
            valor: 5000.0,
            natureza: 'RECEITA',
            status: 'CONCILIADO',
          },
          {
            usuarioId: idUserA,
            contaId: conta.id,
            competencia: '2026-05',
            dataMovimento: new Date('2026-05-05'),
            descricao: 'Salário Maio',
            valor: 5000.0,
            natureza: 'RECEITA',
            status: 'CONCILIADO',
          },
          {
            usuarioId: idUserA,
            contaId: conta.id,
            competencia: '2026-06',
            dataMovimento: new Date('2026-06-05'),
            descricao: 'Salário Junho',
            valor: 5000.0,
            natureza: 'RECEITA',
            status: 'CONCILIADO',
          },
          {
            usuarioId: idUserA,
            contaId: conta.id,
            competencia: '2026-07',
            dataMovimento: new Date('2026-07-05'),
            descricao: 'Salário Julho',
            valor: 5000.0,
            natureza: 'RECEITA',
            status: 'CONCILIADO',
          },
          // Transferência própria (não deve entrar no cômputo de receitas)
          {
            usuarioId: idUserA,
            contaId: conta.id,
            competencia: '2026-08',
            dataMovimento: new Date('2026-08-10'),
            descricao: 'Transferência Entre Contas',
            valor: 3000.0,
            natureza: 'TRANSFERENCIA_PROPRIA',
            status: 'CONCILIADO',
          },
          // Despesa (não deve entrar)
          {
            usuarioId: idUserA,
            contaId: conta.id,
            competencia: '2026-08',
            dataMovimento: new Date('2026-08-15'),
            descricao: 'Aluguel',
            valor: 1500.0,
            natureza: 'DESPESA',
            status: 'CONCILIADO',
          },
        ],
      });

      const responseMedia = await app.inject({
        method: 'GET',
        url: '/api/usuario/renda-media-6m?competencia=2026-10',
        headers: {
          authorization: `Bearer ${tokenUserA}`,
        },
      });

      expect(responseMedia.statusCode).toBe(200);
      const dataMedia = JSON.parse(responseMedia.body);
      expect(dataMedia.totalReceitas).toBe(20000.0);
      expect(dataMedia.media6m).toBe(3333.33);
      expect(dataMedia.mesesFechados).toEqual([
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
      ]);
      expect(dataMedia.rendaAtual).toBe(7200.0);
      // Complemento sugerido = rendaAtual (7200) - media6m (3333.33) = 3866.67
      expect(dataMedia.complementoSugerido).toBe(3866.67);

      // Limpar movimentos e conta
      await prisma.movimento.deleteMany({ where: { usuarioId: idUserA } });
      await prisma.conta.deleteMany({ where: { usuarioId: idUserA } });
    });
  });

  describe('RBAC, Roles e Expiração de Token (TASK-11)', () => {
    let idOwner: string;
    let idAdmin: string;
    let tokenOwner: string;
    let tokenAdmin: string;

    afterAll(async () => {
      if (idOwner || idAdmin) {
        await prisma.usuario.deleteMany({
          where: {
            id: {
              in: [idOwner, idAdmin].filter(Boolean),
            },
          },
        });
      }
    });

    it('deve cadastrar usuário com role OWNER e incluir role no payload do token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/cadastro',
        payload: {
          nome: 'Owner System',
          email: `owner_${Date.now()}@teste.com`,
          senha: 'OwnerPass123!',
          role: 'OWNER',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.usuario.role).toBe('OWNER');
      idOwner = data.usuario.id;
      tokenOwner = data.token;

      // Verificar decode do token JWT
      const decoded = app.jwt.decode<{ role: string; sub: string }>(tokenOwner);
      expect(decoded?.role).toBe('OWNER');
      expect(decoded?.sub).toBe(idOwner);
    });

    it('deve cadastrar usuário com role ADMIN e suportar role case-insensitive', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/cadastro',
        payload: {
          nome: 'Admin System',
          email: `admin_${Date.now()}@teste.com`,
          senha: 'AdminPass123!',
          role: 'admin',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.usuario.role).toBe('ADMIN');
      idAdmin = data.usuario.id;
      tokenAdmin = data.token;
    });

    it('deve retornar role correta no perfil do usuário', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/usuario/perfil',
        headers: {
          authorization: `Bearer ${tokenOwner}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.usuario.role).toBe('OWNER');
    });

    it('deve permitir acesso a rotas protegidas para todas as roles da Fase 1 (OWNER, ADMIN, USER)', async () => {
      for (const token of [tokenOwner, tokenAdmin, tokenUserA]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/fase1/baseline',
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('deve validar comportamento do middleware authorizeRoles (bloqueio 403 e autorização 200)', async () => {
      const { authorizeRoles, ensureAuthenticated } = await import('../../middlewares/auth.middleware.js');
      
      const rbacApp = await buildApp();
      rbacApp.get('/test-role-admin-only', {
        preHandler: [ensureAuthenticated, authorizeRoles(['ADMIN', 'OWNER'])],
        handler: async () => ({ status: 'ok' }),
      });
      await rbacApp.ready();

      // Usuário comum (USER) deve receber 403 Forbidden
      const resUser = await rbacApp.inject({
        method: 'GET',
        url: '/test-role-admin-only',
        headers: {
          authorization: `Bearer ${tokenUserA}`,
        },
      });
      expect(resUser.statusCode).toBe(403);
      const bodyForbidden = JSON.parse(resUser.body);
      expect(bodyForbidden.error).toBe('Forbidden');

      // Admin deve ter acesso permitido
      const resAdmin = await rbacApp.inject({
        method: 'GET',
        url: '/test-role-admin-only',
        headers: {
          authorization: `Bearer ${tokenAdmin}`,
        },
      });
      expect(resAdmin.statusCode).toBe(200);

      // Owner também deve ter acesso
      const resOwner = await rbacApp.inject({
        method: 'GET',
        url: '/test-role-admin-only',
        headers: {
          authorization: `Bearer ${tokenOwner}`,
        },
      });
      expect(resOwner.statusCode).toBe(200);

      await rbacApp.close();
    });

    it('deve cadastrar usuário com role VISITANTE e autenticar com acesso liberado a rotas atuais', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/cadastro',
        payload: {
          nome: 'Visitante Convidado',
          email: `visitante_${Date.now()}@teste.com`,
          senha: 'VisitantePass123!',
          role: 'VISITANTE',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.usuario.role).toBe('VISITANTE');
      const tokenVisitante = data.token;

      // Token contém role VISITANTE
      const decoded = app.jwt.decode<{ role: string; sub: string }>(tokenVisitante);
      expect(decoded?.role).toBe('VISITANTE');

      // Acesso liberado no momento às rotas da Fase 1
      const resFase1 = await app.inject({
        method: 'GET',
        url: '/api/fase1/baseline',
        headers: {
          authorization: `Bearer ${tokenVisitante}`,
        },
      });
      expect(resFase1.statusCode).toBe(200);

      // Limpar usuário de teste
      await prisma.usuario.delete({
        where: { id: data.usuario.id },
      });
    });
  });
});
