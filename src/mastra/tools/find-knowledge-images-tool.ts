import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { ANCHOR_CLOSE, ANCHOR_OPEN, searchKnowledgeImages } from '@/lib/knowledge-store'

/**
 * 图片语义检索工具（“直接要图”）。
 *
 * 在知识库的 image-description 分块上做向量检索，返回图片清单。
 * - 模型侧：toModelOutput 只给文本摘要（含 ⟦img:ID⟧ 锚点），便于模型把锚点
 *   原样复制进回复，由服务端回填成真实图片；不给 URL，避免模型幻觉拼链接。
 * - 应用侧：execute 的原始返回保留 imageUrl 等字段，前端工具卡片直接渲染图片网格。
 */
export const findKnowledgeImagesTool = createTool({
  id: 'find-knowledge-images',
  description:
    '按主题从机床知识库中查找相关插图/图纸/示意图并直接输出给用户。当用户直接索要图片（如“给我看看主轴结构图”“有没有换刀示意图”）时调用此工具，而不是 search-knowledge-base。返回的图片会由系统直接展示；如需在文字中引用某张图，请原样复制结果中的 ⟦img:图片ID⟧ 标记，严禁自行拼接图片 URL。',
  inputSchema: z.object({
    query: z.string().describe('要查找的图片主题描述，如“主轴结构图”“冷却系统示意图”'),
    topK: z.number().int().min(1).max(10).optional().describe('返回图片数量上限，默认 5'),
    fileName: z.string().optional().describe('可选，限定来源文档文件名，如“xxx.pdf”'),
  }),
  outputSchema: z.object({
    query: z.string(),
    count: z.number(),
    images: z.array(
      z.object({
        id: z.string(),
        imageUrl: z.string(),
        description: z.string(),
        sourceFile: z.string(),
        page: z.number().nullable(),
        score: z.number(),
      }),
    ),
  }),
  execute: async ({ query, topK, fileName }) => {
    const images = await searchKnowledgeImages({ query, topK: topK ?? 5, fileName })
    return { query, count: images.length, images }
  },
  // 注意：返回的 ToolResultOutput 文本变体字段名必须是 `value`（不是 `text`）。
  // provider 转换器（openai-compatible 等）按 `output.value` 取值，
  // 写成 `text` 会导致模型收到空的 tool 结果，误判为“没找到”。
  toModelOutput: output => {
    if (!output || output.images.length === 0) {
      return {
        type: 'text',
        value: `知识库中未找到与“${output?.query ?? ''}”相关的图片。`,
      }
    }
    const lines = output.images.map(
      (img, i) =>
        `${i + 1}. ${ANCHOR_OPEN}img:${img.id}${ANCHOR_CLOSE}（来源：${img.sourceFile || '未知文档'}${img.page ? ` 第${img.page}页` : ''}）：${img.description.slice(0, 160)}`,
    )
    return {
      type: 'text',
      value:
        `找到 ${output.images.length} 张与“${output.query}”相关的图片，系统已将图片展示给用户。` +
        `如需在回复中提到某张图，请原样复制对应的 ⟦img:ID⟧ 标记（服务端会渲染为图片），不要自行编写图片 URL：\n${lines.join('\n')}`,
    }
  },
})
