<script setup lang="ts">
/**
 * 自定义窗口栏：固定在应用顶部，所有页面共用。
 *
 * 应用使用自定义窗口（decorations: false，无原生标题栏），本栏承担窗口标题栏角色：
 *  - 左侧：应用标识，整条栏为窗口拖拽区域；
 *  - 右侧：设置入口、主题切换、窗口控制按钮（最小化 / 最大化 / 关闭）。
 * 设置入口直接放在窗口栏上，不使用下拉菜单。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useTheme } from '@/composables/useTheme'
import {
  closeWindow,
  isTauri,
  isWindowMaximized,
  minimizeWindow,
  onAppEvent,
  toggleMaximizeWindow
} from '@/core/tauri'

const router = useRouter()
const { isDark, toggleTheme } = useTheme()

/** 是否最大化（决定最大化按钮图标） */
const isMaximized = ref(false)

/** 窗口控制按钮仅在桌面客户端显示，浏览器预览下隐藏 */
const showWinControls = isTauri

let unlistenMaximized: (() => void) | null = null

async function refreshMaximized() {
  isMaximized.value = await isWindowMaximized()
}

function goSettings() {
  void router.push({ name: 'setting' })
}

async function handleMinimize() {
  await minimizeWindow()
}

async function handleToggleMaximize() {
  await toggleMaximizeWindow()
  await refreshMaximized()
}

async function handleClose() {
  await closeWindow()
}

onMounted(async () => {
  if (!isTauri) return
  await refreshMaximized()
  // 监听窗口最大化状态变化，刷新按钮图标
  unlistenMaximized = await onAppEvent('tauri://change-maximized', refreshMaximized)
})

onBeforeUnmount(() => {
  unlistenMaximized?.()
  unlistenMaximized = null
})
</script>

<template>
  <header class="win-bar">
    <!-- 左侧：应用标识（拖拽区域） -->
    <div class="win-bar__brand">
      <div class="win-bar__logo">KD</div>
      <span class="win-bar__name">Knife Doc Tool</span>
    </div>

    <!-- 右侧：设置、主题切换、窗口控制 -->
    <div class="win-bar__actions">
      <el-button link class="win-bar__btn" @click="goSettings">
        <el-icon><Setting /></el-icon>
        <span>设置</span>
      </el-button>
      <el-tooltip :content="isDark ? '切换到亮色' : '切换到暗色'" placement="bottom">
        <el-button link class="win-bar__btn win-bar__btn--icon" @click="toggleTheme">
          <el-icon><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
        </el-button>
      </el-tooltip>

      <!-- 窗口控制按钮 -->
      <div v-if="showWinControls" class="win-bar__win-controls">
        <button
          type="button"
          class="win-ctrl"
          title="最小化"
          @click="handleMinimize"
        >
          <el-icon><Minus /></el-icon>
        </button>
        <button
          type="button"
          class="win-ctrl"
          :title="isMaximized ? '还原' : '最大化'"
          @click="handleToggleMaximize"
        >
          <el-icon><component :is="isMaximized ? 'Aim' : 'FullScreen'" /></el-icon>
        </button>
        <button
          type="button"
          class="win-ctrl win-ctrl--close"
          title="关闭"
          @click="handleClose"
        >
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.win-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 0 0 16px;
  background: var(--kd-panel);
  border-bottom: 1px solid var(--kd-border);
  flex-shrink: 0;
  z-index: $z-header;
  // 整条窗口栏可拖动窗口
  -webkit-app-region: drag;
  user-select: none;
}

.win-bar__brand {
  display: flex;
  align-items: center;
  gap: 9px;
}

.win-bar__logo {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: $radius-sm;
  background: linear-gradient(135deg, var(--kd-primary), #8a5cf6);
  color: #fff;
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 0.4px;
}

.win-bar__name {
  font-size: $font-sm;
  font-weight: 700;
  color: var(--kd-text);
  letter-spacing: 0.3px;
}

.win-bar__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  // 右侧操作区不可拖动，保证按钮可点击
  -webkit-app-region: no-drag;
}

.win-bar__btn {
  gap: 4px;
  font-size: $font-sm;
}

.win-bar__btn--icon {
  font-size: 16px;
}

/* 窗口控制按钮 */
.win-bar__win-controls {
  display: flex;
  align-items: center;
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--kd-border);
}

.win-ctrl {
  display: grid;
  place-items: center;
  width: 38px;
  height: 34px;
  border: 0;
  background: transparent;
  color: var(--kd-text-2);
  font-size: 14px;
  cursor: pointer;
  border-radius: $radius-sm;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    background: var(--kd-panel-3);
    color: var(--kd-text);
  }

  &--close:hover {
    background: #e8453c;
    color: #fff;
  }
}
</style>
