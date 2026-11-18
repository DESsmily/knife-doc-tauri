<script setup lang="ts">
/**
 * 项目管理主页
 *
 * 页面结构（自上而下）：
 *  - 工具栏：搜索框（Ctrl/⌘ + K 聚焦）、网格 / 列表视图切换、新增项目；
 *  - 概览条：激活服务数量、离线运行说明；
 *  - 服务列表：网格卡片视图与紧凑列表视图，末尾固定一张「接入新微服务文档」占位卡。
 *
 * 排序交互沿用 Pointer Events 方案（Tauri 的 WebView 对 HTML5 原生 draggable 支持不稳定）：
 * 拖起后卡片脱离文档流跟随指针，列表中留下虚线占位框标记放置位置，悬停到某张卡片上时
 * 占位框让位到该卡片位置（卡片顺次后移），点击拖拽手柄立即进入拖拽，其余区域长按亦可。
 */

import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { message } from '@/core/message'

import EmptyState from '@/components/common/EmptyState.vue'
import { copyText, probe } from '@/core/http'
import type { DocProject } from '@/core/types'
import { fromNow, normalizeBaseUrl } from '@/core/utils'
import { useProjectStore, type ProjectInput } from '@/stores/project'

const router = useRouter()
const projectStore = useProjectStore()

/* ------------------------------ 列表与搜索 ------------------------------ */

const keyword = ref('')
const searchRef = ref<HTMLInputElement>()

const filteredProjects = computed<DocProject[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = projectStore.sorted
  if (!kw) return list
  return list.filter(
    (item) =>
      item.name.toLowerCase().includes(kw) ||
      item.baseUrl.toLowerCase().includes(kw) ||
      (item.description ?? '').toLowerCase().includes(kw)
  )
})

/** 快捷键提示文案：按平台区分 ⌘ / Ctrl */
const modKeyLabel = computed(() => (/mac|iphone|ipad/i.test(navigator.userAgent) ? '⌘ K' : 'Ctrl K'))

async function focusSearch() {
  await nextTick()
  searchRef.value?.focus()
}

/** Ctrl/⌘ + K 聚焦项目搜索；Esc 清空已输入的关键词 */
function onGlobalKeydown(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    void focusSearch()
    return
  }
  if (event.key === 'Escape' && document.activeElement === searchRef.value) {
    keyword.value = ''
  }
}

/* ------------------------------ 视图模式 ------------------------------ */

const VIEW_KEY = 'knife4doc:projectView'

function readViewMode(): 'grid' | 'list' {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

const viewMode = ref<'grid' | 'list'>(readViewMode())

watch(viewMode, (value) => {
  try {
    window.localStorage.setItem(VIEW_KEY, value)
  } catch {
    /* 隐私模式下 localStorage 不可用，忽略即可 */
  }
})

/* ------------------------------ 展示辅助 ------------------------------ */

/** 列表序号：#01 / #02 …… */
function indexLabel(index: number): string {
  return `#${String(index + 1).padStart(2, '0')}`
}

/** 是否已同步过文档（决定展示「文档规模」还是「接口架构」） */
function isSynced(project: DocProject): boolean {
  return Boolean(project.meta?.apiCount || project.meta?.groupCount)
}

/** 文档规模文案，例如：137 接口  5 分组 · OpenAPI 3.0.3 */
function scaleLabel(project: DocProject): string {
  const meta = project.meta
  if (!meta || (!meta.apiCount && !meta.groupCount)) return '尚未同步文档'
  const parts: string[] = []
  if (meta.apiCount) parts.push(`${meta.apiCount} 接口`)
  if (meta.groupCount) parts.push(`${meta.groupCount} 分组`)
  const spec = meta.specVersion
    ? meta.specVersion.startsWith('2')
      ? 'Swagger 2.0'
      : `OpenAPI ${meta.specVersion}`
    : ''
  return [parts.join('  '), spec].filter(Boolean).join(' · ')
}

/** 把主题色转成带透明度的 rgba，用于头像底色等弱化色块 */
function tint(hex: string, alpha: number): string {
  const raw = String(hex ?? '').replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const num = Number.parseInt(full, 16)
  if (full.length !== 6 || !Number.isFinite(num)) return `rgba(79, 124, 255, ${alpha})`
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`
}

/* ------------------------------ 新增 / 编辑 ----------------------------- */

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref('')
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  name: '',
  baseUrl: '',
  description: ''
})

const rules = computed<FormRules>(() => ({
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { max: 40, message: '项目名称不能超过 40 个字符', trigger: 'blur' }
  ],
  baseUrl: [
    { required: true, message: '请输入后端地址', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) => {
        const normalized = normalizeBaseUrl(value)
        if (!/^https?:\/\/.+/i.test(normalized)) {
          callback(new Error('地址需以 http:// 或 https:// 开头'))
          return
        }
        const duplicated = projectStore.projects.some(
          (item) => item.id !== editingId.value && item.baseUrl === normalized
        )
        if (duplicated) {
          callback(new Error('该地址已存在，请勿重复添加'))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ]
}))

function openCreate() {
  dialogMode.value = 'create'
  editingId.value = ''
  form.name = ''
  form.baseUrl = ''
  form.description = ''
  dialogVisible.value = true
  void nextTick(() => formRef.value?.clearValidate())
}

function openEdit(project: DocProject) {
  dialogMode.value = 'edit'
  editingId.value = project.id
  form.name = project.name
  form.baseUrl = project.baseUrl
  form.description = project.description ?? ''
  dialogVisible.value = true
  void nextTick(() => formRef.value?.clearValidate())
}

async function handleSubmit() {
  const instance = formRef.value
  if (!instance) return
  const valid = await instance.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const payload: ProjectInput = {
      name: form.name,
      baseUrl: form.baseUrl,
      description: form.description
    }
    if (dialogMode.value === 'create') {
      const created = projectStore.add(payload)
      message.success('项目已添加')
      dialogVisible.value = false
      // 直接进入新项目，省去用户再点一次
      void router.push({ name: 'doc', params: { projectId: created.id } })
    } else {
      projectStore.update(editingId.value, payload)
      message.success('项目已更新')
      dialogVisible.value = false
    }
  } finally {
    submitting.value = false
  }
}

/* ------------------------------ 删除 ---------------------------------- */

async function handleRemove(project: DocProject) {
  try {
    await ElMessageBox.confirm(
      `确定要删除项目「${project.name}」吗？该操作只会移除本地的地址记录，不会影响后端服务。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  projectStore.remove(project.id)
  message.success('已删除')
}

/* ------------------------------ 打开 / 探测 ---------------------------- */

function openProject(project: DocProject) {
  // 长按拖拽刚结束时抑制一次 click，避免松手后误触发打开项目
  if (suppressClick.value) {
    suppressClick.value = false
    return
  }
  projectStore.setCurrent(project.id)
  void router.push({ name: 'doc', params: { projectId: project.id } })
}

/**
 * 在浏览器中打开服务地址。
 * 桌面客户端的 WebView 通常会拦截 window.open，此时退化为复制地址并给出提示，
 * 保证按钮在任何环境下都有明确反馈。
 */
async function openExternal(project: DocProject) {
  const opened = window.open(project.baseUrl, '_blank', 'noopener,noreferrer')
  if (opened) return
  const ok = await copyText(project.baseUrl)
  if (ok) message.info('已复制地址，可在浏览器中打开')
  else message.warning('打开失败，请手动复制地址')
}

/* ------------------------------ 拖拽排序（占位框模式） ------------------------------ */
// Tauri 的 WebView 对 HTML5 原生 draggable 支持不稳定，改用 Pointer Events 实现：
// 拖起后卡片脱离文档流（fixed）跟随鼠标，列表中留下虚线占位框标记放置位置；
// 悬停到某张卡片上时占位框让位到该卡片位置（卡片顺次后移），离开列表后占位框回到原位；
// 点击拖拽手柄立即进入拖拽，在卡片其它区域长按 LONG_PRESS_MS 也可拖拽，ESC 取消。

/** 长按触发拖拽的阈值（毫秒） */
const LONG_PRESS_MS = 400
/** 长按期间允许的移动容差（像素），超过则视为滚动/点击而非拖拽 */
const PRESS_TOLERANCE = 8

/** 占位框在预览序列中的标记 */
const GHOST_KEY = '__ghost__'

/** 正在拖拽的项目 id */
const draggedId = ref('')
/** 是否已进入拖拽模式 */
const dragActive = ref(false)
/** 悬浮卡片相对按下位置的偏移量 */
const dragOffset = reactive({ x: 0, y: 0 })
/** 拖拽起始时捕获的卡片位置与尺寸（用于悬浮跟随） */
const dragRect = reactive({ x: 0, y: 0, w: 0 })
/** 占位框当前下标（在包含占位框的预览序列中的位置） */
const dropIndex = ref(0)
/** 拖拽刚结束时抑制一次 click，避免松手后误触发打开项目 */
const suppressClick = ref(false)

/** 长按计时器句柄 */
let pressTimer: number | undefined
/** 按下时所在的元素，用于捕获悬浮定位 */
let pressEl: HTMLElement | null = null
/** 按下起始位置，用于判断移动距离与计算偏移 */
const pressStart = { x: 0, y: 0 }

/** 搜索时禁用拖拽，避免在过滤列表上排序造成困惑 */
const dragEnabled = computed(() => keyword.value.trim() === '')

/** 拖拽期间的预览序列：被拖卡片让位，占位框插入到 dropIndex 处 */
const previewOrder = computed<string[]>(() => {
  const ids = filteredProjects.value.map((item) => item.id)
  if (!dragActive.value) return ids
  const rest = ids.filter((id) => id !== draggedId.value)
  const at = Math.max(0, Math.min(dropIndex.value, rest.length))
  const arr = [...rest]
  arr.splice(at, 0, GHOST_KEY)
  return arr
})

/** 占位框的 order 值 */
const ghostOrder = computed(() => previewOrder.value.indexOf(GHOST_KEY))

/** 悬浮卡片的定位样式：fixed 跟随鼠标 */
const floatingStyle = computed<Record<string, string>>((): Record<string, string> => {
  if (!dragActive.value) return {}
  return {
    position: 'fixed',
    left: `${dragRect.x + dragOffset.x}px`,
    top: `${dragRect.y + dragOffset.y}px`,
    width: `${dragRect.w}px`,
    zIndex: '1000',
    pointerEvents: 'none'
  }
})

/** 每张卡片的内联样式：主题色 + 拖拽期间的悬浮定位 / 排序位置 */
function cardStyle(project: DocProject): Record<string, string | number> {
  const style: Record<string, string | number> = {
    '--card-color': project.color,
    '--card-soft': tint(project.color, 0.16),
    '--card-line': tint(project.color, 0.45)
  }
  if (!dragActive.value) return style
  if (project.id === draggedId.value) return { ...style, ...floatingStyle.value }
  const order = previewOrder.value.indexOf(project.id)
  if (order >= 0) style.order = order
  return style
}

/** 卡片 pointerdown：启动长按计时，超时后进入拖拽模式（手柄上已 stop，不会走到这里） */
function onCardPointerDown(project: DocProject, event: PointerEvent) {
  if (!dragEnabled.value) return
  // 仅响应鼠标左键 / 触摸 / 笔
  if (event.pointerType === 'mouse' && event.button !== 0) return
  // 在按钮 / 链接 / 表单等交互元素上按下时不启动拖拽，避免与按钮点击冲突
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, select, textarea, label, [role="button"]')) {
    return
  }
  pressEl = event.currentTarget as HTMLElement | null
  pressStart.x = event.clientX
  pressStart.y = event.clientY
  pressTimer = window.setTimeout(() => startDrag(project), LONG_PRESS_MS)
}

/** 拖拽手柄 pointerdown：点击即拖，无需长按 */
function onHandlePointerDown(project: DocProject, event: PointerEvent) {
  if (!dragEnabled.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  pressEl = event.currentTarget as HTMLElement | null
  pressStart.x = event.clientX
  pressStart.y = event.clientY
  startDrag(project)
}

/** 进入拖拽模式：捕获卡片位置，占位框默认落在卡片原位 */
function startDrag(project: DocProject) {
  if (dragActive.value) return
  const card = pressEl?.closest('.project-item') as HTMLElement | null
  const rect = card?.getBoundingClientRect()
  if (rect) {
    dragRect.x = rect.left
    dragRect.y = rect.top
    dragRect.w = rect.width
  }
  draggedId.value = project.id
  dragActive.value = true
  dragOffset.x = 0
  dragOffset.y = 0
  dropIndex.value = Math.max(0, filteredProjects.value.findIndex((item) => item.id === project.id))
}

/** 清理长按计时 */
function clearPress() {
  if (pressTimer !== undefined) {
    clearTimeout(pressTimer)
    pressTimer = undefined
  }
}

/** 占位框回到被拖卡片的原位（未悬停在卡片上时“恢复原样”） */
function resetDropIndex() {
  if (!draggedId.value) return
  const home = Math.max(0, filteredProjects.value.findIndex((item) => item.id === draggedId.value))
  if (dropIndex.value !== home) dropIndex.value = home
}

/** 更新放置目标：悬停卡片让位、悬停占位框/间隙保持、离开列表还原 */
function updateDropTarget(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el || !el.closest('.project-items')) {
    // 指针离开列表区域：占位框回到原位
    resetDropIndex()
    return
  }
  // 悬停在占位框上：保持当前位置（松手即落到占位框所在处）
  if (el.closest('.is-ghost')) return
  const card = el.closest('.project-item') as HTMLElement | null
  const id = card?.dataset.id
  if (!id || id === draggedId.value) return
  // 占位框移动到该卡片当前所在的位置，卡片顺次让位
  const slot = previewOrder.value.indexOf(id)
  if (slot >= 0 && slot !== dropIndex.value) dropIndex.value = slot
}

/** 全局 pointermove：未进入拖拽时移动过大取消长按；进入拖拽后跟随鼠标并更新占位框 */
function onPointerMove(event: PointerEvent) {
  if (!dragActive.value) {
    // 未进入拖拽：移动过大则取消长按，保留为普通点击
    if (
      Math.abs(event.clientX - pressStart.x) > PRESS_TOLERANCE ||
      Math.abs(event.clientY - pressStart.y) > PRESS_TOLERANCE
    ) {
      clearPress()
    }
    return
  }
  // 进入拖拽：阻止文本选择等默认行为，更新悬浮位置与占位框
  event.preventDefault()
  dragOffset.x = event.clientX - pressStart.x
  dragOffset.y = event.clientY - pressStart.y
  updateDropTarget(event.clientX, event.clientY)
}

/** 结束拖拽；commit 为 false 时仅还原（ESC / pointercancel） */
function endDrag(commit: boolean) {
  if (commit && draggedId.value) {
    const home = Math.max(0, filteredProjects.value.findIndex((item) => item.id === draggedId.value))
    const target = Math.max(0, Math.min(dropIndex.value, filteredProjects.value.length - 1))
    if (target !== home) projectStore.moveProjectTo(draggedId.value, target)
  }
  draggedId.value = ''
  dragActive.value = false
  dropIndex.value = 0
  dragOffset.x = 0
  dragOffset.y = 0
  pressEl = null
  // 抑制拖拽结束后的误触 click；兜底延迟重置，防止 pointer 移到其它元素时 click 未触发而残留
  suppressClick.value = true
  window.setTimeout(() => {
    suppressClick.value = false
  }, 300)
}

/** 全局 pointerup：按当前占位框位置完成排序 */
function onPointerUp() {
  if (!dragActive.value) {
    clearPress()
    return
  }
  endDrag(true)
}

/** 全局 pointercancel：取消拖拽并还原 */
function onPointerCancel() {
  if (dragActive.value) endDrag(false)
}

/** ESC 取消拖拽并还原 */
function onDragKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && dragActive.value) endDrag(false)
}

/* ------------------------------ 地址可用性探测 ------------------------------ */

/** 地址可用性探测缓存 */
const statusMap = reactive<Record<string, 'idle' | 'checking' | 'ok' | 'fail'>>({})

const STATUS_TEXT: Record<string, string> = {
  idle: '未检测',
  checking: '检测中',
  ok: '可访问',
  fail: '不可达'
}

function statusLabel(project: DocProject): string {
  return STATUS_TEXT[statusMap[project.id] ?? 'idle'] ?? '未检测'
}

async function checkStatus(project: DocProject) {
  statusMap[project.id] = 'checking'
  const ok = await probe(`${project.baseUrl}/v3/api-docs/swagger-config`, 5000)
  if (ok) {
    statusMap[project.id] = 'ok'
    return
  }
  const ok2 = await probe(`${project.baseUrl}/swagger-resources`, 5000)
  if (ok2) {
    statusMap[project.id] = 'ok'
    return
  }
  const ok3 = await probe(`${project.baseUrl}/v2/api-docs`, 5000)
  statusMap[project.id] = ok3 ? 'ok' : 'fail'
}

async function checkAll() {
  await Promise.all(projectStore.projects.map((item) => checkStatus(item)))
}

async function handleCopyUrl(project: DocProject) {
  const ok = await copyText(project.baseUrl)
  message[ok ? 'success' : 'warning'](ok ? '地址已复制' : '复制失败')
}

onMounted(() => {
  projectStore.init()
  if (projectStore.projects.length > 0) void checkAll()
  // 拖拽期间需在卡片之外也能收到 pointermove / pointerup，注册到 window
  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onDragKeydown)
  window.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('keydown', onDragKeydown)
  window.removeEventListener('keydown', onGlobalKeydown)
  clearPress()
})
</script>

<template>
  <div class="project-page">
    <!-- 工具栏：搜索 + 视图切换 + 新增 -->
    <div class="project-page__toolbar">
      <div class="search-box" @click="focusSearch">
        <el-icon class="search-box__icon"><Search /></el-icon>
        <input
          ref="searchRef"
          v-model="keyword"
          class="search-box__input"
          type="text"
          placeholder="搜索项目名称、服务地址或分组..."
          autocomplete="off"
          spellcheck="false"
        />
        <button
          v-if="keyword"
          type="button"
          class="search-box__clear"
          title="清空"
          @click.stop="keyword = ''"
        >
          <el-icon><Close /></el-icon>
        </button>
        <kbd class="search-box__kbd">{{ modKeyLabel }}</kbd>
      </div>

      <div class="project-page__toolbar-right">
        <div class="view-switch" role="group" aria-label="视图切换">
          <button
            type="button"
            class="view-switch__btn"
            :class="{ 'is-active': viewMode === 'grid' }"
            title="网格视图"
            @click="viewMode = 'grid'"
          >
            <el-icon><Grid /></el-icon>
          </button>
          <button
            type="button"
            class="view-switch__btn"
            :class="{ 'is-active': viewMode === 'list' }"
            title="列表视图"
            @click="viewMode = 'list'"
          >
            <el-icon><List /></el-icon>
          </button>
        </div>

        <button type="button" class="new-btn" @click="openCreate">
          <el-icon><Plus /></el-icon>
          <span>新增项目</span>
        </button>
      </div>
    </div>

    <!-- 概览条：激活服务数量 / 离线运行说明 -->
    <div class="project-page__meta">
      <div class="project-page__meta-left">
        <span class="count-tag">共 {{ projectStore.count }} 个激活服务</span>
      </div>
      <span class="safe-tip">
        <el-icon><CircleCheck /></el-icon>
        离线安全运行 · 无云端上传
      </span>
    </div>

    <main class="project-page__body kd-scroll">
      <!-- 有数据但被搜索过滤掉 -->
      <EmptyState
        v-if="projectStore.projects.length > 0 && filteredProjects.length === 0"
        icon="Search"
        title="没有匹配的项目"
        description="换个关键词试试，或清空搜索框查看全部服务。"
      />

      <!-- 服务列表：网格 / 列表双视图 + 新增占位卡 -->
      <div
        v-else
        class="project-items"
        :class="[viewMode === 'grid' ? 'is-grid' : 'is-list', { 'is-drag-active': dragActive }]"
      >
        <article
          v-for="(project, index) in filteredProjects"
          :key="project.id"
          class="project-item"
          :class="[
            viewMode === 'grid' ? 'is-card' : 'is-row',
            { 'is-floating': dragActive && draggedId === project.id }
          ]"
          :style="cardStyle(project)"
          :data-id="project.id"
          @pointerdown="onCardPointerDown(project, $event)"
          @click="openProject(project)"
        >
          <!-- ------------------------------ 网格卡片视图 ------------------------------ -->
          <template v-if="viewMode === 'grid'">
            <span class="project-item__accent" />

            <header class="card-head">
              <span class="project-avatar">{{ project.name.slice(0, 1).toUpperCase() }}</span>

              <div class="project-title">
                <span class="project-title__name">{{ project.name }}</span>
                <span class="project-title__index kd-mono">{{ indexLabel(index) }}</span>
              </div>

              <span
                v-if="dragEnabled"
                class="project-handle"
                title="拖动排序"
                @pointerdown.stop="onHandlePointerDown(project, $event)"
                @click.stop
              >
                <el-icon><Rank /></el-icon>
              </span>

              <span
                class="status-pill"
                :class="`is-${statusMap[project.id] ?? 'idle'}`"
                title="点击重新检测连通性"
                @click.stop="checkStatus(project)"
              >
                <el-icon v-if="statusMap[project.id] === 'checking'" class="is-spin">
                  <Loading />
                </el-icon>
                <i v-else class="status-pill__dot" />
                {{ statusLabel(project) }}
              </span>
            </header>

            <div class="project-visited">最近访问：{{ fromNow(project.lastOpened) }}</div>

            <div class="project-divider" />

            <div class="project-field">
              <span class="project-field__label">服务端点（HOST ENDPOINT）</span>
              <div class="endpoint">
                <span class="endpoint__url kd-mono">{{ project.baseUrl }}</span>
                <button
                  type="button"
                  class="endpoint__copy"
                  title="复制地址"
                  @click.stop="handleCopyUrl(project)"
                >
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </div>
            </div>

            <dl class="info-rows">
              <div class="info-row">
                <dt>备注信息</dt>
                <dd :class="{ 'is-muted': !project.description }">
                  {{ project.description || '暂无备注' }}
                </dd>
              </div>
              <div class="info-row">
                <dt>{{ isSynced(project) ? '文档规模' : '接口架构' }}</dt>
                <dd v-if="isSynced(project)" class="is-strong">{{ scaleLabel(project) }}</dd>
                <dd v-else class="is-pending"><i class="pending-dot" />尚未同步文档</dd>
              </div>
            </dl>

            <footer class="project-item__footer">
              <button type="button" class="doc-btn" @click.stop="openProject(project)">
                <el-icon><Document /></el-icon>
                <span>查看文档</span>
              </button>

              <div class="icon-actions">
                <button type="button" title="在浏览器中打开" @click.stop="openExternal(project)">
                  <el-icon><TopRight /></el-icon>
                </button>
                <button type="button" title="复制地址" @click.stop="handleCopyUrl(project)">
                  <el-icon><CopyDocument /></el-icon>
                </button>
                <button type="button" title="编辑" @click.stop="openEdit(project)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button
                  type="button"
                  class="is-danger"
                  title="删除"
                  @click.stop="handleRemove(project)"
                >
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </footer>
          </template>

          <!-- ------------------------------ 紧凑列表视图 ------------------------------ -->
          <template v-else>
            <span class="project-item__accent" />

            <span class="project-avatar">{{ project.name.slice(0, 1).toUpperCase() }}</span>

            <div class="project-title">
              <span class="project-title__name">{{ project.name }}</span>
              <span class="project-title__index kd-mono">{{ indexLabel(index) }}</span>
            </div>

            <span
              class="status-pill"
              :class="`is-${statusMap[project.id] ?? 'idle'}`"
              title="点击重新检测连通性"
              @click.stop="checkStatus(project)"
            >
              <el-icon v-if="statusMap[project.id] === 'checking'" class="is-spin"><Loading /></el-icon>
              <i v-else class="status-pill__dot" />
              {{ statusLabel(project) }}
            </span>

            <span class="row-url kd-mono">{{ project.baseUrl }}</span>

            <span class="row-meta" :class="{ 'is-muted': !isSynced(project) }">
              {{ scaleLabel(project) }}
            </span>

            <span class="row-visited">最近访问：{{ fromNow(project.lastOpened) }}</span>

            <div class="icon-actions">
              <span
                v-if="dragEnabled"
                class="project-handle"
                title="拖动排序"
                @pointerdown.stop="onHandlePointerDown(project, $event)"
                @click.stop
              >
                <el-icon><Rank /></el-icon>
              </span>
              <button type="button" title="查看文档" @click.stop="openProject(project)">
                <el-icon><Document /></el-icon>
              </button>
              <button type="button" title="在浏览器中打开" @click.stop="openExternal(project)">
                <el-icon><TopRight /></el-icon>
              </button>
              <button type="button" title="复制地址" @click.stop="handleCopyUrl(project)">
                <el-icon><CopyDocument /></el-icon>
              </button>
              <button type="button" title="编辑" @click.stop="openEdit(project)">
                <el-icon><EditPen /></el-icon>
              </button>
              <button type="button" class="is-danger" title="删除" @click.stop="handleRemove(project)">
                <el-icon><Delete /></el-icon>
              </button>
            </div>
          </template>
        </article>

        <!-- 拖拽占位框：标记当前放置位置 -->
        <div
          v-if="dragActive"
          class="project-item is-ghost"
          :class="viewMode === 'grid' ? 'is-card' : 'is-row'"
          :style="{ order: ghostOrder }"
        />

        <!-- 新增占位卡：接入新微服务文档 -->
        <button
          v-if="!dragActive"
          type="button"
          class="add-card"
          :class="viewMode === 'grid' ? 'is-card' : 'is-row'"
          @click="openCreate"
        >
          <span class="add-card__plus"><el-icon><Plus /></el-icon></span>
          <span class="add-card__title">接入新微服务文档</span>
          <span class="add-card__desc">
            支持 OpenAPI v2/v3、Swagger UI、Knife4j 及标准 JSON/YAML 规范
          </span>
        </button>
      </div>
    </main>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增文档项目' : '编辑文档项目'"
      width="520px"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="88px"
        label-position="right"
        @submit.prevent
      >
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：用户中心服务" maxlength="40" show-word-limit />
        </el-form-item>

        <el-form-item label="后端地址" prop="baseUrl">
          <el-input v-model="form.baseUrl" placeholder="例如：http://127.0.0.1:9999" class="kd-mono" />
          <div class="form-tip">
            无需填写 <code>/v2/api-docs</code> 等路径，系统会自动探测；也可直接粘贴
            <code>doc.html</code> 地址。
          </div>
        </el-form-item>

        <el-form-item label="备注">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="120"
            show-word-limit
            placeholder="选填，例如：本地开发环境"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ dialogMode === 'create' ? '添加并打开' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.project-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kd-bg);
  overflow: hidden;
}

/* ------------------------------ 工具栏 ------------------------------ */

.project-page__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  flex-shrink: 0;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  max-width: 620px;
  height: 38px;
  padding: 0 10px 0 12px;
  border-radius: 10px;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  cursor: text;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  &:focus-within {
    border-color: var(--kd-primary);
    box-shadow: 0 0 0 3px var(--kd-primary-soft);
  }
}

.search-box__icon {
  color: var(--kd-text-3);
  font-size: 15px;
  flex-shrink: 0;
}

.search-box__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: $font-md;
  color: var(--kd-text);

  &::placeholder {
    color: var(--kd-text-3);
  }
}

.search-box__clear {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--kd-text-3);
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: var(--kd-panel-3);
    color: var(--kd-text);
  }
}

.search-box__kbd {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel-3);
  color: var(--kd-text-3);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.4;
}

.project-page__toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.view-switch {
  display: inline-flex;
  padding: 3px;
  border-radius: 9px;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel-2);
}

.view-switch__btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--kd-text-3);
  font-size: 15px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    color: var(--kd-text);
  }

  &.is-active {
    background: var(--kd-panel);
    color: var(--kd-primary);
    box-shadow: var(--kd-shadow-sm);
  }
}

.new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: 9px;
  background: var(--kd-primary);
  color: #fff;
  font-size: $font-sm;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;

  &:hover {
    background: var(--kd-primary-hover);
    box-shadow: 0 6px 16px rgba(79, 124, 255, 0.28);
  }

  &:active {
    transform: translateY(1px);
  }
}

/* ------------------------------ 概览条 ------------------------------ */

.project-page__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.project-page__meta-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.count-tag {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  font-size: $font-xs;
  color: var(--kd-text-2);
  white-space: nowrap;
}

.safe-tip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: $font-xs;
  color: var(--kd-success);
  white-space: nowrap;

  .el-icon {
    font-size: 14px;
  }
}

/* ------------------------------ 列表容器 ------------------------------ */

.project-page__body {
  flex: 1;
  min-height: 0;
  padding: 0 20px 32px;
}

.project-items.is-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

.project-items.is-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-items.is-drag-active {
  user-select: none;
}

/* ------------------------------ 卡片：公共部分 ------------------------------ */

.project-item {
  position: relative;
  overflow: hidden;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, opacity 0.16s ease;
}

.project-item.is-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: $radius-lg;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  cursor: pointer;

  &:hover {
    transform: translateY(-2px);
    border-color: var(--card-line, var(--kd-border-strong));
    box-shadow: var(--kd-shadow-md);

    .project-item__accent {
      opacity: 1;
    }
  }

  &.is-floating {
    opacity: 0.96;
    box-shadow: var(--kd-shadow-lg);
    cursor: grabbing;
    user-select: none;
    // 悬浮跟随期间关闭过渡，让卡片实时贴合指针，避免滞后
    transition: none;
  }
}

.project-item.is-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: $radius-md;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  cursor: pointer;

  &:hover {
    border-color: var(--card-line, var(--kd-border-strong));
    box-shadow: var(--kd-shadow-sm);

    .project-item__accent {
      opacity: 1;
    }
  }

  &.is-floating {
    opacity: 0.96;
    box-shadow: var(--kd-shadow-lg);
    cursor: grabbing;
    user-select: none;
    transition: none;
  }
}

.project-item__accent {
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--card-color, var(--kd-primary));
  opacity: 0.5;
  transition: opacity 0.16s ease;
}

/* 卡片头部：头像 + 名称 + 拖拽手柄 + 状态胶囊 */
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 头像：主题色的弱化底色 + 同色文字 */
.project-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--card-soft, var(--kd-primary-soft));
  color: var(--card-color, var(--kd-primary));
  font-weight: 700;
  font-size: 15px;
}

.card-head .project-title {
  flex: 1;
  min-width: 0;
}

.project-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.project-title__name {
  font-size: $font-md;
  font-weight: 600;
  color: var(--kd-text);
  @include ellipsis(1);
}

.project-title__index {
  font-size: 11px;
  color: var(--kd-text-3);
  flex-shrink: 0;
}

/* 连通性状态胶囊：点击可重新检测 */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--kd-panel-3);
  color: var(--kd-text-3);
  flex-shrink: 0;
  cursor: pointer;
  white-space: nowrap;

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  &.is-ok {
    background: var(--kd-success-soft);
    color: var(--kd-success);
  }

  &.is-fail {
    background: var(--kd-danger-soft);
    color: var(--kd-danger);
  }

  &.is-checking {
    background: var(--kd-primary-soft);
    color: var(--kd-primary);
  }
}

.is-spin {
  animation: kd-spin 0.9s linear infinite;
}

@keyframes kd-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 拖拽手柄 */
.project-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: $radius-sm;
  color: var(--kd-text-3);
  font-size: 15px;
  cursor: grab;
  flex-shrink: 0;
  // 触摸设备上点击手柄时阻止滚动，保证按住即可拖动
  touch-action: none;
  transition: color 0.14s ease, background 0.14s ease, opacity 0.14s ease;

  &:hover {
    color: var(--kd-primary);
    background: var(--kd-panel-3);
  }

  &:active {
    cursor: grabbing;
  }
}

/* 网格视图的手柄平时隐藏，悬停卡片时才显形 */
.card-head .project-handle {
  opacity: 0;
}

.project-item.is-card:hover .project-handle,
.project-item.is-floating .project-handle {
  opacity: 1;
}

/* ------------------------------ 网格视图细节 ------------------------------ */

.project-visited {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.project-divider {
  height: 1px;
  background: var(--kd-border);
  margin: 2px 0 4px;
}

.project-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.project-field__label {
  font-size: 11px;
  letter-spacing: 0.4px;
  color: var(--kd-text-3);
}

.endpoint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 7px 10px;
  border-radius: $radius-md;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel-2);
}

.endpoint__url {
  flex: 1;
  min-width: 0;
  font-size: $font-xs;
  color: var(--kd-primary);
  @include ellipsis(1);
}

.endpoint__copy {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: $radius-sm;
  background: transparent;
  color: var(--kd-text-3);
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: var(--kd-panel-3);
    color: var(--kd-primary);
  }
}

.info-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.info-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: $font-xs;

  dt {
    flex-shrink: 0;
    color: var(--kd-text-3);
  }

  dd {
    margin: 0;
    min-width: 0;
    color: var(--kd-text-2);
    @include ellipsis(1);

    &.is-muted {
      color: var(--kd-text-3);
    }

    &.is-strong {
      color: var(--kd-text);
    }

    &.is-pending {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--kd-warning);
    }
  }
}

.pending-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kd-warning);
  flex-shrink: 0;
}

.project-item__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  margin-top: auto;
  border-top: 1px dashed var(--kd-border);
}

.doc-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: $radius-md;
  border: 1px solid var(--kd-primary);
  background: var(--kd-primary-soft);
  color: var(--kd-primary);
  font-size: $font-xs;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;

  &:hover {
    background: var(--kd-primary);
    color: #fff;
  }
}

/* 图标操作组 */
.icon-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;

  button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: $radius-sm;
    background: transparent;
    color: var(--kd-text-3);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;

    &:hover {
      background: var(--kd-panel-3);
      color: var(--kd-text);
    }

    &.is-danger:hover {
      background: var(--kd-danger-soft);
      color: var(--kd-danger);
    }
  }
}

/* ------------------------------ 列表视图细节 ------------------------------ */

.is-row .project-avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  font-size: 13px;
}

.is-row .project-title {
  width: 210px;
  flex-shrink: 0;
}

.row-url {
  flex: 1;
  min-width: 0;
  font-size: $font-xs;
  color: var(--kd-primary);
  @include ellipsis(1);
}

.row-meta {
  width: 200px;
  flex-shrink: 0;
  font-size: $font-xs;
  color: var(--kd-text-2);
  @include ellipsis(1);

  &.is-muted {
    color: var(--kd-warning);
  }
}

.row-visited {
  width: 150px;
  flex-shrink: 0;
  font-size: $font-xs;
  color: var(--kd-text-3);
  @include ellipsis(1);
}

/* ------------------------------ 拖拽占位框 ------------------------------ */

.project-item.is-ghost {
  pointer-events: none;
  border: 2px dashed var(--kd-primary);
  background: var(--kd-primary-soft);
  opacity: 0.5;

  &.is-row {
    border-radius: $radius-md;
    min-height: 54px;
  }

  &.is-card {
    border-radius: $radius-lg;
    min-height: 240px;
  }
}

/* ------------------------------ 新增占位卡 ------------------------------ */

.add-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--kd-border-strong);
  background: transparent;
  color: var(--kd-text-3);
  cursor: pointer;
  text-align: center;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;

  &:hover {
    border-color: var(--kd-primary);
    background: var(--kd-primary-soft);
    color: var(--kd-text-2);

    .add-card__plus {
      border-color: var(--kd-primary);
      color: var(--kd-primary);
    }
  }

  &.is-card {
    flex-direction: column;
    padding: 28px 24px;
    border-radius: $radius-lg;
    min-height: 240px;
  }

  &.is-row {
    flex-direction: row;
    padding: 14px;
    border-radius: $radius-md;
  }
}

.add-card__plus {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--kd-border-strong);
  color: var(--kd-text-3);
  font-size: 20px;
  flex-shrink: 0;
  transition: border-color 0.18s ease, color 0.18s ease;
}

.add-card__title {
  font-size: $font-md;
  font-weight: 600;
  color: var(--kd-text-2);
}

.add-card__desc {
  font-size: $font-xs;
  color: var(--kd-text-3);
  line-height: 1.7;
  max-width: 320px;
}

.is-row .add-card__plus {
  width: 30px;
  height: 30px;
  font-size: 15px;
}

.is-row .add-card__desc {
  max-width: none;
  @include ellipsis(1);
}

/* ------------------------------ 其它 ------------------------------ */

.form-tip {
  margin-top: 6px;
  font-size: $font-xs;
  color: var(--kd-text-3);
  line-height: 1.6;

  code {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--kd-panel-3);
    color: var(--kd-danger);
  }
}

@include respond-to($bp-md) {
  .project-page__toolbar {
    padding: 12px 14px;
    flex-wrap: wrap;
  }

  .search-box {
    max-width: none;
  }

  .project-page__meta {
    padding: 0 14px 12px;
  }

  .project-page__body {
    padding: 0 14px 28px;
  }

  .project-items.is-grid {
    grid-template-columns: 1fr;
  }

  .is-row .row-meta,
  .is-row .row-visited {
    display: none;
  }

  .is-row .project-title {
    width: auto;
  }
}
</style>
