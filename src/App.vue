<script setup lang="ts">
// 数据与设置已在 main.ts 挂载前加载完成，这里只负责渲染路由。
// WindowBar 为全局窗口工具栏，固定在所有页面顶部，提供应用标识与窗口菜单。
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import WindowBar from '@/components/common/WindowBar.vue'
import { onAppEvent } from '@/core/tauri'

const router = useRouter()

let unlistenNavigateSettings: (() => void) | null = null

/** 监听托盘菜单「设置」触发的导航事件 */
onMounted(async () => {
  unlistenNavigateSettings = await onAppEvent('navigate-settings', () => {
    void router.push({ name: 'setting' })
  })
})

onBeforeUnmount(() => {
  unlistenNavigateSettings?.()
  unlistenNavigateSettings = null
})
</script>

<template>
  <div class="app-shell">
    <WindowBar />
    <router-view v-slot="{ Component }">
      <transition name="kd-fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </div>
</template>

<style lang="scss" scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.kd-fade-enter-active,
.kd-fade-leave-active {
  transition: opacity 0.18s ease;
}

.kd-fade-enter-from,
.kd-fade-leave-to {
  opacity: 0;
}
</style>
