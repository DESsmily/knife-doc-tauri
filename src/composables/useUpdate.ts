/**
 * 应用更新中心
 *
 * 把「检查更新 → 弹框展示更新说明 → 下载安装」的流程与状态集中到这里，
 * 状态挂在模块作用域上（全应用单例），因此启动时的自动检查与设置页的手动检查
 * 共用同一个更新弹框（`UpdateDialog`），只有一套更新交互，不会出现两处提示打架。
 *
 * 与旧行为最大的区别：发现新版本不再静默下载安装，而是弹出更新说明，
 * 由用户自行选择「稍候更新」或「立即更新」。
 */

import { ref } from 'vue'

import { isTauri } from '@/core/tauri'
import { checkForUpdate, downloadAndInstallUpdate, type UpdateInfo } from '@/core/updater'

/** 弹框所处阶段 */
export type UpdatePhase = 'notice' | 'downloading' | 'installed' | 'error'

/** 弹框是否可见 */
const visible = ref(false)
/** 可用的新版本信息，未发现更新时为 null */
const info = ref<UpdateInfo | null>(null)
/** 当前阶段 */
const phase = ref<UpdatePhase>('notice')
/** 已下载字节数 */
const downloaded = ref(0)
/** 更新包总字节数（未知时为 null） */
const total = ref<number | null>(null)
/** 下载失败时的错误信息 */
const errorText = ref('')

/** 打开更新弹框并展示指定版本的更新说明 */
function open(update: UpdateInfo) {
  info.value = update
  phase.value = 'notice'
  downloaded.value = 0
  total.value = null
  errorText.value = ''
  visible.value = false
  // 下一帧再打开，保证弹框每次都能播放出现动画
  requestAnimationFrame(() => {
    visible.value = true
  })
}

/** 关闭弹框（稍候更新 / 安装完成后关闭） */
function close() {
  visible.value = false
}

/** 立即更新：下载并安装更新包 */
async function install(): Promise<void> {
  const current = info.value
  if (!current) return
  phase.value = 'downloading'
  downloaded.value = 0
  total.value = null
  try {
    await downloadAndInstallUpdate(current.rid, (progress) => {
      downloaded.value = progress.downloaded
      total.value = progress.total
    })
    phase.value = 'installed'
  } catch (error) {
    phase.value = 'error'
    errorText.value = String(error)
  }
}

/**
 * 启动后自动检查更新：发现新版本时弹出更新说明，交由用户决定是否立即更新。
 * delay 用于把检查推迟到窗口展示稳定之后，避免拖慢启动。
 */
async function autoCheck(delay = 3000): Promise<void> {
  if (!isTauri) return
  await new Promise((resolve) => setTimeout(resolve, delay))
  try {
    const found = await checkForUpdate()
    if (found) open(found)
  } catch {
    /* 网络异常时静默失败，用户可手动在设置页检查 */
  }
}

/** 手动检查更新：返回是否发现新版本（设置页据此提示「已是最新」） */
async function checkManually(): Promise<boolean> {
  const found = await checkForUpdate()
  if (found) {
    open(found)
    return true
  }
  return false
}

export function useUpdate() {
  return {
    visible,
    info,
    phase,
    downloaded,
    total,
    errorText,
    open,
    close,
    install,
    autoCheck,
    checkManually
  }
}
