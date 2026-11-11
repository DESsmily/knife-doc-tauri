<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 展示类型，如 string / array[UserDto] / object */
    type?: string
    /** 引用模型名，存在时高亮并可点击 */
    refName?: string
    /** 原始 JSON Schema type */
    rawType?: string
  }>(),
  { type: '', refName: '', rawType: '' }
)

const emit = defineEmits<{
  (e: 'open-model', name: string): void
}>()

/** 拆分 array[...] 的前后缀，便于分别着色 */
const parsed = computed(() => {
  const text = String(props.type ?? '').trim() || 'object'
  const arrayMatch = /^array\[(.*)\](\(.*\))?$/.exec(text)
  if (arrayMatch) {
    return { wrap: 'array', inner: arrayMatch[1], suffix: arrayMatch[2] ?? '' }
  }
  const mapMatch = /^object\{(.+)\}$/.exec(text)
  if (mapMatch) {
    return { wrap: 'map', inner: mapMatch[1], suffix: '' }
  }
  return { wrap: '', inner: text, suffix: '' }
})

/** 内层类型是否为引用模型 */
const innerRef = computed(() => {
  const inner = parsed.value.inner.replace(/\(.*\)$/, '')
  if (props.refName && inner === props.refName) return props.refName
  if (/^[A-Z]/.test(inner)) return inner
  return ''
})

const kindClass = computed(() => {
  const base = parsed.value.inner.replace(/\(.*\)$/, '').toLowerCase()
  if (['string', 'integer', 'number', 'boolean', 'object', 'null'].includes(base)) return `is-${base}`
  return 'is-ref'
})

function handleClick() {
  if (innerRef.value) emit('open-model', innerRef.value)
}
</script>

<template>
  <span class="type-badge" :class="kindClass">
    <template v-if="parsed.wrap === 'array'">
      <span class="type-badge__wrap">array&lt;</span>
      <span class="type-badge__inner">{{ parsed.inner }}{{ parsed.suffix }}</span>
      <span class="type-badge__wrap">&gt;</span>
    </template>
    <template v-else-if="parsed.wrap === 'map'">
      <span class="type-badge__wrap">map&lt;</span>
      <span class="type-badge__inner">{{ parsed.inner }}</span>
      <span class="type-badge__wrap">&gt;</span>
    </template>
    <template v-else>
      <span class="type-badge__inner">{{ parsed.inner }}</span>
    </template>

    <button
      v-if="innerRef"
      class="type-badge__link"
      type="button"
      :title="`查看模型 ${innerRef}`"
      @click.stop="handleClick"
    >
      <el-icon><View /></el-icon>
    </button>
  </span>
</template>

<style lang="scss" scoped>
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: $radius-sm;
  border: 1px solid transparent;
  background: var(--kd-panel-3);
  font-family: $font-mono;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--kd-text-2);
  white-space: nowrap;
}

.type-badge__wrap {
  color: var(--kd-text-3);
}

.type-badge__link {
  display: inline-flex;
  align-items: center;
  border: 0;
  background: transparent;
  padding: 0;
  margin-left: 1px;
  cursor: pointer;
  color: var(--kd-primary);
  font-size: 12px;
  opacity: 0.7;

  &:hover {
    opacity: 1;
  }
}

.is-string {
  background: rgba(79, 124, 255, 0.1);
  border-color: rgba(79, 124, 255, 0.22);
  color: #3563e9;

  .type-badge__inner {
    color: #3563e9;
  }
}

.is-integer,
.is-number {
  background: rgba(255, 143, 31, 0.12);
  border-color: rgba(255, 143, 31, 0.26);

  .type-badge__inner {
    color: #d97706;
  }
}

.is-boolean {
  background: rgba(0, 181, 120, 0.12);
  border-color: rgba(0, 181, 120, 0.26);

  .type-badge__inner {
    color: #059669;
  }
}

.is-object {
  background: rgba(138, 92, 246, 0.12);
  border-color: rgba(138, 92, 246, 0.24);

  .type-badge__inner {
    color: #7c3aed;
  }
}

.is-ref .type-badge__inner {
  color: var(--kd-primary);
  font-weight: 600;
}

html.dark {
  .is-string .type-badge__inner {
    color: #7aa2ff;
  }

  .is-integer .type-badge__inner,
  .is-number .type-badge__inner {
    color: #ffb454;
  }

  .is-boolean .type-badge__inner {
    color: #34d399;
  }

  .is-object .type-badge__inner {
    color: #b18cf5;
  }
}
</style>
