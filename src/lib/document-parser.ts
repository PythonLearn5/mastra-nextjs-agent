import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname, basename, resolve } from 'path'
import { ANCHOR_CLOSE, ANCHOR_PREFIX } from './knowledge-store'

export interface ExtractedImage {
  /**
   * 图片锚点 ID（同时作为落盘文件名主干）。
   * 文本中会以 ⟦img:ID⟧ 的形式保留图片位置，构建/回填全靠它对齐。
   */
  id: string
  dataUrl: string
  name: string
  width: number
  height: number
  sourceFile: string
  /** 真实页码（1 起始）；解析不到为 null（如 mammoth 回退路径） */
  page: number | null
  /** 图注（MinerU caption 或 Markdown alt） */
  caption?: string
}

export interface ParsedDocument {
  text: string
  metadata: {
    source: string
    fileName: string
    extension: string
    [key: string]: unknown
  }
  images?: ExtractedImage[]
}

type ParserFn = (filePath: string) => Promise<{ text: string; images?: ExtractedImage[] }>

const parsers: Record<string, ParserFn> = {}

export function registerParser(extension: string, fn: ParserFn) {
  const ext = extension.toLowerCase().startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`
  parsers[ext] = fn
}

/** 文件名 → 安全的图片 ID 主干（保留 CJK，去掉路径/空白/锚点冲突字符） */
export function sanitizeImageBase(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"'<>|\s⟦⟧\[\]()!]+/g, '_')
    .slice(0, 80)
}

/** 生成锚点标记文本 ⟦img:ID⟧ */
export function imageAnchor(id: string): string {
  return `${ANCHOR_PREFIX}${id}${ANCHOR_CLOSE}`
}

function anchorOf(id: string): string {
  return imageAnchor(id)
}

/**
 * 回退路径（MinerU / mammoth）拿到的都是未裁剪的原始嵌入图，
 * 这里至少做限尺寸 + 压缩，避免整张超大截图落盘并送视觉模型。
 */
async function normalizeDataUrl(
  dataUrl: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const { normalizeImageDataUrl } = await import('./docx-ooxml')
    const out = await normalizeImageDataUrl(dataUrl)
    if (!out) return null
    return { dataUrl: out.dataUrl, width: out.width, height: out.height }
  } catch {
    return null
  }
}

/** MinerU 结果统一处理：真实页码/图注 + 把 md 图片引用替换为文本锚点 */
async function attachMinerUImages(
  fileBase: string,
  result: { mdContent: string; images: { name: string; dataUrl: string; page: number | null; caption?: string }[] },
): Promise<{ text: string; images: ExtractedImage[] }> {
  const safe = sanitizeImageBase(fileBase)
  const images: ExtractedImage[] = []
  const stemToId = new Map<string, string>()

  for (const img of result.images) {
    const id = `${safe}_p${img.page ?? 0}_${images.length + 1}`
    const normalized = await normalizeDataUrl(img.dataUrl)
    images.push({
      id,
      dataUrl: normalized?.dataUrl ?? img.dataUrl,
      name: img.name,
      width: normalized?.width ?? 0,
      height: normalized?.height ?? 0,
      sourceFile: fileBase,
      page: img.page,
      caption: img.caption,
    })
    const stem = img.name.replace(/\.[^.]+$/, '')
    stemToId.set(stem, id)
    stemToId.set(img.name, id)
  }

  // md_content 中的图片引用 ![alt](images/xxx.png) → ⟦img:ID⟧（位置保留在原文）
  const text = result.mdContent.replace(
    /!\[([^\]]*)\]\((?:[^)\s]*?)([\w.-]+\.(?:png|jpe?g|gif|webp|bmp))[)]/gi,
    (m, alt: string, fileName: string) => {
      const id = stemToId.get(fileName) ?? stemToId.get(fileName.replace(/\.[^.]+$/, ''))
      if (!id) return m
      const hit = images.find(img => img.id === id)
      if (hit && !hit.caption && alt.trim()) hit.caption = alt.trim()
      return anchorOf(id)
    },
  )

  return { text, images }
}

async function parsePdf(filePath: string): Promise<{ text: string; images?: ExtractedImage[] }> {
  const fileBase = basename(filePath)
  const mineruUrl = process.env.MINERU_API_URL

  if (mineruUrl) {
    console.log(`  ${fileBase}: 使用 MinerU 解析…`)
    try {
      const { parseWithMinerU } = await import('./mineru-client')
      const result = await parseWithMinerU(filePath, { apiUrl: mineruUrl })
      const parsed = await attachMinerUImages(fileBase, result)
      console.log(`  ${fileBase}: MinerU 完成，${parsed.text.length} 字符，${parsed.images.length} 张图片（已锚点化）`)
      return parsed
    } catch (err) {
      console.warn(`  ${fileBase}: MinerU 失败（${err instanceof Error ? err.message : err}），回退到 pdf-parse…`)
    }
  }

  const { PDFParse } = await import('pdf-parse')
  const buffer = readFileSync(filePath)
  const pdf = new PDFParse({ data: new Uint8Array(buffer) })
  const textResult = await pdf.getText()

  const safe = sanitizeImageBase(fileBase)
  const images: ExtractedImage[] = []
  try {
    const imageResult = await pdf.getImage({ imageDataUrl: true, imageThreshold: 100 })
    for (const page of imageResult.pages) {
      for (const img of page.images) {
        if (img.dataUrl && img.width >= 100 && img.height >= 100) {
          images.push({
            id: `${safe}_p${page.pageNumber}_${images.length + 1}`,
            dataUrl: img.dataUrl,
            name: img.name || `image_p${page.pageNumber}`,
            width: img.width,
            height: img.height,
            sourceFile: fileBase,
            page: page.pageNumber,
          })
        }
      }
    }
    console.log(`  ${fileBase}: 提取到 ${images.length} 张嵌入图片`)
  } catch (err) {
    console.warn(`  ${fileBase}: 嵌入图片提取失败（${err instanceof Error ? err.message : err}），尝试整页截图…`)
    try {
      const screenshotResult = await pdf.getScreenshot({ imageDataUrl: true, desiredWidth: 1024 })
      for (const page of screenshotResult.pages) {
        if (page.dataUrl && page.width >= 100 && page.height >= 100) {
          images.push({
            id: `${safe}_p${page.pageNumber}_${images.length + 1}`,
            dataUrl: page.dataUrl,
            name: `screenshot_p${page.pageNumber}`,
            width: page.width,
            height: page.height,
            sourceFile: fileBase,
            page: page.pageNumber,
          })
        }
      }
      console.log(`  ${fileBase}: 截图 ${images.length} 页作为图片`)
    } catch (screenshotErr) {
      console.warn(`  ${fileBase}: 整页截图也失败（${screenshotErr instanceof Error ? screenshotErr.message : screenshotErr}），跳过图片`)
    }
  }

  await pdf.destroy()
  return { text: textResult.text, images }
}

async function parseWord(filePath: string): Promise<{ text: string; images?: ExtractedImage[] }> {
  const fileBase = basename(filePath)
  const ext = extname(filePath).toLowerCase()
  const mineruUrl = process.env.MINERU_API_URL
  const disableNative = process.env.DOCX_NATIVE_IMAGES === 'false'

  // 1) 原生 OOXML：正文 + 按 Word 实际显示区域（srcRect 裁剪）取图，离线、确定性、体积小
  if (ext === '.docx' && !disableNative) {
    try {
      const { parseDocxNative } = await import('./docx-ooxml')
      const parsed = await parseDocxNative(filePath)
      if (parsed.text.trim() || parsed.images.length > 0) {
        console.log(
          `  ${fileBase}: OOXML 原生解析完成，${parsed.text.length} 字符，${parsed.images.length} 张插图（已按 srcRect 裁剪/压缩）`
        )
        return parsed
      }
      console.warn(`  ${fileBase}: OOXML 原生解析无内容，回退…`)
    } catch (err) {
      console.warn(`  ${fileBase}: OOXML 原生解析失败（${err instanceof Error ? err.message : err}），回退到 MinerU…`)
    }
  }

  // 2) MinerU：版面/表格效果更好，但拿到的是未裁剪的原始嵌入图
  if (mineruUrl) {
    console.log(`  ${fileBase}: 使用 MinerU 解析…`)
    try {
      const { parseWithMinerU } = await import('./mineru-client')
      const result = await parseWithMinerU(filePath, { apiUrl: mineruUrl })
      const parsed = await attachMinerUImages(fileBase, result)
      console.log(`  ${fileBase}: MinerU 完成，${parsed.text.length} 字符，${parsed.images.length} 张图片（已锚点化）`)
      return parsed
    } catch (err) {
      console.warn(`  ${fileBase}: MinerU 失败（${err instanceof Error ? err.message : err}），回退到 mammoth…`)
    }
  }

  // 3) mammoth：本地兜底，同样只做压缩（无法感知 srcRect 裁剪）
  const mammoth = await import('mammoth')
  const buffer = readFileSync(filePath)

  const images: ExtractedImage[] = []
  const safe = sanitizeImageBase(fileBase)

  const htmlResult = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf = await image.read()
        const normalized = await normalizeDataUrl(`data:${image.contentType || 'image/png'};base64,${buf.toString('base64')}`)
        // 解码失败就不登记图片，也不留锚点，避免正文里出现悬空引用
        if (!normalized) return { src: '' }
        const id = `${safe}_img${images.length + 1}`
        images.push({
          id,
          dataUrl: normalized.dataUrl,
          name: id,
          width: normalized.width,
          height: normalized.height,
          sourceFile: fileBase,
          page: null,
        })
        // src 里直接放锚点标记，HTML 转文本时保留位置（不再丢图）
        return { src: anchorOf(id) }
      }),
    }
  )

  const text = htmlResult.value
    // <img src="⟦img:ID⟧"> → 保留锚点本身；其他 img 丢弃
    .replace(/<img[^>]*\bsrc="([^"]*)"[^>]*>/gi, (_m, src: string) =>
      src.startsWith(ANCHOR_PREFIX) ? src : ' ',
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  console.log(`  ${fileBase}: 提取到 ${images.length} 张嵌入图片（Word 无页码，page=null）`)

  return { text, images }
}

async function parseText(filePath: string): Promise<{ text: string; images?: undefined }> {
  return { text: readFileSync(filePath, 'utf-8') }
}

async function parseExcel(filePath: string): Promise<{ text: string; images?: undefined }> {
  const XLSX = await import('xlsx')
  const readFile = XLSX.default?.readFile ?? XLSX.readFile
  const workbook = readFile(filePath)
  const sheetToJson = XLSX.default?.utils?.sheet_to_json ?? XLSX.utils?.sheet_to_json
  const lines: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = sheetToJson<Record<string, unknown>>(sheet, { defval: '' })
    lines.push(`=== 工作表: ${sheetName} ===`)
    if (rows.length > 0) {
      const headers = Object.keys(rows[0])
      lines.push(headers.join('\t'))
      for (const row of rows) {
        lines.push(headers.map(h => String(row[h] ?? '')).join('\t'))
      }
    }
    lines.push('')
  }

  return { text: lines.join('\n') }
}

registerParser('.pdf', parsePdf)
registerParser('.docx', parseWord)
registerParser('.doc', parseWord)
registerParser('.xlsx', parseExcel)
registerParser('.xls', parseExcel)
registerParser('.txt', parseText)
registerParser('.md', parseText)
registerParser('.markdown', parseText)
registerParser('.json', parseText)
registerParser('.csv', parseText)
registerParser('.html', parseText)
registerParser('.htm', parseText)
registerParser('.xml', parseText)
registerParser('.yaml', parseText)
registerParser('.yml', parseText)
registerParser('.log', parseText)

export async function parseFile(filePath: string): Promise<ParsedDocument> {
  const ext = extname(filePath).toLowerCase()
  const fileName = basename(filePath)
  const parser = parsers[ext]

  if (!parser) {
    throw new Error(
      `不支持的文件格式: ${ext}（文件: ${fileName}）。可通过 registerParser('${ext}', fn) 扩展。`
    )
  }

  const result = await parser(filePath)
  return {
    text: result.text,
    images: result.images,
    metadata: {
      source: filePath,
      fileName,
      extension: ext,
    },
  }
}

export async function parseDirectory(dirPath: string): Promise<ParsedDocument[]> {
  if (!existsSync(dirPath)) {
    throw new Error(`目录不存在: ${dirPath}`)
  }

  const results: ParsedDocument[] = []
  const entries = readdirSync(dirPath)

  for (const entry of entries) {
    if (entry.startsWith('~$') || entry.startsWith('~') || entry.startsWith('.')) {
      continue
    }

    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      const subResults = await parseDirectory(fullPath)
      results.push(...subResults)
      continue
    }

    const ext = extname(entry).toLowerCase()
    if (!parsers[ext]) continue

    try {
      const doc = await parseFile(fullPath)
      results.push(doc)
    } catch (err) {
      console.error(`解析失败: ${entry}`, err)
    }
  }

  return results
}

export function getSupportedExtensions(): string[] {
  return Object.keys(parsers)
}

/** 落盘图片，返回可访问 URL；文件名即锚点 ID */
export function saveImageToPublic(
  dataUrl: string,
  imageId: string,
  publicDir = resolve(process.cwd(), 'public', 'knowledge-images')
): string {
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true })
  }

  const base64Data = dataUrl.split(',')[1]
  const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0]
  const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : '.png'
  const filePath = join(publicDir, imageId + ext)
  writeFileSync(filePath, Buffer.from(base64Data, 'base64'))

  return `/knowledge-images/${imageId + ext}`
}
