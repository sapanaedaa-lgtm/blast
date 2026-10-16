import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  APP_URL: z.string().default("http://localhost:3000"),
  API_URL: z.string().default("http://localhost:4000"),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  COOKIE_SECRET: z.string().min(16),
  SESSION_ENCRYPTION_KEY: z.string().min(16),
  CSRF_SECRET: z.string().min(16),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().default(50),

  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  SUPABASE_BUCKET: z.string().optional().default("inaedaa-media"),

  WA_ENGINE: z.string().default("baileys"),
  WA_SESSION_DIR: z.string().default("./sessions"),
  WA_MAX_SESSIONS: z.coerce.number().default(5),

  // WhatsApp Cloud API credentials (optional; the active engine is Baileys)
  WHATSAPP_CLOUD_API_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().default(""),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),

  QUEUE_CONCURRENCY: z.coerce.number().default(1),
  DEFAULT_MIN_DELAY_SEC: z.coerce.number().default(5),
  DEFAULT_MAX_DELAY_SEC: z.coerce.number().default(15),
  MAX_MESSAGES_PER_HOUR: z.coerce.number().default(120),
  MAX_RETRY_ATTEMPTS: z.coerce.number().default(3),
  AUTO_PAUSE_FAILURE_THRESHOLD: z.coerce.number().default(0.4),
  AUTO_PAUSE_MIN_SAMPLE: z.coerce.number().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

