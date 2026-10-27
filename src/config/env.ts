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
  // OpenRouter (openrouter.ai) — chave de servidor opcional (fallback quando o usuário não tem chave salva)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().optional().or(z.literal('')),
  OPENROUTER_HTTP_REFERER: z.string().optional(),
  OPENROUTER_X_TITLE: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(16).optional(),
  DUPLICATA_SIMILARIDADE_MINIMA: z.coerce.number().min(0).max(1).default(0.5),
  // TASK-49 — Cotação USD→BRL usada no cálculo de custo das chamadas de IA
  COTACAO_USD_BRL: z.coerce.number().positive().default(5.5),
  // TASK-52 — Médias consolidadas de IA
  IA_MEDIA_JANELA_DIAS: z.coerce.number().positive().default(90),
  IA_MEDIA_TOKENS_BASE: z.coerce.number().positive().default(1000),
  // Diretório base dos uploads (relativo à raiz do projeto por padrão).
  // Em produção deve apontar para fora do projeto (caminho absoluto recomendado).
  // Valor vazio/em branco cai no default (paridade com docs/automacao/limpar_historico_importacao.ts).
  UPLOADS_DIR: z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    z.string().default('uploads')
  ),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Configuração inválida das variáveis de ambiente:');
  console.error(parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
