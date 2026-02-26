import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';

// Google Config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

// WeChat Config
const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const WECHAT_REDIRECT_URI = process.env.WECHAT_REDIRECT_URI || 'http://localhost:3001/api/auth/wechat/callback';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export async function authRoutes(fastify: FastifyInstance) {
  // === Google Auth ===
  fastify.get('/api/auth/google', async (request, reply) => {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${GOOGLE_REDIRECT_URI}&response_type=code&scope=email%20profile`;
    reply.redirect(authUrl);
  });

  fastify.get('/api/auth/google/callback', async (
    request: FastifyRequest<{ Querystring: { code: string } }>,
    reply: FastifyReply
  ) => {
    const { code } = request.query;
    if (!code) {
      return reply.redirect(`${FRONTEND_URL}?error=missing_code`);
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
      let user = await prisma.user.findUnique({ where: { googleId: userInfo.id } });
      if (!user) {
        if (userInfo.email) {
          user = await prisma.user.findUnique({ where: { email: userInfo.email } });
        }
        if (user) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { googleId: userInfo.id, avatar: user.avatar || userInfo.picture }
          });
        } else {
          user = await prisma.user.create({
            data: {
              googleId: userInfo.id,
              email: userInfo.email,
              name: userInfo.name,
              avatar: userInfo.picture,
            }
          });
        }
      }

      // 4. Generate JWT
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      // 5. Redirect back to frontend
      reply.redirect(`${FRONTEND_URL}?token=${token}`);
    } catch (e) {
      fastify.log.error(e);
      reply.redirect(`${FRONTEND_URL}?error=google_auth_failed`);
    }
  });

  // === WeChat Login ===
  fastify.get('/api/auth/wechat', async (request, reply) => {
    const authUrl = `https://open.weixin.qq.com/connect/qrconnect?appid=${WECHAT_APP_ID}&redirect_uri=${encodeURIComponent(WECHAT_REDIRECT_URI)}&response_type=code&scope=snsapi_login&state=STATE#wechat_redirect`;
    reply.redirect(authUrl);
  });

  fastify.get('/api/auth/wechat/callback', async (
    request: FastifyRequest<{ Querystring: { code: string; state?: string } }>,
    reply: FastifyReply
  ) => {
    const { code } = request.query;
    if (!code) {
      return reply.redirect(`${FRONTEND_URL}?error=missing_code`);
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
      let user = null;
      if (actualUnionId) {
        user = await prisma.user.findUnique({ where: { wechatUnionId: actualUnionId } });
      }
      if (!user) {
        user = await prisma.user.findUnique({ where: { wechatOpenId: openid } });
      }

      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            wechatOpenId: openid,
            wechatUnionId: actualUnionId,
            name: user.name || userInfo.nickname,
            avatar: user.avatar || userInfo.headimgurl
          }
        });
      } else {
        user = await prisma.user.create({
          data: {
            wechatOpenId: openid,
            wechatUnionId: actualUnionId,
            name: userInfo.nickname,
            avatar: userInfo.headimgurl,
          }
        });
      }

      // 4. Generate JWT
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      // 5. Redirect to frontend
      reply.redirect(`${FRONTEND_URL}?token=${token}`);
    } catch (e) {
      fastify.log.error(e);
      reply.redirect(`${FRONTEND_URL}?error=wechat_auth_failed`);
    }
  });

  // Get current user profile
  fastify.get('/api/auth/me', async (request, reply) => {
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
