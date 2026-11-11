/**
 * 应用数据持久化。
 *
 * 桌面端把整份数据（项目、全局参数、快捷请求）写入安装目录的 `data.json`，
 * 浏览器端退回 localStorage。对外只暴露同步读写：启动时一次性把磁盘数据读进内存，
 * 之后业务 store 直接读内存快照，写入走 400ms 防抖落盘，避免频繁 IO 也保持既有
 * store 的同步调用风格。
 */

import { call, isTauri } from '@/core/tauri'

const DATA_VERSION = 1
const BROWSER_KEY = 'knife4doc:data'
const FLUSH_DELAY = 400

export interface DataEnvelope {
  version: number
  buckets: Record<string, unknown>
}

const buckets: Record<string, unknown> = {}

let ready = false
let dirty = false
let timer: ReturnType<typeof setTimeout> | null = null
let lastError = ''

function adopt(value: unknown) {
  const envelope = (value ?? {}) as Partial<DataEnvelope>
  const source = envelope.buckets
  for (const key of Object.keys(buckets)) delete buckets[key]
  if (source && typeof source === 'object') {
    Object.assign(buckets, source)
  }
}

function readBrowserEnvelope(): DataEnvelope {
  try {
    const raw = window.localStorage.getItem(BROWSER_KEY)
    if (!raw) return { version: DATA_VERSION, buckets: {} }
    const parsed = JSON.parse(raw) as DataEnvelope
    return { version: DATA_VERSION, buckets: parsed?.buckets ?? {} }
  } catch {
    return { version: DATA_VERSION, buckets: {} }
  }
}

function writeBrowserEnvelope() {
  try {
    window.localStorage.setItem(BROWSER_KEY, JSON.stringify({ version: DATA_VERSION, buckets }))
  } catch (error) {
    lastError = `本地存储写入失败：${String(error)}`
  }
}

/** 启动时调用一次；失败也不阻塞渲染，只是退化成空数据。 */
export async function initStorage(): Promise<void> {
  if (ready) return
  if (isTauri) {
    try {
      adopt(await call<DataEnvelope>('read_data'))
    } catch (error) {
      lastError = String(error)
    }
  } else {
    adopt(readBrowserEnvelope())
  }
  ready = true
}

/** 当前数据实际写到哪里，供设置页展示。 */
export function storageBackend(): 'file' | 'localStorage' {
  return isTauri ? 'file' : 'localStorage'
}

export function storageError(): string {
  return lastError
}

/** 同步读取某个数据桶；磁盘里没有就用调用方给的默认值。 */
export function readBucket<T>(name: string, fallback: T): T {
  const value = buckets[name]
  return value === undefined ? fallback : (value as T)
}

export function writeBucket(name: string, value: unknown) {
  buckets[name] = value
  dirty = true
  scheduleFlush()
}

function scheduleFlush() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushStorage()
  }, FLUSH_DELAY)
}

/** 立即落盘；返回是否成功。 */
export async function flushStorage(): Promise<boolean> {
  if (!dirty) return true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  dirty = false
  if (isTauri) {
    try {
      await call('write_data', { value: { version: DATA_VERSION, buckets } })
      lastError = ''
      return true
    } catch (error) {
      dirty = true
      lastError = `数据保存失败：${String(error)}`
      return false
    }
  }
  writeBrowserEnvelope()
  return true
}

// 窗口隐藏 / 关闭前补一次落盘，避免防抖尾巴丢失最后一次修改。
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushStorage())
  window.addEventListener('blur', () => void flushStorage())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushStorage()
  })
}
