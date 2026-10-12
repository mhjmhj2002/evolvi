import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://evolvi:evolvi_secret@localhost:5432/evolvi_db?schema=public',
      JWT_SECRET: 'super_secret_jwt_key_troque_em_producao_123456789',
    },
  },
});
