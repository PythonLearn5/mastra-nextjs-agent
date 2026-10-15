import { readFileSync } from 'fs'
import { basename } from 'path'

export interface MinerUImage {
  /** MinerU 返回的图片文件名（如 images/xxx.jpg 的 xxx.jpg） */
  name: string
  dataUrl: string
  /** content_list 中解析到的真实页码（1 起始），解析不到时为 null */
  page: number | null
  /** 图片 caption/图注，解析不到时为 undefined */
  caption?: string
}

export interface MinerUParseResult {
  mdContent: string
  images: MinerUImage[]
}

const DEFAULT_TIMEOUT = 300000

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) {
    const parts = value
      .map(v => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object') {
          const t = (v as Record<string, unknown>).text
          return typeof t === 'string' ? t : ''
        }
        return ''
      })
      .filter(Boolean)
    if (parts.length > 0) return parts.join(' ').trim() || undefined
  }
  if (value && typeof value === 'object') {
    const t = (value as Record<string, unknown>).text
    if (typeof t === 'string') return t.trim() || undefined
  }
  return undefined
}

/** 解析 MinerU content_list（可能是 JSON 字符串或数组），提取 image 块的页码与图注 */
function parseContentList(raw: unknown): Map<string, { page: number | null; caption?: string }> {
  const map = new Map<string, { page: number | null; caption?: string }>()
  let list: unknown = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw)
    } catch {
      return map
    }
  }
  if (!Array.isArray(list)) return map
  for (const block of list) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type !== 'image' && item.type !== 'img') continue
    const imgPath = typeof item.img_path === 'string' ? item.img_path : ''
    if (!imgPath) continue
    const name = imgPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? imgPath
    const pageIdxRaw = item.page_idx ?? item.page_id ?? item.page
    const pageIdx =
      typeof pageIdxRaw === 'number' && Number.isFinite(pageIdxRaw) ? pageIdxRaw : null
    map.set(name, {
      page: pageIdx === null ? null : pageIdx + 1, // content_list 是 0 起始页码
      caption: firstString(item.image_caption ?? item.caption ?? item.text),
    })
  }
  return map
}

export async function parseWithMinerU(
  filePath: string,
  options: {
    apiUrl?: string
    backend?: 'pipeline' | 'vlm-transformers' | 'vlm-sglang-engine' | 'vlm-sglang-client'
    lang?: string
    returnImages?: boolean
    startPageId?: number
    endPageId?: number
  } = {}
): Promise<MinerUParseResult> {
  const apiUrl = options.apiUrl ?? process.env.MINERU_API_URL ?? 'http://192.168.15.110:8000'
  const backend = options.backend ?? 'pipeline'
  const lang = options.lang ?? 'ch'
  const returnImages = options.returnImages ?? true

  const fileName = basename(filePath)
  const fileBuffer = readFileSync(filePath)

  const formData = new FormData()
  formData.append('files', new Blob([fileBuffer]), fileName)
  formData.append('backend', backend)
  formData.append('lang_list', lang)
  formData.append('return_md', 'true')
  formData.append('return_content_list', 'true')
  if (returnImages) {
    formData.append('return_images', 'true')
  }
  if (options.startPageId !== undefined) {
    formData.append('start_page_id', String(options.startPageId))
  }
  if (options.endPageId !== undefined) {
    formData.append('end_page_id', String(options.endPageId))
  }

  const res = await fetch(`${apiUrl}/file_parse`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`MinerU API 错误 ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const results = data?.results ?? {}
  const fileKey = Object.keys(results)[0]
  const fileResult = results[fileKey] ?? {}

  const mdContent: string = fileResult.md_content ?? ''
  const meta = parseContentList(fileResult.content_list ?? fileResult.info?.content_list)

  const images: MinerUImage[] = []
  const rawImages = fileResult.images ?? {}
  for (const [rawName, dataUrl] of Object.entries(rawImages)) {
    const stem = rawName.replace(/\.[^.]+$/, '')
    const info = meta.get(stem) ?? meta.get(rawName)
    images.push({
      name: rawName,
      dataUrl: String(dataUrl),
      page: info?.page ?? null,
      caption: info?.caption,
    })
  }

  return { mdContent, images }
}
