<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from '@/core/message'

import MarkdownText from '@/components/common/MarkdownText.vue'
import MethodTag from '@/components/common/MethodTag.vue'
import { exportJson } from '@/core/http'
import { isTauri } from '@/core/tauri'
import type { ApiSummary } from '@/core/types'
import { safeFileName } from '@/core/utils'
import { useDocStore } from '@/stores/doc'

const docStore = useDocStore()

const keyword = ref('')
const downloading = ref(false)

const info = computed(() => docStore.parser?.info ?? null)
const group = computed(() => docStore.currentGroup)

const filteredApis = computed<ApiSummary[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = docStore.apiList
  if (!kw) return list
  return list.filter(
    (api) =>
      api.summary.toLowerCase().includes(kw) ||
      api.path.toLowerCase().includes(kw) ||
      api.method.toLowerCase().includes(kw)
  )
})

const methodStats = computed(() => {
  const stats = new Map<string, number>()
  for (const api of docStore.apiList) stats.set(api.method, (stats.get(api.method) ?? 0) + 1)
  return Array.from(stats.entries()).sort((a, b) => b[1] - a[1])
})

function openApi(api: ApiSummary) {
  docStore.setActiveApi(api.id)
}

/**
 * 下载当前分组的接口文档 JSON。
 * 直接导出后端返回的原始 Swagger / OpenAPI 文档，便于离线留存或导入其它工具。
 */
async function downloadDocJson() {
  const parser = docStore.parser
  if (!parser) {
    message.warning('当前分组文档尚未加载完成')
    return
  }
  downloading.value = true
  try {
    const name = safeFileName(group.value?.name || info.value?.title || 'api-docs', 'api-docs')
    const path = await exportJson(`${name}.json`, parser.document)
    if (!path) return
    message.success(isTauri ? `接口 JSON 已保存到 ${path}` : `接口 JSON 已下载（${name}.json）`)
  } catch (error) {
    message.error(`下载失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="info-panel">
    <header class="info-head">
      <div class="info-head__main">
        <h2>{{ info?.title || group?.title || '接口文档' }}</h2>
        <div class="info-tags">
          <el-tag v-if="info?.version" size="small" effect="plain">版本 {{ info.version }}</el-tag>
          <el-tag size="small" effect="plain" type="success">
            {{ docStore.parser?.specKind === 'swagger2' ? 'Swagger 2.0' : 'OpenAPI 3' }}
          </el-tag>
          <el-tag size="small" effect="plain" type="info">{{ docStore.apiCount }} 个接口</el-tag>
          <el-tag size="small" effect="plain" type="warning">{{ docStore.tagGroups.length }} 个模块</el-tag>
        </div>
      </div>

      <div class="info-head__actions">
        <el-tooltip content="下载当前分组的接口文档 JSON" placement="bottom">
          <el-button
            size="small"
            :loading="downloading"
            :disabled="!docStore.parser"
            @click="downloadDocJson"
          >
            <el-icon><Download /></el-icon>
            <span>下载 JSON</span>
          </el-button>
        </el-tooltip>
      </div>
    </header>

    <section v-if="info?.description" class="info-section">
      <h3 class="info-section__title">文档描述</h3>
      <div class="info-desc">
        <MarkdownText :text="info.description" />
      </div>
    </section>

    <section class="info-section">
      <h3 class="info-section__title">基础信息</h3>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="分组名称">{{ group?.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="分组 ID">{{ group?.id || '—' }}</el-descriptions-item>
        <el-descriptions-item label="服务地址">
          <span class="kd-mono">{{ info?.host || '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="接口前缀">
          <span class="kd-mono">{{ info?.basePath || '（无）' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="文档地址" :span="2">
          <span class="kd-mono break-all">{{ group?.url || '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item v-if="docStore.parser?.securitySchemes && Object.keys(docStore.parser.securitySchemes).length" label="鉴权方式" :span="2">
          <el-tag
            v-for="(scheme, name) in docStore.parser.securitySchemes"
            :key="name"
            size="small"
            effect="plain"
            class="scheme-tag"
          >
            {{ name }}
            <span v-if="(scheme as Record<string, unknown>).type" class="scheme-type">
              ({{ (scheme as Record<string, unknown>).type }})
            </span>
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </section>

    <section class="info-section">
      <h3 class="info-section__title">请求方法分布</h3>
      <div class="method-stats">
        <div v-for="[method, count] in methodStats" :key="method" class="method-stat">
          <MethodTag :method="method" size="small" />
          <span class="method-stat__count">{{ count }}</span>
          <div class="method-stat__bar">
            <i
              :style="{
                width: `${(count / docStore.apiCount) * 100}%`,
                background: 'var(--kd-primary)'
              }"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="info-section">
      <div class="info-section__head">
        <h3 class="info-section__title">接口列表</h3>
        <el-input v-model="keyword" size="small" placeholder="搜索接口" clearable class="api-search">
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
      </div>

      <el-table
        :data="filteredApis"
        size="small"
        border
        max-height="520"
        empty-text="没有匹配的接口"
        @row-click="openApi"
        class="api-table"
      >
        <el-table-column label="方法" width="90">
          <template #default="{ row }">
            <MethodTag :method="row.method" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="接口名称" min-width="200" prop="summary" show-overflow-tooltip />
        <el-table-column label="路径" min-width="260">
          <template #default="{ row }">
            <span class="kd-mono api-path">{{ row.fullPath }}</span>
          </template>
        </el-table-column>
        <el-table-column label="模块" width="130" prop="tag" show-overflow-tooltip />
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="openApi(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.info-panel {
  padding-bottom: 40px;
}

.info-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--kd-border);
  margin-bottom: 18px;

  h2 {
    font-size: $font-xxl;
    line-height: 1.35;
    margin-bottom: 10px;
  }
}

.info-head__main {
  flex: 1;
  min-width: 0;
}

.info-head__actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.info-section {
  margin-bottom: 22px;
}

.info-section__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.info-section__title {
  font-size: $font-md;
  font-weight: 600;
  margin-bottom: 10px;
  padding-left: 9px;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: var(--kd-primary);
  }
}

.info-section__head .info-section__title {
  margin-bottom: 0;
}

.info-desc {
  padding: 12px 14px;
  border-radius: $radius-md;
  background: var(--kd-panel-2);
  border: 1px solid var(--kd-border);
}

.scheme-tag {
  margin-right: 6px;
}

.scheme-type {
  opacity: 0.65;
  font-size: 11px;
}

.method-stats {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-width: 520px;
}

.method-stat {
  display: flex;
  align-items: center;
  gap: 10px;
}

.method-stat__count {
  font-size: $font-sm;
  color: var(--kd-text-2);
  font-family: $font-mono;
  min-width: 32px;
}

.method-stat__bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--kd-panel-3);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }
}

.api-search {
  width: 220px;
  margin-left: auto;
}

.api-table {
  :deep(.el-table__row) {
    cursor: pointer;
  }
}

.api-path {
  font-size: 12px;
  color: var(--kd-text-2);
  word-break: break-all;
}

.break-all {
  word-break: break-all;
}
</style>
