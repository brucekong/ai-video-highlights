import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';

export const Schemas = {
  TakeawayItem: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '要点唯一 ID' },
      title: { type: 'string', description: '要点标题' },
      summary: { type: 'string', nullable: true, description: '要点摘要' },
      timestamp: { type: 'integer', description: '视频中的时间点（秒）' },
      duration: { type: 'string', nullable: true, description: '该段持续时长' },
    },
  },
  TranscriptSegment: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '字幕文本' },
      translatedText: { type: 'string', nullable: true, description: '字幕翻译文本' },
      offset: { type: 'integer', description: '开始时间（毫秒）' },
      duration: { type: 'integer', description: '持续时长（毫秒）' },
    },
  },
  VideoListItem: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: '视频 ID（YouTube video ID 或 Bilibili BV号）' },
      title: { type: 'string', nullable: true, description: '视频标题' },
      url: { type: 'string', description: '视频完整 URL' },
      platform: { type: 'string', enum: ['youtube', 'bilibili'], description: '视频平台' },
      takeawayCount: { type: 'integer', description: '要点数量' },
      analyzedAt: { type: 'string', format: 'date-time', description: '分析时间' },
    },
  },
  UserProfile: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '用户 ID' },
      name: { type: 'string', nullable: true, description: '用户名' },
      email: { type: 'string', nullable: true, description: '邮箱' },
      avatar: { type: 'string', nullable: true, description: '头像 URL' },
    },
  },
  ErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', description: '错误信息' },
      message: { type: 'string', description: '详细错误描述' },
    },
  },
  SuccessMessage: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string' },
    },
  },
};


/**
 * OpenAPI 规范配置
 * 用于生成 API 文档（通过 Scalar 渲染）
 */
export const swaggerOptions: FastifyDynamicSwaggerOptions = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'AI Video Highlights API',
      description: `
## 🎬 AI 视频精要提取服务

AI Video Highlights 是一个智能视频分析平台，支持 YouTube 和 Bilibili 视频，
自动提取关键要点、管理字幕、并提供用户认证功能。

### 核心功能
- **视频分析**：AI 驱动的视频内容分析与要点提取
- **字幕提取**：自动获取和缓存视频字幕，支持 Whisper 兜底
- **多平台支持**：YouTube / Bilibili
- **用户系统**：Google / 微信 OAuth 登录
- **历史管理**：用户分析历史记录管理

### 认证方式
部分接口需要通过 \`Bearer Token\` 认证，Token 通过 OAuth 登录后获取。
      `.trim(),
      version: '0.0.1',
      contact: {
        name: 'AI Video Highlights',
        url: 'https://github.com/brucekong/ai-video-highlights',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: '本地开发服务器',
      },
    ],
    tags: [
      {
        name: 'Health',
        description: '健康检查接口，用于监测服务状态',
      },
      {
        name: 'Analyze',
        description: '视频分析相关接口 — 提交视频进行 AI 分析、获取分析结果',
      },
      {
        name: 'Videos',
        description: '视频管理接口 — 列表、详情、删除已分析的视频',
      },
      {
        name: 'Transcript',
        description: '字幕接口 — 获取视频字幕（不做 AI 分析）',
      },
      {
        name: 'Auth',
        description: '用户认证接口 — Google / 微信 OAuth 登录、获取当前用户信息',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '通过 OAuth 登录后获取的 JWT Token',
        },
      },
    },
  },
};
