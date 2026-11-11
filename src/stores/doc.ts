/**
 * 文档 Store —— 负责分组发现、文档解析与接口索引。
 *
 * 说明：`DocumentParser` 实例持有整份解析结果，体量较大且不可序列化，
 * 因此放在模块级的非响应式缓存中，Store 只保存可响应的元信息。
 */

import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { discover, loadGroupDocument } from '@/core/discover'
import { DocumentParser } from '@/core/parser'
import type { ApiDetail, ApiSummary, ApiTagGroup, DocGroup, DocProject, SchemaModel } from '@/core/types'
import { useProjectStore } from './project'

/** 解析器缓存：key = `${projectId}::${groupId}` */
const parserCache = new Map<string, DocumentParser>()

function cacheKey(projectId: string, groupId: string): string {
  return `${projectId}::${groupId}`
}

/**
 * 会话级记忆「当前访问的接口」，值形如 `<projectId>::<apiId>`。
 * 标签列表本身只存内存、刷新即丢，靠这个 key 才能让刷新后只保留
 * 当前接口那一个标签；用 sessionStorage 而非 data.json，重启应用即失效。
 * 带上 projectId 是因为接口 id 只由「分组 + 路径 + 方法」哈希而来，跨项目可能撞车。
 */
const SS_ACTIVE_API = 'knife4doc:activeApi'

function readRememberedApi(projectId: string): string {
  try {
    const raw = window.sessionStorage.getItem(SS_ACTIVE_API) ?? ''
    const index = raw.indexOf('::')
    if (index < 0) return ''
    return raw.slice(0, index) === projectId ? raw.slice(index + 2) : ''
  } catch {
    return ''
  }
}

function rememberApi(projectId: string, apiId: string) {
  try {
    if (projectId && apiId) window.sessionStorage.setItem(SS_ACTIVE_API, `${projectId}::${apiId}`)
    else window.sessionStorage.removeItem(SS_ACTIVE_API)
  } catch {
    /* 隐私模式等场景下 sessionStorage 不可用，忽略即可 */
  }
}

export const useDocStore = defineStore('doc', {
  state() {
    return {
      /** 当前项目 id */
      projectId: '',
      /** 分组列表 */
      groups: [] as DocGroup[],
      /** 当前选中分组 */
      currentGroupId: '',
      /** 当前选中接口 */
      activeApiId: '',
      /** 右侧主区域展示的面板 */
      activePanel: 'api' as 'api' | 'info' | 'models',
      /**
       * 接口搜索关键字。搜索框位于页面顶栏，左侧接口列表按它过滤，
       * 因此状态提升到 Store，避免两个组件各自维护一份。
       */
      apiKeyword: '',
      /**
       * 已打开的接口标签（顺序即标签栏顺序）。
       * 只存在于内存中、不写入 data.json，因此重启应用后只会剩下
       * 当前访问的那个接口标签；切换分组时同样重置为该分组默认接口。
       */
      openTabs: [] as string[],
      /**
       * 左侧接口列表的定位请求（面包屑跳转用）。
       * target 形如 `tag:用户管理` 或 `api:<apiId>`；nonce 保证重复请求也能触发。
       */
      revealRequest: null as { target: string; nonce: number } | null,
      /** 入口探测中 */
      discovering: false,
      /** 分组文档解析中 */
      parsing: false,
      /** 全局错误信息 */
      error: '',
      /** 探测日志（用于问题排查） */
      logs: [] as string[],
      /** 最近一次成功解析的时间 */
      syncedAt: 0,
      /** 版本号，解析完成后自增，用于触发依赖它的计算属性 */
      revision: 0
    }
  },

  getters: {
    /** 当前分组的解析器 */
    parser(state): DocumentParser | null {
      // 解析器实例保存在非响应式的模块级缓存中，Vue 无法自动追踪其变化。
      // 这里主动读取 revision，使该 getter 在解析/切换分组完成后重新求值。
      void state.revision
      if (!state.projectId || !state.currentGroupId) return null
      return parserCache.get(cacheKey(state.projectId, state.currentGroupId)) ?? null
    },

    currentGroup(state): DocGroup | null {
      return state.groups.find((item) => item.id === state.currentGroupId) ?? null
    },

    /** 当前分组按 tag 聚合的接口分组 */
    tagGroups(): ApiTagGroup[] {
      return this.parser?.tagGroups ?? []
    },

    /** 当前分组的全部接口概要 */
    apiList(): ApiSummary[] {
      return this.parser?.apis ?? []
    },

    /** 当前分组模型定义 */
    models(): SchemaModel[] {
      return this.parser?.schemas ?? []
    },

    /** 接口总数（当前分组） */
    apiCount(): number {
      return this.parser?.apiCount ?? 0
    },

    /** 接口 id -> 概要 的索引 */
    apiMap(): Map<string, ApiSummary> {
      const map = new Map<string, ApiSummary>()
      for (const api of this.apiList) map.set(api.id, api)
      return map
    },

    /** 当前接口详情 */
    activeApi(): ApiDetail | null {
      if (!this.parser || !this.activeApiId) return null
      return this.parser.getDetail(this.activeApiId)
    },

    hasError(state): boolean {
      return Boolean(state.error)
    }
  },

  actions: {
    /** 打开一个项目：先探测入口，再加载第一个分组 */
    async openProject(project: DocProject, options: { force?: boolean } = {}) {
      const projectStore = useProjectStore()
      const isSameProject = this.projectId === project.id
      if (isSameProject && this.groups.length > 0 && !options.force) {
        projectStore.touch(project.id)
        return
      }

      this.projectId = project.id
      this.groups = []
      this.currentGroupId = ''
      this.activeApiId = ''
      this.apiKeyword = ''
      this.openTabs = []
      this.revealRequest = null
      this.error = ''
      this.logs = []
      this.parsing = false
      this.discovering = true
      for (const key of Array.from(parserCache.keys())) {
        if (key.startsWith(`${project.id}::`)) parserCache.delete(key)
      }

      try {
        const result = await discover(project.baseUrl)
        this.groups = result.groups
        this.logs = result.logs
        this.syncedAt = Date.now()

        projectStore.updateMeta(project.id, {
          groupCount: result.groups.length,
          specVersion: result.groups[0]?.swaggerVersion
        })

        if (result.groups.length > 0) {
          await this.selectGroup(result.groups[0].id)
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        this.discovering = false
      }
    },

    /** 选择分组；未加载则拉取并解析 */
    async selectGroup(groupId: string) {
      this.currentGroupId = groupId
      this.activeApiId = ''
      this.activePanel = 'api'
      this.openTabs = []
      this.revealRequest = null
      const group = this.groups.find((item) => item.id === groupId)
      if (!group) return

      const key = cacheKey(this.projectId, groupId)
      if (parserCache.has(key)) {
        group.loaded = true
        this.revision++
        this.selectFirstApi()
        return
      }

      this.parsing = true
      this.error = ''
      try {
        const { doc } = await loadGroupDocument(group)
        const parser = new DocumentParser(doc, { groupId: group.id, sourceUrl: group.url })
        parserCache.set(key, markRaw(parser))

        group.loaded = true
        group.error = null
        group.specKind = parser.specKind
        group.title = parser.info.title
        group.apiVersion = parser.info.version
        group.description = parser.info.description
        group.host = parser.info.host
        group.basePath = parser.info.basePath
        group.apiCount = parser.apiCount

        this.syncedAt = Date.now()
        this.revision++

        const projectStore = useProjectStore()
        const total = this.groups.reduce((sum, item) => sum + (item.apiCount || 0), 0)
        projectStore.updateMeta(this.projectId, {
          title: parser.info.title,
          apiCount: total,
          specVersion: group.swaggerVersion
        })

        this.selectFirstApi()
      } catch (error) {
        group.error = error instanceof Error ? error.message : String(error)
        group.loaded = false
        this.error = group.error
        throw error
      } finally {
        this.parsing = false
      }
    },

    /** 重新拉取当前分组文档 */
    async reloadCurrentGroup() {
      if (!this.currentGroupId) return
      const groupId = this.currentGroupId
      parserCache.delete(cacheKey(this.projectId, groupId))
      const group = this.groups.find((item) => item.id === groupId)
      if (group) {
        group.loaded = false
        group.error = null
      }
      await this.selectGroup(groupId)
    },

    /** 重新探测入口（分组可能变化） */
    async reloadAll() {
      const projectStore = useProjectStore()
      const project = projectStore.projects.find((item) => item.id === this.projectId)
      if (!project) return
      await this.openProject(project, { force: true })
    },

    /**
     * 分组（重新）加载完成时的默认选中。
     * 因为标签只存内存，这里同时把标签栏收敛成「当前访问的这一个接口」：
     * 优先沿用会话里记住的接口（刷新后仍在同一分组时即它），否则取第一个接口。
     */
    selectFirstApi() {
      const list = this.apiList
      if (list.length === 0) {
        this.openTabs = []
        this.activeApiId = ''
        rememberApi(this.projectId, '')
        return
      }
      const remembered = readRememberedApi(this.projectId)
      const target = list.find((item) => item.id === remembered) ?? list[0]
      this.activeApiId = target.id
      this.openTabs = [target.id]
      rememberApi(this.projectId, target.id)
    },

    /** 选中接口：写标签栏 + 左侧列表定位 */
    setActiveApi(apiId: string) {
      if (!apiId) return
      this.activeApiId = apiId
      this.activePanel = 'api'
      this.openApiTab(apiId)
      rememberApi(this.projectId, apiId)
      // 无论从左侧列表、搜索、标签栏还是弹窗里选中，都让左侧列表滚动到该接口并展开其所在模块
      this.revealInSidebar(`api:${apiId}`)
    },

    /** 打开接口标签：已存在则只置为激活，不存在才追加到末尾 */
    openApiTab(apiId: string) {
      if (!apiId || this.openTabs.includes(apiId)) return
      this.openTabs.push(apiId)
    },

    /** 关闭接口标签；关掉的若是当前标签，则激活相邻标签 */
    closeApiTab(apiId: string) {
      const index = this.openTabs.indexOf(apiId)
      if (index < 0) return
      this.openTabs.splice(index, 1)
      if (this.activeApiId !== apiId) return
      const next = this.openTabs[index] ?? this.openTabs[index - 1]
      if (next) this.setActiveApi(next)
      else {
        this.activeApiId = ''
        this.activePanel = 'api'
        rememberApi(this.projectId, '')
      }
    },

    /**
     * 请求左侧接口列表定位：展开目标所在模块并滚动到它的位置。
     * 由 DocSidebar 监听 revealRequest 后落到真实 DOM 上执行。
     */
    revealInSidebar(target: string) {
      if (!target) return
      this.revealRequest = { target, nonce: Date.now() + Math.random() }
    },

    /** 切换右侧面板 */
    setPanel(panel: 'api' | 'info' | 'models') {
      this.activePanel = panel
    },

    /** 切换项目时清空状态 */
    reset() {
      this.projectId = ''
      this.groups = []
      this.currentGroupId = ''
      this.activeApiId = ''
      this.activePanel = 'api'
      this.apiKeyword = ''
      this.openTabs = []
      this.revealRequest = null
      this.error = ''
      this.logs = []
      this.discovering = false
      this.parsing = false
    }
  }
})
