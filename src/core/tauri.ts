/**
 * Tauri 桥接层。
 *
 * 应用同时支持两种运行环境：
 *  - 桌面客户端（Tauri）：数据落在安装目录，网络请求由 Rust 透明转发。
 *  - 纯浏览器（`pnpm dev` 直接用浏览器打开）：仅用于 UI 预览，数据退回 localStorage，
 *    跨域依赖目标服务自身的 CORS 配置。
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 是否运行在 Tauri 客户端内 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * 监听 Rust 端发射的事件；浏览器预览模式下返回一个空的清理函数。
 * 用于托盘菜单等原生侧触发的前端导航指令。
 */
export async function onAppEvent(event: string, handler: () => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {}
  return listen(event, () => handler())
}

export type CloseBehavior = 'minimizeToTray' | 'quit'
export type ThemeModeSetting = 'system' | 'light' | 'dark'
export type DataRootSource = 'env' | 'install' | 'appData'

export interface AppSettings {
  closeBehavior: CloseBehavior
  theme: ThemeModeSetting
  requestTimeout: number
}

export interface AppInfo {
  productName: string
  version: string
  os: string
  arch: string
  dataRoot: string
  cacheDir: string
  tempDir: string
  dataFile: string
  settingsFile: string
  source: DataRootSource
  installCandidate: string | null
  closeBehavior: CloseBehavior
}

export interface DataUsage {
  dataBytes: number
  cacheBytes: number
  tempBytes: number
}

export type DirTarget = 'root' | 'cache' | 'temp'

/** 调用 Rust 命令；浏览器环境下给出明确错误而不是静默失败。 */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error(`「${command}」仅在桌面客户端可用`)
  return invoke<T>(command, args)
}

/* ------------------------------------------------------------------ */
/* 自定义窗口控制（decorations: false 时由前端窗口栏提供）              */
/* ------------------------------------------------------------------ */

/** 最小化窗口 */
export async function minimizeWindow(): Promise<void> {
  if (!isTauri) return
  await getCurrentWindow().minimize()
}

/** 切换最大化 / 还原 */
export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri) return
  await getCurrentWindow().toggleMaximize()
}

/** 关闭窗口 */
export async function closeWindow(): Promise<void> {
  if (!isTauri) return
  await getCurrentWindow().close()
}

/** 当前是否处于最大化状态 */
export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri) return false
  return getCurrentWindow().isMaximized()
}
