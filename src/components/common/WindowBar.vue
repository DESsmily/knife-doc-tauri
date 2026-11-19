<script setup lang="ts">
/**
 * 自定义窗口栏 = 全局顶部导航（固定在所有页面顶部，所有页面共用）。
 *
 * 应用使用自定义窗口（decorations: false，无原生标题栏），本栏同时承担两件事：
 *  - 窗口标题栏：整条栏为窗口拖拽区域，右侧提供最小化 / 最大化 / 关闭；
 *  - 应用级导航：应用标识 +「项目管理 / 快捷请求 / 同步日志」，
 *    右侧为设置入口与主题切换。
 *
 * 设置入口直接放在窗口栏上，不使用下拉菜单，也不依赖原生窗口。
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useTheme } from '@/composables/useTheme'
import {
  closeWindow,
  isTauri,
  isWindowMaximized,
  minimizeWindow,
  onAppEvent,
  toggleMaximizeWindow
} from '@/core/tauri'

interface NavItem {
  path: string
  label: string
  icon: string
  /** 该导航项在哪些路由下保持高亮（接口文档属于「项目管理」的下级页面） */
  active: (path: string) => boolean
}

const route = useRoute()
const router = useRouter()
const { isDark, toggleTheme } = useTheme()

/**
 * 「项目管理」段内最近停留的地址：项目列表 `/` 或某个文档 `/doc/:id`。
 *
 * 从快捷请求 / 同步日志切回「项目管理」时直接回到刚才的文档，避免总是落回列表页；
 * WindowBar 常驻于所有页面，这份记忆随会话存在，不需要落盘。
 */
const lastProjectPath = ref('/')

watch(
  () => route.path,
  (path) => {
    if (path === '/' || path.startsWith('/doc')) lastProjectPath.value = path
  },
  { immediate: true }
)

const navItems = computed<NavItem[]>(() => [
  {
    path: lastProjectPath.value,
    label: '项目管理',
    icon: 'Files',
    active: (path) => path === '/' || path.startsWith('/doc')
  },
  { path: '/quick', label: '快捷请求', icon: 'Lightning', active: (path) => path.startsWith('/quick') },
  { path: '/sync-log', label: '同步日志', icon: 'Clock', active: (path) => path.startsWith('/sync-log') }
])

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
  <header class="app-bar">
    <!-- 应用标识（拖拽区域） -->
    <div class="app-bar__brand">
      <div class="app-bar__logo">KD</div>
      <span class="app-bar__name">Knife Doc Tool</span>
    </div>

    <span class="app-bar__split" />

    <!-- 应用级导航 -->
    <nav class="app-bar__nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.label"
        :to="item.path"
        class="app-bar__link"
        :class="{ 'is-active': item.active(route.path) }"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- 右侧：设置、主题、窗口控制 -->
    <div class="app-bar__actions">
      <el-tooltip content="设置" placement="bottom">
        <button type="button" class="app-bar__icon" aria-label="设置" @click="goSettings">
          <el-icon><Setting /></el-icon>
        </button>
      </el-tooltip>

      <el-tooltip :content="isDark ? '切换到亮色' : '切换到暗色'" placement="bottom">
        <button type="button" class="app-bar__icon" aria-label="切换主题" @click="toggleTheme">
          <el-icon><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
        </button>
      </el-tooltip>

      <!-- 窗口控制按钮（桌面客户端） -->
      <div v-if="showWinControls" class="app-bar__win">
        <button type="button" class="win-ctrl" title="最小化" @click="handleMinimize">
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
        <button type="button" class="win-ctrl win-ctrl--close" title="关闭" @click="handleClose">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.app-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 0 0 14px;
  background: var(--kd-panel);
  border-bottom: 1px solid var(--kd-border);
  flex-shrink: 0;
  z-index: $z-header;
  // 整条栏可拖动窗口
  -webkit-app-region: drag;
  user-select: none;
}

/* ------------------------------ 应用标识 ------------------------------ */

.app-bar__brand {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}

.app-bar__logo {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--kd-primary), #6f5cf6);
  color: #fff;
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 0.4px;
}

.app-bar__name {
  font-size: $font-md;
  font-weight: 700;
  color: var(--kd-text);
  letter-spacing: 0.3px;
}

.app-bar__split {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--kd-border);
  flex-shrink: 0;
}

/* ------------------------------ 导航 ------------------------------ */

.app-bar__nav {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  // 导航必须可点击，且不参与窗口拖拽
  -webkit-app-region: no-drag;
}

.app-bar__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: $font-sm;
  color: var(--kd-text-2);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease;

  .el-icon {
    font-size: 15px;
    color: var(--kd-text-3);
    transition: color 0.16s ease;
  }

  &:hover {
    color: var(--kd-text);
    background: var(--kd-panel-2);

    .el-icon {
      color: var(--kd-text-2);
    }
  }

  &.is-active {
    color: var(--kd-primary);
    font-weight: 600;
    background: var(--kd-primary-soft);
    border-color: rgba(79, 124, 255, 0.35);

    .el-icon {
      color: var(--kd-primary);
    }
  }
}

/* ------------------------------ 右侧操作区 ------------------------------ */

.app-bar__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  // 右侧操作区不可拖动，保证按钮可点击
  -webkit-app-region: no-drag;
}

.app-bar__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--kd-text-2);
  font-size: 16px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    background: var(--kd-panel-3);
    color: var(--kd-text);
  }
}

/* ------------------------------ 窗口控制按钮 ------------------------------ */

.app-bar__win {
  display: flex;
  align-items: center;
  margin-left: 6px;
  padding-left: 6px;
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

@include respond-to($bp-md) {
  .app-bar__link span {
    display: none;
  }
}
</style>
