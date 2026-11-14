<script setup lang="ts">
/**
 * 文档内嵌快捷请求面板。
 *
 * 在接口文档页的「快捷请求」Tab 中复用全局快捷请求编辑器：根据当前接口详情
 * 派生一条快捷请求（含入参），若已有相同「方法 + 地址」的请求则直接复用，
 * 避免重复堆积；用户可编辑、发送，保存后即进入快捷请求列表。
 */

import { computed, ref, watch } from 'vue'

import RequestEditor from '@/components/quick/RequestEditor.vue'
import { apiDetailToQuickRequest } from '@/core/apiToQuick'
import type { ApiDetail, GlobalParam, SchemaModel } from '@/core/types'
import { useQuickRequestStore } from '@/stores/quickRequest'

const props = defineProps<{
  detail: ApiDetail
  baseUrl: string
  models: SchemaModel[]
  globalParams: GlobalParam[]
}>()

const store = useQuickRequestStore()

/** 当前文档页使用的快捷请求 id */
const requestId = ref('')

/** 在快捷请求列表中查找与当前接口「方法 + 地址」匹配的请求 */
function findExisting(detail: ApiDetail, baseUrl: string): string {
  const snapshot = apiDetailToQuickRequest(detail, baseUrl, props.globalParams)
  const target = `${detail.method} ${snapshot.url}`
  const hit = store.requests.find((item) => `${item.method} ${item.url}` === target)
  return hit?.id ?? ''
}

/** 根据当前接口派生或复用一条快捷请求，并切换为当前编辑对象 */
function syncRequest() {
  if (!props.detail) {
    requestId.value = ''
    return
  }
  const existingId = findExisting(props.detail, props.baseUrl)
  if (existingId) {
    requestId.value = existingId
    store.setActive(existingId)
    return
  }
  const snapshot = apiDetailToQuickRequest(props.detail, props.baseUrl, props.globalParams)
  const created = store.addRequest(snapshot)
  requestId.value = created.id
}

// 接口切换时重新派生 / 复用请求
watch(
  () => props.detail?.id,
  () => syncRequest(),
  { immediate: true }
)

const request = computed(() => store.requests.find((item) => item.id === requestId.value) ?? null)
</script>

<template>
  <div class="doc-quick">
    <div v-if="request" class="doc-quick__hint">
      <el-icon><InfoFilled /></el-icon>
      <span>
        已从接口 <strong class="kd-mono">{{ detail.method }} {{ detail.fullPath }}</strong>
        派生快捷请求，可直接编辑发送；保存后可在「快捷请求」页继续管理。
      </span>
    </div>
    <RequestEditor :request="request" />
  </div>
</template>

<style lang="scss" scoped>
.doc-quick {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;

  &__hint {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: $font-xs;
    color: var(--kd-text-2);
    background: var(--kd-panel-2);
    border-radius: $radius-md;
    border-left: 3px solid var(--kd-primary);

    .kd-mono {
      font-weight: 600;
      color: var(--kd-text);
    }
  }
}
</style>
