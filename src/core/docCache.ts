/**
 * 文档数据本地缓存。
 *
 * 每次成功请求到文档数据（入口探测结果 / 分组文档 JSON）后，覆盖写一份快照到本地；
 * 之后再次请求失败时直接回读这份快照，保证后端不可用或离线时仍能打开已缓存的文档。
 * 项目被删除时，其全部快照一并清除。
 *
 * 快照随既有持久化层落盘：桌面端写入安装目录 data.json，浏览器预览退回 localStorage。
 */

import { readBucket, writeBucket } from '@/core/storage'
import type { DiscoverResult } from '@/core/types'

/** 文档缓存所在的数据桶 */
const CACHE_BUCKET = 'docCache'

/** 单个分组文档的快照 */
export interface GroupDocSnapshot {
  /** 分组文档原始 JSON（成功请求时覆盖写入） */
  doc: Record<string, unknown>
  /** 成功请求时的文档地址 */
  url: string
  /** 快照写入时间 */
  savedAt: number
}

/** 单个项目的文档快照集合 */
export interface ProjectDocSnapshot {
  /** 入口探测快照（可能为空：只缓存过分组文档） */
  discovery: DiscoverySnapshot | null
  /** 分组文档快照，key = 分组 id */
  groups: Record<string, GroupDocSnapshot>
}

/** 入口探测结果的快照 */
export interface DiscoverySnapshot {
  /** 探测结果（分组列表） */
  result: DiscoverResult
  /** 快照写入时间 */
  savedAt: number
}

function readSnapshots(): Record<string, ProjectDocSnapshot> {
  const data = readBucket<Record<string, ProjectDocSnapshot>>(CACHE_BUCKET, {})
  return data && typeof data === 'object' ? data : {}
}

function writeSnapshots(data: Record<string, ProjectDocSnapshot>) {
  writeBucket(CACHE_BUCKET, data)
}

/**
 * 深拷贝快照内容。
 * 快照写入后仍会保留在内存桶里，若直接存引用，后续对分组对象的修改
 * （loaded / apiCount 等）会污染已缓存的快照，因此必须克隆一份纯数据。
 */
function clone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

/** 成功探测入口后调用：覆盖该项目的入口探测快照 */
export function saveDiscovery(projectId: string, result: DiscoverResult) {
  const snapshots = readSnapshots()
  const prev = snapshots[projectId]
  snapshots[projectId] = {
    discovery: { result: clone(result), savedAt: Date.now() },
    groups: prev?.groups ?? {}
  }
  writeSnapshots(snapshots)
}

/** 读取项目的入口探测快照；没有则返回 null */
export function readDiscovery(projectId: string): DiscoverySnapshot | null {
  return readSnapshots()[projectId]?.discovery ?? null
}

/** 成功拉取分组文档后调用：覆盖该分组的文档快照 */
export function saveGroupDoc(
  projectId: string,
  groupId: string,
  doc: Record<string, unknown>,
  url: string
) {
  const snapshots = readSnapshots()
  const prev = snapshots[projectId]
  const snapshot: GroupDocSnapshot = { doc: clone(doc), url, savedAt: Date.now() }
  if (!prev) {
    snapshots[projectId] = { discovery: null, groups: { [groupId]: snapshot } }
  } else {
    prev.groups[groupId] = snapshot
  }
  writeSnapshots(snapshots)
}

/** 读取分组的文档快照；没有则返回 null */
export function readGroupDoc(projectId: string, groupId: string): GroupDocSnapshot | null {
  return readSnapshots()[projectId]?.groups[groupId] ?? null
}

/** 项目删除时调用：清除该项目的全部文档快照 */
export function clearProjectCache(projectId: string) {
  const snapshots = readSnapshots()
  if (!snapshots[projectId]) return
  delete snapshots[projectId]
  writeSnapshots(snapshots)
}
