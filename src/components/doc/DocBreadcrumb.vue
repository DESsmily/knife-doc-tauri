<script setup lang="ts">
import { computed } from 'vue'

import MethodTag from '@/components/common/MethodTag.vue'
import { useDocStore } from '@/stores/doc'

const props = defineProps<{
  /** 项目名，作为面包屑第一段 */
  projectName: string
}>()

const docStore = useDocStore()

const detail = computed(() => docStore.activeApi)

const groupName = computed(() => docStore.currentGroup?.name ?? '')

/** 非接口面板（文档信息 / 数据模型）在面包屑里展示的名称 */
const panelLabel = computed(() => {
  if (docStore.activePanel === 'info') return '文档信息'
  if (docStore.activePanel === 'models') return '数据模型'
  return ''
})

/**
 * 点击面包屑上的模块 / 接口标签时，滚动左侧接口列表到对应位置并展开其所在模块。
 * target 形如 `tag:用户管理` 或 `api:<apiId>`。
 */
function go(target: string) {
  docStore.revealInSidebar(target)
}
</script>

<template>
  <nav class="doc-crumb" aria-label="当前位置">
    <el-icon class="doc-crumb__icon"><Location /></el-icon>

    <ol class="doc-crumb__list">
      <li class="crumb-text" :title="props.projectName">{{ props.projectName }}</li>

      <template v-if="groupName">
        <li class="crumb-sep">/</li>
        <li class="crumb-text" :title="groupName">{{ groupName }}</li>
      </template>

      <template v-if="detail">
        <li class="crumb-sep">/</li>
        <li>
          <button type="button" class="crumb-link" :title="detail.tag" @click="go(`tag:${detail.tag}`)">
            {{ detail.tag }}
          </button>
        </li>

        <li class="crumb-sep">/</li>
        <li class="crumb-current">
          <MethodTag :method="detail.method" size="small" />
          <button
            type="button"
            class="crumb-link is-current"
            :title="detail.summary"
            @click="go(`api:${detail.id}`)"
          >
            {{ detail.summary }}
          </button>
        </li>
      </template>

      <template v-else-if="panelLabel">
        <li class="crumb-sep">/</li>
        <li class="crumb-text is-current">{{ panelLabel }}</li>
      </template>
    </ol>
  </nav>
</template>

<style lang="scss" scoped>
.doc-crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  flex-shrink: 0;
  padding: 0 24px;
  border-bottom: 1px solid var(--kd-border);
  background: var(--kd-panel);
  font-size: $font-xs;
  overflow: hidden;
}

.doc-crumb__icon {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--kd-text-3);
}

.doc-crumb__list {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.crumb-sep {
  flex-shrink: 0;
  color: var(--kd-text-3);
  opacity: 0.5;
}

.crumb-text {
  min-width: 0;
  max-width: 180px;
  color: var(--kd-text-3);
  @include ellipsis(1);

  &.is-current {
    color: var(--kd-text-2);
    font-weight: 600;
  }
}

.crumb-current {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.crumb-link {
  min-width: 0;
  max-width: 220px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--kd-text-2);
  font-size: $font-xs;
  cursor: pointer;
  @include ellipsis(1);

  &:hover {
    color: var(--kd-primary);
    text-decoration: underline;
  }

  &.is-current {
    color: var(--kd-primary);
    font-weight: 600;
  }
}

@include respond-to($bp-md) {
  .doc-crumb {
    padding: 0 16px;
  }
}
</style>
