/**
 * 通用工具函数
 */

/** djb2 字符串哈希，用于生成稳定的元素 id */
export function hash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** 生成稳定 id：前缀 + 哈希 */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${hash(parts.join('|'))}`
}

/** 生成随机 id */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/** 安全取值，避免 undefined 传播 */
export function pick<T>(obj: unknown, path: string, fallback: T): T {
  if (!isPlainObject(obj)) return fallback
  const segments = path.split('.')
  let cur: unknown = obj
  for (const seg of segments) {
    if (!isPlainObject(cur) && !isArray(cur)) return fallback
    cur = (cur as Record<string, unknown>)[seg]
    if (cur === undefined || cur === null) return fallback
  }
  return cur as T
}

/* ------------------------------------------------------------------ */
/* 类型映射                                                            */
/* ------------------------------------------------------------------ */

/**
 * 在前端可以安全用 `number` 承载的整型 format。
 *
 * JS 的 Number 是 IEEE 754 双精度，安全整数上限为 2^53-1，因此：
 *  - `integer(int32)` / `int16` / `int8`（Java int / short / byte）→ number
 *  - `integer(int64)`（Java long）以及**未声明 format** 的 integer → string
 *
 * 后端用 long 承载的字段多为雪花 ID、时间戳等，Jackson 默认就会序列化成
 * 字符串以避免前端精度丢失，所以前端也应按 string 处理，否则示例代码与
 * 实际返回结构会对不上。
 */
const NUMERIC_INTEGER_FORMATS = new Set([
  'int8',
  'int16',
  'int32',
  'byte',
  'short',
  'uint8',
  'uint16',
  'uint32'
])

/** 该整型 format 是否应映射为前端的 number 类型（int64 / 无 format 均为 false） */
export function isNumericIntegerFormat(format: string | null | undefined): boolean {
  return NUMERIC_INTEGER_FORMATS.has(String(format ?? '').trim().toLowerCase())
}

/**
 * 拆解展示用类型字符串，得到基础类型与 format。
 * 例如 `integer(int64)` → `{ base: 'integer', format: 'int64' }`，
 * `array[User]` 这类复合类型不会命中，原样返回。
 */
export function splitDisplayType(displayType: string): { base: string; format: string } {
  const matched = /^([^()[\]]+?)\s*(?:\(([^()]*)\))?$/.exec(String(displayType ?? '').trim())
  if (!matched) return { base: String(displayType ?? '').trim(), format: '' }
  return { base: (matched[1] ?? '').trim(), format: (matched[2] ?? '').trim() }
}

/** 深拷贝（结构化克隆优先，降级为 JSON 往返） */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

/** 归一化后端地址：去掉尾部斜杠、去掉 doc.html 及其后的内容 */
export function normalizeBaseUrl(raw: string): string {
  let url = String(raw ?? '').trim()
  if (!url) return ''
  // 用户可能直接粘贴 http://host:port/doc.html
  url = url.replace(/\/doc\.html.*$/i, '')
  url = url.replace(/\/swagger-ui\.html.*$/i, '')
  url = url.replace(/\/swagger-ui\/index\.html.*$/i, '')
  // 去掉多余尾部斜杠
  url = url.replace(/\/+$/, '')
  return url
}

/** 校验是否为合法的 http(s) 地址 */
export function isValidHttpUrl(raw: string): boolean {
  const url = String(raw ?? '').trim()
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 拼接路径，保证只有一个斜杠 */
export function joinUrl(base: string, segment: string): string {
  const b = String(base ?? '').replace(/\/+$/, '')
  const s = String(segment ?? '').replace(/^\/+/, '')
  if (!b) return s
  if (!s) return b
  return `${b}/${s}`
}

/** 拼接到完整地址（segment 可能是完整 url） */
export function resolveUrl(base: string, segment: string): string {
  const seg = String(segment ?? '').trim()
  if (/^https?:\/\//i.test(seg)) return seg
  return joinUrl(base, seg)
}

/** 判断地址是否为绝对地址 */
export function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(String(url ?? '').trim())
}

/**
 * 把标题 / 分组名转成安全的文件名片段。
 * 替换 Windows / macOS 不允许的字符，压缩空白，并去掉首尾的点（避免生成隐藏文件）。
 */
export function safeFileName(text: string, fallback = 'export', max = 80): string {
  const cleaned = String(text ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
  if (!cleaned) return fallback
  return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned
}

/** JSON 美化输出，失败时原样返回 */
export function prettyJson(value: unknown, indent = 2): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
      return JSON.stringify(JSON.parse(trimmed), null, indent)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, indent)
  } catch {
    return String(value)
  }
}

/** 安全 JSON.parse */
export function safeParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** 字节大小格式化 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let idx = 0
  let size = bytes
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx++
  }
  return `${size.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`
}

/** 时间格式化 */
export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间描述 */
export function fromNow(ts: number | null | undefined): string {
  if (!ts) return '从未访问'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return formatTime(ts)
}

/** 首字母大写 */
export function capitalize(text: string): string {
  const s = String(text ?? '')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** 去掉 HTML 标签（用于表格内嵌富文本描述的场景做降级） */
export function stripHtml(html: string): string {
  return String(html ?? '').replace(/<[^>]*>/g, '')
}

/** 数组去重并保持顺序 */
export function unique<T>(list: T[]): T[] {
  return Array.from(new Set(list))
}

/** 排除空值 */
export function compact<T>(list: (T | null | undefined | '')[]): T[] {
  return list.filter((item): item is T => item !== null && item !== undefined && item !== '')
}

/** 截断字符串 */
export function truncate(text: string, max = 40): string {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** 防抖 */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 200) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

/** 请求耗时展示 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/** 根据 HTTP 方法返回主题色（遵循国内涨红跌绿无关，这里按方法语义配色） */
export function methodColor(method: string): string {
  switch (String(method).toUpperCase()) {
    case 'GET':
      return '#61affe'
    case 'POST':
      return '#49cc90'
    case 'PUT':
      return '#fca130'
    case 'DELETE':
      return '#f93e3e'
    case 'PATCH':
      return '#50e3c2'
    case 'HEAD':
      return '#9012fe'
    case 'OPTIONS':
      return '#0d5aa7'
    default:
      return '#8a93a5'
  }
}

/** 后缀 -> 语言标识，用于代码高亮 */
export function guessLanguage(name: string): string {
  const n = String(name ?? '').toLowerCase()
  if (n.endsWith('.json')) return 'json'
  if (n.endsWith('.xml')) return 'xml'
  if (n.endsWith('.js')) return 'javascript'
  if (n.endsWith('.ts')) return 'typescript'
  return 'json'
}

/** 判断是否包含中文 */
export function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(String(text ?? ''))
}

/**
 * 转义正则元字符
 */
export function escapeRegExp(text: string): string {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
