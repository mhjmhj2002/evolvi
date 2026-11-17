import { defineConfig } from 'vitest/config';

// Define a pasta antes de os módulos carregarem src/config/env.ts, que lê o .env.
// A opção test.env não prevalecia sobre valores já carregados pelo dotenv.
process.env.UPLOADS_DIR = '.local/test-uploads';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./vitest.global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://evolvi:evolvi_secret@localhost:5432/evolvi_db?schema=public',
      JWT_SECRET: 'super_secret_jwt_key_troque_em_producao_123456789',
      UPLOADS_DIR: '.local/test-uploads',
    },
  },
});
