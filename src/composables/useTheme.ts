/**
 * 主题（跟随系统 / 亮色 / 暗色）
 *
 * 主题是一项应用设置，真实值存在 Rust 侧的 settings.json，这里只负责把它翻译成
 * DOM 上的 dark 类。watcher 挂在独立的 effect scope 上：它只在第一次调用时建立，
 * 若跟着某个页面的作用域走，切换到别的页面后 watcher 会被自动停止，主题就再也不生效了。
 */

import { computed, effectScope, watch } from 'vue'

import type { ThemeModeSetting } from '@/core/tauri'
import { useAppStore } from '@/stores/app'

let bound = false

function applyToDom(mode: 'light' | 'dark') {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
}

export function useTheme() {
  const app = useAppStore()

  if (!bound) {
    bound = true
    effectScope(true).run(() => watch(() => app.resolvedTheme, applyToDom, { immediate: true }))
  }

  const isDark = computed(() => app.resolvedTheme === 'dark')

  function toggleTheme() {
    void app.saveSettings({ theme: isDark.value ? 'light' : 'dark' })
  }

  function setTheme(value: ThemeModeSetting) {
    if (value === app.settings.theme) return
    void app.saveSettings({ theme: value })
  }

  return { isDark, toggleTheme, setTheme, theme: computed(() => app.settings.theme) }
}
