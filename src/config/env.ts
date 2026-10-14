import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  CORS_ORIGIN: z.string().default('*'),
  OPEN_FINANCE_MODE: z.enum(['mock', 'real']).default('mock'),
  OPEN_FINANCE_CLIENT_ID: z.string().optional(),
  OPEN_FINANCE_CLIENT_SECRET: z.string().optional(),
  OPEN_FINANCE_API_URL: z.string().url().optional().or(z.literal('')),
  GEMINI_API_KEY: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(16).optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Configuração inválida das variáveis de ambiente:');
  console.error(parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
