import 'dotenv/config'
import { resolve, join } from 'path'
import { readdirSync, unlinkSync, existsSync, statSync } from 'fs'
import { MDocument } from '@mastra/rag'
import { LibSQLVector } from '@mastra/libsql'
import { embedMany, generateText } from 'ai'
import { ModelRouterEmbeddingModel, ModelRouterLanguageModel } from '@mastra/core/llm'
import {
  parseDirectory,
  getSupportedExtensions,
  saveImageToPublic,
  type ExtractedImage,
} from '../src/lib/document-parser'

const INDEX_NAME = 'machine_tool_knowledge'
const EMBEDDING_DIMENSIONS = 2048

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

const embedder = new ModelRouterEmbeddingModel({
  id: 'zhipuai/embedding-3',
  url: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY!,
})

const visionModel = new ModelRouterLanguageModel({
  id: 'zhipuai/glm-4.5v',
  url: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY!,
})

const vectorStore = new LibSQLVector({
  id: 'mastra-vector',
  url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

async function describeImage(
  image: ExtractedImage,
  index: number
): Promise<{ description: string; imageUrl: string } | null> {
  try {
    const safeName = `${image.sourceFile.replace(/\.[^.]+$/, '')}_p${image.pageNumber}_${index}`
    const imageUrl = saveImageToPublic(image.dataUrl, safeName)
    console.log(`     已保存图片: ${imageUrl}`)

    const dataUrlSize = Math.round(image.dataUrl.length * 0.75 / 1024)
    console.log(`     图片大小: ~${dataUrlSize}KB，调用视觉模型…`)

    const result = await generateText({
      model: visionModel as any,
      maxOutputTokens: 1000,
      abortSignal: AbortSignal.timeout(60000),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: image.dataUrl },
            {
              type: 'text',
              text: '请用中文简要描述这张图片的内容，重点说明其中的技术信息（文字、数据、图表）。不超过300字。',
            },
          ],
        },
      ],
    })

    return { description: result.text, imageUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`     图片识别失败: ${msg}`)
    return null
  }
}

async function main() {
  const kbDir = resolve(process.cwd(), 'knowledge-base')
  const imagesDir = resolve(process.cwd(), 'public', 'knowledge-images')

  console.log(`\n🧹 清理旧数据…`)
  clearDirectory(imagesDir)
  console.log(`   已清理图片目录: ${imagesDir}`)

  console.log(`\n📁 知识库目录: ${kbDir}`)
  console.log(`📋 支持的格式: ${getSupportedExtensions().join(', ')}\n`)

  console.log('1️⃣  解析文档…')
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

  console.log('\n2️⃣  识别图片内容…')
  const imageDescriptions: { text: string; imageUrl: string; sourceFile: string }[] = []
  const imagePathMap: Map<string, string> = new Map()

  if (totalImages > 0) {
    let imgIdx = 0
    for (const doc of documents) {
      if (!doc.images || doc.images.length === 0) continue
      for (let i = 0; i < doc.images.length; i++) {
        imgIdx++
        const img = doc.images[i]

        if (!img.dataUrl) {
          const placeholderUrl = `/knowledge-images/placeholder_${imgIdx}.txt`
          imagePathMap.set(img.name, placeholderUrl)
          imagePathMap.set(`images/${img.name}`, placeholderUrl)
          console.log(`   跳过 ${imgIdx}/${totalImages}: ${img.sourceFile} (无 data URL, 原始路径: ${img.name})`)
          continue
        }

        console.log(`   识别 ${imgIdx}/${totalImages}: ${img.sourceFile} p${img.pageNumber}…`)
        const result = await describeImage(img, i)
        if (result) {
          imageDescriptions.push({
            text: result.description,
            imageUrl: result.imageUrl,
            sourceFile: img.sourceFile,
          })
          const origName = img.name || `${img.sourceFile.replace(/\.[^.]+$/, '')}_img${i + 1}`
          imagePathMap.set(origName, result.imageUrl)
          imagePathMap.set(`images/${origName}`, result.imageUrl)
          console.log(`   → 已保存: ${result.imageUrl} (${result.description.length} 字符)`)
        }
      }
    }
  } else {
    console.log('   无图片需要识别')
  }

  for (const doc of documents) {
    let modified = false
    for (const [origName, url] of imagePathMap) {
      if (doc.text.includes(origName)) {
        doc.text = doc.text.split(origName).join(url)
        modified = true
      }
    }
    if (modified) {
      console.log(`   替换图片路径: ${doc.metadata.fileName}`)
    }
  }

  console.log('\n3️⃣  分块（文本 + 图片描述）…')
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

  for (const desc of imageDescriptions) {
    const md = MDocument.fromText(desc.text, {
      source: desc.sourceFile,
      fileName: desc.sourceFile,
      extension: '.image',
      imageUrl: desc.imageUrl,
      type: 'image-description',
    })
    const chunks = await md.chunk({
      strategy: 'recursive',
      maxSize: 512,
      overlap: 50,
    })
    for (const chunk of chunks) {
      allChunks.push({
        text: chunk.text,
        metadata: {
          source: desc.sourceFile,
          fileName: desc.sourceFile,
          extension: '.image',
          imageUrl: desc.imageUrl,
          type: 'image-description',
          ...chunk.metadata,
        },
      })
    }
    console.log(`   ${desc.sourceFile} 图片描述 → ${chunks.length} 块`)
  }

  console.log(`   共 ${allChunks.length} 个文本块\n`)

  console.log('4️⃣  向量化…')
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

  console.log('\n5️⃣  写入向量库…')
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
    metadata: allChunks.map(c => ({
      ...c.metadata,
      text: c.text,
    })),
  })

  console.log(`\n✅ 知识库构建完成！`)
  console.log(`   索引名: ${INDEX_NAME}`)
  console.log(`   向量数: ${allEmbeddings.length}`)
  console.log(`   维度: ${EMBEDDING_DIMENSIONS}`)
  console.log(`   来源文件: ${documents.length}`)
  console.log(`   图片描述: ${imageDescriptions.length}`)
  if (imageDescriptions.length > 0) {
    console.log(`   图片路径: /knowledge-images/`)
  }
  console.log('')
}

main().catch(err => {
  console.error('\n❌ 构建失败:', err)
  process.exit(1)
})
