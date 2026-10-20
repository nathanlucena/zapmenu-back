import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

export function getPrismaClient(databaseUrl: string): PrismaClient {
  if (!client) {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }
  return client;
}
