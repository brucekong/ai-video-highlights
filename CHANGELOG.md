# 更新日志 (CHANGELOG)

## [2026-02-27]

### ✨ 新功能 (Features)
- **前端汉化**: 完成了前端界面的全面汉化，包括首页预览、视频播放页、核心摘要侧边栏及登录模块。
- **视频删除功能**: 在历史记录侧边栏集成了视频删除逻辑，支持从个人历史或全局库中移除解析记录。
- **部署环境增强**: 在 Railway 部署环境中引入了 `yt-dlp`、`ffmpeg` 及 `deno` 运行时环境，显著提升了音频采集的成功率。

### 🐞 修复 (Bug Fixes)
- **摘要时间戳偏移**: 修复了 AI 提炼摘要时可能产生超过视频实际时长的时间戳“幻觉”问题，通过后端校验及 Prompt 约束确立了时间边界。
- **YouTube 访问受限**: 通过引入 `User-Agent` 伪装及环境变量 `YOUTUBE_COOKIES` 支持，解决了 YouTube 反爬虫导致的 "Sign in to confirm you’re not a bot" 错误。
- **Whisper 兜底逻辑**: 解决了 Railway 生产环境下 `python3` 命令缺失导致的 Whisper 转录失败问题。

### 🛠️ 优化与重构 (Optimizations & Refactor)
- **部署配置优化**: 新增 `railway.toml` 强制指定使用 Nixpacks 构建器，确保系统级依赖（Python/FFmpeg）正确安装。
- **UI/UX 改进**: 优化了历史记录卡片的展示效果，并为删除操作增加了悬停显示及二次确认确认机制。

---

# CHANGELOG (English)

## [2026-02-27]

### ✨ Features
- **Frontend Localization**: Completed full translation of the frontend interface into Chinese, including the landing page, video view, takeaways sidebar, and login modal.
- **Video Deletion**: Integrated video deletion logic in the history sidebar, allowing removal of analyzed records from personal history or the global database.
- **Environment Enhancement**: Introduced `yt-dlp`, `ffmpeg`, and `deno` runtime in the Railway deployment environment, significantly improving audio capture success rates.

### 🐞 Bug Fixes
- **Timestamp Hallucination**: Fixed issues where AI-generated summary timestamps exceeded the actual video duration by implementing backend validation and Prompt constraints.
- **YouTube Access Restrictions**: Resolved "Sign in to confirm you’re not a bot" errors by implementing User-Agent spoofing and `YOUTUBE_COOKIES` environment variable support.
- **Whisper Fallback**: Fixed Whisper transcription failures caused by missing `python3` in the Railway production environment.

### 🛠️ Optimizations & Refactor
- **Deployment Config**: Added `railway.toml` to force-use the Nixpacks builder, ensuring correct installation of system-level dependencies (Python/FFmpeg).
- **UI/UX Improvements**: Optimized the display of history cards and added hover-triggered delete buttons with confirmation dialogs.
