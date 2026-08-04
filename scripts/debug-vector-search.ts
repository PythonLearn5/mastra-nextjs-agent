import 'dotenv/config'
import { resolve } from 'path'
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

async function main() {
  const query = process.argv[2] || '机床主轴'
  const topK = Number(process.argv[3] || 5)

  console.log(`\n🔍 查询: "${query}"`)
  console.log(`   Top-K: ${topK}\n`)

  console.log('1️⃣  生成查询向量…')
  const { embedding } = await embed({
    model: embedder,
    value: query,
  })
  console.log(`   向量维度: ${embedding.length}\n`)

  console.log('2️⃣  检索向量库…')
  const results = await vectorStore.query({
    indexName: INDEX_NAME,
    queryVector: embedding,
    topK,
  })

  console.log(`   返回 ${results.length} 条结果\n`)

  if (results.length === 0) {
    console.log('❌ 未检索到任何结果！检查：')
    console.log('   - 知识库是否已构建（npm run build-kb）')
    console.log('   - 索引名是否匹配（machine_tool_knowledge）')
    console.log('   - 向量维度是否一致（2048）')
    process.exit(0)
  }

  console.log('3️⃣  检索结果:\n')
  console.log('='.repeat(80))

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const metadata = r.metadata ?? {}
    const text = String(metadata.text ?? metadata.chunk_text ?? '')
    const score = r.score ?? 'N/A'

    console.log(`\n📄 结果 ${i + 1} (score: ${score})`)
    console.log(`   来源: ${metadata.fileName ?? metadata.source ?? '未知'}`)
    console.log(`   类型: ${metadata.type ?? 'text'}`)
    if (metadata.imageUrl) {
      console.log(`   图片: ${metadata.imageUrl}`)
    }
    console.log(`   文本长度: ${text.length} 字符`)
    console.log(`   文本内容:`)
    console.log(`   ${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`)
    console.log(`   全部 metadata:`, JSON.stringify(metadata, null, 2).slice(0, 500))
    console.log('-'.repeat(80))
  }

  console.log(`\n✅ 检索完成，共 ${results.length} 条结果\n`)

  console.log('\n📋 索引概览:')
  try {
    const info = await vectorStore.describeIndex({ indexName: INDEX_NAME })
    console.log(`   索引名: ${INDEX_NAME}`)
    console.log(`   维度: ${(info as any).dimension ?? (info as any).dims ?? 'N/A'}`)
    console.log(`   向量数: ${(info as any).count ?? (info as any).vectorCount ?? 'N/A'}`)
    console.log(`   原始信息:`, JSON.stringify(info, null, 2))
  } catch (err) {
    console.log(`   describeIndex 不可用: ${err instanceof Error ? err.message : err}`)
  }
}

main().catch(err => {
  console.error('\n❌ 失败:', err)
  process.exit(1)
})
