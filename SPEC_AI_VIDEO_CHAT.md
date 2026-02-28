# Technical Specification: AI Video Chat / 技术规格书：AI 视频对话

This document defines the requirements, architecture, and design specifications for the "AI Video Chat" feature in the **AI Video Highlights** project.

本文定义了 **AI Video Highlights** 项目中“AI 视频对话”功能的需求、架构和设计规范。

---

## 1. Feature Overview / 功能概述

The AI Video Chat allows users to interact with video content using an AI assistant. Instead of just reading a static summary, users can ask specific questions about the video's details and receive answers with clickable timestamps.

AI 视频对话允许用户使用 AI 助手与视频内容进行交互。用户不再仅仅阅读静态摘要，而是可以针对视频详情提出具体问题，并获得带可点击时间戳的回答。

---

## 2. Requirements / 核心需求

*   **R1: Stream Conversation**: Support real-time streaming of AI responses for a better user experience.
    *   **流式对话**: 支持 AI 回复的实时流式传输，提升用户体验。
*   **R2: Full Content Context**: The AI must have "God's View" of the entire video transcript to provide accurate answers.
    *   **全量上下文**: AI 必须拥有整个视频转录文本的“上帝视角”，以提供准确的回答。
*   **R3: Clickable Timestamps**: AI must output timestamps in `[mm:ss]` format, which are converted to clickable links in the UI.
    *   **点击跳转**: AI 必须以 `[分:秒]` 格式输出时间戳，并在 UI 中转换为可点击链接。
*   **R4: Chat History**: Conversations must be persisted in the database so users can resume after refreshing.
    *   **对话历史**: 对话必须持久化到数据库中，并在刷新后恢复。
*   **R5: Sidebar Tab Navigation**: The sidebar should switch between "Transcript" and "AI Chat" modes.
    *   **侧边栏切换**: 侧边栏应支持在“转录”和“AI 对话”模式之间切换。

---

## 3. Data Model / 数据模型 (Prisma)

A new model `ChatMessage` is introduced to handle persistent storage.

```prisma
model ChatMessage {
  id        String   @id @default(cuid())
  videoId   String   @map("video_id")
  userId    String   @map("user_id")
  role      String   // "user" or "assistant"
  content   String
  createdAt DateTime @default(now()) @map("created_at")

  video Video @relation(fields: [videoId], references: [videoId], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([videoId, userId])
  @@map("chat_messages")
}
```

---

## 4. API Specification / 接口规范

### 4.1 POST `/api/chat/stream` (SSE)
Request a streaming response from the AI.
*   **Auth**: Required (Bearer Token)
*   **Body**: `{ "videoId": String, "message": String }`
*   **Response**: `text/event-stream` returning data chunks like `data: {"content": "..."}` or `data: [DONE]`.

### 4.2 GET `/api/chat/history/:videoId`
Retrieve past conversation history.
*   **Auth**: Required (Bearer Token)
*   **Response**: `{ "success": true, "data": [{ "role": "user", "content": "..." }, ...] }`

---

## 5. Implementation Details / 实现细节

### 5.1 AI Context Construction (AI 上下文构建)
The server fetches all subtitles, formats them as a timestamped list, and injects them into the **System Prompt**.  
*Example*: `[01:23] In this scene, the author introduces the core concept of...`

### 5.2 Frontend Message Parsing (前端消息解析)
A regex-based parser identifies `[mm:ss]` patterns in the AI's markdown response and wraps them in interactive components that trigger `player.seekTo()`.

---

## 6. UI/UX Design / 交互设计

*   **Tabs**: Sidebar header contains two tabs: "Transcript" (转录) and "AI Chat" (AI 助手).
*   **Avatars**: Distinct icons for `User` and `Bot` (using Lucide symbols).
*   **Bubbles**: Bubble-style chat layout with glassmorphism backgrounds.
*   **Empty State**: Suggestions and quick-prompts to help users get started (e.g., "Summarize this video").

---

## 7. Future Considerations / 未来展望

*   **RAG (Vector Search)**: Introduce for cross-video search or ultra-long videos (10h+).
*   **Image/Frame Support**: Allow AI to describe specific frames.
*   **Export**: Share or save chat logs as PDF/Markdown.
