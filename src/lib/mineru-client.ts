import { readFileSync } from 'fs'
import { basename } from 'path'

export interface MinerUParseResult {
  mdContent: string
  images: { name: string; dataUrl: string }[]
}

const DEFAULT_TIMEOUT = 300000

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
  const images: { name: string; dataUrl: string }[] = []
  const rawImages = fileResult.images ?? {}
  for (const [name, dataUrl] of Object.entries(rawImages)) {
    images.push({ name, dataUrl: String(dataUrl) })
  }

  return { mdContent, images }
}
