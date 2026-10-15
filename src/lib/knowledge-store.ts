/**
 * 知识库共享检索层（图文关联 RAG 的核心）
 *
 * - 向量库 / 嵌入模型单例（构建脚本与运行时共用）
 * - 图片锚点 ⟦img:ID⟧ 的解析、清洗、渲染
 * - 图片清单 public/knowledge-images/manifest.json 的读取（id → url/描述/来源/页码）
 * - 服务端锚点 → Markdown 回填（流式 text-delta + 历史消息两条路径）
 * - 图片语义检索（供 find-knowledge-images 工具“直接要图”）
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { embed } from 'ai'
import { LibSQLVector } from '@mastra/libsql'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'

export const KNOWLEDGE_INDEX_NAME = 'machine_tool_knowledge'
export const EMBEDDING_DIMENSIONS = 2048

/** 图片锚点标记：⟦img:IMAGE_ID⟧，IMAGE_ID 为图片文件名主干（构建时确定性生成） */
export const ANCHOR_OPEN = '\u27e6'
export const ANCHOR_CLOSE = '\u27e7'
export const ANCHOR_PREFIX = `${ANCHOR_OPEN}img:`
const anchorRe = () => new RegExp(`${ANCHOR_OPEN}img:([^${ANCHOR_CLOSE}\\s]+)${ANCHOR_CLOSE}`, 'g')

// ---------------------------------------------------------------------------
// 单例：嵌入模型 / 向量库
// ---------------------------------------------------------------------------

export const knowledgeEmbedder = new ModelRouterEmbeddingModel({
  id: 'alibaba-cn/text-embedding-v4',
  url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY!,
})

/** text-embedding-v4 默认 1024 维，必须显式指定 dimensions 才能对齐 2048 维索引 */
export const EMBEDDING_PROVIDER_OPTIONS = {
  openaiCompatible: { dimensions: EMBEDDING_DIMENSIONS },
} as const

let sharedVectorStore: LibSQLVector | null = null

export function getKnowledgeVectorStore(): LibSQLVector {
  if (!sharedVectorStore) {
    sharedVectorStore = new LibSQLVector({
      id: 'mastra-vector',
      url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN,
    })
  }
  return sharedVectorStore
}

// ---------------------------------------------------------------------------
// 锚点字符串工具
// ---------------------------------------------------------------------------

/** 提取文本中所有完整锚点的 IMAGE_ID（去重、保序） */
export function extractImageIds(text: string): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(anchorRe())) {
    const id = m[1].trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** 移除完整锚点（用于嵌入文本，避免标记污染向量） */
export function stripAnchors(text: string): string {
  return text
    .replace(anchorRe(), '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 移除被分块/流式截断产生的不完整锚点碎片（孤立 ⟦… 或 ⟧），完整锚点原样保留 */
export function stripIncompleteAnchorFragments(text: string): string {
  if (!text.includes(ANCHOR_OPEN) && !text.includes(ANCHOR_CLOSE)) return text
  const preserved: string[] = []
  // 先把完整锚点占位保护起来，避免被后续清理误伤
  let out = text.replace(anchorRe(), (m) => {
    preserved.push(m)
    return `\u0000${preserved.length - 1}\u0000`
  })
  out = out.replace(new RegExp(`${ANCHOR_OPEN}[^${ANCHOR_CLOSE}]*$`), '')
  out = out.split(ANCHOR_CLOSE).join('')
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => preserved[Number(i)])
  return out
}

// ---------------------------------------------------------------------------
// 图片清单 manifest
// ---------------------------------------------------------------------------

export interface KnowledgeImageEntry {
  id: string
  url: string
  description?: string
  caption?: string
  sourceFile?: string
  page?: number | null
}

export type KnowledgeImageManifest = Record<string, KnowledgeImageEntry>

export function knowledgeImagesDir(): string {
  return resolve(process.cwd(), 'public', 'knowledge-images')
}

export function knowledgeManifestPath(): string {
  return join(knowledgeImagesDir(), 'manifest.json')
}

let manifestCache: { mtimeMs: number; data: KnowledgeImageManifest } | null = null

export function loadImageManifest(): KnowledgeImageManifest {
  try {
    const p = knowledgeManifestPath()
    if (!existsSync(p)) return {}
    const mtimeMs = statSync(p).mtimeMs
    if (manifestCache && manifestCache.mtimeMs === mtimeMs) return manifestCache.data
    const data = JSON.parse(readFileSync(p, 'utf-8')) as KnowledgeImageManifest
    manifestCache = { mtimeMs, data }
    return data
  } catch {
    return {}
  }
}

export function getImageEntry(id: string): KnowledgeImageEntry {
  return (
    loadImageManifest()[id] ?? {
      id,
      url: `/knowledge-images/${id}.png`,
    }
  )
}

/** 锚点 ID → Markdown 图片语法 */
export function anchorToMarkdown(id: string): string {
  const entry = getImageEntry(id)
  const rawAlt = entry.caption || entry.description || '知识库插图'
  const alt = rawAlt.replace(/[[\]!]/g, ' ').trim().slice(0, 60) || '知识库插图'
  return `![${alt}](${entry.url})`
}

/** 无状态回填：将文本中的完整锚点替换为 Markdown 图片 */
export function backfillAnchors(text: string): string {
  if (!text || !text.includes(ANCHOR_OPEN)) return text
  return text.replace(anchorRe(), (_m, id: string) => anchorToMarkdown(id.trim()))
}

// ---------------------------------------------------------------------------
// 流式回填（跨 delta 的锚点会被缓冲到完整为止）
// ---------------------------------------------------------------------------

export class AnchorStreamBackfiller {
  private buffer = ''

  get hasPending(): boolean {
    return this.buffer.length > 0
  }

  push(chunk: string): string {
    if (!chunk) return ''
    this.buffer += chunk
    let safeEnd = this.buffer.length
    const lastOpen = this.buffer.lastIndexOf(ANCHOR_OPEN)
    if (lastOpen !== -1 && this.buffer.indexOf(ANCHOR_CLOSE, lastOpen) === -1) {
      // 尾部可能存在未完成的锚点：暂缓输出（限制长度，防止被 ⟦ 普通字符卡死）
      if (this.buffer.length - lastOpen <= 120) safeEnd = lastOpen
    }
    const emit = this.buffer.slice(0, safeEnd)
    this.buffer = this.buffer.slice(safeEnd)
    return backfillAnchors(emit)
  }

  /** 文本段结束时调用：剩余内容里的完整锚点尽力回填，碎片剔除 */
  flush(): string {
    const rest = this.buffer
    this.buffer = ''
    return backfillAnchors(stripIncompleteAnchorFragments(rest))
  }
}

/**
 * UIMessageChunk 流转换器：仅改写 text-delta 中的锚点。
 * handleChatStream(v6) 返回 ReadableStream<UIMessageChunk>，
 * text-delta 形状为 { type: 'text-delta', id: string, delta: string }。
 */
/** 只关心 text-* 三类字段，其余 chunk 原样透传 */
type AnchorRelevantChunk = { type?: string; id?: string; delta?: string; [key: string]: unknown }

export function createKnowledgeAnchorTransform<
  Chunk extends AnchorRelevantChunk = AnchorRelevantChunk,
>(): TransformStream<Chunk, Chunk> {
  const backfiller = new AnchorStreamBackfiller()
  return new TransformStream<Chunk, Chunk>({
    transform(chunk, controller) {
      if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
        const out = backfiller.push(chunk.delta)
        if (out) controller.enqueue({ ...chunk, delta: out })
        return
      }
      if (chunk.type === 'text-end') {
        const rest = backfiller.flush()
        if (rest) {
          controller.enqueue({ ...chunk, type: 'text-delta', id: chunk.id, delta: rest } as Chunk)
        }
        controller.enqueue(chunk)
        return
      }
      controller.enqueue(chunk)
    },
  })
}

/** 历史消息回填：把 UI 消息 text part 中的锚点替换为 Markdown 图片 */
export function backfillUIMessageText<T extends object>(messages: T[]): T[] {
  return messages.map(message => {
    const parts = (message as { parts?: unknown[] }).parts
    if (!Array.isArray(parts)) return message
    return {
      ...message,
      parts: parts.map(part => {
        const p = part as { type?: string; text?: string }
        if (p?.type === 'text' && typeof p.text === 'string' && p.text.includes(ANCHOR_OPEN)) {
          return { ...p, text: backfillAnchors(p.text) }
        }
        return part
      }),
    }
  })
}

// ---------------------------------------------------------------------------
// 图片语义检索（“直接要图”）
// ---------------------------------------------------------------------------

export interface KnowledgeImageHit {
  id: string
  imageUrl: string
  description: string
  sourceFile: string
  page: number | null
  score: number
}

export async function searchKnowledgeImages(options: {
  query: string
  topK?: number
  fileName?: string
  minScore?: number
}): Promise<KnowledgeImageHit[]> {
  const { query, topK = 5, fileName, minScore = 0 } = options
  const { embedding } = await embed({
    model: knowledgeEmbedder,
    value: query,
    providerOptions: EMBEDDING_PROVIDER_OPTIONS,
  })

  const vectorStore = getKnowledgeVectorStore()
  type VectorQueryFilter = NonNullable<Parameters<typeof vectorStore.query>[0]['filter']>
  const filter = {
    type: 'image-description',
    ...(fileName ? { fileName } : {}),
  } as unknown as VectorQueryFilter

  const results = await vectorStore.query({
    indexName: KNOWLEDGE_INDEX_NAME,
    queryVector: embedding,
    topK,
    filter,
    minScore,
  })

  return results
    .map(r => {
      const md = (r.metadata ?? {}) as Record<string, unknown>
      const rawText = String(md.text ?? '')
      const id = String(md.imageId ?? '') || extractImageIds(rawText)[0] || ''
      const description = stripAnchors(rawText) || String(md.description ?? '')
      return {
        id,
        imageUrl: String(md.imageUrl ?? (id ? getImageEntry(id).url : '')),
        description,
        sourceFile: String(md.fileName ?? md.sourceFile ?? ''),
        page: typeof md.page === 'number' ? md.page : null,
        score: r.score ?? 0,
      }
    })
    .filter(hit => !!hit.imageUrl)
}
