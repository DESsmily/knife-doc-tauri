<script setup lang="ts">
/**
 * 全局底部状态栏（所有页面共用）。
 *
 * 展示运行状态摘要：左侧为后台监听与网络模式，右侧为可用快捷键与文档引擎。
 * 这里只做「当前状态」的展示，不承担任何业务操作，避免干扰页面内的交互。
 */

import { computed } from 'vue'

import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

/** 网络模式：桌面端请求由本机进程直连内网服务，浏览器预览走普通跨域 */
const networkLabel = computed(() => (appStore.isDesktop ? '局域网离线' : '浏览器预览'))

/**
 * 快捷键提示：生产环境已屏蔽 WebView 的 F5 / Ctrl+R 整页刷新，
 * 因此只在开发态提示 F5，发布版提示真正可用的页面搜索。
 */
const shortcutLabel = computed(() => (import.meta.env.PROD ? 'Ctrl+F 页面搜索' : 'F5 刷新'))
</script>

<template>
  <footer class="app-status">
    <div class="app-status__group">
      <span class="app-status__item">
        <i class="app-status__dot" />
        后台监听：就绪
      </span>
      <span class="app-status__sep" />
      <span class="app-status__item">网络模式：{{ networkLabel }}</span>
    </div>

    <div class="app-status__group">
      <span class="app-status__item">快捷键：{{ shortcutLabel }}</span>
      <span class="app-status__sep" />
      <span class="app-status__item">文档引擎：Knife4j-Core</span>
    </div>
  </footer>
</template>

<style lang="scss" scoped>
.app-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 28px;
  padding: 0 14px;
  background: var(--kd-panel);
  border-top: 1px solid var(--kd-border);
  font-size: 11px;
  color: var(--kd-text-3);
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
}

.app-status__group {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.app-status__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.app-status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kd-success);
  flex-shrink: 0;
}

.app-status__sep {
  width: 1px;
  height: 12px;
  background: var(--kd-border);
  flex-shrink: 0;
}

@include respond-to($bp-md) {
  .app-status__group:last-child {
    display: none;
  }
}
</style>
