/**
 * ElMessage 全局封装。
 *
 * 统一调用入口，频繁触发时只保留最新一条：展示新提示前先关闭上一条实例，
 * 避免短时间内多次操作导致多条提示叠加堆积。
 *
 * 用法与原 ElMessage 一致：
 *   message.success('已保存')
 *   message.error('保存失败')
 *   message[ok ? 'success' : 'warning']('地址已复制')
 */

import { ElMessage, type MessageHandler, type MessageOptions } from 'element-plus'

/** 当前正在展示的提示实例 */
let currentInstance: MessageHandler | null = null

/** 支持的提示类型 */
type MessageKind = 'success' | 'warning' | 'info' | 'error'

/**
 * 生成指定类型的提示方法。
 * 每次调用先关闭上一条实例，再弹出新提示，保证界面上始终只有一条。
 */
function make(kind: MessageKind) {
  return (content: string, options?: Partial<MessageOptions>): MessageHandler => {
    currentInstance?.close()
    currentInstance = ElMessage({ message: content, type: kind, ...options })
    return currentInstance
  }
}

export const message = {
  success: make('success'),
  warning: make('warning'),
  info: make('info'),
  error: make('error')
}

export type { MessageHandler, MessageOptions }
