<script setup lang="ts">
import { computed, reactive, ref, shallowReactive, watch } from 'vue'
import { ElMessage } from 'element-plus'

import CodeBlock from '@/components/common/CodeBlock.vue'
import TypeBadge from '@/components/common/TypeBadge.vue'
import { headerSuggestions } from '@/core/headers'
import {
  copyText,
  saveTextFile,
  sendDebugRequest,
  type DebugRequestOptions,
  type DebugResponseResult
} from '@/core/http'
import { escapeRegExp, formatDuration, prettyJson, safeParse, uid } from '@/core/utils'
import type {
  ApiDetail,
  ApiParam,
  GlobalParam,
  QuickBody,
  QuickKV,
  QuickRequest
} from '@/core/types'
import { useAppStore } from '@/stores/app'
import { useQuickRequestStore } from '@/stores/quickRequest'

const appStore = useAppStore()
const quickStore = useQuickRequestStore()

const props = defineProps<{
  detail: ApiDetail
  globalParams: GlobalParam[]
  baseUrl: string
}>()

type BodyType = ApiDetail['requestMode']
type SectionName = 'params' | 'body' | 'headers' | 'settings'
type RowLoc = 'path' | 'query' | 'header' | 'body'

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const BODY_TYPES: { value: BodyType; label: string; hint: string }[] = [
  { value: 'none', label: 'none', hint: '不发送请求体' },
  { value: 'form', label: 'form-data', hint: 'multipart/form-data，支持上传文件' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded', hint: '表单字段编码后放入请求体' },
  { value: 'json', label: 'JSON', hint: 'application/json' },
  { value: 'raw', label: 'Text', hint: '原样发送文本' }
]

const ROW_TYPES: { value: string; label: string }[] = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'file', label: '文件' }
]

/** Header 参数名自动补全数据源 */
const headerNameSuggestions = headerSuggestions()

/** 调试面板的 body 类型 -> http 层用于生成 cURL 的模式 */
const CURL_BODY_MODE: Record<BodyType, NonNullable<DebugRequestOptions['bodyMode']>> = {
  none: 'none',
  form: 'formData',
  urlencoded: 'form',
  json: 'json',
  raw: 'raw'
}

/* ------------------------------------------------------------------ */
/* 可编辑行模型                                                        */
/* ------------------------------------------------------------------ */

interface EditableRow {
  /** 稳定 key */
  key: string
  /** 所属位置：path / query 同属 Params 表格 */
  loc: RowLoc
  name: string
  value: string
  /** 展示用类型，如 string / string(binary) / array[file] */
  type: string
  /** 原始 JSON Schema type，用于识别文件字段 */
  rawType: string
  /** JSON Schema format，binary 即文件 */
  format: string
  refName: string
  required: boolean
  description: string
  enabled: boolean
  /** 来源 */
  source: 'doc' | 'global'
  /** 是否可删除/改名（文档定义的参数不可改名） */
  editable: boolean
  enumValues: unknown[]
}

interface DebugState {
  params: EditableRow[]
  header: EditableRow[]
  body: EditableRow[]
  /** 用户可切换的请求体类型，默认取文档声明 */
  bodyType: BodyType
  rawBody: string
  timeout: number
  withCredentials: boolean
  /** 可调的前缀地址，默认取项目 baseUrl，用户可手动修改 */
  prefixUrl: string
}

/** 按接口缓存调试状态，切换接口回来后输入不丢失 */
const stateCache = new Map<string, DebugState>()

function toRow(param: ApiParam, source: 'doc' | 'global', loc: RowLoc, enabled = true): EditableRow {
  return {
    key: `${source}_${param.id}`,
    loc,
    name: param.name,
    value: param.example ?? '',
    type: param.type,
    rawType: param.rawType,
    format: param.format,
    refName: param.refName,
    required: param.required,
    description: param.description,
    enabled,
    source,
    editable: false,
    enumValues: param.enumValues ?? []
  }
}

function globalToRow(param: GlobalParam): EditableRow {
  return {
    key: `global_${param.id}`,
    loc: param.in === 'query' ? 'query' : 'header',
    name: param.name,
    value: param.value,
    type: 'string',
    rawType: 'string',
    format: '',
    refName: '',
    required: false,
    description: param.description || '全局参数',
    enabled: param.enabled,
    source: 'global',
    editable: true,
    enumValues: []
  }
}

function newRow(loc: RowLoc): EditableRow {
  return {
    key: uid('row'),
    loc,
    name: '',
    value: '',
    type: 'string',
    rawType: 'string',
    format: '',
    refName: '',
    required: false,
    description: '',
    enabled: true,
    source: 'doc',
    editable: true,
    enumValues: []
  }
}

/** 把全局参数合并进 Query / Header 行：同名取全局默认值，缺失的追加 */
function mergeGlobal(rows: EditableRow[], loc: 'query' | 'header', globals: GlobalParam[]): EditableRow[] {
  const result = [...rows]
  for (const global of globals.filter((item) => item.in === loc)) {
    const hit = result.find((item) => item.loc === loc && item.name === global.name)
    if (hit) {
      // 同名参数：以全局值为默认值，但保留文档定义的类型与描述
      if (!hit.value) hit.value = global.value
      hit.source = 'global'
      continue
    }
    result.push(globalToRow(global))
  }
  return result
}

/** 依据接口定义 + 全局参数构建初始状态 */
function buildState(detail: ApiDetail, globals: GlobalParam[]): DebugState {
  const top = detail.parameters.filter((item) => item.level === 0)

  const params = mergeGlobal(
    [
      ...top.filter((item) => item.in === 'path').map((item) => toRow(item, 'doc', 'path')),
      ...top.filter((item) => item.in === 'query').map((item) => toRow(item, 'doc', 'query'))
    ],
    'query',
    globals
  )
  const header = mergeGlobal(
    top.filter((item) => item.in === 'header').map((item) => toRow(item, 'doc', 'header')),
    'header',
    globals
  )

  return {
    params,
    header,
    // 只有表单型请求体才逐项填写；json 的 body 节点走文本编辑器
    body: top.filter((item) => item.in === 'formData').map((item) => toRow(item, 'doc', 'body')),
    bodyType: detail.requestMode,
    rawBody: detail.requestExample || '',
    timeout: appStore.settings.requestTimeout || 60000,
    withCredentials: false,
    prefixUrl: props.baseUrl || ''
  }
}

const state = reactive<DebugState>(buildState(props.detail, props.globalParams))

/**
 * 文件上传控件选择结果：行 key -> 已选文件
 * 必须用 shallowReactive：深度响应式会把 File 包成 Proxy，
 * FormData 里的 Proxy 无法被浏览器序列化，请求会在发送阶段直接失败。
 */
const fileMap = shallowReactive<Record<string, File[]>>({})

function applyState(next: DebugState) {
  state.params = next.params
  state.header = next.header
  state.body = next.body
  state.bodyType = next.bodyType
  state.rawBody = next.rawBody
  state.timeout = next.timeout
  state.withCredentials = next.withCredentials
  state.prefixUrl = next.prefixUrl
}

/**
 * 用最新的全局参数同步 Query / Header 中的全局行：
 *  - 全局配置里已删除的参数，从表单中移除
 *  - 新增的全局参数，追加到表单
 *  - 已存在的同名参数，更新为全局配置的值与启用状态
 */
function syncGlobalRows() {
  for (const loc of ['query', 'header'] as const) {
    const rows = loc === 'query' ? state.params : state.header
    const globals = props.globalParams.filter((item) => item.in === loc)

    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index]
      if (row.source !== 'global') continue
      if (!globals.some((item) => item.name === row.name)) rows.splice(index, 1)
    }

    for (const global of globals) {
      const hit = rows.find((row) => row.loc === loc && row.name === global.name)
      if (hit) {
        hit.source = 'global'
        hit.value = global.value
        hit.enabled = global.enabled
        if (!hit.description) hit.description = global.description || '全局参数'
        continue
      }
      rows.push(globalToRow(global))
    }
  }
}

/** 切换接口：优先复用该接口上次的输入 */
watch(
  () => props.detail.id,
  () => {
    const cached = stateCache.get(props.detail.id)
    if (cached) {
      applyState(cached)
      syncGlobalRows()
      return
    }
    applyState(buildState(props.detail, props.globalParams))
  },
  { immediate: true }
)

/** 全局参数配置变化：实时同步到当前表单 */
watch(
  () =>
    props.globalParams
      .map((item) => `${item.id}:${item.in}:${item.name}:${item.value}:${item.enabled}`)
      .join('|'),
  () => syncGlobalRows()
)

/** 输入变化时写入缓存，切走再切回来不丢数据 */
watch(
  () => state,
  () => {
    stateCache.set(props.detail.id, {
      params: state.params.map((item) => ({ ...item })),
      header: state.header.map((item) => ({ ...item })),
      body: state.body.map((item) => ({ ...item })),
      bodyType: state.bodyType,
      rawBody: state.rawBody,
      timeout: state.timeout,
      withCredentials: state.withCredentials,
      prefixUrl: state.prefixUrl
    })
  },
  { deep: true }
)

/* ------------------------------------------------------------------ */
/* 请求构造                                                            */
/* ------------------------------------------------------------------ */

const activeSection = ref<SectionName>('params')

const pathRows = computed(() => state.params.filter((item) => item.loc === 'path'))
const queryRows = computed(() => state.params.filter((item) => item.loc === 'query'))

/** 替换路径参数后的 URL（不含 query） */
const resolvedPath = computed(() => {
  let path = props.detail.path
  for (const row of pathRows.value) {
    path = path.replace(new RegExp(`\\{${escapeRegExp(row.name)}\\}`, 'g'), encodeURIComponent(row.value ?? ''))
  }
  return path
})

const queryString = computed(() =>
  queryRows.value
    .filter((item) => item.enabled && item.name)
    .map((item) => `${encodeURIComponent(item.name)}=${encodeURIComponent(item.value ?? '')}`)
    .join('&')
)

/**
 * 查询参数对象：所有已启用的查询参数（含非必填）都显式传入，
 * 避免仅靠 URL 查询串时非必填参数被省略。同名键重复时以最后一条为准，
 * 与 queryString 的拼接行为保持一致。
 */
const queryParams = computed<Record<string, string>>(() => {
  const params: Record<string, string> = {}
  for (const item of queryRows.value) {
    if (!item.enabled || !item.name) continue
    params[item.name] = item.value ?? ''
  }
  return params
})

const fullUrl = computed(() => {
  const base = (state.prefixUrl || '').replace(/\/+$/, '')
  const qs = queryString.value
  return `${base}${resolvedPath.value}${qs ? `?${qs}` : ''}`
})

const docBodyType = computed<BodyType>(() => props.detail.requestMode)

function bodyTypeLabel(value: BodyType): string {
  return BODY_TYPES.find((item) => item.value === value)?.label ?? value
}

/** 文件字段：OAS3 用 string(binary)，swagger2 用 file / array[file] */
function isFileRow(row: EditableRow): boolean {
  if (row.rawType === 'file' || row.format === 'binary') return true
  return /^(file|array\[file\]|string\(binary\)|array\[string\(binary\)\])$/.test(row.type)
}

/** 数组型文件字段允许一次选多个 */
function isMultiFile(row: EditableRow): boolean {
  return row.type.startsWith('array[')
}

const isTableBody = computed(() => state.bodyType === 'form' || state.bodyType === 'urlencoded')

const rawJsonInvalid = computed(
  () => state.bodyType === 'json' && Boolean(state.rawBody.trim()) && safeParse(state.rawBody) === null
)

/** 已填写的行数，用于 tab 上的角标 */
function filledCount(rows: EditableRow[]): number {
  return rows.filter(
    (row) =>
      row.enabled &&
      row.name &&
      (isFileRow(row) ? (fileMap[row.key]?.length ?? 0) > 0 : Boolean(String(row.value ?? '').trim()))
  ).length
}

const sectionCounts = computed(() => ({
  params: filledCount(state.params),
  headers: filledCount(state.header),
  body: isTableBody.value ? filledCount(state.body) : state.rawBody.trim() ? 1 : 0
}))

/** 缺失的必填参数 */
const missingRequired = computed(() => {
  const missing: string[] = []
  for (const row of pathRows.value) {
    if (!String(row.value ?? '').trim()) missing.push(`${row.name}（path）`)
  }
  for (const row of queryRows.value) {
    if (row.enabled && row.required && !String(row.value ?? '').trim()) missing.push(`${row.name}（query）`)
  }
  for (const row of state.header) {
    if (row.enabled && row.required && !String(row.value ?? '').trim()) missing.push(`${row.name}（header）`)
  }
  return missing
})

const requestHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = {}
  const produces = props.detail.produces[0]
  if (produces) headers.Accept = produces

  if (state.bodyType === 'json') headers['Content-Type'] = 'application/json'
  else if (state.bodyType === 'urlencoded') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  else if (state.bodyType === 'raw') headers['Content-Type'] = 'text/plain;charset=utf-8'

  for (const row of state.header) {
    if (!row.enabled || !row.name || !row.value) continue
    headers[row.name] = row.value
  }
  return headers
})

/* ------------------------------------------------------------------ */
/* 发送                                                                */
/* ------------------------------------------------------------------ */

const sending = ref(false)
const response = ref<DebugResponseResult | null>(null)
const responseTab = ref('body')
const jsonPath = ref('')

const prettyBody = computed(() => {
  const raw = response.value?.body ?? ''
  if (!raw.trim()) return ''
  const parsed = safeParse(raw)
  if (parsed === null) return raw
  return prettyJson(parsed)
})

const contentType = computed(() => {
  const headers = response.value?.headers ?? {}
  const key = Object.keys(headers).find((item) => item.toLowerCase() === 'content-type')
  return key ? headers[key] : ''
})

const isJsonResponse = computed(() => contentType.value.includes('json') || safeParse(response.value?.body ?? '') !== null)

const responseTabs = computed(() => {
  const list = [{ name: 'body', label: '响应体' }, { name: 'headers', label: '响应头' }]
  if (isJsonResponse.value) list.push({ name: 'tree', label: 'JSON 树' })
  list.push({ name: 'curl', label: 'cURL' }, { name: 'request', label: '请求信息' })
  return list
})

function resolveBodyPayload(): { data: unknown; files: { name: string; file: File }[] } {
  const rows = state.body.filter((item) => item.enabled && item.name)

  if (state.bodyType === 'json') {
    const text = state.rawBody?.trim() ?? ''
    if (!text) return { data: undefined, files: [] }
    const parsed = safeParse(text)
    return { data: parsed === null ? text : parsed, files: [] }
  }
  if (state.bodyType === 'urlencoded') {
    const params = new URLSearchParams()
    for (const row of rows) params.append(row.name, row.value ?? '')
    return { data: params, files: [] }
  }
  if (state.bodyType === 'form') {
    const files: { name: string; file: File }[] = []
    const form = new FormData()
    for (const row of rows) {
      if (isFileRow(row)) {
        for (const file of fileMap[row.key] ?? []) {
          form.append(row.name, file)
          files.push({ name: row.name, file })
        }
        continue
      }
      form.append(row.name, row.value ?? '')
    }
    return { data: form, files }
  }
  if (state.bodyType === 'raw') {
    return { data: state.rawBody || undefined, files: [] }
  }
  return { data: undefined, files: [] }
}

async function handleSend() {
  if (missingRequired.value.length > 0) {
    ElMessage.warning(`请先填写必填参数：${missingRequired.value.join('、')}`)
    return
  }

  sending.value = true
  response.value = null
  try {
    const headers = { ...requestHeaders.value }
    const payload = resolveBodyPayload()
    if (state.bodyType === 'form') {
      // multipart 的 Content-Type 必须由浏览器附带 boundary，不能手动指定
      delete headers['Content-Type']
    }

    const result = await sendDebugRequest({
      url: fullUrl.value,
      method: props.detail.method,
      headers,
      params: queryParams.value,
      data: payload.data,
      responseType: 'text',
      timeout: state.timeout,
      withCredentials: state.withCredentials,
      rawText: state.bodyType === 'json' || state.bodyType === 'raw' ? state.rawBody : undefined,
      bodyMode: CURL_BODY_MODE[state.bodyType],
      formFields: state.body
        .filter((item) => item.enabled && item.name && !isFileRow(item))
        .map((item) => ({ name: item.name, value: item.value })),
      files: payload.files
    })
    response.value = result
    responseTab.value = 'body'
  } finally {
    sending.value = false
  }
}

function handleReset() {
  stateCache.delete(props.detail.id)
  applyState(buildState(props.detail, props.globalParams))
  for (const key of Object.keys(fileMap)) delete fileMap[key]
  response.value = null
  ElMessage.success('已重置为文档默认值')
}

async function handleCopyResponse() {
  const ok = await copyText(response.value?.body ?? '')
  ElMessage[ok ? 'success' : 'warning'](ok ? '响应内容已复制' : '复制失败')
}

function handleDownload() {
  const ext = isJsonResponse.value ? 'json' : 'txt'
  void saveTextFile(`${props.detail.operationId || 'response'}.${ext}`, response.value?.body ?? '').then((path) => {
    if (path) ElMessage.success(`已保存到 ${path}`)
  })
}

/* ------------------------------------------------------------------ */
/* 另存为快捷请求                                                      */
/* ------------------------------------------------------------------ */

function rowToKv(row: EditableRow): QuickKV {
  const type: QuickKV['type'] = row.type === 'number' || row.type === 'boolean' || row.type === 'file' ? row.type : 'string'
  return {
    id: uid('kv'),
    name: row.name,
    value: row.value,
    enabled: row.enabled,
    description: row.description,
    type
  }
}

/** 把当前调试表单（含全局参数实际取值）快照成一条快捷请求 */
function snapshotQuickRequest(): Partial<QuickRequest> {
  const fields: QuickKV[] = []
  const fileFields: string[] = []
  if (state.bodyType === 'form' || state.bodyType === 'urlencoded') {
    for (const row of state.body) {
      if (!row.name) continue
      const item = rowToKv(row)
      fields.push(item)
      if (isFileRow(row)) fileFields.push(item.id)
    }
  }

  const body: QuickBody = {
    mode: state.bodyType,
    text: state.bodyType === 'json' || state.bodyType === 'raw' ? state.rawBody : '',
    contentType: state.bodyType === 'json' ? 'application/json' : 'text/plain;charset=utf-8',
    fields,
    fileFields
  }

  const headers = state.header.filter((row) => row.name).map(rowToKv)
  const accept = props.detail.produces[0]
  if (accept) {
    headers.unshift({ id: uid('kv'), name: 'Accept', value: accept, enabled: true, description: '文档声明的响应类型', type: 'string' })
  }

  return {
    name: props.detail.summary || props.detail.operationId || props.detail.path,
    method: props.detail.method,
    url: `${(props.baseUrl || '').replace(/\/+$/, '')}${resolvedPath.value}`,
    params: queryRows.value.filter((row) => row.name).map(rowToKv),
    headers,
    body,
    timeout: state.timeout,
    remark: `来自接口文档 ${props.detail.method} ${props.detail.fullPath}`
  }
}

function handleSaveAsQuick() {
  const request = quickStore.addRequest(snapshotQuickRequest())
  ElMessage.success(`已存为快捷请求「${request.name}」，可在「快捷请求」页继续编辑`)
}

async function handleCopyUrl() {
  const ok = await copyText(fullUrl.value)
  ElMessage[ok ? 'success' : 'warning'](ok ? '地址已复制' : '复制失败')
}

async function handleCopyBody() {
  const ok = await copyText(state.rawBody)
  ElMessage[ok ? 'success' : 'warning'](ok ? '请求体已复制' : '复制失败')
}

/* ------------------------------------------------------------------ */
/* 行操作                                                             */
/* ------------------------------------------------------------------ */

function addRow(list: EditableRow[], loc: RowLoc) {
  list.push(newRow(loc))
}

function removeRow(list: EditableRow[], key: string) {
  delete fileMap[key]
  const index = list.findIndex((item) => item.key === key)
  if (index >= 0) list.splice(index, 1)
}

function syncGlobal(row: EditableRow) {
  const global = props.globalParams.find((item) => item.name === row.name)
  if (global) row.value = global.value
}

function formatJson() {
  const parsed = safeParse(state.rawBody)
  if (parsed === null) {
    ElMessage.warning('当前内容不是合法 JSON，无法格式化')
    return
  }
  state.rawBody = prettyJson(parsed)
}

function generateBodyExample() {
  const bodyParam = props.detail.parameters.find((item) => item.in === 'body' && item.level === 0)
  state.rawBody = bodyParam?.example || props.detail.requestExample || '{}'
  formatJson()
}

function pickFiles(row: EditableRow, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // 清空 value，保证再次选择同一个文件仍能触发 change
  input.value = ''
  if (!files.length) {
    delete fileMap[row.key]
    return
  }
  fileMap[row.key] = isMultiFile(row) ? files : files.slice(0, 1)
}

function clearFiles(row: EditableRow) {
  delete fileMap[row.key]
}

function fileNames(row: EditableRow): string {
  return (fileMap[row.key] ?? [])
    .map((file) => file.name)
    .join('、')
}

function changeRowType(row: EditableRow, value: string) {
  row.type = value
  row.rawType = value
  if (value === 'file') row.value = ''
  else delete fileMap[row.key]
}

/** 表单型请求体只有 form-data 支持文件 */
function rowTypeOptions(row: EditableRow) {
  if (row.loc === 'body' && state.bodyType !== 'form') return ROW_TYPES.filter((item) => item.value !== 'file')
  return ROW_TYPES
}

/** Header 参数名自动补全：按输入前缀过滤常用请求头 */
function queryHeaderSuggestions(queryString: string, cb: (list: { value: string; label: string }[]) => void) {
  const q = queryString.trim().toLowerCase()
  const list = q
    ? headerNameSuggestions.filter((item) => item.value.toLowerCase().includes(q))
    : headerNameSuggestions
  cb(list)
}

/* ------------------------------------------------------------------ */
/* JSON 树渲染                                                        */
/* ------------------------------------------------------------------ */

interface TreeNode {
  key: string
  label: string
  value: string
  type: 'object' | 'array' | 'value'
  children: TreeNode[]
}

function toTree(value: unknown, label: string, key: string): TreeNode {
  if (Array.isArray(value)) {
    return {
      key,
      label,
      value: `Array(${value.length})`,
      type: 'array',
      children: value.map((item, index) => toTree(item, String(index), `${key}.${index}`))
    }
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return {
      key,
      label,
      value: `Object(${entries.length})`,
      type: 'object',
      children: entries.map(([k, v]) => toTree(v, k, `${key}.${k}`))
    }
  }
  return {
    key,
    label,
    value:
      typeof value === 'string'
        ? `"${value}"`
        : value === null
          ? 'null'
          : String(value),
    type: 'value',
    children: []
  }
}

const jsonTree = computed<TreeNode[]>(() => {
  const parsed = safeParse(response.value?.body ?? '')
  if (parsed === null) return []
  if (Array.isArray(parsed)) return parsed.map((item, index) => toTree(item, String(index), `root.${index}`))
  if (parsed !== null && typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>)
    return entries.map(([k, v]) => toTree(v, k, `root.${k}`))
  }
  return [toTree(parsed, 'root', 'root')]
})

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.key === path) return node
    const hit = findNode(node.children, path)
    if (hit) return hit
  }
  return null
}

watch(jsonPath, (path) => {
  const node = findNode(jsonTree.value, path)
  if (node) ElMessage.info(node.value.length > 60 ? `${node.value.slice(0, 60)}…` : node.value)
})
</script>

<template>
  <div class="debug-tab">
    <!-- 请求行：地址 + 发送 -->
    <div class="req-bar">
      <span class="req-bar__method" :class="`method-${detail.method.toLowerCase()}`">{{ detail.method }}</span>
      <el-input
        v-model="state.prefixUrl"
        class="req-bar__prefix kd-mono"
        placeholder="前缀地址，如 http://127.0.0.1:9999"
        spellcheck="false"
      />
      <span class="req-bar__path kd-mono">{{ resolvedPath }}{{ queryString ? `?${queryString}` : '' }}</span>
      <el-tooltip content="复制完整地址" placement="top">
        <el-button link class="req-bar__icon" @click="handleCopyUrl">
          <el-icon><CopyDocument /></el-icon>
        </el-button>
      </el-tooltip>
      <el-button type="primary" :loading="sending" @click="handleSend">
        <el-icon><Promotion /></el-icon>
        <span>{{ sending ? '请求中' : '发送' }}</span>
      </el-button>
      <el-button @click="handleReset">重置</el-button>
      <el-tooltip content="把当前参数与取值存成一条快捷请求" placement="bottom">
        <el-button @click="handleSaveAsQuick">
          <el-icon><Star /></el-icon>
          <span>存为快捷请求</span>
        </el-button>
      </el-tooltip>
    </div>

    <el-alert
      v-if="missingRequired.length"
      type="warning"
      :closable="false"
      show-icon
      :title="`以下必填参数尚未填写：${missingRequired.join('、')}`"
    />

    <!-- 请求参数 -->
    <section class="req-panel">
      <el-tabs v-model="activeSection" class="req-tabs">
        <el-tab-pane name="params">
          <template #label>
            <span class="tab-label">
              Params
              <em v-if="sectionCounts.params" class="tab-label__count">{{ sectionCounts.params }}</em>
            </span>
          </template>
        </el-tab-pane>
        <el-tab-pane name="body">
          <template #label>
            <span class="tab-label">
              Body
              <em v-if="sectionCounts.body" class="tab-label__count">{{ sectionCounts.body }}</em>
            </span>
          </template>
        </el-tab-pane>
        <el-tab-pane name="headers">
          <template #label>
            <span class="tab-label">
              Headers
              <em v-if="sectionCounts.headers" class="tab-label__count">{{ sectionCounts.headers }}</em>
            </span>
          </template>
        </el-tab-pane>
        <el-tab-pane name="settings" label="设置" />
      </el-tabs>

      <div class="req-panel__body">
        <!-- Params -->
        <template v-if="activeSection === 'params'">
          <div class="panel-tools">
            <span class="panel-tools__hint">Path 参数替换地址中的 {占位}，Query 参数拼到 URL</span>
            <el-button link size="small" @click="addRow(state.params, 'query')">
              <el-icon><Plus /></el-icon>
              <span>添加 Query 参数</span>
            </el-button>
          </div>

          <el-table :data="state.params" size="small" empty-text="该接口没有 Path / Query 参数" class="edit-table">
            <el-table-column width="40" align="center">
              <template #default="{ row }"><el-checkbox v-model="row.enabled" /></template>
            </el-table-column>
            <el-table-column label="参数名" min-width="170">
              <template #default="{ row }">
                <el-input v-if="row.editable" v-model="row.name" class="kd-mono" placeholder="参数名" />
                <div v-else class="cell-name">
                  <span class="kd-mono">{{ row.name }}</span>
                  <em v-if="row.loc === 'path'" class="cell-name__mark" title="路径参数">{ }</em>
                  <i v-if="row.required" class="cell-name__star">*</i>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="参数值" min-width="220">
              <template #default="{ row }">
                <el-select
                  v-if="row.enumValues && row.enumValues.length"
                  v-model="row.value"
                  clearable
                  placeholder="请选择"
                  class="full-width"
                >
                  <el-option v-for="(value, index) in row.enumValues" :key="index" :label="String(value)" :value="String(value)" />
                </el-select>
                <el-input v-else v-model="row.value" class="kd-mono" placeholder="参数值" />
              </template>
            </el-table-column>
            <el-table-column label="类型" width="110">
              <template #default="{ row }">
                <el-select
                  v-if="row.editable"
                  :model-value="row.type"
                  @update:model-value="(value: string) => changeRowType(row, value)"
                >
                  <el-option v-for="item in rowTypeOptions(row)" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
                <TypeBadge v-else :type="row.type" :ref-name="row.refName" />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="150">
              <template #default="{ row }">
                <span class="row-desc">{{ row.description || '—' }}</span>
                <el-tag v-if="row.source === 'global'" size="small" type="warning" effect="plain" class="row-tag">全局</el-tag>
                <el-tag v-else-if="row.required" size="small" type="danger" effect="plain" class="row-tag">必填</el-tag>
              </template>
            </el-table-column>
            <el-table-column width="40" align="center">
              <template #default="{ row }">
                <el-button v-if="row.editable" link type="danger" size="small" @click="removeRow(state.params, row.key)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <!-- Body -->
        <template v-else-if="activeSection === 'body'">
          <div class="body-types">
            <button
              v-for="opt in BODY_TYPES"
              :key="opt.value"
              type="button"
              class="body-types__item"
              :class="{ 'is-active': state.bodyType === opt.value }"
              :title="opt.hint"
              @click="state.bodyType = opt.value"
            >
              {{ opt.label }}
            </button>
            <span v-if="state.bodyType !== docBodyType" class="body-types__doc">
              文档声明为 {{ bodyTypeLabel(docBodyType) }}
              <el-button link size="small" @click="state.bodyType = docBodyType">恢复</el-button>
            </span>
          </div>

          <div v-if="state.bodyType === 'none'" class="panel-empty">该接口不发送请求体</div>

          <template v-else-if="isTableBody">
            <div class="panel-tools">
              <span class="panel-tools__hint">
                {{ state.bodyType === 'form' ? '类型为「文件」的字段会作为 multipart 文件上传' : '表单字段将编码为 a=1&b=2' }}
              </span>
              <el-button link size="small" @click="addRow(state.body, 'body')">
                <el-icon><Plus /></el-icon>
                <span>添加字段</span>
              </el-button>
            </div>

            <el-table :data="state.body" size="small" empty-text="无表单字段" class="edit-table">
              <el-table-column width="40" align="center">
                <template #default="{ row }"><el-checkbox v-model="row.enabled" /></template>
              </el-table-column>
              <el-table-column label="字段名" min-width="170">
                <template #default="{ row }">
                  <el-input v-if="row.editable" v-model="row.name" class="kd-mono" placeholder="字段名" />
                  <div v-else class="cell-name">
                    <span class="kd-mono">{{ row.name }}</span>
                    <i v-if="row.required" class="cell-name__star">*</i>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="参数值" min-width="230">
                <template #default="{ row }">
                  <div v-if="isFileRow(row)" class="file-cell">
                    <label class="file-picker">
                      <input
                        class="file-picker__input"
                        type="file"
                        :multiple="isMultiFile(row)"
                        @change="pickFiles(row, $event)"
                      />
                      <span class="file-picker__btn" :class="{ 'is-chosen': fileMap[row.key]?.length }">
                        <el-icon><Upload /></el-icon>
                        <span class="file-picker__text">{{ fileNames(row) || '选择文件' }}</span>
                      </span>
                    </label>
                    <el-button
                      v-if="fileMap[row.key]?.length"
                      link
                      size="small"
                      title="清除已选文件"
                      @click="clearFiles(row)"
                    >
                      <el-icon><Close /></el-icon>
                    </el-button>
                  </div>
                  <el-input v-else v-model="row.value" class="kd-mono" placeholder="参数值" />
                </template>
              </el-table-column>
              <el-table-column label="类型" width="110">
                <template #default="{ row }">
                  <el-select
                    v-if="row.editable"
                    :model-value="row.type"
                    @update:model-value="(value: string) => changeRowType(row, value)"
                  >
                    <el-option v-for="item in rowTypeOptions(row)" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                  <TypeBadge v-else :type="row.type" :ref-name="row.refName" />
                </template>
              </el-table-column>
              <el-table-column label="说明" min-width="150">
                <template #default="{ row }">
                  <span class="row-desc">{{ row.description || '—' }}</span>
                  <el-tag v-if="isFileRow(row)" size="small" type="info" effect="plain" class="row-tag">文件</el-tag>
                </template>
              </el-table-column>
              <el-table-column width="40" align="center">
                <template #default="{ row }">
                  <el-button v-if="row.editable" link type="danger" size="small" @click="removeRow(state.body, row.key)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>

          <div v-else class="editor">
            <div class="editor__bar">
              <span class="editor__lang kd-mono">{{ state.bodyType === 'json' ? 'application/json' : 'text/plain' }}</span>
              <div class="editor__tools">
                <el-button v-if="state.bodyType === 'json'" link size="small" @click="generateBodyExample">
                  <el-icon><MagicStick /></el-icon>
                  <span>生成示例</span>
                </el-button>
                <el-button v-if="state.bodyType === 'json'" link size="small" @click="formatJson">
                  <el-icon><Sort /></el-icon>
                  <span>格式化</span>
                </el-button>
                <el-button link size="small" @click="handleCopyBody">
                  <el-icon><CopyDocument /></el-icon>
                  <span>复制</span>
                </el-button>
              </div>
            </div>
            <textarea
              v-model="state.rawBody"
              class="editor__area kd-mono"
              spellcheck="false"
              :placeholder="state.bodyType === 'json' ? '{&quot;name&quot;: &quot;test&quot;}' : '请输入请求体文本'"
            />
            <div v-if="rawJsonInvalid" class="editor__warn">内容不是合法 JSON，发送时会按原始字符串提交</div>
          </div>
        </template>

        <!-- Headers -->
        <template v-else-if="activeSection === 'headers'">
          <div class="panel-tools">
            <span class="panel-tools__hint">带「全局」标签的行来自全局参数配置，可点击右侧按钮同步最新值</span>
            <el-button link size="small" @click="addRow(state.header, 'header')">
              <el-icon><Plus /></el-icon>
              <span>添加 Header</span>
            </el-button>
          </div>

          <el-table :data="state.header" size="small" empty-text="无 Header 参数" class="edit-table">
            <el-table-column width="40" align="center">
              <template #default="{ row }"><el-checkbox v-model="row.enabled" /></template>
            </el-table-column>
            <el-table-column label="参数名" min-width="180">
              <template #default="{ row }">
                <el-autocomplete
                  v-if="row.editable"
                  v-model="row.name"
                  :fetch-suggestions="queryHeaderSuggestions"
                  class="kd-mono"
                  placeholder="参数名"
                  value-key="value"
                />
                <div v-else class="cell-name">
                  <span class="kd-mono">{{ row.name }}</span>
                  <i v-if="row.required" class="cell-name__star">*</i>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="参数值" min-width="260">
              <template #default="{ row }">
                <el-input
                  v-model="row.value"
                  class="kd-mono"
                  placeholder="参数值"
                  :type="/token|authorization|secret|password/i.test(row.name) ? 'password' : 'text'"
                  show-password
                />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="160">
              <template #default="{ row }">
                <span class="row-desc">{{ row.description || '—' }}</span>
                <el-tag v-if="row.source === 'global'" size="small" type="warning" effect="plain" class="row-tag">全局</el-tag>
                <el-tag v-else-if="row.required" size="small" type="danger" effect="plain" class="row-tag">必填</el-tag>
              </template>
            </el-table-column>
            <el-table-column width="40" align="center">
              <template #default="{ row }">
                <el-button
                  v-if="row.source === 'global'"
                  link
                  size="small"
                  title="从全局参数同步最新值"
                  @click="syncGlobal(row)"
                >
                  <el-icon><Refresh /></el-icon>
                </el-button>
                <el-button v-else-if="row.editable" link type="danger" size="small" @click="removeRow(state.header, row.key)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <!-- 设置 -->
        <template v-else>
          <div class="settings">
            <div class="setting-item">
              <span class="setting-item__label">请求超时</span>
              <el-input-number v-model="state.timeout" :min="0" :step="1000" size="small" controls-position="right" />
              <span class="setting-item__hint">单位毫秒，0 表示不限制</span>
            </div>
            <div class="setting-item">
              <span class="setting-item__label">携带 Cookie</span>
              <el-switch v-model="state.withCredentials" size="small" />
              <span class="setting-item__hint">桌面端由 Rust 客户端发出请求，Cookie 随响应自动保持；浏览器预览模式需后端允许凭据</span>
            </div>
            <div class="setting-item">
              <span class="setting-item__label">全局参数</span>
              <span class="setting-item__value">{{ globalParams.length }} 条已配置</span>
              <span class="setting-item__hint">在左侧边栏「全局参数」中维护，自动合并到 Params / Headers</span>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- 响应 -->
    <section class="resp-panel">
      <div class="resp-head">
        <span class="resp-head__title">返回响应</span>
        <template v-if="response">
          <el-tag :type="response.ok ? 'success' : 'danger'" effect="dark" size="small" class="kd-mono">
            {{ response.status || 'ERR' }} {{ response.statusText }}
          </el-tag>
          <span class="resp-stat">
            <el-icon><Timer /></el-icon>
            {{ formatDuration(response.duration) }}
          </span>
          <span class="resp-stat">
            <el-icon><Files /></el-icon>
            {{ (response.size / 1024).toFixed(2) }} KB
          </span>
          <div class="resp-head__actions">
            <el-tooltip content="复制响应内容" placement="top">
              <el-button link size="small" @click="handleCopyResponse">
                <el-icon><CopyDocument /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip content="下载响应内容" placement="top">
              <el-button link size="small" @click="handleDownload">
                <el-icon><Download /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
        </template>
        <span v-else class="resp-head__hint">尚未发送请求</span>
      </div>

      <div v-if="!response" class="resp-empty">
        <el-icon><Monitor /></el-icon>
        <p>点击「发送」查看响应结果</p>
      </div>

      <template v-else>
        <el-alert v-if="response.error" type="error" :closable="false" show-icon class="resp-error" :title="response.error" />

        <el-tabs v-model="responseTab" class="resp-tabs">
          <el-tab-pane v-for="tab in responseTabs" :key="tab.name" :name="tab.name" :label="tab.label" />

          <div class="resp-body">
            <template v-if="responseTab === 'body'">
              <CodeBlock :code="prettyBody || response.body" lang="json" max-height="none" />
            </template>

            <template v-else-if="responseTab === 'headers'">
              <el-table :data="Object.entries(response.headers).map(([k, v]) => ({ k, v }))" size="small" border>
                <el-table-column label="名称" width="220" prop="k" class="kd-mono" />
                <el-table-column label="值" prop="v" />
              </el-table>
            </template>

            <template v-else-if="responseTab === 'tree'">
              <el-tree
                :data="jsonTree"
                node-key="key"
                :props="{ label: 'label', children: 'children' }"
                default-expand-all
                class="json-tree"
                @node-click="(node: TreeNode) => (jsonPath = node.key)"
              >
                <template #default="{ data }">
                  <span class="json-node">
                    <span class="json-node__key">{{ data.label }}</span>
                    <span class="json-node__colon">:</span>
                    <span class="json-node__value" :class="`is-${data.type}`">{{ data.value }}</span>
                  </span>
                </template>
              </el-tree>
            </template>

            <template v-else-if="responseTab === 'curl'">
              <CodeBlock :code="response.curl" lang="text" max-height="none" />
            </template>

            <template v-else>
              <el-descriptions :column="1" border size="small" class="request-info">
                <el-descriptions-item label="请求地址">
                  <span class="kd-mono">{{ response.finalUrl }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="请求方法">
                  <span class="kd-mono">{{ detail.method }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="请求头">
                  <div v-if="Object.keys(requestHeaders).length" class="kv-list">
                    <div v-for="(value, key) in requestHeaders" :key="key" class="kv-item">
                      <span class="kv-item__k kd-mono">{{ key }}</span>
                      <span class="kv-item__v kd-mono">{{ value }}</span>
                    </div>
                  </div>
                  <span v-else class="text-muted">无</span>
                </el-descriptions-item>
                <el-descriptions-item v-if="state.bodyType === 'json'" label="请求体">
                  <CodeBlock :code="state.rawBody" lang="json" max-height="260px" />
                </el-descriptions-item>
              </el-descriptions>
            </template>
          </div>
        </el-tabs>
      </template>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.debug-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ------------------------------------------------------------------ */
/* 请求行                                                              */
/* ------------------------------------------------------------------ */

.req-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 10px;
  border-radius: $radius-md;
  border: 1px solid var(--kd-border-strong);
  background: var(--kd-panel);
}

.req-bar__method {
  flex-shrink: 0;
  font-family: $font-mono;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: $radius-sm;
  color: #fff;
  background: var(--kd-primary);

  &.method-get {
    background: #61affe;
  }

  &.method-post {
    background: #49cc90;
  }

  &.method-put {
    background: #fca130;
  }

  &.method-delete {
    background: #f93e3e;
  }

  &.method-patch {
    background: #50e3c2;
  }

  &.method-head,
  &.method-options {
    background: #8a93a5;
  }
}

.req-bar__prefix {
  flex-shrink: 0;
  width: 240px;
}

.req-bar__path {
  flex: 1;
  min-width: 0;
  font-size: $font-sm;
  color: var(--kd-text);
  @include ellipsis(1);
  padding: 0 2px;
}

.req-bar__icon {
  flex-shrink: 0;
  color: var(--kd-text-3);
}

/* ------------------------------------------------------------------ */
/* 请求面板                                                            */
/* ------------------------------------------------------------------ */

.req-panel {
  border: 1px solid var(--kd-border);
  border-radius: $radius-lg;
  background: var(--kd-panel);
  overflow: hidden;
}

.req-tabs {
  :deep(.el-tabs__header) {
    margin: 0;
    padding: 0 14px;
    background: var(--kd-panel-2);
  }

  :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
    background: var(--kd-border);
  }

  :deep(.el-tabs__item) {
    height: 38px;
    line-height: 38px;
  }
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.tab-label__count {
  font-style: normal;
  font-size: 11px;
  line-height: 15px;
  min-width: 15px;
  padding: 0 4px;
  text-align: center;
  border-radius: 999px;
  background: var(--kd-primary-soft);
  color: var(--kd-primary);
}

.req-panel__body {
  padding: 12px 14px 14px;
}

.panel-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 8px;
  min-height: 24px;
}

.panel-tools__hint {
  margin-right: auto;
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.panel-empty {
  padding: 22px;
  border: 1px dashed var(--kd-border-strong);
  border-radius: $radius-md;
  color: var(--kd-text-3);
  font-size: $font-sm;
  text-align: center;
}

/* ------------------------------------------------------------------ */
/* Body 类型切换                                                       */
/* ------------------------------------------------------------------ */

.body-types {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.body-types__item {
  padding: 3px 12px;
  border: 1px solid var(--kd-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--kd-text-2);
  font-family: $font-mono;
  font-size: $font-xs;
  line-height: 18px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: var(--kd-primary);
    border-color: var(--kd-primary);
  }

  &.is-active {
    background: var(--kd-primary);
    border-color: var(--kd-primary);
    color: #fff;
  }
}

.body-types__doc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  font-size: $font-xs;
  color: var(--kd-warning);
}

/* ------------------------------------------------------------------ */
/* 参数表格                                                            */
/* ------------------------------------------------------------------ */

.edit-table {
  :deep(.el-table__cell) {
    padding: 3px 0;
  }
}

.cell-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--kd-text);
}

.cell-name__mark {
  font-style: normal;
  font-size: 11px;
  padding: 0 4px;
  border-radius: $radius-sm;
  background: var(--kd-primary-soft);
  color: var(--kd-primary);
}

.cell-name__star {
  font-style: normal;
  color: var(--kd-danger);
}

.row-desc {
  font-size: 12px;
  color: var(--kd-text-3);
}

.row-tag {
  margin-left: 6px;
  transform: scale(0.86);
}

.full-width {
  width: 100%;
}

/* ------------------------------------------------------------------ */
/* 文件上传                                                            */
/* ------------------------------------------------------------------ */

.file-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.file-picker {
  position: relative;
  display: inline-flex;
  min-width: 0;
  cursor: pointer;
}

.file-picker__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.file-picker__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 260px;
  min-width: 0;
  padding: 3px 10px;
  border: 1px dashed var(--kd-border-strong);
  border-radius: $radius-sm;
  background: var(--kd-panel-2);
  color: var(--kd-text-2);
  font-size: $font-xs;
  line-height: 18px;

  &:hover {
    border-color: var(--kd-primary);
    color: var(--kd-primary);
  }

  &.is-chosen {
    border-style: solid;
    border-color: var(--kd-success);
    background: var(--kd-success-soft);
    color: var(--kd-success);
  }
}

.file-picker__text {
  @include ellipsis(1);
}

/* ------------------------------------------------------------------ */
/* 文本请求体编辑器                                                    */
/* ------------------------------------------------------------------ */

.editor {
  border: 1px solid var(--kd-border-strong);
  border-radius: $radius-md;
  overflow: hidden;
  background: var(--kd-code-bg);
}

.editor__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--kd-border);
  background: var(--kd-panel-2);
}

.editor__lang {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.editor__tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.editor__area {
  display: block;
  width: 100%;
  min-height: 300px;
  padding: 12px 14px;
  border: 0;
  outline: none;
  resize: vertical;
  background: transparent;
  color: var(--kd-text);
  font-size: $font-sm;
  line-height: 1.7;

  &::placeholder {
    color: var(--kd-text-3);
  }
}

.editor__warn {
  padding: 6px 12px;
  border-top: 1px solid var(--kd-border);
  background: var(--kd-warning);
  color: #fff;
  font-size: $font-xs;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

.settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setting-item__label {
  flex-shrink: 0;
  width: 84px;
  font-size: $font-sm;
  color: var(--kd-text-2);
}

.setting-item__value {
  font-size: $font-sm;
  color: var(--kd-text);
}

.setting-item__hint {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

/* ------------------------------------------------------------------ */
/* 响应面板                                                            */
/* ------------------------------------------------------------------ */

.resp-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--kd-border);
  border-radius: $radius-lg;
  background: var(--kd-panel);
  height: clamp(360px, 52vh, 640px);
  overflow: hidden;
}

.resp-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 14px;
  border-bottom: 1px solid var(--kd-border);
  background: var(--kd-panel-2);
  flex-shrink: 0;
}

.resp-head__title {
  font-size: $font-sm;
  font-weight: 600;
  color: var(--kd-text);
}

.resp-head__hint {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.resp-head__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.resp-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.resp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--kd-text-3);

  .el-icon {
    font-size: 34px;
    color: var(--kd-border-strong);
  }

  p {
    font-size: $font-sm;
  }
}

.resp-error {
  margin: 10px 14px 0;
  width: auto;
}

.resp-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  :deep(.el-tabs__header) {
    margin: 0;
    padding: 0 14px;
    flex-shrink: 0;
  }

  :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
    background: var(--kd-border);
  }

  :deep(.el-tabs__content) {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 14px 14px;
    @include scrollbar;
  }
}

.resp-body {
  min-height: 120px;
}

.json-tree {
  background: transparent;

  :deep(.el-tree-node__content) {
    height: 26px;
  }
}

.json-node {
  font-family: $font-mono;
  font-size: 12.5px;
}

.json-node__key {
  color: #7b57d6;
}

html.dark .json-node__key {
  color: #c792ea;
}

.json-node__colon {
  margin: 0 4px;
  color: var(--kd-text-3);
}

.json-node__value {
  &.is-object,
  &.is-array {
    color: var(--kd-text-3);
  }

  &.is-value {
    color: var(--kd-text);
  }
}

.request-info {
  :deep(.el-descriptions__label) {
    width: 100px;
    font-weight: 600;
  }
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kv-item {
  display: flex;
  gap: 10px;
  font-size: 12px;
}

.kv-item__k {
  color: var(--kd-text-3);
  min-width: 160px;
  flex-shrink: 0;
}

.kv-item__v {
  color: var(--kd-text);
  word-break: break-all;
}

.text-muted {
  color: var(--kd-text-3);
}
</style>
