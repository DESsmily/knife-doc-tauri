/**
 * 快捷请求 -> 请求负载。
 *
 * 把一条 QuickRequest（含鉴权、参数、请求体）翻译成 sendDebugRequest 的入参，
 * 这样文档调试与快捷请求共用同一条发送链路（在桌面端由 Rust 透明转发跨域）。
 */

import type { DebugRequestOptions } from './http'
import type { QuickKV, QuickRequest } from './types'
import { isValidHttpUrl } from './utils'

/** 未分类的文件字段：行 id -> 已选文件 */
export type FileMap = Record<string, File[]>

function enabled(list: QuickKV[]): QuickKV[] {
  return list.filter((item) => item.enabled && item.name.trim())
}

/** 是否为文件字段：优先按 type 判断，兼容旧数据里的 fileFields 标记 */
function isFileRow(row: QuickKV, fileFields: string[]): boolean {
  return row.type === 'file' || fileFields.includes(row.id)
}

/** 拼 query，允许同名键重复出现（与 Apifox 行为一致） */
function withQuery(url: string, params: QuickKV[]): string {
  const pairs = enabled(params).map(
    (item) => `${encodeURIComponent(item.name)}=${encodeURIComponent(item.value ?? '')}`
  )
  if (!pairs.length) return url
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}${pairs.join('&')}`
}

function applyAuth(request: QuickRequest, headers: Record<string, string>): QuickKV[] {
  const auth = request.auth
  const extra: QuickKV[] = []
  if (auth.type === 'bearer' && auth.token.trim()) {
    const token = auth.token.trim()
    headers.Authorization = /^Bearer\s/i.test(token) ? token : `Bearer ${token}`
  } else if (auth.type === 'basic' && (auth.username || auth.password)) {
    // btoa 只接受 latin1，用户名/密码含中文时先按 UTF-8 展开成字节串
    const bytes = new TextEncoder().encode(`${auth.username}:${auth.password}`)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    headers.Authorization = `Basic ${btoa(binary)}`
  } else if (auth.type === 'apikey' && auth.keyName.trim()) {
    if (auth.keyIn === 'header') headers[auth.keyName.trim()] = auth.keyValue
    else {
      extra.push({
        id: 'auth_query',
        name: auth.keyName.trim(),
        value: auth.keyValue,
        enabled: true,
        description: '鉴权参数',
        type: 'string'
      })
    }
  }
  return extra
}

export interface QuickValidation {
  ok: boolean
  message: string
}

/** 发送前的最小校验：地址必须完整且合法。 */
export function validateQuickRequest(request: QuickRequest): QuickValidation {
  const url = request.url.trim()
  if (!url) return { ok: false, message: '请先填写请求地址' }
  if (!isValidHttpUrl(url)) return { ok: false, message: '地址需以 http:// 或 https:// 开头' }
  return { ok: true, message: '' }
}

/** 构造发送参数；files 只影响 multipart 模式。 */
export function buildQuickPayload(
  request: QuickRequest,
  files: FileMap = {}
): DebugRequestOptions {
  const headers: Record<string, string> = {}
  const body = request.body

  if (body.mode === 'json') headers['Content-Type'] = body.contentType || 'application/json'
  else if (body.mode === 'urlencoded') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  else if (body.mode === 'raw') headers['Content-Type'] = body.contentType || 'text/plain;charset=utf-8'

  for (const row of enabled(request.headers)) {
    if (row.value) headers[row.name.trim()] = row.value
  }

  const authParams = applyAuth(request, headers)
  const params = [...request.params, ...authParams]
  const rows = enabled(body.fields)
  const text = body.text ?? ''

  let data: unknown = undefined
  const filePayload: { name: string; file: File }[] = []

  if (body.mode === 'json') {
    if (text.trim()) {
      try {
        data = JSON.parse(text)
      } catch {
        // 内容不是合法 JSON 时原样发送，让后端去报错，和文档调试保持一致
        data = text
      }
    }
  } else if (body.mode === 'raw') {
    data = text || undefined
  } else if (body.mode === 'urlencoded') {
    const form = new URLSearchParams()
    for (const row of rows) form.append(row.name, row.value ?? '')
    data = rows.length ? form : undefined
  } else if (body.mode === 'form') {
    const form = new FormData()
    for (const row of rows) {
      if (isFileRow(row, body.fileFields)) {
        for (const file of files[row.id] ?? []) {
          form.append(row.name, file)
          filePayload.push({ name: row.name, file })
        }
        continue
      }
      form.append(row.name, row.value ?? '')
    }
    data = rows.length || filePayload.length ? form : undefined
    // multipart 的 Content-Type 必须由运行时附带 boundary，不能手动指定
    delete headers['Content-Type']
  }

  return {
    url: withQuery(request.url.trim(), params),
    method: request.method,
    headers,
    params: {},
    data,
    timeout: request.timeout,
    withCredentials: false,
    rawText: body.mode === 'json' || body.mode === 'raw' ? text : undefined,
    bodyMode: body.mode === 'form' ? 'formData' : body.mode === 'urlencoded' ? 'form' : body.mode,
    formFields: body.mode === 'form' || body.mode === 'urlencoded'
      ? rows.filter((row) => !isFileRow(row, body.fileFields)).map((row) => ({ name: row.name, value: row.value }))
      : [],
    files: filePayload
  }
}
