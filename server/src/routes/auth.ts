import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { Schemas } from '../docs/openapi.js';
import { JWT_SECRET } from '../utils/auth.js';

// Google Config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';



// WeChat Config
const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const WECHAT_REDIRECT_URI = process.env.WECHAT_REDIRECT_URI || 'http://localhost:3001/api/auth/wechat/callback';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// 从 FRONTEND_URL 中提取根域名，用于跨子域名 Cookie 共享
// 例如 https://powneng.top -> .powneng.top，这样 api.powneng.top 设置的 cookie 在 powneng.top 也可见
const getCookieDomain = (): string => {
  try {
    const url = new URL(FRONTEND_URL);
    const hostname = url.hostname;
    // localhost 不需要设置 domain
    if (hostname === 'localhost' || hostname === '127.0.0.1') return '';
    // 提取根域名（去掉 www. 等前缀），如 powneng.top
    const parts = hostname.split('.');
    const rootDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
    return `.${rootDomain}`;
  } catch {
    return '';
  }
};
const COOKIE_DOMAIN = getCookieDomain();
const IS_PRODUCTION = FRONTEND_URL.startsWith('https');

// 动态获取前端 URL (本地开发环境下优先使用请求的 Origin)
const getFrontendUrl = (request: FastifyRequest) => {
  const origin = request.headers.origin || request.headers.referer;
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    try {
      const url = new URL(origin);
      return `${url.protocol}//${url.host}`;
    } catch (e) {
      return FRONTEND_URL;
    }
  }
  return FRONTEND_URL;
};

export async function authRoutes(fastify: FastifyInstance) {
  // === Google Auth ===
  fastify.get('/api/auth/google', {
    schema: {
      tags: ['Auth'],
      summary: 'Google OAuth 登录',
      description: '重定向到 Google OAuth 授权页面，用户授权后会回调到 /api/auth/google/callback。',
      querystring: {
        type: 'object',
        properties: {
          redirect: { type: 'string', description: '登录成功后返回的页面路径' },
        },
      },
      response: {
        302: { type: 'null', description: '重定向到 Google 授权页面' },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: { redirect?: string } }>, reply) => {
    const { redirect } = request.query;
    // 使用 state 携带跳转地址
    const state = redirect ? Buffer.from(redirect).toString('base64') : '';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${GOOGLE_REDIRECT_URI}&response_type=code&scope=email%20profile&state=${state}`;

    console.log(authUrl);
    reply.redirect(authUrl);
  });

  fastify.get('/api/auth/google/callback', {
    schema: {
      tags: ['Auth'],
      summary: 'Google OAuth 回调',
      description: 'Google OAuth 授权回调地址，成功后会携带 JWT Token 重定向回前端。无需手动调用。',
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Google 授权码' },
          state: { type: 'string', description: '状态参数' },
        },
      },
      response: {
        302: { type: 'null', description: '重定向回前端（携带 token 或 error 参数）' },
      },
    },
  }, async (
    request: FastifyRequest<{ Querystring: { code: string, state?: string } }>,
    reply: FastifyReply
  ) => {
    const { code, state } = request.query;
    const targetBase = getFrontendUrl(request);
    let targetUrl = targetBase;
    if (state) {
      try {
        const decodedPath = Buffer.from(state, 'base64').toString('utf-8');
        targetUrl = `${targetBase}${decodedPath.startsWith('/') ? '' : '/'}${decodedPath}`;
      } catch (e) {
        console.error('Failed to decode state:', e);
      }
    }

    if (!code) {
      return reply.redirect(`${targetUrl}${targetUrl.includes('?') ? '&' : '?'}error=missing_code`);
    }

    try {
      // 1. Get access token
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      });
      const { access_token } = tokenRes.data;

      // 2. Get user info
      const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      const userInfo = userRes.data; // { id, email, name, picture }

      // 3. Upsert user
      const user = await prisma.user.upsert({
        where: { googleId: userInfo.id },
        update: {
          name: userInfo.name,
          avatar: userInfo.picture,
        },
        create: {
          googleId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          avatar: userInfo.picture,
        },
      });

      // 4. Generate JWT
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      // 5. Redirect back to frontend - Use a short-lived cookie for handoff to keep URL clean
      const cookieParts = [`auth_token_handoff=${token}`, 'Path=/', 'Max-Age=60', 'SameSite=Lax'];
      if (COOKIE_DOMAIN) cookieParts.push(`Domain=${COOKIE_DOMAIN}`);
      if (IS_PRODUCTION) cookieParts.push('Secure');
      reply.header('Set-Cookie', cookieParts.join('; '));
      reply.redirect(targetUrl);
    } catch (e) {
      fastify.log.error(e);
      reply.redirect(`${targetUrl}${targetUrl.includes('?') ? '&' : '?'}error=google_auth_failed`);
    }
  });

  // === WeChat Login ===
  fastify.get('/api/auth/wechat', {
    schema: {
      tags: ['Auth'],
      summary: '微信 OAuth 登录',
      description: '重定向到微信开放平台扫码登录页面，用户授权后会回调到 /api/auth/wechat/callback。',
      querystring: {
        type: 'object',
        properties: {
          redirect: { type: 'string', description: '登录成功后返回的页面路径' },
        },
      },
      response: {
        302: { type: 'null', description: '重定向到微信授权页面' },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: { redirect?: string } }>, reply) => {
    const { redirect } = request.query;
    const state = redirect ? Buffer.from(redirect).toString('base64') : 'STATE';
    const authUrl = `https://open.weixin.qq.com/connect/qrconnect?appid=${WECHAT_APP_ID}&redirect_uri=${encodeURIComponent(WECHAT_REDIRECT_URI)}&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`;
    reply.redirect(authUrl);
  });

  fastify.get('/api/auth/wechat/callback', {
    schema: {
      tags: ['Auth'],
      summary: '微信 OAuth 回调',
      description: '微信 OAuth 授权回调地址，成功后会携带 JWT Token 重定向回前端。无需手动调用。',
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '微信授权码' },
          state: { type: 'string', description: '状态参数' },
        },
      },
      response: {
        302: { type: 'null', description: '重定向回前端（携带 token 或 error 参数）' },
      },
    },
  }, async (
    request: FastifyRequest<{ Querystring: { code: string; state?: string } }>,
    reply: FastifyReply
  ) => {
    const { code, state } = request.query;
    const targetBase = getFrontendUrl(request);
    let targetUrl = targetBase;
    if (state && state !== 'STATE') {
      try {
        const decodedPath = Buffer.from(state, 'base64').toString('utf-8');
        targetUrl = `${targetBase}${decodedPath.startsWith('/') ? '' : '/'}${decodedPath}`;
      } catch (e) {
        console.error('Failed to decode state:', e);
      }
    }

    if (!code) {
      return reply.redirect(`${targetUrl}${targetUrl.includes('?') ? '&' : '?'}error=missing_code`);
    }

    try {
      // 1. Get access token and openid
      const tokenRes = await axios.get(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}&code=${code}&grant_type=authorization_code`);

      const { access_token, openid, unionid } = tokenRes.data;
      if (!access_token || !openid) {
        throw new Error(tokenRes.data.errmsg || 'Failed to get wechat token');
      }

      // 2. Get user info
      const userRes = await axios.get(`https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}`);
      const userInfo = userRes.data; // { nickname, headimgurl, unionid }

      const actualUnionId = unionid || userInfo.unionid;

      // 3. Upsert user
      const user = await prisma.user.upsert({
        where: actualUnionId ? { wechatUnionId: actualUnionId } : { wechatOpenId: openid },
        update: {
          wechatOpenId: openid,
          wechatUnionId: actualUnionId,
          name: userInfo.nickname,
          avatar: userInfo.headimgurl,
        },
        create: {
          wechatOpenId: openid,
          wechatUnionId: actualUnionId,
          name: userInfo.nickname,
          avatar: userInfo.headimgurl,
        },
      });

      // 4. Generate JWT
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      // 5. Redirect back to frontend - Use a short-lived cookie for handoff
      const cookieParts = [`auth_token_handoff=${token}`, 'Path=/', 'Max-Age=60', 'SameSite=Lax'];
      if (COOKIE_DOMAIN) cookieParts.push(`Domain=${COOKIE_DOMAIN}`);
      if (IS_PRODUCTION) cookieParts.push('Secure');
      reply.header('Set-Cookie', cookieParts.join('; '));
      reply.redirect(targetUrl);
    } catch (e) {
      fastify.log.error(e);
      reply.redirect(`${targetUrl}${targetUrl.includes('?') ? '&' : '?'}error=wechat_auth_failed`);
    }
  });

  // Get current user profile
  fastify.get('/api/auth/me', {
    schema: {
      tags: ['Auth'],
      summary: '获取当前用户信息',
      description: '通过 JWT Token 获取当前登录用户的个人信息（名称、邮箱、头像等）。',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: Schemas.UserProfile,
          },
        },
        401: Schemas.ErrorResponse,
      },
    },
  }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, name: true, email: true, avatar: true }
      });
      if (!user) return reply.status(401).send({ error: 'User not found' });
      return reply.send({ success: true, data: user });
    } catch (e) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });
}
