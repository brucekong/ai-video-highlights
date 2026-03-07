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

---

## 2. 搜索逻辑规范 / Search Logic Standards

### 2.1 语义搜索调优 / Semantic Search Tuning
- **混合检索策略 (Hybrid Search)**:
  - 所有的语义搜索入口必须采用“向量相似度 + 关键词增强”的混合策略。
  - **权重分配**: 
    - 字面完全匹配（Exact Match）奖励强度高于模糊匹配。
    - 最终得分需由 `LEAST(1.0, ...)` 进行归一化处理。

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
