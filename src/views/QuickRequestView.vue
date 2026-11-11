<script setup lang="ts">
/**
 * 快捷请求页：左侧分类树 + 右侧「已打开标签 + 请求编辑器」。
 */

import { computed, onMounted } from 'vue'

import RequestEditor from '@/components/quick/RequestEditor.vue'
import RequestTabs from '@/components/quick/RequestTabs.vue'
import RequestTree from '@/components/quick/RequestTree.vue'
import TopNav from '@/components/common/TopNav.vue'
import { useQuickRequestStore } from '@/stores/quickRequest'

const store = useQuickRequestStore()
const active = computed(() => store.active)

onMounted(() => {
  if (store.tabs.length === 0 && store.requests.length > 0) store.open(store.requests[0].id)
})
</script>

<template>
  <div class="quick-page">
    <header class="quick-page__header">
      <div class="quick-page__brand">
        <div class="brand-logo">KD</div>
        <div class="brand-text">
          <h1>快捷请求</h1>
          <p>不依赖接口文档的临时请求，请求由 Rust 进程发出，不受跨域限制</p>
        </div>
      </div>
      <div class="quick-page__actions">
        <TopNav />
      </div>
    </header>

    <div class="quick-page__main">
      <RequestTree />
      <section class="quick-page__content">
        <RequestTabs />
        <RequestEditor :request="active" />
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.quick-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--kd-bg);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: $header-height;
    padding: 0 20px;
    background: var(--kd-panel);
    border-bottom: 1px solid var(--kd-border);
  }

  &__brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  &__actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  &__main {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  &__content {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
  }
}

.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--kd-primary), #2f3aa8);
  border-radius: 9px;
}

.brand-text {
  h1 {
    margin: 0;
    font-size: $font-lg;
  }

  p {
    margin: 0;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}
</style>
