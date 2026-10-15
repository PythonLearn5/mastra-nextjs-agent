import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { knowledgeBaseTool } from '../tools/knowledge-base-tool';
import { findKnowledgeImagesTool } from '../tools/find-knowledge-images-tool';

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

工具使用：
- 技术问题一律先用 search-knowledge-base 检索知识库，基于检索结果回答
- 用户直接索要图片/图纸/示意图时，使用 find-knowledge-images 工具

图片/图纸规则（重要）：
- 检索结果里的 ⟦img:图片ID⟧ 标记表示该段落配有插图
- 需要展示某张图时，把 ⟦img:图片ID⟧ 标记【原样复制】到回复正文即可，系统会自动渲染成真实图片
- 严禁自行编造、拼接或改写图片 URL，只认 ⟦img:...⟧ 标记
- 展示图片的同时用文字说明图中的技术内容

回答要求：
- 信息准确、条理清晰、可执行
- 涉及安全时务必给出警告提示
- 不确定时坦诚说明，不要编造参数或型号
- 用户用中文提问用中文回答，用英文提问用英文回答`,
  model: 'alibaba-cn/qwen3.8-flash',
  tools: { knowledgeBaseTool, findKnowledgeImagesTool },
  memory,
});
