import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma v7 removed the `url` field from the schema's datasource block.
 * Connection URLs must now be passed via the driver adapter (node-postgres).
 * The DATABASE_URL env var is loaded from .env automatically by Vite in dev
 * and by the hosting environment in production.
 *
 * Docs: https://pris.ly/d/prisma7-client-config
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to your .env file before starting the app."
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Backward-compatible alias so existing `import { db } from "~/db.server"` keeps working.
export const db = prisma;
