<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import CodeBlock from '@/components/common/CodeBlock.vue'
import {
  generateCurl,
  generateJavaScript,
  generateRequestJson,
  generateTypeScript,
  type ScriptContext
} from '@/core/scriptGenerator'
import type { ApiDetail, GlobalParam, SchemaModel } from '@/core/types'

const props = defineProps<{
  detail: ApiDetail
  baseUrl: string
  models: SchemaModel[]
  globalParams: GlobalParam[]
}>()

const activeTab = ref<'js' | 'ts' | 'curl' | 'json'>('js')

const rootRef = ref<HTMLElement>()

/**
 * 示例代码高度差很大（TS 类型定义远长于 cURL），页面滚动发生在父级
 * doc-content 上，切换后不重置就会停留在上一篇内容的中间。
 */
watch(activeTab, () => {
  nextTick(() => {
    let node = rootRef.value?.parentElement ?? null
    while (node) {
      const { overflowY } = getComputedStyle(node)
      if (overflowY === 'auto' || overflowY === 'scroll') {
        node.scrollTop = 0
        return
      }
      node = node.parentElement
    }
  })
})

const context = computed<ScriptContext>(() => ({
  detail: props.detail,
  baseUrl: props.baseUrl || 'http://127.0.0.1:8080',
  models: props.models,
  globalParams: props.globalParams.map((item) => ({
    name: item.name,
    in: item.in,
    value: item.value
  }))
}))

const jsCode = computed(() => generateJavaScript(context.value))
const tsCode = computed(() => generateTypeScript(context.value))
const curlCode = computed(() => generateCurl(context.value))
const jsonCode = computed(() => generateRequestJson(context.value))

const tabs = [
  { name: 'js', label: 'JavaScript' },
  { name: 'ts', label: 'TypeScript' },
  { name: 'curl', label: 'cURL' },
  { name: 'json', label: '请求参数 JSON' }
] as const

const currentCode = computed(() => {
  switch (activeTab.value) {
    case 'ts':
      return tsCode.value
    case 'curl':
      return curlCode.value
    case 'json':
      return jsonCode.value
    default:
      return jsCode.value
  }
})

const currentLang = computed(() => {
  switch (activeTab.value) {
    case 'ts':
      return 'typescript' as const
    case 'curl':
      return 'text' as const
    case 'json':
      return 'json' as const
    default:
      return 'javascript' as const
  }
})

const currentFilename = computed(() => {
  const name = props.detail.operationId || 'api'
  switch (activeTab.value) {
    case 'ts':
      return `${name}.ts`
    case 'curl':
      return `${name}.sh`
    case 'json':
      return `${name}.json`
    default:
      return `${name}.js`
  }
})

const descriptionMap: Record<string, string> = {
  js: '基于 axios 的调用函数，可直接拷贝到项目中；全局参数与文档定义的 header 已预置。',
  ts: '请求类型在上、响应类型在下，类型由文档的 Schema 推导；点击行号旁的 − / + 标记可折叠/展开代码块。',
  curl: '命令行请求示例，方便在终端或脚本中快速验证接口。',
  json: '请求参数的 JSON 结构示例，可直接粘贴到调试面板的 Body 中。'
}
</script>

<template>
  <div ref="rootRef" class="sample-tab">
    <div class="sample-tab__head">
      <el-tabs v-model="activeTab" class="sample-tabs">
        <el-tab-pane v-for="tab in tabs" :key="tab.name" :name="tab.name" :label="tab.label" />
      </el-tabs>
      <span class="sample-tab__filename kd-mono">{{ currentFilename }}</span>
    </div>

    <p class="sample-tab__desc">{{ descriptionMap[activeTab] }}</p>

    <CodeBlock
      :code="currentCode"
      :lang="currentLang"
      :title="tabs.find((item) => item.name === activeTab)?.label"
      :foldable="activeTab === 'ts'"
      max-height="none"
      line-numbers
      fill
    />
  </div>
</template>

<style lang="scss" scoped>
.sample-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 6px;
}

.sample-tab__head {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--kd-border);
}

.sample-tabs {
  flex: 1;
  min-width: 0;

  :deep(.el-tabs__header) {
    margin-bottom: 0;
  }

  :deep(.el-tabs__nav-wrap::after) {
    display: none;
  }
}

.sample-tab__filename {
  font-size: $font-xs;
  color: var(--kd-text-3);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--kd-panel-3);
  flex-shrink: 0;
}

.sample-tab__desc {
  font-size: $font-xs;
  color: var(--kd-text-3);
  line-height: 1.7;
}
</style>
