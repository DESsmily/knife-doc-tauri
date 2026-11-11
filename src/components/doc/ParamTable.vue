<script setup lang="ts">
import { computed } from 'vue'

import MarkdownText from '@/components/common/MarkdownText.vue'
import TypeBadge from '@/components/common/TypeBadge.vue'
import type { ApiParam } from '@/core/types'

/** 表格行：在参数模型基础上附加「来源」标记 */
export interface ParamRow extends ApiParam {
  /** 是否来自全局参数 */
  global?: boolean
}

const props = withDefaults(
  defineProps<{
    params: ParamRow[]
    /** 是否展示参数位置列 */
    showIn?: boolean
    /** 是否展示示例值列 */
    showExample?: boolean
    /** 是否展示默认值列 */
    showDefault?: boolean
    /** 空数据文案 */
    emptyText?: string
    /** 默认展开全部 */
    expandAll?: boolean
    /** 表格最大高度 */
    maxHeight?: string
  }>(),
  {
    showIn: false,
    showExample: true,
    showDefault: false,
    emptyText: '暂无参数',
    expandAll: true,
    maxHeight: ''
  }
)

const emit = defineEmits<{
  (e: 'open-model', name: string): void
}>()

const rows = computed(() => props.params)

const labelMap: Record<string, string> = {
  path: 'path',
  query: 'query',
  header: 'header',
  cookie: 'cookie',
  body: 'body',
  formData: 'form'
}

function inClass(location: string): string {
  return `in-${location}`
}

function formatExample(row: ParamRow): string {
  if (!row.example) return ''
  const text = String(row.example)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}
</script>

<template>
  <el-table
    :data="rows"
    row-key="id"
    :tree-props="{ children: 'children' }"
    :default-expand-all="expandAll"
    :max-height="maxHeight || undefined"
    size="small"
    border
    :empty-text="emptyText"
    class="param-table"
  >
    <el-table-column label="参数名称" min-width="220">
      <template #default="{ row }">
        <div class="param-name">
          <span class="param-name__text kd-mono">{{ row.name }}</span>
          <el-tag v-if="row.global" size="small" type="warning" effect="plain" class="param-name__tag">
            全局
          </el-tag>
          <el-tag
            v-if="row.circular"
            size="small"
            type="info"
            effect="plain"
            class="param-name__tag"
            title="检测到循环引用，已停止展开"
          >
            循环引用
          </el-tag>
        </div>
      </template>
    </el-table-column>

    <el-table-column v-if="showIn" label="位置" width="82" align="center">
      <template #default="{ row }">
        <span class="in-tag" :class="inClass(row.in)">{{ labelMap[row.in] ?? row.in }}</span>
      </template>
    </el-table-column>

    <el-table-column label="类型" min-width="150">
      <template #default="{ row }">
        <TypeBadge :type="row.type" :ref-name="row.refName" @open-model="(name: string) => emit('open-model', name)" />
      </template>
    </el-table-column>

    <el-table-column label="必填" width="66" align="center">
      <template #default="{ row }">
        <span v-if="row.required" class="required-flag">是</span>
        <span v-else class="optional-flag">否</span>
      </template>
    </el-table-column>

    <el-table-column v-if="showDefault" label="默认值" width="110">
      <template #default="{ row }">
        <span class="kd-mono cell-muted">{{ row.defaultValue || '—' }}</span>
      </template>
    </el-table-column>

    <el-table-column label="描述" min-width="240">
      <template #default="{ row }">
        <div class="param-desc">
          <MarkdownText :text="row.description" />
          <ul v-if="row.enumValues && row.enumValues.length" class="enum-list">
            <li v-for="(value, index) in row.enumValues" :key="index">
              <code>{{ value }}</code>
            </li>
          </ul>
          <span v-if="!row.description && !(row.enumValues && row.enumValues.length)" class="cell-muted">—</span>
        </div>
      </template>
    </el-table-column>

    <el-table-column v-if="showExample" label="示例值" min-width="160">
      <template #default="{ row }">
        <span v-if="row.example" class="kd-mono example-cell" :title="String(row.example)">
          {{ formatExample(row) }}
        </span>
        <span v-else class="cell-muted">—</span>
      </template>
    </el-table-column>
  </el-table>
</template>

<style lang="scss" scoped>
.param-table {
  :deep(.el-table__row) {
    background: transparent;
  }

  // Element Plus 的树形展开图标是 inline-block 的 button，占位符默认也是 20px。
  // 两者宽度保持一致，父行（有图标）与叶子行（占位符）的字段名才会左对齐。
  :deep(.el-table__placeholder) {
    width: 20px;
  }
}

.param-name {
  // 必须是 inline-flex：展开图标 / 缩进是行内元素，
  // 若这里用 block 级的 flex，图标会被挤到单独一行，出现「图标与内容换行」。
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  vertical-align: middle;
  max-width: 100%;
}

.param-name__text {
  font-weight: 600;
  color: var(--kd-text);
  font-size: 12.5px;
  // 允许超长字段名收缩换行，避免撑破单元格被 overflow:hidden 裁掉
  min-width: 0;
  overflow-wrap: anywhere;
}

.param-name__tag {
  transform: scale(0.88);
  transform-origin: left center;
}

.in-tag {
  display: inline-block;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
  border-radius: $radius-sm;
  font-family: $font-mono;
  font-size: 11px;
  background: var(--kd-panel-3);
  color: var(--kd-text-2);

  &.in-path {
    background: rgba(245, 34, 45, 0.12);
    color: #d4380d;
  }

  &.in-query {
    background: rgba(79, 124, 255, 0.12);
    color: #3563e9;
  }

  &.in-header {
    background: rgba(255, 143, 31, 0.14);
    color: #d97706;
  }

  &.in-body {
    background: rgba(138, 92, 246, 0.14);
    color: #7c3aed;
  }

  &.in-formData {
    background: rgba(0, 181, 120, 0.14);
    color: #059669;
  }

  &.in-cookie {
    background: rgba(19, 194, 194, 0.14);
    color: #08979c;
  }
}

html.dark {
  .in-tag.in-path {
    color: #ff7b72;
  }

  .in-tag.in-query {
    color: #7aa2ff;
  }

  .in-tag.in-header {
    color: #ffb454;
  }

  .in-tag.in-body {
    color: #b18cf5;
  }

  .in-tag.in-formData {
    color: #34d399;
  }

  .in-tag.in-cookie {
    color: #2dd4bf;
  }
}

.required-flag {
  color: var(--kd-danger);
  font-weight: 600;
}

.optional-flag {
  color: var(--kd-text-3);
}

.cell-muted {
  color: var(--kd-text-3);
}

.param-desc {
  font-size: $font-sm;
  line-height: 1.6;
}

.enum-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;

  code {
    display: inline-block;
    padding: 0 5px;
    border-radius: 3px;
    background: var(--kd-panel-3);
    border: 1px solid var(--kd-border);
    font-size: 11px;
    color: var(--kd-text-2);
  }
}

.example-cell {
  font-size: 12px;
  color: var(--kd-text-2);
  word-break: break-all;
}
</style>
