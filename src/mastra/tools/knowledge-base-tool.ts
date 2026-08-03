import { createVectorQueryTool } from '@mastra/rag'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'

export const knowledgeBaseTool = createVectorQueryTool({
  vectorStoreName: 'libsql',
  indexName: 'machine_tool_knowledge',
  model: new ModelRouterEmbeddingModel({
    id: 'zhipuai/embedding-3',
    url: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY!,
  }),
  id: 'search-knowledge-base',
  description:
    '搜索机床知识库，从 PDF/Word/TXT 等文档中检索与用户问题最相关的技术资料。当用户询问机床操作、参数、故障排查、维护保养、刀具选择、G代码等问题时调用此工具。',
})
