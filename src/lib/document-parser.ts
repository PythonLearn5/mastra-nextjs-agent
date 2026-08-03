import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, extname, basename } from 'path'

export interface ParsedDocument {
  text: string
  metadata: {
    source: string
    fileName: string
    extension: string
    [key: string]: unknown
  }
}

type ParserFn = (filePath: string) => Promise<string>

const parsers: Record<string, ParserFn> = {}

export function registerParser(extension: string, fn: ParserFn) {
  const ext = extension.toLowerCase().startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`
  parsers[ext] = fn
}

async function parsePdf(filePath: string): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const buffer = readFileSync(filePath)
  const pdf = new PDFParse({ data: new Uint8Array(buffer) })
  const result = await pdf.getText()
  await pdf.destroy()
  return result.text
}

async function parseWord(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

async function parseText(filePath: string): Promise<string> {
  return readFileSync(filePath, 'utf-8')
}

registerParser('.pdf', parsePdf)
registerParser('.docx', parseWord)
registerParser('.doc', parseWord)
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

  const text = await parser(filePath)
  return {
    text,
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
