import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server";

export const customSessionStorage = new PrismaSessionStorage(prisma);
