/**
 * 全局参数 Store
 *
 * 用户为某个项目配置的公共 header / query 参数，勾选后会注入到该项目下所有接口，
 * 既展示在接口文档的参数表中，也会参与调试请求的实际发送。按项目隔离，持久化到
 * 安装目录的 data.json。
 */

import { defineStore } from 'pinia'

import { readBucket, writeBucket } from '@/core/storage'
import type { GlobalParam, GlobalParamIn } from '@/core/types'
import { uid } from '@/core/utils'

type StoreShape = Record<string, GlobalParam[]>

function readAll(): StoreShape {
  const value = readBucket<StoreShape>('globalParams', {})
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

/** 常见公共参数预设，便于一键添加 */
export const GLOBAL_PARAM_PRESETS: { name: string; in: GlobalParamIn; description: string }[] = [
  { name: 'Authorization', in: 'header', description: '鉴权令牌' },
  { name: 'token', in: 'header', description: '自定义令牌' },
  { name: 'X-Access-Token', in: 'header', description: '业务令牌' },
  { name: 'Content-Type', in: 'header', description: '请求内容类型' },
  { name: 'Accept-Language', in: 'header', description: '语言偏好' },
  { name: 'tenant-id', in: 'header', description: '租户标识' },
  { name: 'appId', in: 'query', description: '应用标识' }
]

export const useGlobalParamStore = defineStore('globalParam', {
  state() {
    return {
      /** 所有项目的全局参数，key 为 projectId */
      all: {} as StoreShape,
      /** 当前项目 id */
      projectId: ''
    }
  },

  getters: {
    /** 当前项目的全部全局参数 */
    list(state): GlobalParam[] {
      if (!state.projectId) return []
      return state.all[state.projectId] ?? []
    },
    /** 当前项目已启用的全局参数 */
    enabled(): GlobalParam[] {
      return this.list.filter((item) => item.enabled)
    },
    /** 已启用的 header 参数 */
    enabledHeaders(): GlobalParam[] {
      return this.enabled.filter((item) => item.in === 'header')
    },
    /** 已启用的 query 参数 */
    enabledQueries(): GlobalParam[] {
      return this.enabled.filter((item) => item.in === 'query')
    },
    /** 启用数量 */
    enabledCount(): number {
      return this.enabled.length
    }
  },

  actions: {
    /** 从磁盘快照恢复 */
    init() {
      this.all = readAll()
    },

    persist() {
      writeBucket('globalParams', this.all)
    },

    /** 切换到某个项目 */
    setProject(projectId: string) {
      this.projectId = projectId
      if (projectId && !this.all[projectId]) {
        this.all[projectId] = []
      }
    },

    ensureBucket(projectId: string): GlobalParam[] {
      if (!this.all[projectId]) this.all[projectId] = []
      return this.all[projectId]
    },

    add(input: Partial<GlobalParam> & { name: string; in: GlobalParamIn }): GlobalParam | null {
      const list = this.ensureBucket(this.projectId)
      const name = String(input.name ?? '').trim()
      if (!name) return null
      if (list.some((item) => item.name === name && item.in === input.in)) return null

      const param: GlobalParam = {
        id: uid('g'),
        name,
        in: input.in,
        value: String(input.value ?? ''),
        enabled: input.enabled ?? true,
        description: String(input.description ?? '')
      }
      list.push(param)
      this.persist()
      return param
    },

    update(id: string, patch: Partial<GlobalParam>) {
      const list = this.ensureBucket(this.projectId)
      const index = list.findIndex((item) => item.id === id)
      if (index < 0) return
      list.splice(index, 1, { ...list[index], ...patch })
      this.persist()
    },

    remove(id: string) {
      const list = this.ensureBucket(this.projectId)
      const index = list.findIndex((item) => item.id === id)
      if (index < 0) return
      list.splice(index, 1)
      this.persist()
    },

    /** 批量替换（弹窗保存时调用） */
    replaceAll(params: GlobalParam[]) {
      this.all[this.projectId] = params
      this.persist()
    },

    clear() {
      this.all[this.projectId] = []
      this.persist()
    }
  }
})
