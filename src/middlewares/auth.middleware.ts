import { FastifyRequest, FastifyReply } from 'fastify';

export type UserRole =
  | 'OWNER'
  | 'ADMIN'
  | 'USER'
  | 'VISITANTE'
  | 'owner'
  | 'admin'
  | 'user'
  | 'visitante';

export async function ensureAuthenticated(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Token de autenticação ausente ou inválido.',
    });
  }
}

/**
 * Middleware RBAC para autorização com base em roles de usuário.
 * Exemplo: preHandler: [ensureAuthenticated, authorizeRoles(['owner', 'admin', 'user'])]
 */
export function authorizeRoles(allowedRoles: UserRole[]) {
  const normalizedAllowed = allowedRoles.map((r) => r.toUpperCase());

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Garante que o usuário esteja autenticado
    if (!request.user || !request.user.role) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Usuário não autenticado ou papel não identificado.',
      });
    }

    const userRole = request.user.role.toUpperCase();
    if (!normalizedAllowed.includes(userRole)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Acesso negado para o papel '${request.user.role}'. Papéis permitidos: ${allowedRoles.join(', ')}`,
      });
    }
  };
}
