# 项目能力说明（CAPABILITIES）

本文件描述 `mastra-nextjs-agent` 当前已具备的功能能力、可扩展方向与使用方式。

## 能力总览

| 能力域 | 状态 | 说明 |
|---|---|---|
| 多轮对话（流式） | ✅ 已实现 | 基于 Mastra Agent + AI SDK，支持流式输出 |
| 会话管理 | ✅ 已实现 | 新建/切换/删除/重命名，历史持久化 |
| 模型切换 | ✅ 已实现 | 运行时切换 LLM 模型 |
| 工具调用 | ✅ 已实现 | 天气查询工具，LLM 自动调用 |
| 记忆与持久化 | ✅ 已实现 | LibSQLStore 存储，跨会话记忆 |
| 语音输入 | ✅ 已实现 | 浏览器 SpeechRecognition，中文识别 |
| Workflow | ✅ 已实现 | 天气活动建议工作流（fetchWeather → planActivities） |
| 可观测性 | ✅ 已实现 | 日志 + 链路追踪 + 敏感数据脱敏 |
| ChatGPT 风格 UI | ✅ 已实现 | 侧边栏 + 顶部栏 + 聊天面板三栏布局 |
| 多用户隔离 | ⚠️ 待实现 | 当前为单用户（固定 resourceId） |
| 文件/图片上传 | ⚠️ 预留 | 输入区有动作菜单入口，功能未接入 |
| 网络搜索 | ⚠️ 预留 | 菜单条目存在但 disabled |
| TTS 语音播报 | ❌ 未实现 | 有 voice-selector 组件，未接入 |
| 用户登录鉴权 | ❌ 未实现 | 无认证层 |

## 详细能力

### 1. 对话能力

**流式聊天**
- 前端使用 `@ai-sdk/react` 的 `useChat`，通过 `DefaultChatTransport` 连接 `/api/chat`
- 后端使用 `@mastra/ai-sdk` 的 `handleChatStream`（version: `v6`），与 Mastra Agent 对接
- 支持 Enter 发送、Shift+Enter 换行、Stop 中断生成

**消息渲染**
- 用户消息：右对齐气泡
- 助手消息：左对齐 + "GPT" 头像，支持 Markdown（Streamdown 渲染器）
- 工具调用：展示工具名称、输入参数、输出结果、错误信息
- 支持代码高亮（Shiki）、数学公式、Mermaid 图表、CJK 优化

**模型切换**
- 顶部栏下拉选择模型，切换后对后续发送生效
- 当前可选：`alibaba-cn/qwen3.8-flash`、`alibaba-cn/qwen-flash`、`openai/gpt-4o-mini`
- 模型通过 `handleChatStream` 的 `params.model` 运行时覆盖 Agent 默认配置

### 2. 会话管理

| 操作 | 触发方式 | API |
|---|---|---|
| 新建会话 | 侧边栏「新对话」按钮 | `POST /api/threads` |
| 切换会话 | 点击侧边栏列表项 | 前端切换 `activeThreadId` |
| 删除会话 | 列表项 hover → 更多 → 删除 | `DELETE /api/threads?id=` |
| 重命名 | 首条消息自动生成标题（前 20 字） | `PATCH /api/threads?id=` |
| 历史列表 | 页面加载自动拉取 | `GET /api/threads` |
| 消息恢复 | 切换会话自动拉取 | `GET /api/chat?threadId=` |

- 会话数据存储在 LibSQL（`mastra.db` 或 Turso 远程）
- 切换会话时通过 `key={threadId}` 重置 ChatPanel 状态

### 3. Agent 能力

**Weather Agent**
- ID: `weather-agent`
- 默认模型: `alibaba-cn/qwen3.8-flash`
- 内置工具: `weatherTool`（`get-weather`）
- 指令特点:
  - 未提供地点时主动询问
  - 非英文地名自动翻译
  - 多段地名取最相关部分
  - 包含湿度、风速、降水等细节
  - 可按天气建议活动

**Weather Tool**
- 输入: `{ location: string }`（城市名）
- 流程: Open-Meteo Geocoding API（地名→经纬度）→ Open-Meteo Forecast API（天气数据）
- 输出: 温度、体感温度、湿度、风速、阵风、天气状况、地点名
- 外部依赖: `geocoding-api.open-meteo.com` + `api.open-meteo.com`（免费、无需 Key）

**Weather Workflow**
- ID: `weather-workflow`
- 输入: `{ city: string }`
- 步骤:
  1. `fetch-weather`: 调用 Open-Meteo 获取天气预报
  2. `plan-activities`: 调用 Weather Agent 生成活动建议
- 输出: `{ activities: string }`

### 4. 存储与记忆

| 存储 | 用途 | 配置 |
|---|---|---|
| LibSQLStore（`mastra-storage`） | Mastra 顶层存储（可观测性数据） | `TURSO_DATABASE_URL` 或 `file:./mastra.db` |
| LibSQLStore（`weather-agent-memory`） | Agent 记忆（会话/消息） | 同上 |

- 未配置 `TURSO_DATABASE_URL` 时，自动 fallback 到本地 `./mastra.db`
- 本地模式无需 `TURSO_AUTH_TOKEN`

### 5. 可观测性

| 能力 | 实现 | 说明 |
|---|---|---|
| 日志 | `PinoLogger`（level: info） | 控制台输出 |
| 链路追踪 | `MastraStorageExporter` | 持久化到 Storage |
| 平台上报 | `MastraPlatformExporter` | 需 `MASTRA_PLATFORM_ACCESS_TOKEN` |
| 敏感数据脱敏 | `SensitiveDataFilter` | 自动过滤密码/令牌/密钥 |

### 6. UI 能力

**布局**
- ChatGPT 风格三栏：侧边栏 + 顶部栏 + 聊天面板
- 侧边栏：移动端可折叠（遮罩 + 滑动动画）
- 顶部栏：会话标题 + 模型选择下拉
- 聊天面板：消息列表 + 底部输入区（sticky）

**输入区**
- 文本输入框（自适应高度）
- 语音输入按钮（浏览器 SpeechRecognition，中文 `zh-CN`）
- 动作菜单（＋）：添加文件/图片、创建图片、网络搜索（后两项预留）
- 发送/停止按钮（状态联动：空输入隐藏，生成中显示停止）

**组件库**
- `src/components/ui/`：25+ shadcn 基础组件（基于 `@base-ui/react`）
- `src/components/ai-elements/`：40+ AI 聊天专用组件（消息、工具、推理、代码块等）

### 7. 开发能力

**开发服务器**
- `npm run dev` → `http://localhost:3000`
- 支持 HMR（需配置 `allowedDevOrigins` 以支持局域网访问）

**生产构建**
- `npm run build` + `npm start`

**类型检查**
- `npx tsc --noEmit`（`tsconfig.json` strict 模式）

**Lint**
- `npm run lint`（`eslint-config-next`）

**Mastra Studio**
- 项目内可运行 `mastra dev` 启动 Studio（`http://localhost:4111`），可视化调试 Agent/Workflow/Tool
- 按 `AGENTS.md` 约定，日常开发使用 `npm run dev`

## 扩展指南

### 新增 Agent
1. 在 `src/mastra/agents/` 新建文件，`new Agent({ id, name, model, instructions, tools, memory })`
2. 在 `src/mastra/index.ts` 的 `agents` 中注册
3. 在 `src/app/api/chat/route.ts` 调整 `agentId`

### 新增 Tool
1. 在 `src/mastra/tools/` 新建文件，`createTool({ id, description, inputSchema, outputSchema, execute })`
2. 在 Agent 的 `tools` 中挂载

### 新增 Workflow
1. 在 `src/mastra/workflows/` 新建文件，使用 `createWorkflow` + `createStep`
2. 在 `src/mastra/index.ts` 的 `workflows` 中注册

### 新增模型
1. 在 `src/app/api/models/route.ts` 的 `AVAILABLE_MODELS` 添加条目
2. 确保对应环境变量已配置（如 `DASHSCOPE_API_KEY`、`OPENAI_API_KEY`）

### 切换到 Turso 远程数据库
1. 在 `.env.local` 设置 `TURSO_DATABASE_URL=libsql://...` 和 `TURSO_AUTH_TOKEN=...`
2. 重启 dev server

## 已知限制

- **单用户**：`RESOURCE_ID` 固定为 `weather-chat`，未做多用户隔离
- **文件上传**：输入区有入口但未实现上传逻辑
- **网络搜索**：菜单条目 disabled
- **TTS**：有 `voice-selector` 组件但未接入播放
- **认证**：无登录/鉴权层
- **ai-elements 类型错误**：`src/components/ai-elements/*` 存在既有的 TypeScript 类型错误（模板遗留，与 `@base-ui/react` 版本演进有关），不影响运行
