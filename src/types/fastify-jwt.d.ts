import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      role: 'OWNER' | 'ADMIN' | 'USER' | 'VISITANTE';
    };
    user: {
      sub: string;
      email: string;
      role: 'OWNER' | 'ADMIN' | 'USER' | 'VISITANTE';
    };
  }
}
