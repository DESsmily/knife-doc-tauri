/**
 * 应用设置 Store
 *
 * 设置项由 Rust 端持有并写入安装目录的 `settings.json`：关闭行为要在窗口关闭事件里
 * 同步生效，不能依赖前端异步回传。浏览器预览模式下降级到 localStorage。
 */

import { defineStore } from 'pinia'

import {
  call,
  isTauri,
  type AppInfo,
  type AppSettings,
  type DataUsage,
  type DirTarget
} from '@/core/tauri'

const LS_SETTINGS = 'knife4doc:settings'

export const DEFAULT_SETTINGS: AppSettings = {
  closeBehavior: 'minimizeToTray',
  theme: 'system',
  requestTimeout: 60000
}

function readBrowserSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(LS_SETTINGS)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeBrowserSettings(settings: AppSettings) {
  try {
    window.localStorage.setItem(LS_SETTINGS, JSON.stringify(settings))
  } catch {
    /* 存储超限时静默失败 */
  }
}

export const useAppStore = defineStore('app', {
  state: () => ({
    ready: false,
    info: null as AppInfo | null,
    settings: { ...DEFAULT_SETTINGS } as AppSettings,
    usage: { dataBytes: 0, cacheBytes: 0, tempBytes: 0 } as DataUsage,
    /** 系统配色偏好，theme = system 时决定实际主题 */
    systemDark: false,
    error: ''
  }),

  getters: {
    /** 是否运行在桌面客户端 */
    isDesktop: () => isTauri,
    /** 实际生效的主题 */
    resolvedTheme(state): 'light' | 'dark' {
      if (state.settings.theme === 'system') return state.systemDark ? 'dark' : 'light'
      return state.settings.theme
    },
    /** 数据根目录展示文案 */
    dataRootLabel(state): string {
      if (!isTauri) return '浏览器 localStorage（仅预览模式）'
      return state.info?.dataRoot ?? ''
    },
    /** 数据是否真的落在安装目录 */
    atInstallDir(state): boolean {
      return state.info?.source === 'install'
    }
  },

  actions: {
    async init() {
      if (this.ready) return
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      this.systemDark = media.matches
      media.addEventListener('change', (event) => {
        this.systemDark = event.matches
      })

      if (isTauri) {
        try {
          this.info = await call<AppInfo>('get_app_info')
          this.settings = { ...DEFAULT_SETTINGS, ...await call<AppSettings>('get_settings') }
          this.usage = await call<DataUsage>('data_usage')
        } catch (error) {
          this.error = `读取客户端信息失败：${String(error)}`
        }
      } else {
        this.settings = readBrowserSettings()
      }
      this.ready = true
    },

    /** 乐观更新：先改内存让界面立刻响应，再落盘。 */
    async saveSettings(patch: Partial<AppSettings>): Promise<boolean> {
      const next: AppSettings = { ...this.settings, ...patch }
      this.settings = next
      if (!isTauri) {
        writeBrowserSettings(next)
        return true
      }
      try {
        this.settings = { ...DEFAULT_SETTINGS, ...await call<AppSettings>('set_settings', { settings: next }) }
        this.error = ''
        return true
      } catch (error) {
        this.error = `设置保存失败：${String(error)}`
        return false
      }
    },

    async refreshUsage() {
      if (!isTauri) return
      try {
        this.usage = await call<DataUsage>('data_usage')
      } catch {
        /* 统计失败不影响主流程 */
      }
    },

    /** 清空缓存 / 临时目录，返回释放的字节数 */
    async clearDir(target: Exclude<DirTarget, 'root'>): Promise<number> {
      const freed = await call<number>('clear_dir', { target })
      await this.refreshUsage()
      return freed
    },

    async openDir(target: DirTarget) {
      await call('open_dir', { target })
    }
  }
})
