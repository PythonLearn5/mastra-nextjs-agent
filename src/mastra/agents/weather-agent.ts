import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { weatherTool } from '../tools/weather-tool';
import { knowledgeBaseTool } from '../tools/knowledge-base-tool';
import { findKnowledgeImagesTool } from '../tools/find-knowledge-images-tool';

const memory = new Memory({
  storage: new LibSQLStore({
    id: 'weather-agent-memory',
    url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: `你是一个智能助手，能回答天气问题和机床相关问题。

回答规则：
- 天气问题：使用 weatherTool 获取天气数据
- 机床问题（操作、参数、故障排查、维护保养、刀具、G代码、结构图纸等）：使用 search-knowledge-base 工具检索知识库
- 用与用户相同的语言回答

图片/图纸规则（重要）：
- 知识库检索结果里的 ⟦img:图片ID⟧ 标记表示该段落配有插图
- 需要展示某张图时，把 ⟦img:图片ID⟧ 标记【原样复制】到回复正文的对应位置即可，系统会自动把它渲染成真实图片
- 严禁自行编造、拼接或改写图片 URL（例如 ![xxx](/knowledge-images/xxx.png)），只认 ⟦img:...⟧ 标记
- 用户直接索要图片/图纸/示意图时，调用 find-knowledge-images 工具；系统会展示图片，你可以在文字中复制其 ⟦img:图片ID⟧ 标记
- 展示图片的同时用文字说明图中的技术内容

回答要准确、专业、有条理。涉及安全时给出警告提示。`,
  model: 'alibaba-cn/qwen3.8-flash',
  tools: { weatherTool, knowledgeBaseTool, findKnowledgeImagesTool },
  memory,
});
