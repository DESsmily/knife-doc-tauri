<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import CodeBlock from '@/components/common/CodeBlock.vue'
import MarkdownText from '@/components/common/MarkdownText.vue'
import ParamTable from '@/components/doc/ParamTable.vue'
import type { SchemaModel } from '@/core/types'

const props = defineProps<{
  modelValue: boolean
  /** 待展示的模型名 */
  modelName: string
  /** 当前分组的全部模型 */
  models: SchemaModel[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'open-model', name: string): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

/** 支持在弹窗内继续深入查看嵌套模型 */
const history = ref<string[]>([])

watch(
  () => [props.modelValue, props.modelName] as const,
  ([open, name]) => {
    if (open) history.value = name ? [name] : []
  },
  { immediate: true }
)

const currentName = computed(() => history.value[history.value.length - 1] ?? '')
const current = computed(() => props.models.find((item) => item.name === currentName.value) ?? null)

function drillInto(name: string) {
  if (!name) return
  if (history.value.includes(name)) {
    // 已出现过：直接跳到该层
    const index = history.value.lastIndexOf(name)
    history.value = history.value.slice(0, index + 1)
    return
  }
  history.value = [...history.value, name]
}

function goBack() {
  if (history.value.length <= 1) return
  history.value = history.value.slice(0, -1)
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="currentName ? `模型详情 · ${currentName}` : '模型详情'"
    width="820px"
    top="7vh"
    append-to-body
    class="model-dialog"
  >
    <div v-if="current" class="model-dialog__body">
      <div class="model-dialog__toolbar">
        <el-breadcrumb separator="/" class="model-breadcrumb">
          <el-breadcrumb-item v-for="(name, index) in history" :key="`${name}-${index}`">
            <button
              type="button"
              class="crumb"
              :class="{ 'is-current': index === history.length - 1 }"
              @click="history = history.slice(0, index + 1)"
            >
              {{ name }}
            </button>
          </el-breadcrumb-item>
        </el-breadcrumb>

        <el-button v-if="history.length > 1" link size="small" @click="goBack">
          <el-icon><Back /></el-icon>
          <span>返回上一层</span>
        </el-button>
      </div>

      <div class="model-dialog__meta">
        <el-tag size="small" effect="plain">{{ current.fields.length }} 个字段</el-tag>
        <span class="model-dialog__type kd-mono">{{ current.type }}</span>
      </div>

      <MarkdownText v-if="current.description" :text="current.description" class="model-dialog__desc" />

      <div class="model-dialog__block">
        <div class="model-dialog__label">字段定义</div>
        <ParamTable
          :params="current.fields"
          max-height="44vh"
          empty-text="该模型无字段"
          @open-model="drillInto"
        />
      </div>

      <div class="model-dialog__block">
        <div class="model-dialog__label">示例数据</div>
        <CodeBlock :code="current.example" lang="json" max-height="320px" />
      </div>
    </div>

    <div v-else class="model-dialog__empty">
      未找到模型「{{ currentName }}」的定义
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.model-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.model-dialog__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-breadcrumb {
  flex: 1;
  min-width: 0;
  font-size: $font-sm;
}

.crumb {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  color: var(--kd-primary);
  font-family: $font-mono;
  font-size: $font-sm;

  &.is-current {
    color: var(--kd-text);
    font-weight: 600;
    cursor: default;
  }
}

.model-dialog__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-dialog__type {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.model-dialog__desc {
  padding: 10px 12px;
  border-radius: $radius-md;
  background: var(--kd-panel-2);
}

.model-dialog__label {
  font-size: $font-xs;
  font-weight: 600;
  color: var(--kd-text-3);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}

.model-dialog__block {
  margin-bottom: 12px;
}

.model-dialog__empty {
  padding: 40px;
  text-align: center;
  color: var(--kd-text-3);
}
</style>
