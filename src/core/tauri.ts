/**
 * Tauri 桥接层。
 *
 * 应用同时支持两种运行环境：
 *  - 桌面客户端（Tauri）：数据落在安装目录，网络请求由 Rust 透明转发。
 *  - 纯浏览器（`pnpm dev` 直接用浏览器打开）：仅用于 UI 预览，数据退回 localStorage，
 *    跨域依赖目标服务自身的 CORS 配置。
 */

import { invoke } from '@tauri-apps/api/core'

/** 是否运行在 Tauri 客户端内 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

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
