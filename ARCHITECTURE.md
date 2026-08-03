# 项目架构说明（ARCHITECTURE）

本文件描述 `mastra-nextjs-agent` 的整体架构、目录结构、技术栈与运行方式，便于新成员快速上手。

## 技术栈

| 层 | 技术 | 版本 | 说明 |
|---|---|---|---|
| 框架 | Next.js（App Router） | 16.2.12 | 全栈框架，前端页面与 API 路由同构 |
| 运行时 | React 19 / Node.js | 19.2.4 / ≥18 | 前端 UI 与服务端运行时 |
| 语言 | TypeScript | ^5 | 严格模式 `strict: true` |
| 样式 | Tailwind CSS v4 + shadcn | ^4 / ^4.16.0 | 原子化 CSS + 组件库，基于 `@base-ui/react` |
| AI 框架 | Mastra | ^1.20.2（CLI）/ ^1.53.0（core） | Agent / Workflow / Tool / Memory / Storage |
| AI SDK 集成 | `@mastra/ai-sdk` + `ai` + `@ai-sdk/react` | ^1.6.3 / ^7.0.38 / ^4.0.41 | Mastra ↔ Vercel AI SDK 桥接，流式聊天与 UI 消息 |
| 存储 | `@mastra/libsql`（LibSQL/Turso） | ^1.17.1 | 会话/记忆持久化，fallback `file:./mastra.db` |
| 可观测性 | `@mastra/observability` + `@mastra/loggers` | ^1.16.2 / ^1.2.0 | Pino 日志 + Storage/Platform 导出 + 敏感数据脱敏 |
| 校验 | Zod | ^4.4.3 | 工具/Workflow 输入输出 schema |
| 其他关键依赖 | `nanoid`、`lucide-react`、`streamdown`、`motion`、`cmdk` | — | ID 生成、图标、Markdown 渲染、动画、命令面板 |

## 目录结构

```
mastra-nextjs-agent/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/
│   │   │   ├── chat/route.ts         # 聊天流式接口（GET 历史消息 / POST 发送）
│   │   │   ├── threads/route.ts     # 会话 CRUD（GET 列表 / POST 新建 / PATCH 改名 / DELETE 删除）
│   │   │   └── models/route.ts       # 可选模型列表
│   │   ├── chat/page.tsx             # /chat 路由（渲染 ChatShell）
│   │   ├── globals.css               # 全局样式与主题变量
│   │   ├── layout.tsx                # 根布局（字体、html/body）
│   │   └── page.tsx                  # 首页（渲染 ChatShell）
│   ├── components/
│   │   ├── ai-elements/               # AI 聊天 UI 元素库（40+ 组件）
│   │   ├── ui/                        # shadcn 基础组件（基于 @base-ui/react）
│   │   ├── app-sidebar.tsx           # 侧边栏（历史会话）
│   │   ├── chat-panel.tsx            # 聊天主面板（消息列表 + 输入区）
│   │   ├── chat-shell.tsx            # 外壳：组合侧边栏 + 顶部栏 + 聊天面板
│   │   └── top-bar.tsx               # 顶部栏（模型切换 + 侧边栏切换）
│   ├── lib/
│   │   └── utils.ts                  # cn() 工具函数
│   └── mastra/                        # Mastra 核心配置
│       ├── index.ts                  # Mastra 实例（agents/workflows/storage/logger/observability）
│       ├── agents/weather-agent.ts   # 天气 Agent
│       ├── tools/weather-tool.ts     # 天气工具（Open-Meteo API）
│       └── workflows/weather-workflow.ts  # 天气活动建议 Workflow
├── .env / .env.example              # 环境变量
├── next.config.ts                   # Next.js 配置（allowedDevOrigins）
├── tsconfig.json                    # TS 配置（@/* → ./src/*）
├── postcss.config.mjs               # PostCSS（Tailwind v4）
├── components.json                  # shadcn 配置
├── eslint.config.mjs                # ESLint
├── AGENTS.md / CLAUDE.md            # AI 协作约定
└── package.json
```

## 架构分层

```
┌─────────────────────────────────────────────────────────┐
│ 前端（Next.js App Router + React 19）                    │
│  ChatShell                                              │
│   ├ AppSidebar  ──┐                                     │
│   ├ TopBar      ──┤                                     │
│   └ ChatPanel   ──┤── fetch /api/chat, /api/threads      │
│                   └── useChat (DefaultChatTransport)     │
└──────────────────────────────┬──────────────────────────┘
                               │ HTTP（REST + 流式）
┌──────────────────────────────┴──────────────────────────┐
│ API 路由（Next.js Route Handlers）                       │
│  /api/chat     GET 历史消息 / POST 流式聊天              │
│  /api/threads  GET 列表 / POST 新建 / PATCH 改名 / DELETE│
│  /api/models   GET 可选模型                              │
└──────────────────────────────┬──────────────────────────┘
                               │ 调用
┌──────────────────────────────┴──────────────────────────┐
│ Mastra 层                                                │
│  Mastra 实例（src/mastra/index.ts）                      │
│   ├ Agents: weatherAgent（zhipuai/glm-5.2）             │
│   ├ Workflows: weatherWorkflow（fetchWeather→plan）      │
│   ├ Storage: LibSQLStore（mastra.db / Turso）           │
│   ├ Memory: LibSQLStore（weather-agent-memory）         │
│   ├ Logger: PinoLogger                                  │
│   └ Observability: Storage + Platform 导出 + 脱敏       │
└──────────────────────────────┬──────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
        LLM Provider（智谱）          外部 API（Open-Meteo）
```

## 前端架构

### 三栏布局（ChatGPT 风格）

- `ChatShell` 是状态中枢，管理：会话列表、当前会话、模型选择、侧边栏开闭
- `AppSidebar`：历史会话列表，支持新建/选择/删除，移动端可折叠
- `TopBar`：当前会话标题 + 模型下拉选择 + 侧边栏切换
- `ChatPanel`：消息列表（流式）+ 输入区（文本/语音/动作菜单/发送按钮）

### 数据流

```
ChatShell
  │  threads / activeThreadId / model
  ├── AppSidebar   ── GET/POST/DELETE /api/threads
  ├── TopBar       ── GET /api/models，onModelChange
  └── ChatPanel (key=activeThreadId)
        ├── useChat(DefaultChatTransport → POST /api/chat)
        ├── fetch GET /api/chat?threadId=...（历史消息）
        ├── Conversation + Message + Tool（渲染）
        └── PromptInput + 语音识别（输入与提交）
```

切换会话时，`ChatPanel` 通过 `key={activeThreadId}` 重置内部状态并重新拉取历史消息。

## 后端架构

### API 路由

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/chat` | GET | 按 `?threadId=` 拉取历史消息 |
| `/api/chat` | POST | 流式聊天（body: `threadId`, `model`, 消息内容） |
| `/api/threads` | GET | 分页列出会话（按 updatedAt 倒序） |
| `/api/threads` | POST | 新建会话（body: `threadId`, `title`, `metadata`） |
| `/api/threads` | PATCH | 重命名会话（`?id=`, body: `title`） |
| `/api/threads` | DELETE | 删除会话（`?id=`） |
| `/api/models` | GET | 返回可选模型列表 |

### Mastra 配置

- **Agent**：`weather-agent`，模型 `zhipuai/glm-5.2`，挂载 `weatherTool`
- **Workflow**：`weatherWorkflow`（`fetch-weather` → `plan-activities`）
- **Storage**：`LibSQLStore`，url 取 `TURSO_DATABASE_URL`，fallback `file:./mastra.db`
- **Memory**：独立 `LibSQLStore`（id: `weather-agent-memory`），url 同上
- **Logger**：`PinoLogger`（level: info）
- **Observability**：`MastraStorageExporter` + `MastraPlatformExporter` + `SensitiveDataFilter`

## 运行方式

```bash
# 安装依赖
npm install

# 开发
npm run dev          # http://localhost:3000

# 生产构建与启动
npm run build
npm start

# Lint
npm run lint
```

> 注意：按 `AGENTS.md` 约定，使用 `npm run dev` / `npm run build`，不要直接执行 `mastra dev` / `mastra build`。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ZHIPU_API_KEY` | 是 | 智谱模型 API Key（`zhipuai/glm-5.2` 等） |
| `TURSO_DATABASE_URL` | 否 | LibSQL/Turso 数据库地址，未设置时 fallback `file:./mastra.db` |
| `TURSO_AUTH_TOKEN` | 否 | Turso 访问令牌（本地文件模式不需要） |
| `MASTRA_PLATFORM_ACCESS_TOKEN` | 否 | Mastra Platform 导出令牌（可选） |

## 约定

- 所有 agents/tools/workflows 在 `src/mastra/index.ts` 注册
- UI 组件基于 `@base-ui/react`（非 Radix），新增 shadcn 组件时注意兼容性
- 使用 Mastra chat stream v6 与 `ai` 包类型保持一致
- 路径别名 `@/*` → `./src/*`
