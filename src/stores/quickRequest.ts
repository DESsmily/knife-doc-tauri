/**
 * 快捷请求 Store
 *
 * 参考 Apifox 的「快捷请求」：不依赖任何接口文档，随手建一个 HTTP 请求，
 * 用分类（文件夹）组织，数据持久化到安装目录 data.json 的 `quick` 桶。
 */

import { defineStore } from 'pinia'

import { readBucket, writeBucket } from '@/core/storage'
import type {
  HttpMethod,
  QuickAuth,
  QuickBody,
  QuickData,
  QuickFolder,
  QuickKV,
  QuickRequest
} from '@/core/types'
import { uid } from '@/core/utils'

/** 请求方法可选项（顺序对齐 Apifox） */
export const QUICK_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

export function emptyAuth(): QuickAuth {
  return {
    type: 'none',
    token: '',
    username: '',
    password: '',
    keyName: '',
    keyValue: '',
    keyIn: 'header'
  }
}

export function emptyBody(): QuickBody {
  return { mode: 'none', text: '', contentType: 'application/json', fields: [], fileFields: [] }
}

export function kv(name = '', value = '', description = ''): QuickKV {
  return { id: uid('kv'), name, value, enabled: true, description }
}

/** 新建一条空白请求；folderId 为空表示挂在未分类下 */
export function createRequest(input: Partial<QuickRequest> = {}): QuickRequest {
  const now = Date.now()
  return {
    id: uid('req'),
    folderId: '',
    name: '未命名请求',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: emptyBody(),
    auth: emptyAuth(),
    timeout: 60000,
    remark: '',
    createdAt: now,
    updatedAt: now,
    lastSentAt: null,
    ...input
  }
}

function normalizeRequest(raw: unknown): QuickRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<QuickRequest>
  if (!item.id || typeof item.url !== 'string') return null
  return {
    ...createRequest(),
    ...item,
    params: Array.isArray(item.params) ? item.params : [],
    headers: Array.isArray(item.headers) ? item.headers : [],
    body: { ...emptyBody(), ...(item.body ?? {}) },
    auth: { ...emptyAuth(), ...(item.auth ?? {}) }
  }
}

function readData(): QuickData {
  const raw = readBucket<Partial<QuickData>>('quick', {})
  const folders = Array.isArray(raw.folders)
    ? raw.folders.filter(
        (it): it is QuickFolder => Boolean(it) && typeof it === 'object' && typeof it.id === 'string'
      )
    : []
  const requests = Array.isArray(raw.requests)
    ? raw.requests.map(normalizeRequest).filter((it): it is QuickRequest => Boolean(it))
    : []
  const alive = new Set(requests.map((item) => item.id))
  const activeId = typeof raw.activeId === 'string' && alive.has(raw.activeId) ? raw.activeId : ''
  // 旧版本数据没有 opened：用当前请求补一个标签，避免出现空标签栏
  const opened = Array.isArray(raw.opened)
    ? raw.opened.filter((id): id is string => typeof id === 'string' && alive.has(id))
    : []
  if (activeId && !opened.includes(activeId)) opened.push(activeId)
  return { folders, requests, activeId, opened }
}

export interface QuickTreeNode {
  id: string
  name: string
  isFolder: boolean
  requests: QuickRequest[]
}

export const useQuickRequestStore = defineStore('quickRequest', {
  state: () => ({
    folders: [] as QuickFolder[],
    requests: [] as QuickRequest[],
    activeId: '',
    /** 顶部标签栏里打开的请求 id，按打开顺序 */
    opened: [] as string[],
    /** 有改动还没落盘的请求 id，只活在内存里，不持久化 */
    dirty: [] as string[],
    /** 左侧树的过滤关键词 */
    keyword: '',
    ready: false
  }),

  getters: {
    /** 当前编辑的请求 */
    active(state): QuickRequest | null {
      return state.requests.find((item) => item.id === state.activeId) ?? null
    },
    /** 顶部标签栏的打开顺序 */
    tabs(state): QuickRequest[] {
      return state.opened
        .map((id) => state.requests.find((item) => item.id === id))
        .filter((item): item is QuickRequest => Boolean(item))
    },
    /** 未分类 + 各分类，用于左侧树 */
    nodes(state): QuickTreeNode[] {
      const list: QuickTreeNode[] = state.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        isFolder: true,
        requests: state.requests.filter((item) => item.folderId === folder.id)
      }))
      list.unshift({
        id: '',
        name: '未分类',
        isFolder: false,
        requests: state.requests.filter((item) => !item.folderId)
      })
      return list
    },
    /** 关键词过滤后的树（匹配请求名 / 地址 / 方法），空分类在过滤时隐藏 */
    matchedNodes(): QuickTreeNode[] {
      const keyword = this.keyword.trim().toLowerCase()
      return this.nodes
        .map((node) => {
          if (!keyword) return node
          return {
            ...node,
            requests: node.requests.filter((item) =>
              `${item.name} ${item.method} ${item.url}`.toLowerCase().includes(keyword)
            )
          }
        })
        .filter((node) => keyword === '' || node.requests.length > 0)
    },
    total(state): number {
      return state.requests.length
    }
  },

  actions: {
    init() {
      if (this.ready) return
      const data = readData()
      this.folders = data.folders
      this.requests = data.requests
      this.activeId = data.requests.some((item) => item.id === data.activeId) ? data.activeId : ''
      this.opened = data.opened
      this.ready = true
    },

    persist() {
      const payload: QuickData = {
        folders: this.folders,
        requests: this.requests,
        activeId: this.activeId,
        opened: this.opened
      }
      writeBucket('quick', payload)
    },

    /** 把请求打开成标签并切为当前；已在标签栏里则只切换 */
    open(id: string) {
      if (this.requests.some((item) => item.id === id)) this.setActive(id)
    },

    /** 关闭标签；未保存的改动仍然留在数据里，只是不再显示在标签栏 */
    close(id: string) {
      const index = this.opened.indexOf(id)
      if (index < 0) return
      this.opened.splice(index, 1)
      this.dirty = this.dirty.filter((item) => item !== id)
      if (this.activeId === id) this.activeId = this.opened[Math.min(index, this.opened.length - 1)] ?? ''
      this.persist()
    },

    closeOthers(id: string) {
      if (!this.opened.includes(id)) return
      this.opened = [id]
      this.dirty = this.dirty.filter((item) => item === id)
      this.activeId = id
      this.persist()
    },

    /** 关闭目标标签一侧的其余标签，供标签右键菜单使用 */
    closeSide(id: string, side: 'left' | 'right') {
      const anchor = this.opened.indexOf(id)
      if (anchor < 0) return
      this.opened = this.opened.filter((_, index) => (side === 'left' ? index >= anchor : index <= anchor))
      this.dirty = this.dirty.filter((item) => this.opened.includes(item))
      if (!this.opened.includes(this.activeId)) this.activeId = id
      this.persist()
    },

    closeAll() {
      this.opened = []
      this.dirty = []
      this.activeId = ''
      this.persist()
    },

    markDirty(id: string) {
      if (!this.dirty.includes(id)) this.dirty.push(id)
    },

    clearDirty(id: string) {
      this.dirty = this.dirty.filter((item) => item !== id)
    },

    addFolder(name: string): QuickFolder {
      const folder: QuickFolder = { id: uid('dir'), name: name.trim() || '新建分类', createdAt: Date.now() }
      this.folders.push(folder)
      this.persist()
      return folder
    },

    renameFolder(id: string, name: string) {
      const index = this.folders.findIndex((item) => item.id === id)
      if (index < 0) return
      this.folders.splice(index, 1, { ...this.folders[index], name: name.trim() || this.folders[index].name })
      this.persist()
    },

    /** 删除分类；withRequests 为 false 时把其中的请求退回未分类 */
    removeFolder(id: string, withRequests: boolean) {
      this.folders = this.folders.filter((item) => item.id !== id)
      if (withRequests) {
        const gone = new Set(this.requests.filter((item) => item.folderId === id).map((item) => item.id))
        this.requests = this.requests.filter((item) => item.folderId !== id)
        this.opened = this.opened.filter((item) => !gone.has(item))
        this.dirty = this.dirty.filter((item) => !gone.has(item))
        if (gone.has(this.activeId)) this.activeId = this.opened[0] ?? this.requests[0]?.id ?? ''
      } else {
        for (const item of this.requests) {
          if (item.folderId === id) item.folderId = ''
        }
      }
      this.persist()
    },

    addRequest(input: Partial<QuickRequest> = {}): QuickRequest {
      const request = createRequest(input)
      this.requests.unshift(request)
      this.open(request.id)
      return request
    },

    /** 复制一条请求（含全部参数），新副本紧跟在原请求之后 */
    duplicate(id: string): QuickRequest | null {
      const source = this.requests.find((item) => item.id === id)
      if (!source) return null
      const snapshot = JSON.parse(JSON.stringify(source)) as QuickRequest
      const copy = createRequest({ ...snapshot, id: uid('req'), name: `${source.name} 副本` })
      const index = this.requests.findIndex((item) => item.id === id)
      this.requests.splice(index + 1, 0, copy)
      this.open(copy.id)
      return copy
    },

    remove(id: string) {
      const index = this.requests.findIndex((item) => item.id === id)
      if (index < 0) return
      const tab = this.opened.indexOf(id)
      this.requests.splice(index, 1)
      this.opened = this.opened.filter((item) => item !== id)
      this.dirty = this.dirty.filter((item) => item !== id)
      if (this.activeId === id) {
        this.activeId = this.opened[Math.min(tab, this.opened.length - 1)] ?? this.requests[0]?.id ?? ''
      }
      this.persist()
    },

    /** 移动请求到某个分类，folderId 传空串表示未分类 */
    move(id: string, folderId: string) {
      const request = this.requests.find((item) => item.id === id)
      if (!request) return
      request.folderId = folderId
      request.updatedAt = Date.now()
      this.persist()
    },

    rename(id: string, name: string) {
      const request = this.requests.find((item) => item.id === id)
      if (!request) return
      request.name = name.trim() || request.name
      request.updatedAt = Date.now()
      this.persist()
    },

    /** 切换当前请求；从左侧列表直接点进来时顺便开个标签 */
    setActive(id: string) {
      this.activeId = id
      if (id && !this.opened.includes(id) && this.requests.some((item) => item.id === id)) {
        this.opened.push(id)
      }
      this.persist()
    },

    /** 编辑器改动落盘：内容已直接写在 store 对象上，这里只更新时间戳并触发持久化。 */
    touch(request: QuickRequest) {
      request.updatedAt = Date.now()
      this.persist()
    },

    markSent(request: QuickRequest) {
      request.lastSentAt = Date.now()
      this.persist()
    },

    exportData(): QuickData {
      return { folders: this.folders, requests: this.requests, activeId: '', opened: [] }
    },

    /** 导入：同 id 覆盖，其余追加，返回新增数量 */
    importData(payload: unknown): number {
      const data = payload as Partial<QuickData>
      if (!data || !Array.isArray(data.requests)) throw new Error('文件结构不正确：缺少 requests 数组')
      let added = 0
      for (const folder of data.folders ?? []) {
        if (!folder || typeof folder.id !== 'string') continue
        if (this.folders.some((item) => item.id === folder.id)) continue
        this.folders.push({
          id: folder.id,
          name: String(folder.name ?? '导入分类'),
          createdAt: folder.createdAt ?? Date.now()
        })
      }
      for (const raw of data.requests) {
        const request = normalizeRequest(raw)
        if (!request) continue
        const index = this.requests.findIndex((item) => item.id === request.id)
        if (index >= 0) {
          this.requests.splice(index, 1, request)
        } else {
          this.requests.unshift(request)
          added += 1
        }
      }
      this.persist()
      return added
    }
  }
})
