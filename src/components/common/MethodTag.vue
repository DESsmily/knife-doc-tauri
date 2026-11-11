<script setup lang="ts">
import { computed } from 'vue'

import { methodColor } from '@/core/utils'

const props = withDefaults(
  defineProps<{
    method: string
    /** 尺寸 */
    size?: 'small' | 'default' | 'large'
    /** 是否显示为纯文字 */
    text?: boolean
  }>(),
  { size: 'default', text: false }
)

const color = computed(() => methodColor(props.method))
const label = computed(() => String(props.method ?? '').toUpperCase())
</script>

<template>
  <span
    class="method-tag"
    :class="[`is-${size}`, { 'is-text': text }]"
    :style="{ '--method-color': color }"
  >
    {{ label }}
  </span>
</template>

<style lang="scss" scoped>
.method-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  padding: 0 8px;
  height: 22px;
  border-radius: $radius-sm;
  font-family: $font-mono;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #fff;
  background: var(--method-color);
  flex-shrink: 0;
  user-select: none;
}

.is-small {
  min-width: 44px;
  height: 18px;
  font-size: 10px;
  padding: 0 6px;
}

.is-large {
  min-width: 62px;
  height: 26px;
  font-size: 12px;
}

.is-text {
  background: transparent;
  color: var(--method-color);
  padding: 0;
  min-width: auto;
}
</style>
