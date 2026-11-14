<script setup lang="ts">
/**
 * 主入口页：项目管理 / 快捷请求 Tab。
 *
 * 应用标识、设置入口与主题切换已抽离到全局窗口工具栏（WindowBar），
 * 本页只保留 Tab 切换与内容区的左右滑动过渡。
 */

import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ProjectListView from '@/views/ProjectListView.vue'
import QuickRequestView from '@/views/QuickRequestView.vue'

const router = useRouter()
const route = useRoute()

type TabKey = 'projects' | 'quick'

/** 从路由恢复当前 Tab：/quick 对应快捷请求，其余为项目管理 */
const activeTab = ref<TabKey>(route.path.startsWith('/quick') ? 'quick' : 'projects')

const currentComponent = computed(() => (activeTab.value === 'projects' ? ProjectListView : QuickRequestView))

// 直接通过浏览器前进/后退切换路由时，同步 Tab 状态
watch(
  () => route.path,
  (path) => {
    activeTab.value = path.startsWith('/quick') ? 'quick' : 'projects'
  }
)

function switchTab(tab: TabKey) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  void router.replace(tab === 'quick' ? '/quick' : '/')
}
</script>

<template>
  <div class="home">
    <!-- Tab 栏：项目管理 / 快捷请求 -->
    <nav class="home__tabs">
      <button
        v-for="tab in (['projects', 'quick'] as TabKey[])"
        :key="tab"
        type="button"
        class="home__tab"
        :class="{ 'is-active': activeTab === tab }"
        @click="switchTab(tab)"
      >
        <el-icon><component :is="tab === 'projects' ? 'Files' : 'Lightning'" /></el-icon>
        <span>{{ tab === 'projects' ? '项目管理' : '快捷请求' }}</span>
      </button>
    </nav>

    <!-- 内容区：左右滑动过渡 -->
    <main class="home__content">
      <transition name="kd-slide">
        <div :key="activeTab" class="home__panel">
          <component :is="currentComponent" />
        </div>
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

/* ------------------------------ Tab 栏 ------------------------------ */
.home__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 18px;
  background: var(--kd-panel);
  border-bottom: 1px solid var(--kd-border);
  flex-shrink: 0;
}

.home__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border: 0;
  background: transparent;
  color: var(--kd-text-3);
  font-size: $font-sm;
  cursor: pointer;
  transition: color 0.18s ease;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: -1px;
    height: 2px;
    background: var(--kd-primary);
    border-radius: 2px;
    transform: scaleX(0);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }

  &:hover {
    color: var(--kd-text);
  }

  &.is-active {
    color: var(--kd-primary);
    font-weight: 600;

    &::after {
      transform: scaleX(1);
    }
  }
}

/* ------------------------------ 内容区：左右滑动过渡 ------------------------------ */
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
