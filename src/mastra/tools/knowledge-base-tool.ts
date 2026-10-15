import { createVectorQueryTool } from '@mastra/rag'
import { KNOWLEDGE_INDEX_NAME, knowledgeEmbedder } from '@/lib/knowledge-store'

/**
 * 机床知识库文本检索工具。
 *
 * 图文关联约定：chunk 正文里的 `⟦img:IMAGE_ID⟧` 锚点标记该段落的插图位置。
 * 模型引用图片时只需原样复制锚点，服务端流式回填会将其转换为真正的
 * Markdown 图片——模型永远不需要（也不应该）自己拼接图片 URL。
 */
export const knowledgeBaseTool = createVectorQueryTool({
  vectorStoreName: 'libsql',
  indexName: KNOWLEDGE_INDEX_NAME,
  model: knowledgeEmbedder,
  id: 'search-knowledge-base',
  enableFilter: true,
  includeSources: false,
  description:
    `搜索机床知识库，从 PDF/Word/TXT 等文档中检索与用户问题最相关的技术资料（返回 JSON 数组，每项的 text 字段为段落原文）。` +
    `当用户询问机床操作、参数、故障排查、维护保养、刀具选择、G代码、结构图纸等问题时调用此工具。` +
    `段落中出现的 ⟦img:图片ID⟧ 标记表示该处配有插图：回答涉及该段落时，请把 ⟦img:图片ID⟧ 原样复制到回复中对应位置，系统会自动把标记渲染成实际图片；严禁自行编造或拼接图片 URL。` +
    `可选 filter 参数为 JSON 字符串，用于按元数据过滤，例如 {"fileName":{"$eq":"xxx.pdf"}} 或 {"page":{"$gte":3}}，不需要过滤时省略。` +
    `若用户直接索要图片/图纸，请改用 find-knowledge-images 工具。`,
})
