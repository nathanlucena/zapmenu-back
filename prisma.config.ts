import { defineConfig, env } from 'prisma/config';

// O Prisma 7 não carrega mais o .env sozinho.
try {
  process.loadEnvFile();
} catch {
  // Sem .env (CI, produção): as variáveis já vêm do ambiente.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
