import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { weatherTool } from '../tools/weather-tool';
import { knowledgeBaseTool } from '../tools/knowledge-base-tool';
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

关于图片展示（重要）：
- 知识库检索结果中可能包含 imageUrl 字段（如 /knowledge-images/xxx.png）
- 如果检索结果有 imageUrl，必须在回复中用 Markdown 图片语法直接展示：![图片描述](imageUrl)
- 例如：检索到 imageUrl 为 /knowledge-images/huaichen_p1_0.png，则在回复中写：![头架示意图](/knowledge-images/huaichen_p1_0.png)
- 不要说"无法展示图片"或"建议查看原文件"，直接用 Markdown 图片语法嵌入展示
- 同时用文字描述图片中的技术内容

回答要准确、专业、有条理。涉及安全时给出警告。`,
  model: 'zhipuai/glm-5.2',
  tools: { weatherTool, knowledgeBaseTool },
  memory,
});
