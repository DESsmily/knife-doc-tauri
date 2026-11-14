<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from '@/core/message'

import type { GlobalParam, GlobalParamIn } from '@/core/types'
import { deepClone, uid } from '@/core/utils'
import { GLOBAL_PARAM_PRESETS, useGlobalParamStore } from '@/stores/globalParam'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const globalParamStore = useGlobalParamStore()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

/** 弹窗内的草稿数据，确认后才写回 store */
const draft = ref<GlobalParam[]>([])
const activeTab = ref<GlobalParamIn>('header')

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      draft.value = deepClone(globalParamStore.list)
      activeTab.value = draft.value.some((item) => item.in === 'query') ? 'query' : 'header'
    }
  }
)

const headerParams = computed(() => draft.value.filter((item) => item.in === 'header'))
const queryParams = computed(() => draft.value.filter((item) => item.in === 'query'))

const currentList = computed(() =>
  activeTab.value === 'header' ? headerParams.value : queryParams.value
)

const enabledCount = computed(() => draft.value.filter((item) => item.enabled).length)

function addRow(location: GlobalParamIn, preset?: { name: string; description: string }) {
  const name = preset?.name ?? ''
  if (name && draft.value.some((item) => item.in === location && item.name === name)) {
    message.warning(`「${name}」已存在`)
    return
  }
  draft.value.push({
    id: uid('g'),
    name,
    in: location,
    value: '',
    enabled: true,
    description: preset?.description ?? ''
  })
}

function removeRow(id: string) {
  draft.value = draft.value.filter((item) => item.id !== id)
}

function toggleAll(enabled: boolean) {
  for (const item of draft.value) item.enabled = enabled
}

function handleSave() {
  const invalid = draft.value.find((item) => !String(item.name ?? '').trim())
  if (invalid) {
    message.warning('存在未填写参数名的行，请补充完整')
    return
  }
  const duplicated = draft.value.find(
    (item, index) =>
      draft.value.findIndex((other) => other.in === item.in && other.name === item.name) !== index
  )
  if (duplicated) {
    message.warning(`参数「${duplicated.name}」重复，请检查`)
    return
  }
  globalParamStore.replaceAll(
    draft.value.map((item) => ({ ...item, name: item.name.trim(), value: String(item.value ?? '') }))
  )
  message.success('全局参数已保存')
  visible.value = false
  emit('saved')
}

function handleClear() {
  draft.value = []
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="全局参数配置"
    width="760px"
    top="8vh"
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="global-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>
        此处配置的 header / query 参数会自动注入到当前项目的
        <b>所有接口</b>，既展示在接口文档的参数表中，也会参与调试请求的发送。
        只有<b>勾选</b>的参数才会生效。配置按项目隔离并保存在本地。
      </span>
    </div>

    <el-tabs v-model="activeTab" class="global-tabs">
      <el-tab-pane name="header">
        <template #label>
          <span class="tab-label">
            Header 参数
            <em v-if="headerParams.length">{{ headerParams.length }}</em>
          </span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="query">
        <template #label>
          <span class="tab-label">
            Query 参数
            <em v-if="queryParams.length">{{ queryParams.length }}</em>
          </span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <div class="global-toolbar">
      <el-button size="small" type="primary" plain @click="addRow(activeTab)">
        <el-icon><Plus /></el-icon>
        <span>新增参数</span>
      </el-button>

      <el-dropdown trigger="click" @command="(cmd: { name: string; description: string }) => addRow(activeTab, cmd)">
        <el-button size="small">
          <span>常用参数</span>
          <el-icon><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item
              v-for="preset in GLOBAL_PARAM_PRESETS.filter((item) => item.in === activeTab)"
              :key="preset.name"
              :command="preset"
            >
              <span class="kd-mono">{{ preset.name }}</span>
              <span class="preset-desc">{{ preset.description }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <div class="global-toolbar__right">
        <el-button size="small" link @click="toggleAll(true)">全选</el-button>
        <el-button size="small" link @click="toggleAll(false)">全不选</el-button>
        <el-button size="small" link type="danger" @click="handleClear">清空</el-button>
      </div>
    </div>

    <div class="global-table">
      <el-table :data="currentList" size="small" empty-text="暂无参数，点击「新增参数」开始配置">
        <el-table-column width="52" align="center">
          <template #header>
            <el-icon class="hint-icon" title="勾选后该参数才会生效"><Select /></el-icon>
          </template>
          <template #default="{ row }">
            <el-checkbox v-model="row.enabled" />
          </template>
        </el-table-column>

        <el-table-column label="参数名" min-width="170">
          <template #default="{ row }">
            <el-input v-model="row.name" size="small" placeholder="如 Authorization" class="kd-mono" />
          </template>
        </el-table-column>

        <el-table-column label="参数值" min-width="220">
          <template #default="{ row }">
            <el-input
              v-model="row.value"
              size="small"
              placeholder="如 Bearer xxx"
              class="kd-mono"
              :type="row.name && /token|authorization|secret|password/i.test(row.name) ? 'password' : 'text'"
              show-password
            />
          </template>
        </el-table-column>

        <el-table-column label="备注" min-width="150">
          <template #default="{ row }">
            <el-input v-model="row.description" size="small" placeholder="选填" />
          </template>
        </el-table-column>

        <el-table-column width="60" align="center">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeRow(row.id)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <div class="global-footer">
        <span class="global-footer__count">已启用 {{ enabledCount }} / {{ draft.length }} 个参数</span>
        <div>
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="handleSave">保存配置</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.global-tip {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-radius: $radius-md;
  background: var(--kd-primary-soft);
  color: var(--kd-text-2);
  font-size: $font-sm;
  line-height: 1.7;
  margin-bottom: 8px;

  .el-icon {
    color: var(--kd-primary);
    margin-top: 3px;
    flex-shrink: 0;
  }

  b {
    color: var(--kd-primary);
  }
}

.global-tabs {
  margin-bottom: -4px;

  :deep(.el-tabs__header) {
    margin-bottom: 10px;
  }
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  em {
    font-style: normal;
    font-size: 11px;
    padding: 0 6px;
    height: 16px;
    line-height: 16px;
    border-radius: 999px;
    background: var(--kd-panel-3);
    color: var(--kd-text-3);
  }
}

.global-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.global-toolbar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.preset-desc {
  margin-left: 10px;
  font-size: 11px;
  color: var(--kd-text-3);
}

.global-table {
  max-height: 46vh;
  overflow: auto;

  :deep(.el-table__empty-block) {
    min-height: 140px;
  }
}

.hint-icon {
  color: var(--kd-text-3);
}

.global-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.global-footer__count {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

@include respond-to($bp-sm) {
  .global-toolbar {
    flex-wrap: wrap;
  }
}
</style>
