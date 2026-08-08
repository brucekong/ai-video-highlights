# 更新日志 (CHANGELOG)

## [2026-07-10]

### ✨ 新功能 (Features)
- **字幕导出**: 在视频详情页右侧转录字幕区域新增一键导出 Markdown 功能，并优化为适合 Obsidian 阅读的紧凑中英文段落对照格式。
- **Obsidian 集成**: 支持将中英文字幕对照一键写入本地 Obsidian 知识库目录。

## [2026-06-14]

### 🐞 修复 (Bug Fixes)
- **本地裁剪封面**: 修复了裁剪页面中截取封面缩略图使用 `object-fit: cover` 导致顶部画面看起来被裁掉的问题，改为完整显示整帧内容。
- **后台图片预览**: 修复了素材管理中的封面缩略图、文件浏览图片预览和发布预览仍使用铺满裁切样式的问题，统一改为完整显示原图内容。

## [2026-06-13]

### 🐞 修复 (Bug Fixes)
- **发布文案生成**: 修复了视频详情页“发布文案”重新生成按钮仍走通用/视频号风格链路的问题，统一切换为小红书风格文案生成。

### 🛠️ 优化与重构 (Optimizations & Refactor)
- **发布提示词**: 合并通用发布文案与小红书文案的风格约束，统一为更丰富的 emoji + 分段 + 场景细节写法，并统一固定标签注入策略。
- **发布数据同步**: 调整后台分析与手动重生成流程，单次生成即可同步写入通用发布字段和小红书字段，避免两套文案结果风格不一致。

## [2026-04-05]

### 🐞 修复 (Bug Fixes)
- **视频切片**: 修复了无本地完整缓存时通过在线分段下载生成长切片会在约 110 秒后音轨提前结束、导致后半段持续无声的问题。

### 🛠️ 优化与重构 (Optimizations & Refactor)
- **切片导出链路**: 调整为优先缓存完整源视频并在本地执行 FFmpeg 裁切，同时统一重建音频时间戳，降低远程分段下载造成的音视频索引损坏风险。

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
