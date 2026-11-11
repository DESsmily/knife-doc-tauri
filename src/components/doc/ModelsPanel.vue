<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import CodeBlock from '@/components/common/CodeBlock.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import MarkdownText from '@/components/common/MarkdownText.vue'
import ParamTable from '@/components/doc/ParamTable.vue'
import { useDocStore } from '@/stores/doc'

const emit = defineEmits<{
  (e: 'open-model', name: string): void
}>()

const docStore = useDocStore()

const keyword = ref('')
const selectedName = ref('')

const filteredModels = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = docStore.models
  if (!kw) return list
  return list.filter((model) => model.name.toLowerCase().includes(kw))
})

const activeModel = computed(
  () => docStore.models.find((model) => model.name === selectedName.value) ?? null
)

watch(
  () => docStore.revision,
  () => {
    if (!selectedName.value || !docStore.models.some((item) => item.name === selectedName.value)) {
      selectedName.value = docStore.models[0]?.name ?? ''
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="models-panel">
    <header class="models-head">
      <h2>数据模型</h2>
      <el-input v-model="keyword" size="small" placeholder="搜索模型" clearable class="model-search">
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
    </header>

    <EmptyState
      v-if="docStore.models.length === 0"
      icon="Grid"
      title="文档中未定义数据模型"
      description="当前分组的 OpenAPI 文档里没有 definitions / components.schemas 定义。"
    />

    <div v-else class="models-body">
      <aside class="model-list kd-scroll">
        <button
          v-for="model in filteredModels"
          :key="model.name"
          type="button"
          class="model-list__item"
          :class="{ 'is-active': model.name === selectedName }"
          @click="selectedName = model.name"
        >
          <span class="model-list__name kd-mono">{{ model.name }}</span>
          <span class="model-list__count">{{ model.fields.length }}</span>
        </button>
        <div v-if="filteredModels.length === 0" class="model-list__empty">没有匹配的模型</div>
      </aside>

      <section v-if="activeModel" class="model-detail">
        <div class="model-detail__head">
          <h3 class="kd-mono">{{ activeModel.name }}</h3>
          <el-tag size="small" effect="plain">{{ activeModel.fields.length }} 个字段</el-tag>
        </div>

        <MarkdownText v-if="activeModel.description" :text="activeModel.description" class="model-desc" />

        <div class="model-block">
          <div class="model-block__label">字段定义</div>
          <ParamTable
            :params="activeModel.fields"
            :max-height="'420'"
            empty-text="该模型无字段"
            @open-model="(name: string) => emit('open-model', name)"
          />
        </div>

        <div class="model-block">
          <div class="model-block__label">示例数据</div>
          <CodeBlock :code="activeModel.example" lang="json" max-height="360px" />
        </div>
      </section>

      <section v-else class="model-detail model-detail--empty">
        <EmptyState icon="Pointer" title="请选择一个模型" description="从左侧列表中选择模型以查看字段定义与示例数据" />
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.models-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.models-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--kd-border);
  margin-bottom: 14px;

  h2 {
    font-size: $font-xl;
    flex: 1;
  }
}

.model-search {
  width: 220px;
}

.models-body {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
  align-items: flex-start;
}

.model-list {
  width: 260px;
  flex-shrink: 0;
  max-height: 72vh;
  border: 1px solid var(--kd-border);
  border-radius: $radius-md;
  padding: 6px;
  background: var(--kd-panel-2);
}

.model-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: $radius-sm;
  background: transparent;
  cursor: pointer;
  color: var(--kd-text-2);
  font-size: $font-sm;
  text-align: left;

  &:hover {
    background: var(--kd-panel-3);
  }

  &.is-active {
    background: var(--kd-primary-soft);
    color: var(--kd-primary);
    font-weight: 600;
  }
}

.model-list__name {
  flex: 1;
  min-width: 0;
  @include ellipsis(1);
}

.model-list__count {
  font-size: 11px;
  color: var(--kd-text-3);
  background: var(--kd-panel-3);
  padding: 0 6px;
  border-radius: 999px;
  flex-shrink: 0;
}

.model-list__empty {
  padding: 20px;
  text-align: center;
  font-size: $font-sm;
  color: var(--kd-text-3);
}

.model-detail {
  flex: 1;
  min-width: 0;
}

.model-detail__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;

  h3 {
    font-size: $font-lg;
    color: var(--kd-primary);
  }
}

.model-desc {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: $radius-md;
  background: var(--kd-panel-2);
}

.model-block {
  margin-bottom: 16px;
}

.model-block__label {
  font-size: $font-xs;
  font-weight: 600;
  color: var(--kd-text-3);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}

@include respond-to($bp-md) {
  .models-body {
    flex-direction: column;
  }

  .model-list {
    width: 100%;
    max-height: 220px;
  }
}
</style>
