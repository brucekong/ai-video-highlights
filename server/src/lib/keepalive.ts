import cron from 'node-cron';
import prisma from './prisma.js';

const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

/**
 * 保活定时任务 / Keep-alive scheduled tasks
 *
 * 1. Render 服务保活：每 10 分钟请求自身 /health 端点，防止免费实例休眠
 *    Render free tier sleeps after 15 minutes of inactivity.
 *
 * 2. Supabase 数据库保活：每 3 小时执行一次简单查询，防止数据库暂停
 *    Supabase free tier pauses after 1 week of inactivity.
 */
export function startKeepAlive() {
  if (!IS_PRODUCTION) {
    console.log('⏸️  开发环境，跳过保活任务 / Dev mode, skipping keep-alive tasks');
    return;
  }

  // ============================================================
  // 1. Render 服务自我保活 / Render service self-ping
  //    Cron: 每 10 分钟执行一次 / Every 10 minutes
  // ============================================================
  if (SELF_URL) {
    cron.schedule('*/10 * * * *', async () => {
      try {
        const res = await fetch(`${SELF_URL}/health`);
        console.log(`💓 Render 保活 ping: ${res.status} @ ${new Date().toISOString()}`);
      } catch (err) {
        console.error('❌ Render 保活 ping 失败:', (err as Error).message);
      }
    });
    console.log(`✅ Render 保活任务已启动：每 10 分钟 ping ${SELF_URL}/health`);
  } else {
    console.warn('⚠️  未设置 RENDER_EXTERNAL_URL 或 SELF_URL，跳过 Render 保活');
  }

  // ============================================================
  // 2. Supabase 数据库心跳 / Supabase database heartbeat
  //    Cron: 每 3 小时执行一次 / Every 3 hours
  // ============================================================
  cron.schedule('0 */3 * * *', async () => {
    try {
      // 使用 Prisma 执行最简单的查询保持连接活跃
      await prisma.$queryRawUnsafe('SELECT 1');
      console.log(`💓 Supabase 心跳: OK @ ${new Date().toISOString()}`);
    } catch (err) {
      console.error('❌ Supabase 心跳失败:', (err as Error).message);
    }
  });
  console.log('✅ Supabase 心跳任务已启动：每 3 小时执行 SELECT 1');
}
