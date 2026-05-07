import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// 使用 pg 驱动适配器：通过 Node.js 原生 TLS 处理数据库连接，
// 彻底绕过 Prisma Rust 引擎的 OpenSSL 依赖问题。
const connectionString = process.env.DATABASE_URL;

const pool = new pg.Pool({
  connectionString,
  ssl: connectionString?.includes('localhost') || connectionString?.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export { prisma, Prisma };
export default prisma;
