<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import MethodTag from '@/components/common/MethodTag.vue'
import type { ApiSummary } from '@/core/types'
import { useDocStore } from '@/stores/doc'

const docStore = useDocStore()

/** 标签栏数据：openTabs 里存的是接口 id，这里映射成可展示的概要 */
const tabs = computed<ApiSummary[]>(() => {
  const map = docStore.apiMap
  return docStore.openTabs
    .map((id) => map.get(id))
    .filter((item): item is ApiSummary => Boolean(item))
})

function isActive(api: ApiSummary): boolean {
  return docStore.activeApiId === api.id && docStore.activePanel === 'api'
}

/** 切换标签：setActiveApi 内部会同时把左侧接口列表滚动定位到该接口并展开其模块 */
function activate(api: ApiSummary) {
  if (isActive(api)) return
  docStore.setActiveApi(api.id)
}

function close(api: ApiSummary) {
  docStore.closeApiTab(api.id)
}

/* 激活的标签（含从左侧列表选中的情况）始终滚动到可视区内 */
const stripRef = ref<HTMLElement | null>(null)

watch(
  () => docStore.activeApiId,
  () => {
    void nextTick(() => {
      const el = stripRef.value?.querySelector<HTMLElement>('.doc-tabs__item.is-active')
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }
)
</script>

<template>
  <div v-if="tabs.length" class="doc-tabs">
    <div ref="stripRef" class="doc-tabs__strip">
      <div
        v-for="api in tabs"
        :key="api.id"
        class="doc-tabs__item"
        :class="{ 'is-active': isActive(api), 'is-deprecated': api.deprecated }"
      >
        <button
          type="button"
          class="doc-tabs__main"
          :title="`${api.method} ${api.fullPath}`"
          @click="activate(api)"
        >
          <MethodTag :method="api.method" size="small" />
          <span class="doc-tabs__name">{{ api.summary }}</span>
        </button>

        <button type="button" class="doc-tabs__close" title="关闭标签" @click="close(api)">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.doc-tabs {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 40px;
  padding: 0 20px;
  border-bottom: 1px solid var(--kd-border);
  background: var(--kd-panel);
}

.doc-tabs__strip {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;

  @include scrollbar(5px);
}

.doc-tabs__item {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 28px;
  padding-right: 2px;
  border: 1px solid var(--kd-border);
  border-radius: $radius-md;
  background: var(--kd-panel-2);
  color: var(--kd-text-2);
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;

  &:hover {
    border-color: var(--kd-border-strong);
    color: var(--kd-text);
  }

  &.is-active {
    background: var(--kd-primary-soft);
    border-color: var(--kd-primary);
    color: var(--kd-primary);

    .doc-tabs__name {
      font-weight: 600;
    }
  }

  &.is-deprecated .doc-tabs__name {
    text-decoration: line-through;
    color: var(--kd-text-3);
  }
}

.doc-tabs__main {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  min-width: 0;
  max-width: 220px;
  padding: 0 4px 0 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: $font-xs;
  cursor: pointer;
}

.doc-tabs__name {
  min-width: 0;
  @include ellipsis(1);
}

.doc-tabs__close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--kd-text-3);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    background: var(--kd-panel-3);
    color: var(--kd-danger);
  }
}

@include respond-to($bp-md) {
  .doc-tabs {
    padding: 0 16px;
  }
}
</style>
