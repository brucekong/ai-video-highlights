# AI Video Highlights Deployment Plan / 部署方案

This document outlines the recommended deployment strategy for the AI Video Highlights project, including frontend, backend, and database.

本文档概述了 AI Video Highlights 项目的推荐部署策略，包括前端、后端和数据库。

---

## 🏗️ Architecture Overview / 架构概览

- **Frontend (前端)**: Vue 3 + Vite 🚀
- **Backend (后端)**: Fastify (Node.js) ⚡
- **Database (数据库)**: PostgreSQL (Prisma ORM) 🐘
- **AI Services (AI 服务)**: DeepSeek, Groq, Gemini 🤖

---

## 🚀 Recommended Hosting Strategy / 推荐托管方案

| Component | Recommended Platform | Why? / 理由 |
| :--- | :--- | :--- |
| **Frontend** | [Vercel](https://vercel.com) / [Cloudflare Pages](https://pages.cloudflare.com) | Static hosting, global CDN, automated deployments. / 静态托管，全球 CDN，自动部署。 |
| **Backend** | [Zeabur](https://zeabur.com) / [Railway](https://railway.app) | Optimized for Node.js, easy Prisma management, supports subdomains. / 对 Node.js 优化好，Prisma 管理简单，支持自定义域名。 |
| **Database** | [Supabase](https://supabase.com) / [Neon](https://neon.tech) | Free/Cheap managed PostgreSQL with great performance. / 免费或低成本的托管 PostgreSQL，性能极佳。 |

---

## 🛠️ Step-by-Step Deployment / 详细部署步骤

### 1. Database Setup / 数据库设置
1. Create a project on **Supabase** or **Neon**.
2. Copy the **Connection String** (PostgreSQL URL).
3. Update your `DATABASE_URL` in the server `.env`.

1. 在 **Supabase** 或 **Neon** 上创建一个项目。
2. 复制 **连接字符串** (PostgreSQL URL)。
3. 更新服务端 `.env` 中的 `DATABASE_URL`。

### 2. Backend Deployment / 后端部署
1. Connect your GitHub repository to **Zeabur** or **Railway**.
2. Set the root directory to `server`.
3. Configure the **Environment Variables** (from `.env`):
   - `DATABASE_URL`
   - `DEEPSEEK_API_KEY`
   - `JWT_SECRET`
   - `PORT=3001` (or as required)
4. Ensure the build command runs `npm run build` and `npx prisma generate`.

1. 将你的 GitHub 仓库连接到 **Zeabur** 或 **Railway**。
2. 将根目录设置为 `server`。
3. 配置 **环境变量**（参考 `.env` 文件）：
   - `DATABASE_URL`
   - `DEEPSEEK_API_KEY`
   - `JWT_SECRET`
   - `PORT=3001` (或按需设置)
4. 确保构建命令包含 `npm run build` 和 `npx prisma generate`。

### 3. Frontend Deployment / 前端部署
1. Connect your GitHub repository to **Vercel** or **Cloudflare Pages**.
2. Set the root directory to `frontend`.
3. Set the **Build Command**: `npm run build`.
4. Set the **Output Directory**: `dist`.
5. Add the **Backend API URL** as an environment variable (e.g., `VITE_API_URL`).

1. 将你的 GitHub 仓库连接到 **Vercel** 或 **Cloudflare Pages**。
2. 将根目录设置为 `frontend`。
3. 设置 **构建命令**: `npm run build`。
4. 设置 **输出目录**: `dist`。
5. 将 **后端 API 地址** 添加为环境变量（如 `VITE_API_URL`）。

---

## 🌐 Domain Configuration / 域名配置

To use your own domain (e.g., `example.com`):

1. **Frontend**: Use `www.example.com` or `app.example.com`.
   - In Vercel/Cloudflare, add your custom domain.
   - Point the CNAME records in your DNS provider (e.g., Aliyun, Cloudflare) to the platform's provided address.
2. **Backend**: Use `api.example.com`.
   - In Zeabur/Railway, add the custom subdomain.
   - Point the CNAME record to the backend hosting provider.

使用你的自定义域名（例如 `example.com`）：

1. **前端**: 使用 `www.example.com` 或 `app.example.com`。
   - 在 Vercel/Cloudflare 中添加你的自定义域名。
   - 在你的 DNS 服务商（如阿里云、Cloudflare）中将 CNAME 记录指向平台提供的地址。
2. **后端**: 使用 `api.example.com`。
   - 在 Zeabur/Railway 中添加自定义子域名。
   - 将 CNAME 记录指向后端托管服务商。

---

## 🔒 Security Note / 安全提醒

> [!WARNING]
> Your `.env` file contains sensitive API keys. **NEVER** commit secret keys to GitHub. Use environment variable settings provided by your hosting platform instead.
>
> 你的 `.env` 文件包含敏感的 API 密钥。**严禁** 将私钥提交到 GitHub。请使用托管平台提供的环境变量设置功能。
