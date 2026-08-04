import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname, basename, resolve } from 'path'

export interface ExtractedImage {
  dataUrl: string
  name: string
  width: number
  height: number
  sourceFile: string
  pageNumber: number
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

async function parsePdf(filePath: string): Promise<{ text: string; images?: ExtractedImage[] }> {
  const fileBase = basename(filePath)
  const mineruUrl = process.env.MINERU_API_URL

  if (mineruUrl) {
    console.log(`  ${fileBase}: 使用 MinerU 解析…`)
    try {
      const { parseWithMinerU } = await import('./mineru-client')
      const result = await parseWithMinerU(filePath, { apiUrl: mineruUrl })
      const images: ExtractedImage[] = result.images.map((img, i) => ({
        dataUrl: img.dataUrl,
        name: img.name,
        width: 0,
        height: 0,
        sourceFile: fileBase,
        pageNumber: i + 1,
      }))
      console.log(`  ${fileBase}: MinerU 完成，${result.mdContent.length} 字符，${images.length} 张图片`)
      return { text: result.mdContent, images }
    } catch (err) {
      console.warn(`  ${fileBase}: MinerU 失败（${err instanceof Error ? err.message : err}），回退到 pdf-parse…`)
    }
  }

  const { PDFParse } = await import('pdf-parse')
  const buffer = readFileSync(filePath)
  const pdf = new PDFParse({ data: new Uint8Array(buffer) })
  const textResult = await pdf.getText()

  const images: ExtractedImage[] = []
  try {
    const imageResult = await pdf.getImage({ imageDataUrl: true, imageThreshold: 100 })
    for (const page of imageResult.pages) {
      for (const img of page.images) {
        if (img.dataUrl && img.width >= 100 && img.height >= 100) {
          images.push({
            dataUrl: img.dataUrl,
            name: img.name || `image_p${page.pageNumber}`,
            width: img.width,
            height: img.height,
            sourceFile: fileBase,
            pageNumber: page.pageNumber,
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
            dataUrl: page.dataUrl,
            name: `screenshot_p${page.pageNumber}`,
            width: page.width,
            height: page.height,
            sourceFile: fileBase,
            pageNumber: page.pageNumber,
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
  const mineruUrl = process.env.MINERU_API_URL

  if (mineruUrl) {
    console.log(`  ${fileBase}: 使用 MinerU 解析…`)
    try {
      const { parseWithMinerU } = await import('./mineru-client')
      const result = await parseWithMinerU(filePath, { apiUrl: mineruUrl })
      const images: ExtractedImage[] = result.images.map((img, i) => ({
        dataUrl: img.dataUrl,
        name: img.name,
        width: 0,
        height: 0,
        sourceFile: fileBase,
        pageNumber: i + 1,
      }))
      console.log(`  ${fileBase}: MinerU 完成，${result.mdContent.length} 字符，${images.length} 张图片`)
      return { text: result.mdContent, images }
    } catch (err) {
      console.warn(`  ${fileBase}: MinerU 失败（${err instanceof Error ? err.message : err}），回退到 mammoth…`)
    }
  }

  const mammoth = await import('mammoth')
  const buffer = readFileSync(filePath)

  const images: ExtractedImage[] = []
  let imgIdx = 0

  const htmlResult = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf = await image.read()
        const base64 = buf.toString('base64')
        const ext = image.contentType === 'image/jpeg' ? 'jpg' : 'png'
        const dataUrl = `data:image/${ext};base64,${base64}`
        imgIdx++
        const imgName = `${fileBase.replace(/\.[^.]+$/, '')}_img${imgIdx}`
        images.push({
          dataUrl,
          name: imgName,
          width: 0,
          height: 0,
          sourceFile: fileBase,
          pageNumber: imgIdx,
        })
        return { src: dataUrl }
      }),
    }
  )

  const text = htmlResult.value
    .replace(/<img[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  console.log(`  ${fileBase}: 提取到 ${images.length} 张嵌入图片`)

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

export function saveImageToPublic(
  dataUrl: string,
  fileName: string,
  publicDir = resolve(process.cwd(), 'public', 'knowledge-images')
): string {
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true })
  }

  const base64Data = dataUrl.split(',')[1]
  const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0]
  const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : '.png'
  const filePath = join(publicDir, fileName + ext)
  writeFileSync(filePath, Buffer.from(base64Data, 'base64'))

  return `/knowledge-images/${fileName + ext}`
}
