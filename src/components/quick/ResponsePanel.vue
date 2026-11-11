<script setup lang="ts">
/**
 * 响应面板（对齐 Apifox）：Body / Cookie / Header / 控制台 / 实际请求。
 *
 * 面板自身只负责「展示」，高度与折叠状态由父级的弹性布局决定；
 * 内容一律在面板内部滚动，不允许把整页撑出滚动条。
 */

import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

import CodeBlock from '@/components/common/CodeBlock.vue'
import { copyText, decodeBodyBytes, type DebugRequestOptions, type DebugResponseResult } from '@/core/http'
import { prettyJson, safeParse, formatBytes, formatDuration } from '@/core/utils'

const props = defineProps<{
  response: DebugResponseResult | null
  sending: boolean
  /** 保存响应时使用的默认文件名 */
  downloadName: string
  /** 本次发送实际使用的请求参数，用于「实际请求」页签 */
  sent: DebugRequestOptions | null
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'save', content: string): void
  (e: 'toggle'): void
}>()

type TabName = 'body' | 'cookie' | 'header' | 'console' | 'actual'
type ViewName = 'pretty' | 'raw' | 'preview' | 'visual'
type FormatName = 'auto' | 'json' | 'xml' | 'html' | 'text'

const activeTab = ref<TabName>('body')
const view = ref<ViewName>('pretty')
const format = ref<FormatName>('auto')
const encoding = ref('utf-8')

const VIEW_MODES: { value: ViewName; label: string }[] = [
  { value: 'pretty', label: 'Pretty' },
  { value: 'raw', label: 'Raw' },
  { value: 'preview', label: 'Preview' },
  { value: 'visual', label: 'Visualize' }
]

const FORMATS: { value: FormatName; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'html', label: 'HTML' },
  { value: 'text', label: 'Text' },
  { value: 'auto', label: 'Auto' }
]

const ENCODINGS = ['utf-8', 'gbk', 'gb2312', 'big5', 'shift_jis', 'euc-kr', 'iso-8859-1', 'windows-1252']

/* ------------------------------------------------------------------ */
/* 响应体                                                              */
/* ------------------------------------------------------------------ */

const contentType = computed(() => props.response?.headers['content-type'] ?? '')

/** 按当前编码重新解码原始字节；没选中时和 response.body 一致 */
const bodyText = computed(() => {
  const response = props.response
  if (!response) return ''
  if (encoding.value === 'utf-8' || !response.bodyBytes?.length) return response.body
  return decodeBodyBytes(response.bodyBytes, encoding.value)
})

/** Auto 时先看 Content-Type，再看内容长相 */
const resolvedFormat = computed<Exclude<FormatName, 'auto'>>(() => {
  if (format.value !== 'auto') return format.value
  const type = contentType.value.toLowerCase()
  if (type.includes('json')) return 'json'
  if (type.includes('html')) return 'html'
  if (type.includes('xml')) return 'xml'
  if (safeParse(bodyText.value) !== null) return 'json'
  if (/^\s*</.test(bodyText.value)) return 'html'
  return 'text'
})

const displayBody = computed(() => {
  if (resolvedFormat.value !== 'json') return bodyText.value
  const parsed = safeParse(bodyText.value)
  return parsed === null ? bodyText.value : prettyJson(parsed)
})

const highlightLang = computed(() => {
  switch (resolvedFormat.value) {
    case 'json':
      return 'json' as const
    case 'xml':
    case 'html':
      return 'xml' as const
    default:
      return 'text' as const
  }
})

const formatLabel = computed(() => (format.value === 'auto' ? `Auto（${resolvedFormat.value.toUpperCase()}）` : format.value.toUpperCase()))

/* ------------------------------------------------------------------ */
/* 可视化表格                                                          */
/* ------------------------------------------------------------------ */

interface VisualTable {
  columns: string[]
  rows: Record<string, string>[]
}

/** JSON 数组 / 对象转表格；结构不满足时返回 null，界面给出提示 */
const visualTable = computed<VisualTable | null>(() => {
  const parsed = safeParse<unknown>(bodyText.value)
  if (parsed === null) return null

  const cell = (value: unknown): string =>
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)

  if (Array.isArray(parsed)) {
    const objects = parsed.filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
    )
    if (!objects.length) {
      return { columns: ['#', '值'], rows: parsed.map((item, index) => ({ '#': String(index + 1), 值: cell(item) })) }
    }
    const columns = [...new Set(objects.flatMap((item) => Object.keys(item)))]
    return { columns, rows: objects.map((item) => Object.fromEntries(columns.map((key) => [key, cell(item[key])]))) }
  }

  if (typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>)
    return { columns: ['字段', '值'], rows: entries.map(([key, value]) => ({ 字段: key, 值: cell(value) })) }
  }
  return null
})

/* ------------------------------------------------------------------ */
/* 响应头 / Cookie                                                     */
/* ------------------------------------------------------------------ */

const headerRows = computed(() =>
  Object.entries(props.response?.headers ?? {}).map(([name, value]) => ({ name, value }))
)

interface CookieRow {
  name: string
  value: string
  domain: string
  path: string
  expires: string
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

/**
 * set-cookie 可能被合并成一个字符串，而 Expires 里本身带逗号，
 * 所以只在「后面紧跟 name=」的位置切分。
 */
function splitSetCookie(raw: string): string[] {
  return raw
    .split(/,(?=\s*[\w.-]+=)/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const cookieRows = computed<CookieRow[]>(() => {
  const raw = props.response?.headers?.['set-cookie'] ?? ''
  if (!raw) return []
  return splitSetCookie(raw).map((line) => {
    const [pair, ...attrs] = line.split(';')
    const eq = pair.indexOf('=')
    const row: CookieRow = {
      name: eq < 0 ? pair.trim() : pair.slice(0, eq).trim(),
      value: eq < 0 ? '' : pair.slice(eq + 1).trim(),
      domain: '',
      path: '',
      expires: '',
      httpOnly: false,
      secure: false,
      sameSite: ''
    }
    for (const attr of attrs) {
      const text = attr.trim()
      const key = text.split('=')[0]?.toLowerCase() ?? ''
      const value = text.slice(key.length + 1).trim()
      if (key === 'domain') row.domain = value
      else if (key === 'path') row.path = value
      else if (key === 'expires' || key === 'max-age') row.expires = row.expires || value
      else if (key === 'httponly') row.httpOnly = true
      else if (key === 'secure') row.secure = true
      else if (key === 'samesite') row.sameSite = value
    }
    return row
  })
})

/* ------------------------------------------------------------------ */
/* 页签                                                                */
/* ------------------------------------------------------------------ */

const TABS = computed<{ name: TabName; label: string; count?: number }[]>(() => [
  { name: 'body', label: 'Body' },
  { name: 'cookie', label: 'Cookie', count: cookieRows.value.length },
  { name: 'header', label: 'Header', count: headerRows.value.length },
  { name: 'console', label: '控制台' },
  { name: 'actual', label: '实际请求' }
])

/* ------------------------------------------------------------------ */
/* 控制台 / 实际请求                                                   */
/* ------------------------------------------------------------------ */

interface ConsoleRow {
  time: string
  level: 'info' | 'warn' | 'error'
  text: string
}

const consoleRows = computed<ConsoleRow[]>(() => {
  const response = props.response
  if (!response) return []
  const rows: ConsoleRow[] = []
  const stamp = new Date(Date.now() - response.duration).toLocaleTimeString('zh-CN', { hour12: false })
  const push = (level: ConsoleRow['level'], text: string) => rows.push({ time: stamp, level, text })

  push('info', `${props.sent?.method?.toUpperCase() ?? 'GET'} ${props.sent?.url ?? response.finalUrl}`)
  push(response.status >= 400 || !response.status ? 'error' : 'info', `${response.status} ${response.statusText}`)
  push('info', `耗时 ${formatDuration(response.duration)}，大小 ${formatBytes(response.size)}`)
  if (contentType.value) push('info', `Content-Type: ${contentType.value}`)
  if (response.finalUrl && props.sent?.url && response.finalUrl !== props.sent.url) {
    push('warn', `最终地址：${response.finalUrl}`)
  }
  if (cookieRows.value.length) push('info', `Set-Cookie ${cookieRows.value.length} 条`)
  if (response.error) push('error', response.error)
  return rows
})

const actualRequest = computed(() => {
  const sent = props.sent
  if (!sent) return ''
  const lines: string[] = [`${sent.method.toUpperCase()} ${pathOf(sent.url)} HTTP/1.1`]
  const headers = Object.entries(sent.headers).filter(([key]) => key)
  if (headers.length) {
    for (const [key, value] of headers) lines.push(`${key}: ${value}`)
  } else {
    // 没写自定义头时明确说明，避免报文看起来像被截断
    lines.push('(未设置自定义请求头，其余由运行时补充)')
  }
  const body = sentBody(sent)
  if (body) {
    lines.push('')
    lines.push(body)
  }
  return lines.join('\n')
})

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function sentBody(sent: DebugRequestOptions): string {
  if (sent.rawText) return sent.rawText
  if (sent.bodyMode === 'form' && sent.formFields?.length) {
    return sent.formFields.map((field) => `${field.name}=${field.value}`).join('&')
  }
  if (sent.bodyMode === 'formData') {
    const rows = [...(sent.formFields ?? []).map((field) => `${field.name}=${field.value}`)]
    rows.push(...(sent.files ?? []).map((file) => `${file.name}=@${file.file.name}`))
    return rows.join('\n')
  }
  if (sent.data && typeof sent.data === 'object') return JSON.stringify(sent.data, null, 2)
  return sent.data === undefined || sent.data === null ? '' : String(sent.data)
}

/* ------------------------------------------------------------------ */
/* 头部摘要                                                            */
/* ------------------------------------------------------------------ */

const statusClass = computed(() => {
  const status = props.response?.status ?? 0
  if (!status) return 'is-error'
  if (status < 300) return 'is-success'
  if (status < 400) return 'is-redirect'
  if (status < 500) return 'is-warning'
  return 'is-danger'
})

const sizeLabel = computed(() => formatBytes(props.response?.size ?? 0))

async function copyBody() {
  const ok = await copyText(displayBody.value || bodyText.value)
  ElMessage[ok ? 'success' : 'warning'](ok ? '响应内容已复制' : '复制失败')
}

function saveBody() {
  const text = displayBody.value || bodyText.value
  if (!text) {
    ElMessage.warning('还没有可保存的响应')
    return
  }
  emit('save', text)
}
</script>

<template>
  <div class="resp-panel" :class="{ 'is-collapsed': collapsed }">
    <div class="resp-head">
      <div class="resp-tabs">
        <button
          v-for="item in TABS"
          :key="item.name"
          type="button"
          class="resp-tab"
          :class="{ 'is-active': activeTab === item.name }"
          :disabled="!response"
          @click="activeTab = item.name"
        >
          {{ item.label }}
          <em v-if="item.count" class="resp-tab__count">{{ item.count }}</em>
        </button>
      </div>

      <div class="resp-head__right">
        <template v-if="response">
          <span class="resp-status" :class="statusClass">{{ response.status || 'ERR' }}</span>
          <span class="resp-meta">{{ Math.round(response.duration) }}ms</span>
          <span class="resp-meta">{{ sizeLabel }}</span>
        </template>
        <span v-else-if="sending" class="resp-meta">请求发送中…</span>
        <span v-else class="resp-meta">未发送</span>

        <button type="button" class="resp-icon" title="复制响应" :disabled="!response" @click="copyBody">
          <el-icon><CopyDocument /></el-icon>
        </button>
        <button type="button" class="resp-icon" title="保存为文件" :disabled="!response" @click="saveBody">
          <el-icon><Download /></el-icon>
        </button>
        <button
          type="button"
          class="resp-icon"
          :title="collapsed ? '展开响应区' : '收起响应区'"
          @click="emit('toggle')"
        >
          <el-icon><component :is="collapsed ? 'ArrowUp' : 'ArrowDown'" /></el-icon>
        </button>
      </div>
    </div>

    <div v-if="collapsed" class="resp-collapsed">
      <span>{{ response ? `${response.status || 'ERR'} · 已收起响应区` : '发送请求后在这里查看响应' }}</span>
    </div>

    <template v-else>
      <div v-if="activeTab === 'body' && response" class="resp-toolbar">
        <div class="resp-views">
          <button
            v-for="item in VIEW_MODES"
            :key="item.value"
            type="button"
            class="resp-view"
            :class="{ 'is-active': view === item.value }"
            @click="view = item.value"
          >
            {{ item.label }}
          </button>
        </div>
        <el-dropdown trigger="click" @command="format = $event as FormatName">
          <button type="button" class="resp-pick">
            {{ formatLabel }}
            <el-icon><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="item in FORMATS" :key="item.value" :command="item.value">
                {{ item.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click" @command="encoding = String($event)">
          <button type="button" class="resp-pick">
            {{ encoding }}
            <el-icon><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="item in ENCODINGS" :key="item" :command="item">
                {{ item }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div v-if="!response" class="resp-empty">
        <el-icon :size="30"><Promotion /></el-icon>
        <p>填写地址后点击「发送」</p>
        <span>请求由 Rust 进程发出，不受浏览器跨域限制</span>
      </div>

      <div v-else class="resp-content">
        <el-alert
          v-if="response.error"
          type="error"
          show-icon
          :closable="false"
          :title="response.error"
          class="resp-error"
        />

        <template v-if="activeTab === 'body'">
          <div v-if="view === 'pretty'" class="resp-fill">
            <CodeBlock
              :code="displayBody"
              :lang="highlightLang"
              :title="`Content-Type: ${contentType || '—'} · ${formatLabel}`"
              line-numbers
              foldable
              copyable
              fill
            />
          </div>

          <pre v-else-if="view === 'raw'" class="resp-raw kd-scroll">{{ bodyText }}</pre>

          <iframe
            v-else-if="view === 'preview'"
            class="resp-preview"
            sandbox=""
            title="响应预览"
            :srcdoc="bodyText"
          />

          <div v-else class="resp-scroll kd-scroll">
            <el-table v-if="visualTable" :data="visualTable.rows" size="small" border>
              <el-table-column
                v-for="column in visualTable.columns"
                :key="column"
                :prop="column"
                :label="column"
                min-width="160"
                show-overflow-tooltip
              />
            </el-table>
            <p v-else class="resp-hint">响应体不是 JSON，无法可视化。可切到 Pretty / Raw 查看原文。</p>
          </div>
        </template>

        <div v-else-if="activeTab === 'cookie'" class="resp-scroll kd-scroll">
          <el-table v-if="cookieRows.length" :data="cookieRows" size="small" border>
            <el-table-column prop="name" label="Name" width="160" class-name="kd-mono" />
            <el-table-column prop="value" label="Value" min-width="220" class-name="kd-mono" show-overflow-tooltip />
            <el-table-column prop="domain" label="Domain" width="150" class-name="kd-mono" />
            <el-table-column prop="path" label="Path" width="110" class-name="kd-mono" />
            <el-table-column prop="expires" label="Expires / Max-Age" width="180" show-overflow-tooltip />
            <el-table-column label="属性" width="130">
              <template #default="{ row }">
                <span class="cookie-flags">
                  <em v-if="row.httpOnly">HttpOnly</em>
                  <em v-if="row.secure">Secure</em>
                  <em v-if="row.sameSite">{{ row.sameSite }}</em>
                </span>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="resp-hint">本次响应没有 Set-Cookie。桌面端由 Rust 进程直连，Cookie 不会自动写入 WebView。</p>
        </div>

        <div v-else-if="activeTab === 'header'" class="resp-scroll kd-scroll">
          <el-table :data="headerRows" size="small" border empty-text="没有响应头">
            <el-table-column prop="name" label="Header" width="240" class-name="kd-mono" />
            <el-table-column prop="value" label="Value" min-width="260" class-name="kd-mono" show-overflow-tooltip />
          </el-table>
        </div>

        <div v-else-if="activeTab === 'console'" class="resp-scroll kd-scroll">
          <ul class="resp-console">
            <li v-for="(row, index) in consoleRows" :key="index" :class="`is-${row.level}`">
              <span class="resp-console__time">{{ row.time }}</span>
              <span class="resp-console__text kd-mono">{{ row.text }}</span>
            </li>
          </ul>
        </div>

        <div v-else class="resp-scroll kd-scroll">
          <div class="resp-fill">
            <CodeBlock :code="actualRequest" lang="text" title="实际发出的请求报文" line-numbers copyable fill />
            <CodeBlock
              class="resp-curl"
              :code="response.curl"
              lang="text"
              title="可粘贴到终端复现该请求"
              line-numbers
              copyable
              fill
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.resp-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  @include card;

  &.is-collapsed {
    overflow: visible;
  }
}

.resp-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  min-height: 36px;
  padding: 0 10px 0 4px;
  border-bottom: 1px solid var(--kd-border);

  .is-collapsed & {
    border-bottom: none;
  }

  &__right {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
  }
}

.resp-tabs {
  display: flex;
  gap: 2px;
  align-items: center;
}

.resp-tab {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 8px 12px;
  font-size: $font-sm;
  color: var(--kd-text-2);
  cursor: pointer;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;

  &:hover:not(:disabled) {
    color: var(--kd-text);
  }

  &.is-active {
    font-weight: 600;
    color: var(--kd-primary);
    border-bottom-color: var(--kd-primary);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }

  &__count {
    padding: 0 5px;
    font-size: 11px;
    font-style: normal;
    color: var(--kd-primary);
    background: var(--kd-primary-soft);
    border-radius: 8px;
  }
}

.resp-status {
  padding: 2px 8px;
  font-family: $font-mono;
  font-size: $font-sm;
  font-weight: 700;
  border-radius: $radius-sm;

  &.is-success {
    color: var(--kd-success);
    background: var(--kd-success-soft);
  }

  &.is-warning {
    color: var(--kd-warning);
    background: rgba(255, 143, 31, 0.14);
  }

  &.is-danger,
  &.is-error {
    color: var(--kd-danger);
    background: var(--kd-danger-soft);
  }

  &.is-redirect {
    color: var(--kd-primary);
    background: var(--kd-primary-soft);
  }
}

.resp-meta {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.resp-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--kd-text-2);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: $radius-sm;

  &:hover:not(:disabled) {
    color: var(--kd-primary);
    background: var(--kd-primary-soft);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
}

.resp-collapsed {
  padding: 0 12px 8px;
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.resp-toolbar {
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--kd-border);
}

.resp-views {
  display: flex;
  gap: 4px;
}

.resp-view {
  padding: 3px 12px;
  font-size: $font-xs;
  color: var(--kd-text-2);
  cursor: pointer;
  background: var(--kd-panel-2);
  border: 1px solid var(--kd-border);
  border-radius: 14px;

  &:hover {
    color: var(--kd-primary);
  }

  &.is-active {
    color: #fff;
    background: var(--kd-primary);
    border-color: var(--kd-primary);
  }
}

.resp-pick {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 3px 8px;
  font-size: $font-xs;
  color: var(--kd-text-2);
  cursor: pointer;
  background: none;
  border: 1px solid var(--kd-border);
  border-radius: $radius-sm;

  &:hover {
    color: var(--kd-primary);
    border-color: var(--kd-primary);
  }
}

.resp-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 8px 10px 10px;
}

.resp-error {
  flex: none;
  margin-bottom: 8px;
}

.resp-fill {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.resp-scroll {
  flex: 1;
  min-height: 0;
  padding-right: 4px;
}

.resp-raw {
  flex: 1;
  min-height: 0;
  padding: 10px 12px;
  margin: 0;
  font-family: $font-mono;
  font-size: $font-xs;
  line-height: 1.7;
  white-space: pre;
  tab-size: 2;
  background: var(--kd-code-bg);
  border: 1px solid var(--kd-border);
  border-radius: $radius-md;
}

.resp-preview {
  flex: 1;
  min-height: 0;
  background: #fff;
  border: 1px solid var(--kd-border);
  border-radius: $radius-md;
}

.resp-hint {
  padding: 14px;
  margin: 0;
  font-size: $font-sm;
  color: var(--kd-text-3);
}

.resp-curl {
  margin-top: 10px;
}

.resp-console {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 4px 6px;
    font-size: $font-xs;
    border-bottom: 1px dashed var(--kd-border);

    &.is-error .resp-console__text {
      color: var(--kd-danger);
    }

    &.is-warn .resp-console__text {
      color: var(--kd-warning);
    }
  }

  &__time {
    flex: none;
    color: var(--kd-text-3);
  }

  &__text {
    color: var(--kd-text-2);
    word-break: break-all;
  }
}

.cookie-flags {
  display: flex;
  gap: 4px;

  em {
    padding: 0 5px;
    font-size: 11px;
    font-style: normal;
    color: var(--kd-text-2);
    background: var(--kd-panel-3);
    border-radius: $radius-sm;
  }
}

.resp-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  color: var(--kd-text-3);

  p {
    margin: 0;
    font-size: $font-md;
    color: var(--kd-text-2);
  }

  span {
    font-size: $font-xs;
  }
}
</style>
