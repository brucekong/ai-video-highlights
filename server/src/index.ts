import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { analyzeRoutes } from './routes/analyze.js';
import { authRoutes } from './routes/auth.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  const fastify = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // CORS — 允许前端开发服务器访问
  await fastify.register(cors, {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // 注册路由
  await fastify.register(analyzeRoutes);
  await fastify.register(authRoutes);

  // Health checks
  fastify.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/healthz', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 启动服务器
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`🚀 Server is running on http://localhost:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
