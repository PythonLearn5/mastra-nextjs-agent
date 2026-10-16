import 'dotenv/config'
import { resolve, join } from 'path'
import { readdirSync, unlinkSync, existsSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { MDocument } from '@mastra/rag'
import { embedMany } from 'ai'
import {
  parseDirectory,
  getSupportedExtensions,
  saveImageToPublic,
  sanitizeImageBase,
  imageAnchor,
  type ExtractedImage,
} from '../src/lib/document-parser'
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDER_OPTIONS,
  KNOWLEDGE_INDEX_NAME,
  extractImageIds,
  getKnowledgeVectorStore,
  knowledgeEmbedder,
  knowledgeImagesDir,
  stripAnchors,
  stripIncompleteAnchorFragments,
  type KnowledgeImageEntry,
  type KnowledgeImageManifest,
} from '../src/lib/knowledge-store'

const vectorStore = getKnowledgeVectorStore()

function clearDirectory(dirPath: string) {
  if (!existsSync(dirPath)) return
  for (const entry of readdirSync(dirPath)) {
    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)
    if (stat.isFile()) {
      unlinkSync(fullPath)
    }
  }
}

async function describeImage(image: ExtractedImage): Promise<string | null> {
  try {
    const dataUrlSize = Math.round((image.dataUrl.length * 0.75) / 1024)
    console.log(`     图片大小: ~${dataUrlSize}KB，调用视觉模型…`)
    // 直连 DashScope OpenAI 兼容接口（qwen3.8-flash 支持图片输入）
    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: 'qwen3.8-flash',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: image.dataUrl } },
              {
                type: 'text',
                text: '请用中文简要描述这张图片的内容，重点说明其中的技术信息（文字、数据、图表）。不超过300字。',
              },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[]
    }
    const msg = data.choices?.[0]?.message
    const text = (msg?.content?.trim() || msg?.reasoning_content?.trim() || '')
    return text || null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`     图片识别失败: ${msg}`)
    return null
  }
}

async function main() {
  //const kbDir = resolve(process.cwd(), 'knowledge-base')
  const kbDir = resolve(process.cwd(), 'knowledge-base-test')
  const imagesDir = knowledgeImagesDir()

  console.log(`\n🧹 清理旧数据…`)
  clearDirectory(imagesDir)
  console.log(`   已清理图片目录: ${imagesDir}`)

  console.log(`\n📁 知识库目录: ${kbDir}`)
  console.log(`📋 支持的格式: ${getSupportedExtensions().join(', ')}\n`)

  console.log('1️⃣  解析文档（文本已内联图片锚点 ⟦img:ID⟧）…')
  const documents = await parseDirectory(kbDir)
  if (documents.length === 0) {
    console.error('❌ 未找到任何可解析的文档。请将 PDF/Word/TXT 等文件放入 knowledge-base/ 目录。')
    process.exit(1)
  }

  let totalImages = 0
  for (const doc of documents) {
    const imgCount = doc.images?.length ?? 0
    totalImages += imgCount
    console.log(
      `   • ${doc.metadata.fileName} (${doc.metadata.extension}) — ${doc.text.length} 字符${imgCount > 0 ? `, ${imgCount} 张图片` : ''}`
    )
  }
  console.log(`   共 ${documents.length} 个文件, ${totalImages} 张图片`)

  console.log('\n2️⃣  保存图片 + 识别图片内容…')
  const manifest: KnowledgeImageManifest = {}
  const imageChunks: { displayText: string; embedText: string; metadata: Record<string, unknown> }[] = []

  if (totalImages > 0) {
    let imgIdx = 0
    for (const doc of documents) {
      for (const img of doc.images ?? []) {
        imgIdx++
        const pageLabel = img.page ? `p${img.page}` : 'p?'
        if (!img.dataUrl) {
          console.log(`   跳过 ${imgIdx}/${totalImages}: ${img.sourceFile} ${pageLabel}（无 data URL）`)
          continue
        }
        console.log(`   处理 ${imgIdx}/${totalImages}: ${img.sourceFile} ${pageLabel}（id=${img.id}）…`)

        // 先落盘：即使视觉描述失败，锚点也能回填成真实图片
        const imageUrl = saveImageToPublic(img.dataUrl, img.id)
        const description = (await describeImage(img)) ?? ''
        const entry: KnowledgeImageEntry = {
          id: img.id,
          url: imageUrl,
          description: description || undefined,
          caption: img.caption,
          sourceFile: img.sourceFile,
          page: img.page,
        }
        manifest[img.id] = entry

        const captionPart = img.caption ? `${img.caption}。` : ''
        if (description || img.caption) {
          imageChunks.push({
            displayText: `${imageAnchor(img.id)} ${captionPart}${description}`,
            embedText: `${captionPart}${description || '文档插图'}`,
            metadata: {
              source: img.sourceFile,
              fileName: img.sourceFile,
              extension: '.image',
              type: 'image-description',
              imageId: img.id,
              imageUrl,
              page: img.page,
              caption: img.caption ?? null,
              imageIds: [img.id],
            },
          })
        }
        console.log(`   → 已保存: ${imageUrl}（描述 ${description.length} 字符${img.caption ? '，有图注' : ''}）`)
        console.log(`   → 图片描述: ${description}`)
      }
    }
  } else {
    console.log('   无图片需要识别')
  }

  if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true })
  writeFileSync(join(imagesDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`   已写入图片清单: ${join(imagesDir, 'manifest.json')}（${Object.keys(manifest).length} 条）`)

  console.log('\n3️⃣  分块（文本块保留锚点，嵌入文本剥离锚点）…')
  const allChunks: { displayText: string; embedText: string; metadata: Record<string, unknown>; id: string }[] = []

  for (const doc of documents) {
    const md = MDocument.fromText(doc.text, doc.metadata)
    const chunks = await md.chunk({
      strategy: 'recursive',
      maxSize: 512,
      overlap: 50,
    })
    const idBase = sanitizeImageBase(doc.metadata.fileName)
    chunks.forEach((chunk, i) => {
      const displayText = stripIncompleteAnchorFragments(chunk.text)
      const embedText = stripAnchors(displayText)
      if (!embedText) return
      allChunks.push({
        displayText,
        embedText,
        id: `${idBase}::t${i}`,
        metadata: {
          ...doc.metadata,
          ...chunk.metadata,
          imageIds: extractImageIds(displayText),
        },
      })
    })
    console.log(`   ${doc.metadata.fileName} → ${chunks.length} 块`)
  }

  for (const imgChunk of imageChunks) {
    allChunks.push({
      displayText: imgChunk.displayText,
      embedText: imgChunk.embedText,
      id: `img::${String(imgChunk.metadata.imageId)}`,
      metadata: imgChunk.metadata,
    })
  }

  console.log(`   共 ${allChunks.length} 个文本块（含 ${imageChunks.length} 个图片描述块）\n`)

  console.log('4️⃣  向量化…')
  const batchSize = 50
  const allEmbeddings: number[][] = []
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize)
    const { embeddings } = await embedMany({
      model: knowledgeEmbedder,
      values: batch.map(c => c.embedText),
      providerOptions: EMBEDDING_PROVIDER_OPTIONS,
    })
    allEmbeddings.push(...embeddings)
    console.log(`   已处理 ${Math.min(i + batchSize, allChunks.length)}/${allChunks.length} 块`)
  }

  console.log('\n5️⃣  写入向量库…')
  try {
    await vectorStore.deleteIndex({ indexName: KNOWLEDGE_INDEX_NAME })
    console.log(`   已清除旧索引: ${KNOWLEDGE_INDEX_NAME}`)
  } catch {
    // 索引不存在，忽略
  }

  await vectorStore.createIndex({
    indexName: KNOWLEDGE_INDEX_NAME,
    dimension: EMBEDDING_DIMENSIONS,
  })

  await vectorStore.upsert({
    indexName: KNOWLEDGE_INDEX_NAME,
    ids: allChunks.map(c => c.id),
    vectors: allEmbeddings,
    metadata: allChunks.map(c => ({
      ...c.metadata,
      text: c.displayText,
    })),
  })

  console.log(`\n✅ 知识库构建完成！`)
  console.log(`   索引名: ${KNOWLEDGE_INDEX_NAME}`)
  console.log(`   向量数: ${allEmbeddings.length}`)
  console.log(`   维度: ${EMBEDDING_DIMENSIONS}`)
  console.log(`   来源文件: ${documents.length}`)
  console.log(`   图片: ${Object.keys(manifest).length} 张（其中 ${imageChunks.length} 张有可检索描述）`)
  console.log('')
}

main().catch(err => {
  console.error('\n❌ 构建失败:', err)
  process.exit(1)
})
