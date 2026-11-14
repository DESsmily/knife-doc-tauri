<script setup lang="ts">
/**
 * 快捷请求编辑器。
 *
 * 布局对齐 Apifox：地址行（方法 + URL + 发送 + 保存）在上，请求名称在下。
 * 编辑只标记「未保存」，落盘由保存按钮 / Ctrl+S 触发；上下两区用 flex 分配高度，中间可拖动。
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import KvTable from '@/components/quick/KvTable.vue'
import ResponsePanel from '@/components/quick/ResponsePanel.vue'
import {
  copyText,
  saveTextFile,
  sendDebugRequest,
  type DebugRequestOptions,
  type DebugResponseResult
} from '@/core/http'
import { buildQuickPayload, validateQuickRequest } from '@/core/quickSend'
import { flushStorage } from '@/core/storage'
import type { QuickBody, QuickRequest } from '@/core/types'
import { formatDuration, formatTime, methodColor, safeParse } from '@/core/utils'
import { useAppStore } from '@/stores/app'
import { useQuickRequestStore, QUICK_METHODS } from '@/stores/quickRequest'

const props = defineProps<{ request: QuickRequest | null }>()

const store = useQuickRequestStore()
const appStore = useAppStore()

const kvBody = ref<InstanceType<typeof KvTable> | null>(null)

const activeTab = ref<'params' | 'headers' | 'body' | 'auth' | 'settings'>('headers')
const sending = ref(false)
const response = ref<DebugResponseResult | null>(null)
/** 本次发送实际用到的请求参数，供「实际请求」页签回看 */
const sent = ref<DebugRequestOptions | null>(null)

/* ------------------------------------------------------------------ */
/* 请求区 / 响应区的高度分配                                            */
/* ------------------------------------------------------------------ */

const SPLIT_BAR = 10
const MIN_RESP = 120
const MIN_REQ = 170

const splitEl = ref<HTMLElement | null>(null)
/** 没发过请求时响应区保持收起，拿到响应才自动展开 */
const respOpen = ref(false)
const respGrow = ref(0.9)
const dragging = ref(false)

const respStyle = computed(() => (respOpen.value ? { flex: `${respGrow.value} 1 0` } : { flex: '0 0 auto' }))

let endDrag: (() => void) | null = null

function startDrag(event: PointerEvent) {
  const container = splitEl.value
  if (!container) return
  event.preventDefault()
  respOpen.value = true
  dragging.value = true

  const rect = container.getBoundingClientRect()
  const available = rect.height - SPLIT_BAR
  const move = (e: PointerEvent) => {
    const want = Math.min(Math.max(rect.bottom - SPLIT_BAR - e.clientY, MIN_RESP), available - MIN_REQ)
    respGrow.value = want / Math.max(available - want, 1)
  }
  const stop = () => {
    dragging.value = false
    endDrag = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
  }
  endDrag = stop
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

onBeforeUnmount(() => endDrag?.())

/* ------------------------------------------------------------------ */
/* 保存：只由「保存」按钮 / Ctrl+S 触发，编辑过程仅标记未保存           */
/* ------------------------------------------------------------------ */

const isDirty = computed(() => (props.request ? store.dirty.includes(props.request.id) : false))

function markUnsaved() {
  const request = props.request
  if (request) store.markDirty(request.id)
}

async function handleSave() {
  const request = props.request
  if (!request) return
  request.updatedAt = Date.now()
  store.clearDirty(request.id)
  store.persist()
  const ok = await flushStorage()
  ElMessage[ok ? 'success' : 'warning'](ok ? '已保存' : '保存失败，请检查安装目录是否可写')
}

/* ------------------------------------------------------------------ */
/* 请求体                                                              */
/* ------------------------------------------------------------------ */

const BODY_MODES: { value: QuickBody['mode']; label: string; hint: string }[] = [
  { value: 'none', label: 'none', hint: '不发送请求体' },
  { value: 'json', label: 'JSON', hint: 'application/json' },
  { value: 'form', label: 'form-data', hint: 'multipart/form-data，支持上传文件' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded', hint: '表单字段编码后放入请求体' },
  { value: 'raw', label: 'Text', hint: '原样发送文本' }
]

const isTextBody = computed(() => {
  const mode = props.request?.body.mode
  return mode === 'json' || mode === 'raw'
})

const jsonInvalid = computed(() => {
  const body = props.request?.body
  return body?.mode === 'json' && Boolean(body.text.trim()) && safeParse(body.text) === null
})

function formatBody() {
  const body = props.request?.body
  if (!body) return
  const parsed = safeParse(body.text)
  if (parsed === null) {
    ElMessage.warning('内容不是合法 JSON，无法格式化')
    return
  }
  body.text = JSON.stringify(parsed, null, 2)
  markUnsaved()
}

function filledCount(rows: { enabled: boolean; name: string }[]): number {
  return rows.filter((row) => row.enabled && row.name.trim()).length
}

/* ------------------------------------------------------------------ */
/* 发送                                                                */
/* ------------------------------------------------------------------ */

const TIMEOUT_OPTIONS = [
  { label: '10 秒', value: 10000 },
  { label: '30 秒', value: 30000 },
  { label: '60 秒', value: 60000 },
  { label: '5 分钟', value: 300000 },
  { label: '不限制', value: 0 }
]

async function handleSend() {
  const request = props.request
  if (!request) return

  const check = validateQuickRequest(request)
  if (!check.ok) {
    ElMessage.warning(check.message)
    return
  }

  sending.value = true
  response.value = null
  respOpen.value = true
  try {
    const payload = buildQuickPayload(request, kvBody.value?.selectedFiles() ?? {})
    payload.timeout = request.timeout || appStore.settings.requestTimeout
    sent.value = payload
    const result = await sendDebugRequest(payload)
    response.value = result
    if (result.error) ElMessage.error(result.error)
    // 只记时间戳，落盘仍然交给「保存」
    request.lastSentAt = Date.now()
  } finally {
    sending.value = false
  }
}

async function copyUrl() {
  if (!props.request) return
  const ok = await copyText(props.request.url)
  ElMessage[ok ? 'success' : 'warning'](ok ? '地址已复制' : '复制失败')
}

/** 保存响应：桌面端走原生另存为对话框 */
async function saveResponse(content: string) {
  const ext = response.value && safeParse(response.value.body) !== null ? 'json' : 'txt'
  const name = `${(props.request?.name ?? 'response').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`
  const path = await saveTextFile(name, content)
  if (path) ElMessage.success(`已保存到 ${path}`)
}

function onKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (key === 's') {
    event.preventDefault()
    void handleSave()
  } else if (key === 'enter') {
    event.preventDefault()
    void handleSend()
  }
}

/** 切换请求时清掉上一次的响应与文件选择 */
watch(
  () => props.request?.id,
  () => {
    response.value = null
    sent.value = null
    respOpen.value = false
    activeTab.value = 'headers'
    kvBody.value?.clearAll()
  }
)
</script>

<template>
  <div class="req-editor" tabindex="-1" @keydown="onKeydown">
    <template v-if="request">
      <div class="editor-url">
        <el-select v-model="request.method" class="editor-url__method" @change="markUnsaved">
          <template #label>
            <span class="method-chip" :style="{ '--method-color': methodColor(request.method) }">
              {{ request.method }}
            </span>
          </template>
          <el-option v-for="method in QUICK_METHODS" :key="method" :label="method" :value="method">
            <span class="method-chip" :style="{ '--method-color': methodColor(method) }">{{ method }}</span>
          </el-option>
        </el-select>
        <el-input
          v-model="request.url"
          class="editor-url__input kd-mono"
          placeholder="http://127.0.0.1:9999/api/example"
          spellcheck="false"
          @input="markUnsaved"
        >
          <template #append>
            <el-button title="复制地址" @click="copyUrl">
              <el-icon><CopyDocument /></el-icon>
            </el-button>
          </template>
        </el-input>
        <el-button type="primary" :loading="sending" class="editor-url__send" @click="handleSend">
          <el-icon v-if="!sending"><Promotion /></el-icon>
          <span>{{ sending ? '请求中' : '发送' }}</span>
        </el-button>
        <el-button class="editor-url__save" title="立即写入本地数据文件（Ctrl+S）" @click="handleSave">
          <el-icon><Checked /></el-icon>
          <span>保存</span>
        </el-button>
      </div>

      <div class="editor-title">
        <el-input v-model="request.name" class="editor-title__name" placeholder="请求名称" @input="markUnsaved" />
        <span class="editor-title__state" :class="isDirty ? 'is-dirty' : 'is-saved'">
          <i class="editor-title__dot" />
          {{ isDirty ? '未保存' : '已保存' }}
        </span>
        <span class="editor-title__time">更新于 {{ formatTime(request.updatedAt) }}</span>
      </div>

      <div ref="splitEl" class="editor-split">
        <section class="editor-panels">
          <el-tabs v-model="activeTab" class="editor-tabs">
            <el-tab-pane name="headers">
              <template #label>
                Headers
                <em v-if="filledCount(request.headers)" class="tab-count">{{ filledCount(request.headers) }}</em>
              </template>
            </el-tab-pane>
            <el-tab-pane name="params">
              <template #label>
                Params
                <em v-if="filledCount(request.params)" class="tab-count">{{ filledCount(request.params) }}</em>
              </template>
            </el-tab-pane>
            <el-tab-pane name="body">
              <template #label>
                Body
                <em v-if="request.body.mode !== 'none'" class="tab-count">●</em>
              </template>
            </el-tab-pane>
            <el-tab-pane name="auth" label="Auth" />
            <el-tab-pane name="settings" label="设置" />
          </el-tabs>

          <div class="editor-panels__body kd-scroll">
            <KvTable
              v-if="activeTab === 'headers'"
              :rows="request.headers"
              name-label="Header"
              value-label="值"
              name-placeholder="Header 名称"
              value-placeholder="值"
              empty-text="没有自定义 Header"
              name-autocomplete
              @change="markUnsaved"
            />

            <KvTable
              v-else-if="activeTab === 'params'"
              :rows="request.params"
              name-placeholder="参数名"
              value-placeholder="参数值"
              empty-text="没有 Query 参数"
              @change="markUnsaved"
            />

            <template v-else-if="activeTab === 'body'">
              <div class="body-modes">
                <button
                  v-for="mode in BODY_MODES"
                  :key="mode.value"
                  type="button"
                  class="body-modes__item"
                  :class="{ 'is-active': request.body.mode === mode.value }"
                  :title="mode.hint"
                  @click="request.body.mode = mode.value; markUnsaved()"
                >
                  {{ mode.label }}
                </button>
              </div>

              <div v-if="isTextBody" class="body-text">
                <div class="body-text__tools">
                  <el-input
                    v-if="request.body.mode === 'raw'"
                    v-model="request.body.contentType"
                    size="small"
                    class="body-text__type"
                    placeholder="Content-Type，如 text/plain"
                    @input="markUnsaved"
                  />
                  <el-button v-if="request.body.mode === 'json'" link size="small" @click="formatBody">
                    <el-icon><MagicStick /></el-icon>
                    <span>格式化 JSON</span>
                  </el-button>
                  <span v-if="jsonInvalid" class="body-text__warn">不是合法 JSON，将按文本原样发送</span>
                </div>
                <el-input
                  v-model="request.body.text"
                  type="textarea"
                  :rows="9"
                  class="kd-mono body-text__area"
                  :placeholder="request.body.mode === 'json' ? '{ &quot;key&quot;: &quot;value&quot; }' : '原样发送的文本'"
                  spellcheck="false"
                  resize="vertical"
                  @input="markUnsaved"
                />
              </div>

              <template v-else-if="request.body.mode === 'form' || request.body.mode === 'urlencoded'">
                <p class="body-hint">
                  {{
                    request.body.mode === 'form'
                      ? '将「类型」选为「文件」后该行变成文件选择；文件本体只存在于本次会话，重新打开请求需要再选一次。'
                      : '字段会按 application/x-www-form-urlencoded 编码进请求体。'
                  }}
                </p>
                <KvTable
                  ref="kvBody"
                  v-model:file-fields="request.body.fileFields"
                  :rows="request.body.fields"
                  :allow-file="request.body.mode === 'form'"
                  name-placeholder="字段名"
                  value-placeholder="字段值"
                  empty-text="没有表单字段"
                  @change="markUnsaved"
                />
              </template>

              <p v-else class="body-hint">该请求不发送请求体。</p>
            </template>

            <div v-else-if="activeTab === 'auth'" class="auth-form">
              <el-form label-width="92px" label-position="left">
                <el-form-item label="类型">
                  <el-radio-group v-model="request.auth.type" @change="markUnsaved">
                    <el-radio-button value="none">无</el-radio-button>
                    <el-radio-button value="bearer">Bearer</el-radio-button>
                    <el-radio-button value="basic">Basic</el-radio-button>
                    <el-radio-button value="apikey">Api Key</el-radio-button>
                  </el-radio-group>
                </el-form-item>

                <el-form-item v-if="request.auth.type === 'bearer'" label="令牌">
                  <el-input v-model="request.auth.token" class="kd-mono" placeholder="eyJhbGciOi..." @input="markUnsaved" />
                  <p class="form-tip">未写 Bearer 前缀时会自动补齐。</p>
                </el-form-item>

                <template v-else-if="request.auth.type === 'basic'">
                  <el-form-item label="用户名">
                    <el-input v-model="request.auth.username" @input="markUnsaved" />
                  </el-form-item>
                  <el-form-item label="密码">
                    <el-input v-model="request.auth.password" type="password" show-password @input="markUnsaved" />
                  </el-form-item>
                </template>

                <template v-else-if="request.auth.type === 'apikey'">
                  <el-form-item label="Key">
                    <el-input v-model="request.auth.keyName" class="kd-mono" placeholder="Authorization" @input="markUnsaved" />
                  </el-form-item>
                  <el-form-item label="Value">
                    <el-input v-model="request.auth.keyValue" class="kd-mono" @input="markUnsaved" />
                  </el-form-item>
                  <el-form-item label="添加到">
                    <el-radio-group v-model="request.auth.keyIn" @change="markUnsaved">
                      <el-radio-button value="header">Header</el-radio-button>
                      <el-radio-button value="query">Query</el-radio-button>
                    </el-radio-group>
                  </el-form-item>
                </template>

                <p v-else-if="request.auth.type === 'none'" class="form-tip">
                  不附带任何鉴权信息；临时调试用的头可以直接加在 Headers。
                </p>
              </el-form>
            </div>

            <div v-else class="settings-form">
              <el-form label-width="112px" label-position="left">
                <el-form-item label="请求超时">
                  <el-select v-model="request.timeout" style="width: 150px" @change="markUnsaved">
                    <el-option v-for="item in TIMEOUT_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                  <el-button link type="primary" size="small" @click="request.timeout = appStore.settings.requestTimeout; markUnsaved()">
                    用全局默认（{{ formatDuration(appStore.settings.requestTimeout) }}）
                  </el-button>
                </el-form-item>
                <el-form-item label="备注">
                  <el-input
                    v-model="request.remark"
                    type="textarea"
                    :rows="6"
                    placeholder="写下这个接口的注意事项，仅保存在本地"
                    @input="markUnsaved"
                  />
                </el-form-item>
                <el-form-item label="最近发送">
                  <span class="kd-text-2">{{ request.lastSentAt ? formatTime(request.lastSentAt) : '从未发送' }}</span>
                </el-form-item>
              </el-form>
            </div>
          </div>
        </section>

        <div
          class="split-bar"
          :class="{ 'is-dragging': dragging }"
          title="拖动调整响应区高度，双击展开或收起"
          @pointerdown="startDrag"
          @dblclick="respOpen = !respOpen"
        >
          <span class="split-bar__grip" />
        </div>

        <ResponsePanel
          :response="response"
          :sending="sending"
          :download-name="request.name"
          :sent="sent"
          :collapsed="!respOpen"
          :style="respStyle"
          @save="saveResponse"
          @toggle="respOpen = !respOpen"
        />
      </div>
    </template>

    <div v-else class="editor-empty">
      <el-icon :size="34"><Lightning /></el-icon>
      <h3>选择左侧的请求开始</h3>
      <p>快捷请求不依赖接口文档，适合临时验证接口、排查线上问题。</p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.req-editor {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 12px 14px 14px;
  overflow: hidden;
  outline: none;
}

/* 请求区 + 分隔条 + 响应区：整块吃满剩余高度，内部再按 flex 分配 */
.editor-split {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.editor-title {
  display: flex;
  align-items: center;
  gap: 12px;

  &__name :deep(input) {
    font-size: $font-lg;
    font-weight: 600;
  }

  &__state {
    display: inline-flex;
    flex: none;
    gap: 5px;
    align-items: center;
    font-size: $font-xs;

    &.is-dirty {
      color: var(--kd-warning);
    }

    &.is-saved {
      color: var(--kd-success);
    }
  }

  &__dot {
    width: 6px;
    height: 6px;
    background: currentcolor;
    border-radius: 50%;
  }

  &__time {
    flex: none;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.editor-url {
  display: flex;
  gap: 8px;
  align-items: center;

  &__method {
    width: 110px;
    flex: none;
  }

  &__input {
    flex: 1;
    min-width: 0;
  }

  &__send {
    flex: none;
    min-width: 88px;
  }

  &__save {
    flex: none;
  }

  :deep(.el-input-group__append) {
    padding: 0 8px;
    background: var(--kd-panel-2);
  }
}

.editor-panels {
  @include card;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-height: 120px;
  overflow: hidden;

  &__body {
    flex: 1;
    min-height: 0;
    padding: 8px 12px 12px;
  }
}

.split-bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: $split-bar-height;
  cursor: row-resize;
  background: var(--kd-bg);

  &__grip {
    width: 46px;
    height: 3px;
    background: var(--kd-border-strong);
    border-radius: 2px;
  }

  &:hover &__grip,
  &.is-dragging &__grip {
    background: var(--kd-primary);
  }
}

.method-chip {
  font-family: $font-mono;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--method-color);
}

.editor-tabs {
  padding: 0 12px;

  :deep(.el-tabs__header) {
    margin-bottom: 0;
  }
}

.tab-count {
  padding: 0 5px;
  margin-left: 4px;
  font-size: 11px;
  font-style: normal;
  color: var(--kd-primary);
  background: var(--kd-primary-soft);
  border-radius: 8px;
}

.body-modes {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;

  &__item {
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
}

.body-text {
  &__tools {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 6px;
  }

  &__type {
    width: 220px;
  }

  &__warn {
    font-size: $font-xs;
    color: var(--kd-warning);
  }

  &__area :deep(textarea) {
    font-family: $font-mono;
    font-size: $font-xs;
    line-height: 1.7;
  }
}

.body-hint {
  padding: 8px 10px;
  margin: 0 0 10px;
  font-size: $font-xs;
  color: var(--kd-text-2);
  background: var(--kd-panel-2);
  border-radius: $radius-sm;
}

.form-tip {
  margin: 4px 0 0;
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.auth-form,
.settings-form {
  max-width: 760px;
}

.editor-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  color: var(--kd-text-3);

  h3 {
    margin: 0;
    font-size: $font-lg;
    color: var(--kd-text);
  }

  p {
    margin: 0;
    font-size: $font-sm;
  }
}
</style>
