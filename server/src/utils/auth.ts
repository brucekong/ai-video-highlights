import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';

/**
 * 从请求头中提取 userId
 * @param request
 * @returns userId 或 null
 */
export function getUserId(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded: any = jwt.verify(token, JWT_SECRET);
      return decoded.userId;
    } catch (e) {
      return null;
    }
  }
  return null;
}
