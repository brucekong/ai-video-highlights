import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import scalarReference from '@scalar/fastify-api-reference';
import { analyzeRoutes } from './routes/analyze.js';
import { authRoutes } from './routes/auth.js';
import { swaggerOptions } from './docs/openapi.js';

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

  // CORS — 允许前端访问
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // 允许 localhost, Vercel 域名, 以及自定义的 FRONTEND_URL
      const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:5174',
        process.env.FRONTEND_URL
      ].filter(Boolean);

      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  });

  // 注册 OpenAPI 规范生成器（@fastify/swagger 仅用于生成 spec，不渲染 UI）
  await fastify.register(swagger, {
    ...swaggerOptions,
    // Provide a unified refResolver for Fastify to understand OpenAPI components
    refResolver: {
      buildLocalReference(json, baseUri, fragment, i) {
        return json.$id as string || `def-${i}`;
      }
    }
  });

  // 注册共享 schema，供路由中通过 $ref 引用 (需要去掉首部的 #/)
  Object.entries(swaggerOptions.openapi?.components?.schemas || {}).forEach(([$id, schema]) => {
    fastify.addSchema({
      $id: `#/components/schemas/${$id}`,
      ...schema as any
    });
  });

  // 注册 Scalar API 文档 UI
  await fastify.register(scalarReference, {
    routePrefix: '/api/docs',
    configuration: {
      theme: 'kepler',
      metaData: {
        title: 'AI Video Highlights API',
      },
    },
  });

  // 注册路由
  await fastify.register(analyzeRoutes);
  await fastify.register(authRoutes);

  // Health checks
  fastify.get('/api/health', {
    schema: {
      tags: ['Health'],
      summary: '健康检查（/api/health）',
      description: '检查服务是否正常运行。',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/health', {
    schema: {
      tags: ['Health'],
      summary: '健康检查（/health）',
      description: '简化的健康检查端点。',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/healthz', {
    schema: {
      tags: ['Health'],
      summary: '健康检查（/healthz）',
      description: 'Kubernetes 风格的健康检查端点。',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 启动服务器
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`🚀 Server is running on http://localhost:${PORT}`);
    fastify.log.info(`📖 API Documentation: http://localhost:${PORT}/api/docs`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();

