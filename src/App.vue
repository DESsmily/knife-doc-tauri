<script setup lang="ts">
// 数据与设置已在 main.ts 挂载前加载完成，这里只负责渲染路由。
// WindowBar 为全局窗口工具栏（同时承载应用级导航），StatusBar 为全局底部状态栏，
// 二者固定在所有页面上下两端，页面只负责自身内容。
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import WindowBar from '@/components/common/WindowBar.vue'
import StatusBar from '@/components/common/StatusBar.vue'
import PageSearchBox from '@/components/common/PageSearchBox.vue'
import UpdateDialog from '@/components/common/UpdateDialog.vue'
import { onAppEvent } from '@/core/tauri'
import { useUpdate } from '@/composables/useUpdate'

const router = useRouter()
const { autoCheck } = useUpdate()

/**
 * 需要保留状态的页面：
 *  - HomeView（项目列表 / 快捷请求）
 *  - DocView（接口文档）
 * 从快捷请求、同步日志或设置页切回时直接复用原实例，不再重新拉取文档、
 * 也不会丢掉已打开的接口标签与滚动位置。同步日志页不缓存，保证每次进入都是最新数据。
 */
const CACHED_VIEWS = ['HomeView', 'DocView']

let unlistenNavigateSettings: (() => void) | null = null

/** 监听托盘菜单「设置」触发的导航事件 */
onMounted(async () => {
  unlistenNavigateSettings = await onAppEvent('navigate-settings', () => {
    void router.push({ name: 'setting' })
  })

  // 启动后延迟检查更新：发现新版本时弹出更新说明，由用户决定是否立即更新
  void autoCheck()
})

onBeforeUnmount(() => {
  unlistenNavigateSettings?.()
  unlistenNavigateSettings = null
})
</script>

<template>
  <div class="app-shell">
    <WindowBar />
    <PageSearchBox />
    <!-- 内容容器撑满剩余高度并允许局部滚动，避免页面级溢出 -->
    <div class="app-shell__content">
      <router-view v-slot="{ Component }">
        <transition name="kd-fade" mode="out-in">
          <keep-alive :include="CACHED_VIEWS">
            <component :is="Component" class="app-shell__page" />
          </keep-alive>
        </transition>
      </router-view>
    </div>

    <!-- 全局底部状态栏：运行状态摘要 -->
    <StatusBar />

    <!-- 全局更新弹框：启动自动检查与设置页手动检查共用 -->
    <UpdateDialog />
  </div>
</template>

<style lang="scss" scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 应用底色画在这里而非 body：桌面端 body 需保持透明以配合透明窗口的启动淡入 */
  background: var(--kd-bg);
  transition: background-color 0.2s ease;
}

/* 内容区：撑满窗口栏下方剩余空间，子页面在其内部局部滚动而非整页溢出 */
.app-shell__content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-shell__page {
  flex: 1;
  min-height: 0;
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
