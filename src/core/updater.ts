/**
 * 应用自动更新（GitHub Releases 源）
 *
 * 直接调用 tauri-plugin-updater 暴露的命令，不依赖 @tauri-apps/plugin-updater 包，
 * 避免网络问题导致无法安装前端包。浏览器预览模式下自动降级为空操作。
 */

import { Channel, invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/core/tauri'

/** 更新元信息（plugin:updater|check 返回） */
export interface UpdateInfo {
  /** 更新资源标识，下载/安装时需要 */
  rid: number
  /** 当前应用版本 */
  currentVersion: string
  /** 新版本号 */
  version: string
  /** 发布日期 */
  date: string | null
  /** 更新说明（release notes） */
  body: string
}

/** 下载进度：downloaded 为已下载字节数，total 为总字节数（服务端未返回时为 null） */
export interface DownloadProgress {
  downloaded: number
  total: number | null
}

/** 检查是否有可用更新；无更新或非桌面端时返回 null */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null
  try {
    const metadata = await invoke<Record<string, unknown> | null>('plugin:updater|check')
    if (!metadata) return null
    return {
      rid: Number(metadata.rid ?? 0),
      currentVersion: String(metadata.currentVersion ?? ''),
      version: String(metadata.version ?? ''),
      date: metadata.date != null ? String(metadata.date) : null,
      body: String(metadata.body ?? '')
    }
  } catch {
    return null
  }
}

/**
 * 下载并安装更新。onProgress 会收到累计已下载字节数与总字节数（总量未知时为 null），
 * 便于界面展示真实进度百分比。
 */
export async function downloadAndInstallUpdate(
  rid: number,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  if (!isTauri) return

  const channel = new Channel<{ event: string; data: { chunkLength?: number; contentLength?: number } }>()
  let downloaded = 0
  let total: number | null = null

  if (onProgress) {
    channel.onmessage = (event) => {
      const name = event?.event
      if (name === 'Started') {
        // Started 事件带出更新包总大小，用于计算百分比
        total = typeof event.data?.contentLength === 'number' ? event.data.contentLength : null
        onProgress({ downloaded, total })
      } else if (name === 'Progress') {
        // Progress 每次只带本块长度，需要在此累计
        downloaded += event.data?.chunkLength ?? 0
        onProgress({ downloaded, total })
      }
    }
  }

  await invoke('plugin:updater|download_and_install', { onEvent: channel, rid })
}
