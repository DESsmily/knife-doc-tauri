<script setup lang="ts">
/** 顶层页面导航：项目管理 / 快捷请求 / 设置 */

import { useRoute } from 'vue-router'

const route = useRoute()

const ITEMS = [
  { path: '/', label: '项目管理', icon: 'Files' },
  { path: '/quick', label: '快捷请求', icon: 'Lightning' },
  { path: '/setting', label: '设置', icon: 'Setting' }
]

function isActive(path: string): boolean {
  return path === '/' ? route.path === '/' : route.path.startsWith(path)
}
</script>

<template>
  <nav class="top-nav">
    <RouterLink
      v-for="item in ITEMS"
      :key="item.path"
      :to="item.path"
      class="top-nav__item"
      :class="{ 'is-active': isActive(item.path) }"
    >
      <el-icon><component :is="item.icon" /></el-icon>
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style lang="scss" scoped>
.top-nav {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--kd-panel-3);
  border-radius: 10px;

  &__item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    font-size: $font-sm;
    color: var(--kd-text-2);
    text-decoration: none;
    border-radius: 8px;
    transition: all 0.15s ease;

    &:hover {
      color: var(--kd-primary);
    }

    &.is-active {
      color: var(--kd-primary);
      background: var(--kd-panel);
      box-shadow: var(--kd-shadow-sm);
    }
  }
}
</style>
