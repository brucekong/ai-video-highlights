# 项目全局规范与约束 / Project Global Specifications & Constraints

## 1. 前端交互规范 / Frontend Interaction Standards

### 1.1 弹窗与控制 / Modals & Controls
- **键盘支持 (Esc Support)**: 
  - **[Mandatory]** 所有弹窗（Modals）、抽屉（Drawers）或全屏覆盖层（Overlays）必须支持通过按下键盘的 `Esc` 键来关闭。
  - **[Implementation]**: 在 Vue 组件中应通过 `window.addEventListener('keydown', handleEsc)` 或 VueUse 的 `onKeyStroke('Escape', ...)` 来实现。
  - **[Cleanup]**: 必须在组件卸载（onUnmounted）或弹窗关闭时移除对应的事件监听，防止内存泄漏。

- **焦点管理 (Focus Management)**:
  - 弹窗打开后，相关的输入框（如果存在）应自动获取焦点（Auto-focus）。

- **传送门 (Teleportation)**:
  - 核心弹窗组件建议使用 `<Teleport to="body">` 渲染，以确保定位不受父级容器 `transform` 或 `overflow` 的影响。

### 1.2 用户反馈与提示 / User Feedback & Notifications
- **[Critical] 友好交互原则 (Friendly UI)**:
  - **禁止使用原生提示**: 严禁直接使用 `window.alert()`、`window.confirm()` 或 `window.prompt()`。
  - **一致性**: 所有全局级别的通知、错误提示、操作反馈必须通过自定义的 UI 组件（如 Friendly Modals, Toasts）实现，且需包含明确的图标和色彩区分（Success/Error/Info）。
  - **加载反馈 (Loading States)**: 长耗时操作（异步请求）必须为触发按钮或相关区域增加加载反馈（如 `Loader` 旋转图标、按钮文本切换、禁用重复点击）。

---

## 2. 搜索逻辑规范 / Search Logic Standards

### 2.1 语义搜索算法逻辑 / Semantic Search Algorithm Logic
- **混合检索策略 (Hybrid Search)**: 所有语义搜索入口必须采用“向量相似度 + 关键词增强”的混合策略。
- **数字专项优化 (Numeric Specialization)**:
  - **[Critical]**: 当查询为纯数字（如 "12"）时，系统进入“精准模式”。
  - **惩罚逻辑**: 对于不包含该数字字符串的结果，其相似度得分将折损 60%（乘以 0.4）。
  - **强制过滤**: 若内容不包含该数字，则相似度得分必须达到 **0.7** 以上（极高语义相关）才能显示。
- **计分权重分配 (Scoring Weights)**:
  - **基础分 (Base Score)**: 基于 pgvector 的 `1 - (embedding <=> query)`。
  - **文本奖励 (Text Boost)**: 
    - 完全匹配（Exact Match）: `+0.4`
    - 模糊包含（ILIKE Contain）: `+0.15`
- **噪音抑制 (Noise Suppression)**:
  - **长度惩罚 (Length Penalty)**: 5 个字符以内的短句如果没有关键词命中，其得分系数下调至 `0.6`。
  - **强制过滤**: 长度小于 2 字符且不含关键词的片段将被从 SQL 层级直接过滤。
- **归一化 (Normalization)**: 最终得分必须通过 `LEAST(1.0, ...)` 封顶，确保 UI 显示不超过 100%。

### 2.2 搜索交互 / Search Interaction
- **防抖自动搜索 (Debounced Auto-search)**:
  - **[Mandatory]**: 侧边栏及主要列表内的搜索框必须支持防抖自动触发，无需用户手动点击搜索按钮。
  - **[Timing]**: 防抖延迟建议设置为 `500ms`，以平衡后端压力与用户响应的及时性。
  - **[State]**: 在搜索过程中应有明确的加载反馈（如 Loading 图标），且在搜索词清空时应立即切回概览模式。

---

## 3. 代码风格与性能 / Code Style & Performance

### 3.1 动画一致性 / Animation Consistency
- 使用 `TransitionGroup` 处理列表动态增减。
- 采用 Stagger 效果时，延迟系数通过 CSS 变量 `--index` 动态控制。
- 结果容器应配置 `scrollbar-gutter: stable` 以防止滚动条抖动。

---

## 4. 后端接口规范 / Backend API Standards

### 4.1 Fastify 响应架构 / Fastify Response Schema
- **[Critical] 显式声明原则 (Explicit Declaration)**: 
  - **[Problem]**: Fastify 使用 `fast-json-stringify` 进行序列化。如果代码中 `reply.send()` 返回了某个字段，但该字段未在路由的 `schema.response` 中声明，该字段会在输出时被自动剔除（Stripped），导致前端无法接收。
  - **[Requirement]**: 每一个需要传递给前端的字段（尤其是新增加的状态位，如 `isIndexed` 等），**必须**在路由定义文件的 `response` schema 中进行完整声明。
  - **[Checklist]**: 如果日志显示后台已发送数据，但前端 `Network` 面板中响应体缺失该字段，请务必检查路由架构定义。

### 4.2 数据交互规范 / Data Interaction Standards
- **分页检索 (Pagination)**:
  - **集合限制**: 对于历史列表、日志等潜在的大型数据集，必须支持分页查询 (`page`, `limit`)，杜绝一次性全量加载。
  - **元数据补充**: 分页响应应统一包含 `meta` 结构，包含 `totalCount`, `page`, `limit` 及 `hasMore` 等状态位。
