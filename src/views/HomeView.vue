<script setup lang="ts">
/**
 * 主页容器：根据路由在「项目管理」与「快捷请求」两个面板之间切换。
 *
 * 应用标识、设置入口、主题切换与顶层导航（项目管理 / 快捷请求 / 同步日志）
 * 已统一上收到全局窗口栏（WindowBar），本页只负责面板渲染与切换过渡。
 */

import { computed } from 'vue'
import { useRoute } from 'vue-router'

import ProjectListView from '@/views/ProjectListView.vue'
import QuickRequestView from '@/views/QuickRequestView.vue'

// 显式声明组件名，供 App.vue 的 keep-alive include 匹配
defineOptions({ name: 'HomeView' })

const route = useRoute()

/** /quick 对应快捷请求，其余（含 /）为项目管理 */
const isQuick = computed(() => route.path.startsWith('/quick'))

const currentComponent = computed(() => (isQuick.value ? QuickRequestView : ProjectListView))
</script>

<template>
  <div class="home">
    <main class="home__content">
      <!-- 两个面板各自缓存：切到快捷请求再切回来时，列表的搜索 / 滚动 / 视图模式都还在 -->
      <transition name="kd-slide">
        <keep-alive>
          <component
            :is="currentComponent"
            :key="isQuick ? 'quick' : 'projects'"
            class="home__panel"
          />
        </keep-alive>
      </transition>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.home {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kd-bg);
}

.home__content {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.home__panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

/* 进入：从右侧滑入；离开：向左滑出 */
.kd-slide-enter-active,
.kd-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.28s ease;
}

.kd-slide-enter-from {
  transform: translateX(40px);
  opacity: 0;
}

.kd-slide-leave-to {
  transform: translateX(-40px);
  opacity: 0;
}
</style>
