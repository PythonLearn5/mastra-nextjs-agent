import 'dotenv/config'
import { resolve } from 'path'
import { MDocument } from '@mastra/rag'
import { LibSQLVector } from '@mastra/libsql'
import { embedMany } from 'ai'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'
import { parseDirectory, getSupportedExtensions } from '../src/lib/document-parser'

const INDEX_NAME = 'machine_tool_knowledge'

const EMBEDDING_DIMENSIONS = 2048

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
  const kbDir = resolve(process.cwd(), 'knowledge-base')
  console.log(`\n📁 知识库目录: ${kbDir}`)
  console.log(`📋 支持的格式: ${getSupportedExtensions().join(', ')}\n`)

  console.log('1️⃣  解析文档…')
  const documents = await parseDirectory(kbDir)
  if (documents.length === 0) {
    console.error('❌ 未找到任何可解析的文档。请将 PDF/Word/TXT 等文件放入 knowledge-base/ 目录。')
    process.exit(1)
  }
  console.log(`   解析到 ${documents.length} 个文件`)
  for (const doc of documents) {
    console.log(`   • ${doc.metadata.fileName} (${doc.metadata.extension}) — ${doc.text.length} 字符`)
  }

  console.log('\n2️⃣  分块…')
  const allChunks: { text: string; metadata: Record<string, unknown> }[] = []
  for (const doc of documents) {
    const md = MDocument.fromText(doc.text, doc.metadata)
    const chunks = await md.chunk({
      strategy: 'recursive',
      maxSize: 512,
      overlap: 50,
    })
    for (const chunk of chunks) {
      allChunks.push({
        text: chunk.text,
        metadata: {
          ...doc.metadata,
          ...chunk.metadata,
        },
      })
    }
    console.log(`   ${doc.metadata.fileName} → ${chunks.length} 块`)
  }
  console.log(`   共 ${allChunks.length} 个文本块\n`)

  console.log('3️⃣  向量化…')
  const batchSize = 50
  const allEmbeddings: number[][] = []
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize)
    const { embeddings } = await embedMany({
      model: embedder,
      values: batch.map(c => c.text),
    })
    allEmbeddings.push(...embeddings)
    console.log(`   已处理 ${Math.min(i + batchSize, allChunks.length)}/${allChunks.length} 块`)
  }

  console.log('\n4️⃣  写入向量库…')
  try {
    await vectorStore.deleteIndex({ indexName: INDEX_NAME })
    console.log(`   已清除旧索引: ${INDEX_NAME}`)
  } catch {
    // 索引不存在，忽略
  }

  await vectorStore.createIndex({
    indexName: INDEX_NAME,
    dimension: EMBEDDING_DIMENSIONS,
  })

  await vectorStore.upsert({
    indexName: INDEX_NAME,
    vectors: allEmbeddings,
    metadata: allChunks.map(c => c.metadata),
  })

  console.log(`\n✅ 知识库构建完成！`)
  console.log(`   索引名: ${INDEX_NAME}`)
  console.log(`   向量数: ${allEmbeddings.length}`)
  console.log(`   维度: ${EMBEDDING_DIMENSIONS}`)
  console.log(`   来源文件: ${documents.length}\n`)
}

main().catch(err => {
  console.error('\n❌ 构建失败:', err)
  process.exit(1)
})
