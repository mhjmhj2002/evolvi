import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../../infrastructure/database/prisma.js';
import { hashPassword, comparePassword } from './password.service.js';
import { cadastroSchema, loginSchema } from './auth.schema.js';
import { env } from '../../config/env.js';
import { authEventBus } from '../../infrastructure/events/auth-event-bus.js';

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /api/auth/cadastro
  app.post('/cadastro', async (request, reply) => {
    const parseResult = cadastroSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Dados de cadastro inválidos',
        issues: parseResult.error.issues,
      });
    }

    const { nome, email, senha, rendaBaseMensal, role } = parseResult.data;

    const existingUser = await prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Já existe um usuário cadastrado com este e-mail.',
      });
    }

    const senhaHash = await hashPassword(senha);

    const userRole = role
      ? (role.toUpperCase() as 'OWNER' | 'ADMIN' | 'USER' | 'VISITANTE')
      : 'USER';

    const usuario = await prisma.usuario.create({
      data: {
        nome,
        email: email.toLowerCase(),
        senhaHash,
        role: userRole,
        rendaBaseMensal: rendaBaseMensal !== undefined ? rendaBaseMensal : 0.0,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        rendaBaseMensal: true,
        faseAtual: true,
        criadoEm: true,
      },
    });

    const token = app.jwt.sign(
      { sub: usuario.id, email: usuario.email, role: usuario.role },
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // Padrão 24h
    });

    return reply.status(201).send({
      usuario: {
        ...usuario,
        rendaBaseMensal: Number(usuario.rendaBaseMensal),
      },
      token,
    });
  });

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Credenciais inválidas',
        issues: parseResult.error.issues,
      });
    }

    const { email, senha } = parseResult.data;

    const usuario = await prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!usuario) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'E-mail ou senha incorretos.',
      });
    }

    const senhaValida = await comparePassword(senha, usuario.senhaHash);
    if (!senhaValida) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'E-mail ou senha incorretos.',
      });
    }

    const token = app.jwt.sign(
      { sub: usuario.id, email: usuario.email, role: usuario.role },
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
    });

    // Disparo assíncrono para Worker em segundo plano (desacoplado, sem travar o handshake HTTP do login)
    authEventBus.emitUsuarioAutenticado({
      usuarioId: usuario.id,
      email: usuario.email,
      timestamp: new Date(),
    });

    return reply.status(200).send({
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        rendaBaseMensal: Number(usuario.rendaBaseMensal),
        faseAtual: usuario.faseAtual,
        criadoEm: usuario.criadoEm,
      },
      token,
    });
  });

  // POST /api/auth/logout
  app.post('/logout', async (_request, reply) => {
    reply.clearCookie('token', {
      path: '/',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    return reply.status(200).send({
      message: 'Logout efetuado com sucesso.',
    });
  });
};
