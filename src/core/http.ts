/**
 * HTTP 层 —— 负责文档拉取与调试请求发送。
 *
 * 跨域说明：桌面客户端里 tauri-plugin-better-cors-fetch 透明接管了 window.fetch 与
 * XMLHttpRequest，请求实际由 Rust 进程发出，因此不受浏览器同源策略约束，后端不需要
 * 为跨域做任何配置，前端也不再有代理前缀。
 *
 * 设计要点：
 *  - 文档拉取统一使用 `responseType: 'text'` 再手动解析，兼容部分后端把 JSON 返回为 text/plain 的情况。
 *  - 调试请求永不抛异常，统一返回结构化结果，便于界面直接展示失败原因。
 */

import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'
import { save } from '@tauri-apps/plugin-dialog'

import { call, isTauri } from '@/core/tauri'

/** 文档拉取用的 axios 实例（不注入任何全局 header，避免污染调试请求） */
const docHttp: AxiosInstance = axios.create({
  timeout: 20000,
  withCredentials: false,
  // 必须直连用户填写的后端地址：显式关闭代理，避免运行时环境变量
  // （HTTP_PROXY 等）把请求劫持到中间代理，或者被 WebView 的代理策略改写。
  proxy: false
})

/** 调试请求用的 axios 实例（超时可被调用方覆盖，允许 0 = 不限制） */
export const debugHttp: AxiosInstance = axios.create({
  timeout: 60000,
  withCredentials: false,
  proxy: false
})

/* ------------------------------------------------------------------ */
/* JSON 解析                                                           */
/* ------------------------------------------------------------------ */

/**
 * 宽松 JSON 解析：
 *  - 去掉 XSSI 防护前缀 `)]}'`
 *  - 去掉 BOM
 *  - 支持 JSON5 风格（单引号、无引号 key、注释、尾逗号）
 */
export function parseLooseJson<T = unknown>(text: string): T {
  let content = String(text ?? '')
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
  content = content.replace(/^\)\]\}',?\s*/, '').trim()
  if (!content) throw new Error('响应内容为空')

  try {
    return JSON.parse(content) as T
  } catch {
    // 降级：容错处理常见的不规范 JSON
    const sanitized = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, '$1')
      .replace(/([{,[]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(sanitized) as T
  }
}

/* ------------------------------------------------------------------ */
/* 文档拉取                                                            */
/* ------------------------------------------------------------------ */

export interface FetchDocResult<T = unknown> {
  data: T
  /** 实际请求成功的地址 */
  url: string
}

function describeError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.code === 'ECONNABORTED') return '请求超时，请检查后端服务是否可访问'
    if (error.response) {
      return `服务端返回 HTTP ${error.response.status} ${error.response.statusText || ''}`.trim()
    }
    if (error.code === 'ERR_NETWORK') {
      return '网络错误：后端不可达，请确认服务已启动、地址与端口正确'
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

export { describeError }

/** 拉取一段 JSON 文本（文档 / 分组配置）。 */
export async function fetchJson<T = unknown>(
  url: string,
  options: { headers?: Record<string, string>; timeout?: number } = {}
): Promise<FetchDocResult<T>> {
  const { headers = {}, timeout = 20000 } = options

  const response: AxiosResponse<string> = await docHttp.get(url, {
    headers: { Accept: 'application/json, text/plain, */*', ...headers },
    responseType: 'text',
    timeout,
    // 避免缓存旧文档
    params: { _t: Date.now() }
  })

  return { data: parseLooseJson<T>(String(response.data)), url }
}

/** 探测某个地址是否可用（不抛异常） */
export async function probe(url: string, timeout = 6000): Promise<boolean> {
  try {
    await fetchJson(url, { timeout })
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 调试请求                                                            */
/* ------------------------------------------------------------------ */

export interface DebugRequestOptions {
  url: string
  method: string
  headers: Record<string, string>
  params: Record<string, string>
  /** 响应体类型 */
  responseType?: 'json' | 'text' | 'blob'
  data?: unknown
  timeout?: number
  withCredentials?: boolean
  /** 请求体原始文本（raw 模式） */
  rawText?: string
  /** 请求体 Content-Type 对应的序列化方式 */
  bodyMode?: 'json' | 'form' | 'formData' | 'raw' | 'none'
  /** form 模式的字段 */
  formFields?: { name: string; value: string }[]
  /** 上传文件 */
  files?: { name: string; file: File }[]
}

export interface DebugResponseResult {
  ok: boolean
  status: number
  statusText: string
  /** 毫秒 */
  duration: number
  /** 响应体文本（按 Content-Type 的 charset 解码） */
  body: string
  /** 响应体原始字节，供界面按其它编码重新解码 */
  bodyBytes: Uint8Array
  /** 响应头 */
  headers: Record<string, string>
  /** 响应大小（字节） */
  size: number
  /** 错误信息 */
  error?: string
  /** 最终请求的地址 */
  finalUrl: string
  /** 生成的 curl 命令 */
  curl: string
}

/** 从 Content-Type 里取 charset，取不到按 utf-8 */
function charsetOf(headers: Record<string, string>): string {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(headers['content-type'] ?? '')
  return match?.[1]?.toLowerCase() ?? 'utf-8'
}

/**
 * 按指定编码解码响应体。编码名浏览器不认识时（如 gb2312 之外的写法）
 * TextDecoder 会抛 RangeError，统一降级到 utf-8。
 */
export function decodeBodyBytes(bytes: Uint8Array, encoding = 'utf-8'): string {
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function buildCurl(options: DebugRequestOptions, finalUrl: string): string {
  const parts: string[] = [`curl -X ${options.method.toUpperCase()}`]
  for (const [key, value] of Object.entries(options.headers)) {
    if (!key) continue
    parts.push(`  -H '${key}: ${value}'`)
  }
  const url = new URL(finalUrl)
  // 非必填参数即使值为空也要保留（不能省略），仅跳过 undefined
  for (const [key, value] of Object.entries(options.params)) {
    if (value === undefined) continue
    url.searchParams.set(key, value)
  }
  const bodyMode = options.bodyMode ?? 'none'
  if (bodyMode === 'json' && options.rawText) {
    parts.push(`  -H 'Content-Type: application/json'`)
    parts.push(`  --data-raw '${options.rawText.replace(/'/g, `'\\''`)}'`)
  } else if (bodyMode === 'form' && options.formFields?.length) {
    for (const field of options.formFields) {
      parts.push(`  --data-urlencode '${field.name}=${field.value}'`)
    }
  } else if (bodyMode === 'formData') {
    for (const field of options.formFields ?? []) {
      parts.push(`  -F '${field.name}=${field.value}'`)
    }
    for (const file of options.files ?? []) {
      parts.push(`  -F '${file.name}=@/path/to/${file.file.name}'`)
    }
  } else if (bodyMode === 'raw' && options.rawText) {
    parts.push(`  --data-raw '${options.rawText.replace(/'/g, `'\\''`)}'`)
  }
  parts.push(`  '${url.toString()}'`)
  return parts.join(' \\\n')
}

/** 发送调试请求，永不抛异常，统一返回结构化结果 */
export async function sendDebugRequest(options: DebugRequestOptions): Promise<DebugResponseResult> {
  const start = performance.now()
  const finalUrl = options.url
  const curl = buildCurl(options, finalUrl)

  const headers = { ...options.headers }

  try {
    const response = await debugHttp.request({
      url: options.url,
      method: options.method,
      headers,
      params: options.params,
      data: options.data,
      timeout: options.timeout ?? 60000,
      withCredentials: options.withCredentials ?? false,
      // 取原始字节：界面才能按不同编码重新解码，大小也不必靠字符串估算
      responseType: 'arraybuffer',
      transformResponse: [(data: unknown) => data],
      validateStatus: () => true
    })

    const duration = performance.now() - start
    const responseHeaders: Record<string, string> = {}
    const rawHeaders = response.headers as Record<string, unknown>
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (value === undefined || value === null) continue
      responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value)
    }

    const bodyBytes =
      response.data instanceof ArrayBuffer
        ? new Uint8Array(response.data)
        : new TextEncoder().encode(String(response.data ?? ''))

    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      statusText: response.statusText,
      duration,
      body: decodeBodyBytes(bodyBytes, charsetOf(responseHeaders)),
      bodyBytes,
      headers: responseHeaders,
      size: bodyBytes.byteLength,
      finalUrl,
      curl
    }
  } catch (error) {
    const duration = performance.now() - start
    return {
      ok: false,
      status: 0,
      statusText: '请求失败',
      duration,
      body: '',
      bodyBytes: new Uint8Array(0),
      headers: {},
      size: 0,
      error: describeError(error),
      finalUrl,
      curl
    }
  }
}

/** 根据文件名取扩展名，用于保存对话框的过滤器 */
function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index > 0 ? filename.slice(index + 1) : 'txt'
}

/**
 * 保存文本：桌面客户端弹出原生「另存为」对话框并直接写盘（取消返回 null）；
 * 浏览器环境退回 `<a download>`。
 */
export async function saveTextFile(filename: string, content: string, mime = 'application/json'): Promise<string | null> {
  if (isTauri) {
    const target = await save({
      defaultPath: filename,
      title: '保存文件',
      filters: [{ name: '文本文件', extensions: [extensionOf(filename)] }]
    })
    if (!target) return null
    await call('write_text_file', { path: target, content })
    return target
  }

  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return filename
}

/** 写入安装目录的 temp 子目录，返回绝对路径（仅桌面客户端） */
export async function saveTempFile(filename: string, content: string): Promise<string> {
  return call<string>('write_temp_text', { name: filename, content })
}

/** 把任意值写入用户的下载目录（导出快捷请求 / 项目配置用） */
export async function exportJson(filename: string, value: unknown): Promise<string | null> {
  return saveTextFile(filename, JSON.stringify(value, null, 2), 'application/json')
}

/** 复制文本到剪贴板 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 降级到 execCommand */
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
