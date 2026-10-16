/**
 * DOCX(OOXML) 原生解析：不依赖 MinerU / mammoth，直接从 docx 里取正文与插图。
 *
 * 关键点：Word 插图常常是一整张超屏截图，正文里用 `<a:srcRect>` 只裁出实际显示的那块。
 * MinerU / mammoth 拿到的都是 media 目录下的**未裁剪原图**（体积大、含无关背景），
 * 本模块按每处 `w:drawing` / `w:pict` 的裁剪信息裁出「Word 里真正显示的样子」再压缩落盘。
 *
 * 依赖：Node 内置 zlib + sharp（图像裁剪/缩放/压缩）。
 */
import { inflateRawSync } from 'zlib'
import { readFileSync } from 'fs'
import { basename } from 'path'
import sharp from 'sharp'
import { imageAnchor, sanitizeImageBase, type ExtractedImage } from './document-parser'

// ---------------------------------------------------------------------------
// zip 读取（docx 就是 zip：只需 store/deflate 两种方法，用内置 inflateRawSync）
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string
  method: number
  dataStart: number
  compressedSize: number
}

/** 解析 zip 的中央目录，返回 entry 表（不在此处解压，避免一次性占内存） */
function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  const EOCD = 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('不是有效的 zip/docx 文件（未找到 EOCD）')

  const total = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  let off = buf.readUInt32LE(eocd + 16)
  if (off + cdSize > buf.length) off = 0 // zip64 等异常场景：从文件头暴力扫描
  const end = Math.min(buf.length, off === 0 ? buf.length : off + cdSize)

  const entries = new Map<string, ZipEntry>()
  for (; off + 46 <= end; ) {
    if (buf.readUInt32LE(off) !== 0x02014b50) {
      off += 1 // 起始偏移有噪声时逐字节对齐
      continue
    }
    const method = buf.readUInt16LE(off + 10)
    const compressedSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (localOff + 30 <= buf.length && buf.readUInt32LE(localOff) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      entries.set(name, {
        name,
        method,
        dataStart: localOff + 30 + lNameLen + lExtraLen,
        compressedSize,
      })
    }
    off += 46 + nameLen + extraLen + commentLen
    if (entries.size >= total) break
  }
  return entries
}

/** 取出 zip 内某个文件的原始字节（找不到返回 null） */
function readZipFile(buf: Buffer, entries: Map<string, ZipEntry>, name: string): Buffer | null {
  const e = entries.get(name)
  if (!e) return null
  const raw = buf.subarray(e.dataStart, e.dataStart + e.compressedSize)
  if (e.method === 0) return Buffer.from(raw)
  if (e.method === 8) return inflateRawSync(raw)
  return null
}

function readPartText(buf: Buffer, entries: Map<string, ZipEntry>, name: string): string {
  return readZipFile(buf, entries, name)?.toString('utf8') ?? ''
}

function partBaseName(part: string): string {
  return part.slice(part.lastIndexOf('/') + 1)
}

/** `word/document.xml` → `word/_rels/document.xml.rels` */
function relsPathOf(part: string): string {
  const i = part.lastIndexOf('/')
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`
}

// ---------------------------------------------------------------------------
// XML 片段工具
// ---------------------------------------------------------------------------

const ATTR = String.raw`[A-Za-z0-9_:.-]+="[^"]*"`
const TAG = String.raw`<[^>]*\b${ATTR}(?:\s+${ATTR})*\s*/?>`

const ATTR_PAIR_RE = /([A-Za-z0-9_:.-]+)\s*=\s*"([^"]*)"/g

function toAttrs(tag: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const pair of tag.matchAll(ATTR_PAIR_RE)) m.set(pair[1], pair[2])
  return m
}

/** 读取标签内属性（用精确键匹配，避免 `\b` 在前导空格处失效） */
function attr(xml: string, tag: string, name: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?/?>`).exec(xml)
  if (!m) return undefined
  return toAttrs(m[0]).get(name)
}

function numAttr(xml: string, tag: string, name: string): number | undefined {
  const raw = attr(xml, tag, name)
  if (raw === undefined) return undefined
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? v : undefined
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

// ---------------------------------------------------------------------------
// 图片引用与裁剪
// ---------------------------------------------------------------------------

/**
 * 裁剪框：四边相对原图的**内缩量**，单位由 `unit` 决定。
 * - `frac`：0~1 的比例（OOXML `<a:srcRect>` 的 l/t/r/b 是 1/1000 百分比，已除以 100000）
 * - `px`：像素（老式 VML `style="clip:l …tpx"`）
 */
interface Crop {
  left: number
  top: number
  right: number
  bottom: number
  unit: 'frac' | 'px'
}

export interface DocxImagePlacement {
  /** 所在的 OOXML part，如 word/document.xml、word/header2.xml */
  part: string
  /** 图片引用在该 part XML 中的字符偏移（用于确定正文锚点位置） */
  offset: number
  /** r:embed / r:id 关系 ID */
  rid: string
  /** media/image1.png */
  target: string
  crop?: Crop
  /** 显示宽度（EMU），可用于超采样估算 */
  extentCx?: number
  extentCy?: number
  /** 图形框架名称（`<wp:docPr name=…>`），有时作者会写有意义的名字 */
  frameName?: string
}

/** r:embed → word/media/imageN.png */
function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of xml.matchAll(/<Relationship(?:\s[^>]*)?\/>/g)) {
    const a = toAttrs(m[0])
    const id = a.get('Id')
    const target = a.get('Target')
    if (!id || !target) continue
    const clean = target.replace(/^\.\//, '').replace(/^\w+:\//, '')
    map.set(id, clean.startsWith('word/') ? clean : `word/${clean}`)
  }
  return map
}

/** srcRect 的 l/t/r/b 单位是 1/1000 百分比（6524 = 6.524%），换算成 0~1 比例 */
function parseSrcRect(drawing: string): Crop | undefined {
  const m = /<a:srcRect(?:\s[^>]*)?\/?>/.exec(drawing)
  if (!m) return undefined
  const g = (k: string) => {
    const v = Number.parseFloat(toAttrs(m[0]).get(k) ?? '')
    return Number.isFinite(v) ? v / 100000 : 0
  }
  return { left: g('l'), top: g('t'), right: g('r'), bottom: g('b'), unit: 'frac' }
}

/** VML `<v:imagedata o:relid="rIdN" style="clip:l 12tpx t … r … b …"/>`（老式 w:pict 插图） */
function collectVml(pict: string, out: DocxImagePlacement[], ctx: { part: string; offset: number }): void {
  for (const m of pict.matchAll(/<v:imagedata(?:\s[^>]*)?\/?>/g)) {
    const a = toAttrs(m[0])
    const rid = a.get('o:relid') ?? a.get('r:id')
    if (!rid) continue
    const style = a.get('style') ?? ''
    let crop: Crop | undefined
    const clip = /clip\s*:\s*([^;"]+)/.exec(style)
    if (clip) {
      const v = (t: RegExp) => {
        const m2 = t.exec(clip[1])
        return m2 ? Number.parseFloat(m2[1]) : 0
      }
      crop = {
        left: v(/\bl\s+(-?[\d.]+)/),
        top: v(/\bt\s+(-?[\d.]+)/),
        right: v(/\br\s+(-?[\d.]+)/),
        bottom: v(/\bb\s+(-?[\d.]+)/),
        unit: 'px',
      }
    }
    out.push({ ...ctx, rid, target: '', crop })
  }
}

/** 扫描一个 part 的所有图片引用（DrawingML 与 VML 两种写法） */
function collectPlacements(part: string, xml: string): DocxImagePlacement[] {
  const out: DocxImagePlacement[] = []
  const push = (source: string, ctx: Omit<DocxImagePlacement, 'target'>) => {
    out.push({ ...ctx, target: '', frameName: attr(source, 'wp:docPr', 'name') })
  }

  for (const m of xml.matchAll(/<w:drawing(?:\s[^>]*)?>[\s\S]*?<\/w:drawing>/g)) {
    const source = m[0]
    const rid = attr(source, 'a:blip', 'r:embed') ?? attr(source, 'a:blip', 'r:link')
    if (!rid) continue
    push(source, {
      part,
      offset: m.index ?? 0,
      rid,
      crop: parseSrcRect(source),
      extentCx: numAttr(source, 'wp:extent', 'cx'),
      extentCy: numAttr(source, 'wp:extent', 'cy'),
    })
  }

  for (const m of xml.matchAll(/<w:pict(?:\s[^>]*)?>[\s\S]*?<\/w:pict>/g)) {
    collectVml(m[0], out, { part, offset: m.index ?? 0 })
  }

  return out.sort((a, b) => a.offset - b.offset)
}

/** 把裁剪框换算成 sharp 的像素矩形；无效/几乎无裁剪则返回 null（用原图） */
function toExtractRegion(
  crop: Crop | undefined,
  width: number,
  height: number
): { left: number; top: number; width: number; height: number } | null {
  if (!crop || !width || !height) return null
  const px = (v: number, axis: 'x' | 'y') =>
    Math.round(crop.unit === 'frac' ? (axis === 'x' ? width : height) * v : v)
  const left = clamp(px(crop.left, 'x'), 0, width - 8)
  const top = clamp(px(crop.top, 'y'), 0, height - 8)
  const right = clamp(px(crop.right, 'x'), 0, width - left - 8)
  const bottom = clamp(px(crop.bottom, 'y'), 0, height - top - 8)
  const w = width - left - right
  const h = height - top - bottom
  if (w < 8 || h < 8) return null
  // 几乎没有裁剪，不必再走 extract
  if (w >= width * 0.98 && h >= height * 0.98) return null
  return { left, top, width: w, height: h }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

// ---------------------------------------------------------------------------
// 压缩
// ---------------------------------------------------------------------------

export interface NormalizeImageOptions {
  /** 最长边像素上限（只缩不放），默认 1568 */
  maxPixel?: number
  /** PNG 直出的体积上限，超过则改 JPEG，默认 256KB（qwen-vl 不保证支持 WebP，故只用 PNG/JPEG） */
  maxPngBytes?: number
  /** JPEG 质量，默认 85 */
  jpegQuality?: number
}

export interface NormalizedImage {
  dataUrl: string
  width: number
  height: number
  bytes: number
  ext: 'png' | 'jpg'
}

/** 裁剪（可选）+ 限尺寸 + 压缩，得到最终落盘/送视觉模型的图 */
export async function normalizeImageBuffer(
  input: Buffer,
  region: { left: number; top: number; width: number; height: number } | null,
  options: NormalizeImageOptions = {}
): Promise<NormalizedImage | null> {
  const { maxPixel = 1568, maxPngBytes = 256 * 1024, jpegQuality = 85 } = options
  try {
    let img = sharp(input, { failOn: 'none' })
    if (region) img = img.extract(region)
    img = img.rotate().resize({ width: maxPixel, height: maxPixel, fit: 'inside', withoutEnlargement: true })

    const png = await img.clone().png({ compressionLevel: 9, effort: 8 }).toBuffer({ resolveWithObject: true })
    let buffer = png.data
    let ext: 'png' | 'jpg' = 'png'
    let info = png.info

    if (buffer.length > maxPngBytes) {
      const jpeg = await img
        .clone()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: jpegQuality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
      if (jpeg.data.length < buffer.length) {
        buffer = jpeg.data
        info = jpeg.info
        ext = 'jpg'
      }
    }

    return {
      dataUrl: `data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,${buffer.toString('base64')}`,
      width: info.width,
      height: info.height,
      bytes: buffer.length,
      ext,
    }
  } catch {
    return null
  }
}

/** data URL → 裁剪压缩后的 data URL（供 MinerU / mammoth 拿到的原图复用同一套裁剪逻辑） */
export async function normalizeImageDataUrl(
  dataUrl: string,
  options: NormalizeImageOptions = {}
): Promise<NormalizedImage | null> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (!base64) return null
  try {
    return await normalizeImageBuffer(Buffer.from(base64, 'base64'), null, options)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 正文 + 锚点
// ---------------------------------------------------------------------------

interface Para {
  start: number
  end: number
  text: string
}

/** 按 `<w:p>` 聚合 `<w:t>` 文本；表格行后补换行，便于分块与阅读 */
function collectParagraphs(xml: string): Para[] {
  const paras: Para[] = []
  const re = /<w:p\b|<\/w:p>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:tr>/g
  let cur: Para | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const tok = m[0]
    if (tok.startsWith('<w:p')) {
      if (cur) paras.push(cur)
      cur = { start: m.index, end: m.index + tok.length, text: '' }
      continue
    }
    if (!cur) continue
    if (tok === '</w:p>') {
      cur.end = m.index + tok.length
      paras.push(cur)
      cur = null
      continue
    }
    if (tok === '</w:tr>') {
      cur.text += '\n'
      continue
    }
    if (tok.startsWith('<w:tab')) {
      cur.text += '\t'
      continue
    }
    if (tok.startsWith('<w:br')) {
      cur.text += '\n'
      continue
    }
    cur.text += decodeEntities(m[1] ?? '')
  }
  if (cur) paras.push(cur)
  return paras
}

/** 段落起点二分：返回第一个 start >= x 的段落下标 */
function lowerBoundParas(paras: Para[], x: number): number {
  let lo = 0
  let hi = paras.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (paras[mid].start < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

const FIGURE_CAPTION = /^(图|附图|示意图|简图|照片|插图|fig\.?|figure)\s*[:：-]?\s*\d/
/** 形如「头架示意图」「××简图」的短标题也可当图注 */
const CAPTION_LIKE = /^[^。；，,;]{0,30}(示意图|简图|图样|照片|剖视图|结构图|装配图|图)$/
/** Word 自动生成的无意义框架名：图片 1 / Image1 */
const GENERIC_FRAME_NAME = /^(图片|图像|image)\s*-?\s*\d+$/i

/** 就近找图注：只认「图N…」或「××示意图」这类短行，找不到就用有意义的 `<wp:docPr name>` 兜底 */
function findCaption(
  offset: number,
  paras: Para[],
  fallback?: string
): string | undefined {
  const anchorIdx = lowerBoundParas(paras, offset)
  // 图片常独占若干空段落，图注多在它上面一两行，故向前跳过空段最多看 3 段、向后看 2 段
  const candidates: string[] = []
  for (let i = anchorIdx - 1; i >= 0 && candidates.length < 3; i--) {
    const t = paras[i].text.trim()
    if (t) candidates.push(t)
  }
  for (let i = anchorIdx, n = 0; i < paras.length && n < 2; i++) {
    const t = paras[i].text.trim()
    if (!t) continue
    n++
    candidates.push(t)
  }
  for (const t of candidates) {
    if (t.length <= 60 && (FIGURE_CAPTION.test(t) || CAPTION_LIKE.test(t))) return t
  }
  if (fallback && !GENERIC_FRAME_NAME.test(fallback)) return fallback
  return undefined
}

/** 把正文按段落顺序输出，图片引用位置插入 ⟦img:ID⟧ 锚点 */
function assembleText(
  paras: Para[],
  placements: DocxImagePlacement[],
  idOf: (p: DocxImagePlacement) => string | undefined
): string {
  const usable = placements.filter(p => !!idOf(p))
  if (paras.length === 0) return usable.map(p => imageAnchor(idOf(p)!)).join('\n')
  const idsByPara = new Map<number, string[]>()
  for (const p of usable) {
    const i = lowerBoundParas(paras, p.offset) - 1
    const key = i < 0 ? 0 : i
    const list = idsByPara.get(key) ?? []
    list.push(imageAnchor(idOf(p)!))
    idsByPara.set(key, list)
  }
  const out: string[] = []
  paras.forEach((para, i) => {
    const text = para.text.trim()
    if (text) out.push(text)
    for (const anchor of idsByPara.get(i) ?? []) out.push(anchor)
  })
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface DocxNativeOptions extends NormalizeImageOptions {
  /** 单图原始字节上限，超过直接跳过（默认 24MB） */
  maxSourceBytes?: number
}

export interface DocxNativeResult {
  text: string
  images: ExtractedImage[]
}

/**
 * 直接解析 docx：正文 + 按 Word 实际显示（srcRect 裁剪后）的插图。
 * 失败（非法 docx、图片解码失败等）时抛错，由调用方回退到 MinerU / mammoth。
 */
export async function parseDocxNative(filePath: string, options: DocxNativeOptions = {}): Promise<DocxNativeResult> {
  const { maxSourceBytes = 24 * 1024 * 1024 } = options
  const buf = readFileSync(filePath)
  const entries = readZipEntries(buf)
  if (entries.size === 0) throw new Error('docx 内未读到任何条目')

  const bodyXml = readPartText(buf, entries, 'word/document.xml')
  if (!bodyXml) throw new Error('docx 缺少 word/document.xml')

  const relsByPart = new Map<string, Map<string, string>>()
  const relsOf = (part: string): Map<string, string> => {
    let m = relsByPart.get(part)
    if (!m) {
      const relsXml = readPartText(buf, entries, relsPathOf(part))
      m = parseRels(relsXml)
      relsByPart.set(part, m)
    }
    return m
  }

  const parts = ['word/document.xml', ...[...entries.keys()].filter(n => /^word\/(header|footer)\d*\.xml$/.test(n)).sort()]
  const placements: DocxImagePlacement[] = []
  const parasByPart = new Map<string, Para[]>()
  for (const part of parts) {
    const xml = readPartText(buf, entries, part)
    if (!xml) continue
    if (part === 'word/document.xml') parasByPart.set(part, collectParagraphs(xml))
    const found = collectPlacements(part, xml)
    if (found.length === 0) continue
    const rels = relsOf(part)
    for (const p of found) {
      p.target = rels.get(p.rid) ?? ''
      if (p.target) placements.push(p)
    }
  }
  placements.sort((a, b) =>
    a.part === b.part ? a.offset - b.offset : a.part < b.part ? -1 : 1
  )

  const safe = sanitizeImageBase(basename(filePath))
  const images: ExtractedImage[] = []
  const idOf = new Map<DocxImagePlacement, string>()
  const parasByOffset = parasByPart.get('word/document.xml') ?? []

  for (const p of placements) {
    let buffer = readZipFile(buf, entries, p.target)
    if (!buffer) continue
    if (buffer.length > maxSourceBytes) {
      console.warn(`  跳过超大嵌入图 ${p.target}（${Math.round(buffer.length / 1024)}KB > ${Math.round(maxSourceBytes / 1024 / 1024)}MB）`)
      continue
    }

    let region: ReturnType<typeof toExtractRegion> = null
    const srcMeta = await sharp(buffer, { failOn: 'none' })
      .metadata()
      .catch(() => null)
    if (srcMeta?.width && srcMeta.height) region = toExtractRegion(p.crop, srcMeta.width, srcMeta.height)

    const normalized = await normalizeImageBuffer(buffer, region, options)
    if (!normalized) {
      console.warn(`  跳过无法解码的插图 ${p.target}`)
      continue
    }

    const id = `${safe}_img${images.length + 1}`
    idOf.set(p, id)

    const paras = parasByPart.get(p.part) ?? []
    const frame = p.frameName?.trim()
    const usefulFrame = frame && !GENERIC_FRAME_NAME.test(frame) ? frame : undefined
    images.push({
      id,
      dataUrl: normalized.dataUrl,
      name: usefulFrame || partBaseName(p.target),
      width: normalized.width,
      height: normalized.height,
      sourceFile: basename(filePath),
      page: null,
      caption: findCaption(p.offset, paras, usefulFrame),
    })
  }

  const text = assembleText(parasByOffset, placements, p => idOf.get(p))

  return { text, images }
}
