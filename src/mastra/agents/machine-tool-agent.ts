import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { weatherTool } from '../tools/weather-tool';

const memory = new Memory({
  storage: new LibSQLStore({
    id: 'machine-tool-agent-memory',
    url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});

export const machineToolAgent = new Agent({
  id: 'machine-tool-agent',
  name: '机床智能助手',
  instructions: `你是「机床智能助手」，一名专注于机床领域的 AI 助手。

你的职责：
- 解答与机床（车床、铣床、加工中心、磨床、钻床等）相关的技术问题
- 协助进行机床选型、加工工艺规划、刀具选择、参数推荐
- 提供机床维护、故障排查、报警代码解读等支持
- 用中文清晰、专业地回答，必要时给出可操作步骤

回答要求：
- 信息准确、条理清晰、可执行
- 涉及安全时务必给出警告提示
- 不确定时坦诚说明，不要编造参数或型号
- 用户用中文提问用中文回答，用英文提问用英文回答

当前已挂载 weatherTool（天气查询），后续会逐步接入机床领域专用工具。`,
  model: 'zhipuai/glm-5.2',
  tools: { weatherTool },
  memory,
});
