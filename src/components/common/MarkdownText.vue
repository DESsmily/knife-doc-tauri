<script setup lang="ts">
import { computed } from 'vue'

import { looksLikeMarkdown, renderMarkdown } from '@/core/markdown'

const props = withDefaults(
  defineProps<{
    /** 文本内容，支持 Markdown */
    text?: string
    /** 强制关闭 Markdown 解析 */
    plain?: boolean
  }>(),
  { text: '', plain: false }
)

const html = computed(() => {
  const content = String(props.text ?? '')
  if (!content.trim()) return ''
  if (props.plain || !looksLikeMarkdown(content)) return ''
  return renderMarkdown(content)
})

const isPlain = computed(() => !html.value)
</script>

<template>
  <div v-if="text" class="markdown-text">
    <div v-if="isPlain" class="markdown-text__plain">{{ text }}</div>
    <!-- eslint-disable-next-line vue/no-v-html -- 内容已在 renderMarkdown 中做过 HTML 转义 -->
    <div v-else class="markdown-text__rich" v-html="html" />
  </div>
</template>

<style lang="scss" scoped>
.markdown-text {
  font-size: $font-sm;
  line-height: 1.75;
  color: var(--kd-text-2);
  word-break: break-word;
}

.markdown-text__plain {
  white-space: pre-wrap;
}

.markdown-text__rich {
  :deep(.md-h) {
    margin: 12px 0 6px;
    font-size: $font-md;
    color: var(--kd-text);
  }

  :deep(h1.md-h) {
    font-size: $font-lg;
  }

  :deep(.md-ul),
  :deep(.md-ol) {
    margin: 6px 0;
    padding-left: 20px;
  }

  :deep(li) {
    margin: 2px 0;
  }

  :deep(.md-code) {
    padding: 1px 5px;
    margin: 0 2px;
    border-radius: $radius-sm;
    background: var(--kd-panel-3);
    border: 1px solid var(--kd-border);
    font-family: $font-mono;
    font-size: 12px;
    color: var(--kd-danger);
  }

  :deep(.md-pre) {
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: $radius-md;
    background: var(--kd-code-bg);
    border: 1px solid var(--kd-border);
    overflow: auto;
    font-family: $font-mono;
    font-size: 12px;

    code {
      white-space: pre;
    }
  }

  :deep(.md-quote) {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--kd-border-strong);
    color: var(--kd-text-3);
  }

  :deep(.md-hr) {
    margin: 12px 0;
    border: 0;
    border-top: 1px solid var(--kd-border);
  }

  :deep(a) {
    word-break: break-all;
  }

  :deep(p) {
    margin: 4px 0;
  }
}
</style>
