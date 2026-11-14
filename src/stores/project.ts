/**
 * 项目管理 Store —— 记录用户维护的接口文档地址，持久化到安装目录的 data.json。
 */

import { defineStore } from 'pinia'

import { readBucket, writeBucket } from '@/core/storage'
import type { DocProject, ProjectMeta } from '@/core/types'
import { isValidHttpUrl, normalizeBaseUrl, uid } from '@/core/utils'

/** 卡片主题色盘 */
const PALETTE = [
  '#4f7cff',
  '#00b578',
  '#ff8f1f',
  '#8a5cf6',
  '#f5222d',
  '#13c2c2',
  '#2f54eb',
  '#eb2f96'
]

function readProjects(): DocProject[] {
  const list = readBucket<unknown[]>('projects', [])
  if (!Array.isArray(list)) return []
  return list
    .filter((item): item is DocProject => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      ...item,
      description: item.description ?? '',
      color: item.color || PALETTE[0]
    }))
}

function readCurrentId(): string {
  return readBucket<string>('currentProject', '')
}

export interface ProjectInput {
  name: string
  baseUrl: string
  description?: string
}

export const useProjectStore = defineStore('project', {
  state() {
    return {
      projects: [] as DocProject[],
      currentId: '',
      ready: false
    }
  },

  getters: {
    /** 当前打开的项目 */
    current(state): DocProject | null {
      return state.projects.find((item) => item.id === state.currentId) ?? null
    },
    /** 当前项目地址（已归一化） */
    baseUrl(): string {
      return this.current?.baseUrl ?? ''
    },
    /** 项目列表：按存储顺序展示，不做自动排序（排序由用户拖拽控制） */
    sorted(state): DocProject[] {
      return [...state.projects]
    },
    count(state): number {
      return state.projects.length
    }
  },

  actions: {
    /** 首次进入应用时从磁盘快照恢复（initStorage 必须已完成） */
    init() {
      if (this.ready) return
      this.projects = readProjects()
      const id = readCurrentId()
      this.currentId = this.projects.some((item) => item.id === id) ? id : ''
      this.ready = true
    },

    persist() {
      writeBucket('projects', this.projects)
    },

    /** 校验输入，返回错误信息数组 */
    validate(input: ProjectInput, editingId?: string): Record<string, string> {
      const errors: Record<string, string> = {}
      const name = String(input.name ?? '').trim()
      const baseUrl = normalizeBaseUrl(input.baseUrl ?? '')

      if (!name) errors.name = '请输入项目名称'
      else if (name.length > 40) errors.name = '项目名称不能超过 40 个字符'

      if (!baseUrl) errors.baseUrl = '请输入后端地址'
      else if (!isValidHttpUrl(baseUrl)) errors.baseUrl = '地址格式不正确，需以 http:// 或 https:// 开头'
      else {
        const duplicated = this.projects.some(
          (item) => item.id !== editingId && item.baseUrl === baseUrl
        )
        if (duplicated) errors.baseUrl = '该地址已存在，请勿重复添加'
      }
      return errors
    },

    add(input: ProjectInput): DocProject {
      const project: DocProject = {
        id: uid('proj'),
        name: String(input.name).trim(),
        baseUrl: normalizeBaseUrl(input.baseUrl),
        description: String(input.description ?? '').trim(),
        color: PALETTE[this.projects.length % PALETTE.length],
        createdAt: Date.now(),
        lastOpened: null
      }
      this.projects.unshift(project)
      this.persist()
      return project
    },

    update(id: string, input: ProjectInput): DocProject | null {
      const index = this.projects.findIndex((item) => item.id === id)
      if (index < 0) return null
      const next: DocProject = {
        ...this.projects[index],
        name: String(input.name).trim(),
        baseUrl: normalizeBaseUrl(input.baseUrl),
        description: String(input.description ?? '').trim()
      }
      this.projects.splice(index, 1, next)
      this.persist()
      return next
    },

    remove(id: string) {
      this.projects = this.projects.filter((item) => item.id !== id)
      if (this.currentId === id) this.setCurrent('')
      this.persist()
    },

    /** 仅清除记录，不影响其它数据；不再自动更新最近访问时间，避免卡片顺序被自动打乱 */
    setCurrent(id: string) {
      this.currentId = id
      writeBucket('currentProject', id)
    },

    /** 记录同步到的元信息（分组数 / 接口数等） */
    updateMeta(id: string, meta: ProjectMeta) {
      const index = this.projects.findIndex((item) => item.id === id)
      if (index < 0) return
      const merged: ProjectMeta = { ...this.projects[index].meta, ...meta, lastSyncAt: Date.now() }
      this.projects.splice(index, 1, { ...this.projects[index], meta: merged })
      this.persist()
    },

    /** 拖拽排序：把指定项目移动到目标下标（以移除该项后的列表为准），并持久化 */
    moveProjectTo(id: string, index: number) {
      const from = this.projects.findIndex((item) => item.id === id)
      if (from < 0) return
      const to = Math.max(0, Math.min(index, this.projects.length - 1))
      if (from === to) return
      const [item] = this.projects.splice(from, 1)
      this.projects.splice(to, 0, item)
      this.persist()
    }
  }
})
