import { NextResponse } from 'next/server'
import { LibSQLVector } from '@mastra/libsql'
import { embed } from 'ai'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'

const INDEX_NAME = 'machine_tool_knowledge'

const embedder = new ModelRouterEmbeddingModel({
  id: 'zhipuai/embedding-3',
  url: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY!,
})

const vectorStore = new LibSQLVector({
  id: 'mastra-vector',
  url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q') || '机床主轴'
    const topK = Number(searchParams.get('topK') || 5)

    const { embedding } = await embed({
      model: embedder,
      value: query,
    })

    const results = await vectorStore.query({
      indexName: INDEX_NAME,
      queryVector: embedding,
      topK,
    })

    let indexInfo: Record<string, unknown> = {}
    try {
      const info = await vectorStore.describeIndex({ indexName: INDEX_NAME })
      indexInfo = info as unknown as Record<string, unknown>
    } catch {
      indexInfo = { error: 'describeIndex 不可用' }
    }

    return NextResponse.json({
      query,
      embeddingDimensions: embedding.length,
      index: INDEX_NAME,
      indexInfo,
      resultCount: results.length,
      results: results.map((r, i) => ({
        rank: i + 1,
        score: r.score ?? null,
        text: String(r.metadata?.text ?? r.metadata?.chunk_text ?? '').slice(0, 300),
        textLength: String(r.metadata?.text ?? r.metadata?.chunk_text ?? '').length,
        hasText: !!r.metadata?.text || !!r.metadata?.chunk_text,
        metadata: r.metadata,
      })),
    })
  } catch (err) {
    console.error('[GET /api/debug/vector] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
