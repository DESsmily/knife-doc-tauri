<script setup lang="ts">
/**
 * 快捷请求页内容：左侧分类树 + 右侧「已打开标签 + 请求编辑器」。
 * 顶部菜单栏与 Tab 由 HomeView 统一提供。
 */

import { computed, onMounted } from 'vue'

import RequestEditor from '@/components/quick/RequestEditor.vue'
import RequestTabs from '@/components/quick/RequestTabs.vue'
import RequestTree from '@/components/quick/RequestTree.vue'
import { useQuickRequestStore } from '@/stores/quickRequest'

const store = useQuickRequestStore()
const active = computed(() => store.active)

onMounted(() => {
  if (store.tabs.length === 0 && store.requests.length > 0) store.open(store.requests[0].id)
})
</script>

<template>
  <div class="quick-page">
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
  height: 100%;
  overflow: hidden;
  background: var(--kd-bg);

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
</style>
