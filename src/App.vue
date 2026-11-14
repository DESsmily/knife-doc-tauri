<script setup lang="ts">
// 数据与设置已在 main.ts 挂载前加载完成，这里只负责渲染路由。
// WindowBar 为全局窗口工具栏，固定在所有页面顶部，提供应用标识与窗口栏。
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import WindowBar from '@/components/common/WindowBar.vue'
import { onAppEvent, isTauri } from '@/core/tauri'
import { checkForUpdate, downloadAndInstallUpdate } from '@/core/updater'

const router = useRouter()

let unlistenNavigateSettings: (() => void) | null = null

/** 监听托盘菜单「设置」触发的导航事件 */
onMounted(async () => {
  unlistenNavigateSettings = await onAppEvent('navigate-settings', () => {
    void router.push({ name: 'setting' })
  })

  // 启动后延迟检查更新，避免影响启动速度
  void autoCheckUpdate()
})

onBeforeUnmount(() => {
  unlistenNavigateSettings?.()
  unlistenNavigateSettings = null
})

/** 自动检查更新：发现新版本后自动下载，下载完成后提示重启 */
async function autoCheckUpdate() {
  if (!isTauri) return
  // 等待 3 秒再检查，给用户一个流畅的启动体验
  await new Promise((resolve) => setTimeout(resolve, 3000))
  try {
    const info = await checkForUpdate()
    if (!info) return
    ElMessage.info(`发现新版本 ${info.version}，正在自动下载更新…`)
    await downloadAndInstallUpdate(info.rid, () => {
      /* 进度静默更新，下载完成后统一提示 */
    })
    ElMessage.success('更新已下载并安装，请重启应用以使用新版本')
  } catch {
    /* 网络异常时静默失败，用户可手动在设置页检查 */
  }
}
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
