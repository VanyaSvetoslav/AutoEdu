import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN is required (get from @BotFather)'),
  ADMIN_TG_ID: z
    .string()
    .regex(/^\d+$/, 'ADMIN_TG_ID must be a numeric Telegram user id')
    .transform((v) => BigInt(v)),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)'),
  DB_PATH: z.string().default('./data/autoedu.sqlite'),
  TZ: z.string().default('Europe/Moscow'),
  TELEGRAM_PROXY_URL: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || v === '' || /^(https?|socks5h?|socks4):\/\//.test(v),
      'TELEGRAM_PROXY_URL must start with http://, https://, socks5://, socks5h:// or socks4://',
    ),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
