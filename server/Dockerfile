FROM node:20-slim

# 安装系统依赖：OpenSSL + CA证书 + FFmpeg + Python3 + yt-dlp
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖文件，利用 Docker 缓存层
COPY package*.json ./
RUN npm ci

# 复制 Prisma schema 并生成客户端
COPY prisma ./prisma
RUN npx prisma generate

# 复制源码并构建
COPY . .
RUN npx tsc

EXPOSE 3001

# 启动时先同步数据库 schema，再启动服务
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
