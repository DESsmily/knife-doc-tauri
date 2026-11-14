<script setup lang="ts">
/**
 * 通用可编辑键值表：快捷请求的 Params / Headers / Body 表单都用它。
 * 直接对父组件传入的数组做增删（数组本身来自 pinia store），改动通过 change 事件
 * 通知上层触发持久化。文件选择状态只保存在本组件内存里，不写入磁盘。
 */

import { computed, shallowReactive } from 'vue'

import type { QuickKV } from '@/core/types'
import { headerSuggestions } from '@/core/headers'
import { uid } from '@/core/utils'

const props = withDefaults(
  defineProps<{
    rows: QuickKV[]
    nameLabel?: string
    valueLabel?: string
    namePlaceholder?: string
    valuePlaceholder?: string
    /** 是否展示类型选择列（表单/Body 场景，与调试功能一致） */
    allowFile?: boolean
    /** 被标记为文件字段的行 id（旧数据兼容，新数据以 type === 'file' 为准） */
    fileFields?: string[]
    emptyText?: string
    showDescription?: boolean
    /** 名称输入框是否启用常用请求头自动补全（用于 Header 场景） */
    nameAutocomplete?: boolean
  }>(),
  {
    nameLabel: '参数名',
    valueLabel: '参数值',
    namePlaceholder: '名称',
    valuePlaceholder: '值',
    allowFile: false,
    fileFields: () => [],
    emptyText: '暂无数据，点击下方按钮添加',
    showDescription: true,
    nameAutocomplete: false
  }
)

const emit = defineEmits<{
  (e: 'change'): void
  (e: 'update:fileFields', value: string[]): void
}>()

/** 字段类型选项，与调试面板保持一致 */
const ROW_TYPES: { value: QuickKV['type']; label: string }[] = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'file', label: '文件' }
]

/** shallowReactive：深层代理会把 File 变成 Proxy，FormData 序列化时会失败 */
const files = shallowReactive<Record<string, File[]>>({})

const filled = computed(() => props.rows.filter((row) => row.enabled && row.name.trim()).length)

const headerNameSuggestions = headerSuggestions()

/** Header 名称自动补全：按输入前缀过滤常用请求头 */
function queryHeaderSuggestions(queryString: string, cb: (list: { value: string; label: string }[]) => void) {
  const q = queryString.trim().toLowerCase()
  const list = q
    ? headerNameSuggestions.filter((item) => item.value.toLowerCase().includes(q))
    : headerNameSuggestions
  cb(list)
}

function addRow() {
  props.rows.push({ id: uid('kv'), name: '', value: '', enabled: true, description: '', type: 'string' })
  emit('change')
}

function removeRow(row: QuickKV) {
  delete files[row.id]
  const index = props.rows.indexOf(row)
  if (index >= 0) props.rows.splice(index, 1)
  if (props.fileFields.includes(row.id)) {
    emit('update:fileFields', props.fileFields.filter((id) => id !== row.id))
  }
  emit('change')
}

/** 是否为文件字段：优先按 type 判断，兼容旧数据的 fileFields 标记 */
function isFileRow(row: QuickKV): boolean {
  return row.type === 'file' || (props.allowFile && props.fileFields.includes(row.id))
}

/** 切换字段类型；切到 file 时同步维护 fileFields 以兼容旧字段 */
function changeType(row: QuickKV, value: QuickKV['type']) {
  row.type = value
  if (value === 'file') {
    row.value = ''
    if (!props.fileFields.includes(row.id)) {
      emit('update:fileFields', [...props.fileFields, row.id])
    }
  } else {
    delete files[row.id]
    if (props.fileFields.includes(row.id)) {
      emit('update:fileFields', props.fileFields.filter((id) => id !== row.id))
    }
  }
  emit('change')
}

function pickFiles(row: QuickKV, event: Event) {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  // 清空 value，保证再次选择同一个文件仍能触发 change
  input.value = ''
  if (!picked.length) {
    delete files[row.id]
    return
  }
  files[row.id] = picked
  emit('change')
}

function clearFiles(row: QuickKV) {
  delete files[row.id]
  emit('change')
}

function fileLabel(row: QuickKV): string {
  return (files[row.id] ?? []).map((file) => file.name).join('、')
}

/** 供上层取出已选文件构造 multipart */
function selectedFiles(): Record<string, File[]> {
  return { ...files }
}

defineExpose({ addRow, selectedFiles, clearAll: () => Object.keys(files).forEach((key) => delete files[key]) })
</script>

<template>
  <div class="kv-table">
    <el-table :data="rows" size="small" :empty-text="emptyText" class="kv-table__grid">
      <el-table-column width="42" align="center">
        <template #default="{ row }">
          <el-checkbox v-model="row.enabled" @change="emit('change')" />
        </template>
      </el-table-column>

      <el-table-column :label="nameLabel" min-width="160">
        <template #default="{ row }">
          <el-autocomplete
            v-if="nameAutocomplete"
            v-model="row.name"
            :fetch-suggestions="queryHeaderSuggestions"
            class="kd-mono"
            :placeholder="namePlaceholder"
            value-key="value"
            @input="emit('change')"
          />
          <el-input
            v-else
            v-model="row.name"
            class="kd-mono"
            :placeholder="namePlaceholder"
            @input="emit('change')"
          />
        </template>
      </el-table-column>

      <el-table-column :label="valueLabel" min-width="220">
        <template #default="{ row }">
          <div v-if="isFileRow(row)" class="file-cell">
            <span v-if="fileLabel(row)" class="file-cell__name kd-ellipsis kd-mono">{{ fileLabel(row) }}</span>
            <span v-else class="file-cell__empty">未选择文件</span>
            <label class="file-cell__pick">
              <input type="file" multiple @change="pickFiles(row, $event)" />
              <span>选择</span>
            </label>
            <el-button v-if="fileLabel(row)" link type="danger" size="small" @click="clearFiles(row)">清除</el-button>
          </div>
          <el-input
            v-else
            v-model="row.value"
            class="kd-mono"
            :placeholder="valuePlaceholder"
            @input="emit('change')"
          />
        </template>
      </el-table-column>

      <el-table-column v-if="allowFile" label="类型" width="110">
        <template #default="{ row }">
          <el-select
            :model-value="row.type"
            @update:model-value="(value: QuickKV['type']) => changeType(row, value)"
          >
            <el-option v-for="item in ROW_TYPES" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column v-if="showDescription" label="说明" min-width="140">
        <template #default="{ row }">
          <el-input
            v-model="row.description"
            placeholder="备注"
            @input="emit('change')"
          />
        </template>
      </el-table-column>

      <el-table-column width="46" align="center">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="removeRow(row)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="kv-table__footer">
      <el-button link type="primary" size="small" @click="addRow">
        <el-icon><Plus /></el-icon>
        <span>添加一行</span>
      </el-button>
      <span class="kv-table__count">已填 {{ filled }} / {{ rows.length }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.kv-table {
  &__grid {
    width: 100%;
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 4px 2px;
  }

  &__count {
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.file-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  &__name {
    font-size: $font-xs;
    color: var(--kd-text);
  }

  &__empty {
    font-size: $font-xs;
    color: var(--kd-text-3);
  }

  &__pick {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    font-size: $font-xs;
    color: var(--kd-primary);
    cursor: pointer;
    border: 1px solid var(--kd-border-strong);
    border-radius: $radius-sm;
    background: var(--kd-panel-2);

    input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }

    &:hover {
      border-color: var(--kd-primary);
    }
  }
}
</style>
