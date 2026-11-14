<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import CodeBlock from '@/components/common/CodeBlock.vue'
import MarkdownText from '@/components/common/MarkdownText.vue'
import MethodTag from '@/components/common/MethodTag.vue'
import ParamTable, { type ParamRow } from '@/components/doc/ParamTable.vue'
import { copyText } from '@/core/http'
import { generateMarkdown, generateTypeTypes, type ScriptContext } from '@/core/scriptGenerator'
import type { ApiDetail, ApiParam, GlobalParam, SchemaModel } from '@/core/types'

const props = defineProps<{
  detail: ApiDetail
  globalParams: GlobalParam[]
  baseUrl: string
  models: SchemaModel[]
}>()

const emit = defineEmits<{
  (e: 'open-model', name: string): void
}>()

/* ------------------------------ 全局参数合并 ---------------------------- */

/** 把启用的全局参数转换成可展示的参数行 */
const globalRows = computed<ParamRow[]>(() =>
  props.globalParams.map((item) => ({
    id: `global_${item.id}`,
    name: item.name,
    in: item.in,
    type: 'string',
    rawType: 'string',
    format: '',
    refName: '',
    required: false,
    description: item.description || '全局参数',
    example: item.value,
    defaultValue: '',
    enumValues: [],
    children: [],
    level: 0,
    pid: '',
    parentTypes: [],
    circular: false,
    global: true
  }))
)

/** 参考 knife4j：全局参数与同名参数合并，全局值优先填充 */
function mergeParams(base: ApiParam[], extras: ParamRow[]): ParamRow[] {
  const result: ParamRow[] = base.map((item) => ({ ...item }))
  for (const extra of extras) {
    const hit = result.find((item) => item.name === extra.name && item.in === extra.in)
    if (hit) {
      hit.example = extra.example
      hit.description = extra.description || hit.description
      hit.global = true
    } else {
      result.push(extra)
    }
  }
  return result
}

const pathParams = computed(() =>
  mergeParams(
    props.detail.parameters.filter((item) => item.level === 0 && item.in === 'path'),
    []
  )
)

const queryParams = computed(() =>
  mergeParams(
    props.detail.parameters.filter((item) => item.level === 0 && item.in === 'query'),
    globalRows.value.filter((item) => item.in === 'query')
  )
)

const headerParams = computed(() =>
  mergeParams(
    props.detail.parameters.filter((item) => item.level === 0 && item.in === 'header'),
    globalRows.value.filter((item) => item.in === 'header')
  )
)

const cookieParams = computed(() =>
  mergeParams(
    props.detail.parameters.filter((item) => item.level === 0 && item.in === 'cookie'),
    []
  )
)

const bodyParams = computed(() =>
  props.detail.parameters.filter((item) =>
    ['body', 'formData'].includes(item.in)
  )
)

const hasAnyParam = computed(
  () =>
    pathParams.value.length +
      queryParams.value.length +
      headerParams.value.length +
      cookieParams.value.length +
      bodyParams.value.length >
    0
)

/* ------------------------------ 响应 ---------------------------------- */

const selectedCode = ref('')

watch(
  () => props.detail.id,
  () => {
    const preferred =
      props.detail.responseCodes.find((item) => item.code === '200') ?? props.detail.responseCodes[0]
    selectedCode.value = preferred?.code ?? ''
  },
  { immediate: true }
)

const activeResponse = computed(() => {
  const codes = props.detail.responseCodes
  if (codes.length === 0) return null
  return codes.find((item) => item.code === selectedCode.value) ?? codes[0]
})

function codeStatusType(code: string): 'success' | 'warning' | 'danger' | 'info' {
  const numeric = Number(code)
  if (code === 'default') return 'info'
  if (!Number.isFinite(numeric)) return 'info'
  if (numeric < 300) return 'success'
  if (numeric < 400) return 'warning'
  return 'danger'
}

/* ------------------------------ 复制 ---------------------------------- */

async function copy(text: string, tip: string) {
  const ok = await copyText(text)
  ElMessage[ok ? 'success' : 'warning'](ok ? tip : '复制失败')
}

function copyAddress() {
  void copy(`${props.baseUrl}${props.detail.path}`, '接口地址已复制')
}

function copyMarkdown() {
  void copy(generateMarkdown(props.detail), '接口 Markdown 已复制')
}

function copyPath() {
  void copy(props.detail.fullPath, '接口路径已复制')
}

/** 复制 TS 示例类型（接口名称 + 入参类型 + 出参类型，出参不含 code/msg/data 包装层） */
function copyTsExample() {
  const ctx: ScriptContext = {
    detail: props.detail,
    baseUrl: props.baseUrl,
    models: props.models
  }
  void copy(generateTypeTypes(ctx), 'TS 示例已复制')
}
</script>

<template>
  <div class="document-tab">
    <!-- 头部 -->
    <header class="doc-head">
      <div class="doc-head__title">
        <h2>{{ detail.summary }}</h2>
        <div class="doc-head__tools">
          <el-tooltip content="复制接口路径" placement="top">
            <el-button link size="small" @click="copyPath">
              <el-icon><CopyDocument /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="复制完整地址" placement="top">
            <el-button link size="small" @click="copyAddress">
              <el-icon><Link /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="复制为 Markdown" placement="top">
            <el-button link size="small" @click="copyMarkdown">
              <el-icon><Tickets /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="复制 TS 示例" placement="top">
            <el-button link size="small" @click="copyTsExample">
              <el-icon><DocumentCopy /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <div class="doc-head__method">
        <MethodTag :method="detail.method" size="large" />
        <span class="doc-head__path kd-mono">{{ detail.fullPath }}</span>
        <el-tag v-if="detail.deprecated" type="danger" size="small" effect="plain">已废弃</el-tag>
        <el-tag v-if="detail.securityKeys.length" type="warning" size="small" effect="plain">
          <el-icon><Lock /></el-icon>
          <span>{{ detail.securityKeys.join(', ') }}</span>
        </el-tag>
      </div>

      <div class="doc-head__meta">
        <div class="meta-item">
          <span class="meta-item__label">请求数据类型</span>
          <span class="meta-item__value kd-mono">{{ detail.consumes.join(', ') || '—' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-item__label">响应数据类型</span>
          <span class="meta-item__value kd-mono">{{ detail.produces.join(', ') || '—' }}</span>
        </div>
        <div v-if="detail.operationId" class="meta-item">
          <span class="meta-item__label">接口标识</span>
          <span class="meta-item__value kd-mono">{{ detail.operationId }}</span>
        </div>
        <div v-if="detail.author" class="meta-item">
          <span class="meta-item__label">开发者</span>
          <span class="meta-item__value">{{ detail.author }}</span>
        </div>
      </div>

      <div v-if="detail.description && detail.description !== detail.summary" class="doc-head__desc">
        <MarkdownText :text="detail.description" />
      </div>
    </header>

    <!-- 请求参数 -->
    <section class="doc-section">
      <h3 class="doc-section__title">
        <span class="bar" />
        请求参数
        <em v-if="!hasAnyParam" class="doc-section__empty-hint">该接口无请求参数</em>
      </h3>

      <template v-if="hasAnyParam">
        <div v-if="pathParams.length" class="param-block">
          <div class="param-block__label">Path 参数</div>
          <ParamTable
            :params="pathParams"
            show-in
            :show-example="false"
            @open-model="(name: string) => emit('open-model', name)"
          />
        </div>

        <div v-if="queryParams.length" class="param-block">
          <div class="param-block__label">Query 参数</div>
          <ParamTable
            :params="queryParams"
            show-in
            @open-model="(name: string) => emit('open-model', name)"
          />
        </div>

        <div v-if="headerParams.length" class="param-block">
          <div class="param-block__label">Header 参数</div>
          <ParamTable
            :params="headerParams"
            show-in
            @open-model="(name: string) => emit('open-model', name)"
          />
        </div>

        <div v-if="cookieParams.length" class="param-block">
          <div class="param-block__label">Cookie 参数</div>
          <ParamTable
            :params="cookieParams"
            show-in
            @open-model="(name: string) => emit('open-model', name)"
          />
        </div>

        <div v-if="bodyParams.length" class="param-block">
          <div class="param-block__label">
            {{
              detail.requestMode === 'form'
                ? 'Form 表单参数'
                : detail.requestMode === 'urlencoded'
                  ? 'Form 表单参数（x-www-form-urlencoded）'
                  : 'Body 参数'
            }}
          </div>
          <ParamTable
            :params="bodyParams"
            show-in
            @open-model="(name: string) => emit('open-model', name)"
          />
        </div>
      </template>
    </section>

    <!-- 请求示例 -->
    <section v-if="detail.requestExample" class="doc-section">
      <h3 class="doc-section__title"><span class="bar" />请求示例</h3>
      <CodeBlock :code="detail.requestExample" :title="detail.requestMode === 'json' ? 'application/json' : '请求体'" />
    </section>

    <!-- 响应状态 -->
    <section class="doc-section">
      <h3 class="doc-section__title"><span class="bar" />响应状态</h3>

      <el-table :data="detail.responseCodes" size="small" border empty-text="文档中未定义响应状态">
        <el-table-column label="状态码" width="110">
          <template #default="{ row }">
            <el-tag :type="codeStatusType(row.code)" effect="plain" size="small" class="kd-mono">
              {{ row.code }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }">
            <MarkdownText :text="row.description" />
          </template>
        </el-table-column>
        <el-table-column label="返回类型" min-width="200">
          <template #default="{ row }">
            <span v-if="row.schemaTitle" class="kd-mono cell-type">
              <button
                v-if="row.refName"
                type="button"
                class="model-link"
                @click="emit('open-model', row.refName)"
              >
                {{ row.schemaTitle }}
              </button>
              <span v-else>{{ row.schemaTitle }}</span>
            </span>
            <span v-else class="cell-muted">—</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 响应参数 / 示例 -->
    <section v-if="activeResponse" class="doc-section">
      <h3 class="doc-section__title">
        <span class="bar" />响应详情
        <el-select
          v-if="detail.responseCodes.length > 1"
          v-model="selectedCode"
          size="small"
          class="code-select"
        >
          <el-option
            v-for="code in detail.responseCodes"
            :key="code.code"
            :label="`${code.code} · ${code.description || ''}`.slice(0, 60)"
            :value="code.code"
          />
        </el-select>
      </h3>

      <template v-if="activeResponse.headers.length">
        <div class="param-block">
          <div class="param-block__label">响应头</div>
          <ParamTable
            :params="activeResponse.headers"
            :show-example="false"
            @open-model="(name: string) => emit('open-model', name)"
          />
        </div>
      </template>

      <div class="param-block">
        <div class="param-block__label">响应参数</div>
        <ParamTable
          :params="activeResponse.parameters"
          max-height="420px"
          empty-text="该状态码未定义响应模型"
          @open-model="(name: string) => emit('open-model', name)"
        />
      </div>

      <div class="param-block">
        <div class="param-block__label">响应示例</div>
        <CodeBlock
          :code="activeResponse.example"
          lang="json"
          :title="`HTTP ${activeResponse.code}`"
          max-height="420px"
        />
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.document-tab {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 40px;
}

.doc-head {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--kd-border);
}

.doc-head__title {
  display: flex;
  align-items: flex-start;
  gap: 12px;

  h2 {
    flex: 1;
    font-size: $font-xl;
    line-height: 1.4;
  }
}

.doc-head__tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.doc-head__method {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.doc-head__path {
  font-size: $font-md;
  color: var(--kd-text);
  word-break: break-all;
  font-weight: 600;
}

.doc-head__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 6px 20px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: $radius-md;
  background: var(--kd-panel-2);
}

.meta-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: $font-sm;
  min-width: 0;
}

.meta-item__label {
  color: var(--kd-text-3);
  flex-shrink: 0;
}

.meta-item__value {
  color: var(--kd-text-2);
  word-break: break-all;
}

.doc-head__desc {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: $radius-md;
  border-left: 3px solid var(--kd-primary);
  background: var(--kd-panel-2);
}

.doc-section {
  margin-top: 22px;
}

.doc-section__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: $font-md;
  font-weight: 600;
  margin-bottom: 10px;

  .bar {
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: var(--kd-primary);
  }
}

.doc-section__empty-hint {
  font-size: $font-xs;
  font-weight: 400;
  font-style: normal;
  color: var(--kd-text-3);
}

.code-select {
  width: 220px;
  margin-left: auto;
}

.param-block {
  margin-bottom: 14px;

  &:last-child {
    margin-bottom: 0;
  }
}

.param-block__label {
  font-size: $font-xs;
  font-weight: 600;
  color: var(--kd-text-3);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.cell-muted {
  color: var(--kd-text-3);
}

.cell-type {
  font-size: 12px;
}

.model-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--kd-primary);
  cursor: pointer;
  font-family: $font-mono;
  font-size: 12px;

  &:hover {
    text-decoration: underline;
  }
}
</style>
