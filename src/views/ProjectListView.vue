<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { message } from '@/core/message'

import EmptyState from '@/components/common/EmptyState.vue'
import { copyText, probe } from '@/core/http'
import type { DocProject } from '@/core/types'
import { fromNow, normalizeBaseUrl } from '@/core/utils'
import { useAppStore } from '@/stores/app'
import { useProjectStore, type ProjectInput } from '@/stores/project'

const router = useRouter()
const projectStore = useProjectStore()
const appStore = useAppStore()

/* ------------------------------ 列表与搜索 ------------------------------ */

const keyword = ref('')

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
  const style: Record<string, string | number> = { '--card-color': project.color }
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
  const card = pressEl?.closest('.project-card') as HTMLElement | null
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
  if (!el || !el.closest('.project-grid')) {
    // 指针离开列表区域：占位框回到原位
    resetDropIndex()
    return
  }
  // 悬停在占位框上：保持当前位置（松手即落到占位框所在处）
  if (el.closest('.project-card__ghost')) return
  const card = el.closest('.project-card') as HTMLElement | null
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

/** 记录中的接口数量等信息 */
function metaText(project: DocProject): string {
  const meta = project.meta
  if (!meta || (!meta.apiCount && !meta.groupCount)) return '尚未同步文档'
  const parts: string[] = []
  if (meta.apiCount) parts.push(`${meta.apiCount} 个接口`)
  if (meta.groupCount && meta.groupCount > 1) parts.push(`${meta.groupCount} 个分组`)
  if (meta.specVersion) parts.push(meta.specVersion.startsWith('2') ? 'Swagger 2.0' : `OpenAPI ${meta.specVersion}`)
  return parts.join(' · ') || '尚未同步文档'
}

/** 地址可用性探测缓存 */
const statusMap = reactive<Record<string, 'idle' | 'checking' | 'ok' | 'fail'>>({})

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
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('keydown', onDragKeydown)
  clearPress()
})
</script>

<template>
  <div class="project-page">
    <!-- 项目列表工具栏：搜索 + 新增 -->
    <div class="project-page__toolbar">
      <el-input
        v-model="keyword"
        class="search-input"
        placeholder="搜索项目名称或地址"
        clearable
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>
        <span>新增项目</span>
      </el-button>
    </div>

    <main class="project-page__body kd-scroll">
      <div class="project-page__summary">
        <span>共 {{ projectStore.count }} 个项目</span>
        <span v-if="projectStore.projects.length" class="project-page__hint">
          {{
            appStore.isDesktop
              ? `数据保存在 ${appStore.dataRootLabel} 的 data.json，不会上传到任何服务器`
              : '浏览器预览模式：数据暂存在 localStorage'
          }}
        </span>
      </div>

      <EmptyState
        v-if="projectStore.projects.length === 0"
        icon="Files"
        title="还没有任何项目"
        description="添加一个后端服务地址（例如 http://127.0.0.1:9999），系统会自动发现 springfox / springdoc 暴露的接口文档。"
      >
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          <span>新增第一个项目</span>
        </el-button>
      </EmptyState>

      <EmptyState
        v-else-if="filteredProjects.length === 0"
        icon="Search"
        title="没有匹配的项目"
        description="换个关键词试试"
      />

      <div v-else class="project-grid" :class="{ 'is-drag-active': dragActive }">
        <article
          v-for="project in filteredProjects"
          :key="project.id"
          class="project-card"
          :class="{ 'is-floating': dragActive && draggedId === project.id }"
          :style="cardStyle(project)"
          :data-id="project.id"
          @pointerdown="onCardPointerDown(project, $event)"
          @click="openProject(project)"
        >
          <div class="project-card__bar" />

          <div class="project-card__head">
            <div class="project-card__avatar" :style="{ background: project.color }">
              {{ project.name.slice(0, 1).toUpperCase() }}
            </div>
            <div class="project-card__title">
              <h3>{{ project.name }}</h3>
              <span class="project-card__time">最近访问：{{ fromNow(project.lastOpened) }}</span>
            </div>

            <!-- 拖拽手柄：点击即可直接拖动排序；在卡片其它区域长按也可拖动 -->
            <span
              v-if="dragEnabled"
              class="project-card__drag"
              title="拖动排序"
              @pointerdown.stop="onHandlePointerDown(project, $event)"
              @click.stop
            >
              <el-icon><Rank /></el-icon>
            </span>

            <span
              class="project-card__status"
              :class="`is-${statusMap[project.id] ?? 'idle'}`"
              @click.stop
            >
              <template v-if="statusMap[project.id] === 'checking'">
                <el-icon class="is-spin"><Loading /></el-icon>
                检测中
              </template>
              <template v-else-if="statusMap[project.id] === 'ok'">
                <i class="dot" />
                可访问
              </template>
              <template v-else-if="statusMap[project.id] === 'fail'">
                <i class="dot" />
                不可达
              </template>
              <template v-else>
                <i class="dot" />
                未检测
              </template>
            </span>
          </div>

          <div class="project-card__url kd-mono">{{ project.baseUrl }}</div>

          <p v-if="project.description" class="project-card__desc">{{ project.description }}</p>
          <p v-else class="project-card__desc is-placeholder">暂无备注</p>

          <div class="project-card__meta">
            <span class="project-card__meta-text">{{ metaText(project) }}</span>
          </div>

          <div class="project-card__footer" @click.stop>
            <el-button size="small" type="primary" plain @click="openProject(project)">
              <el-icon><Document /></el-icon>
              <span>查看文档</span>
            </el-button>
            <el-button-group>
              <el-tooltip content="检测连通性" placement="top">
                <el-button size="small" @click="checkStatus(project)">
                  <el-icon><Connection /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="复制地址" placement="top">
                <el-button size="small" @click="handleCopyUrl(project)">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="编辑" placement="top">
                <el-button size="small" @click="openEdit(project)">
                  <el-icon><EditPen /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button size="small" type="danger" plain @click="handleRemove(project)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </el-tooltip>
            </el-button-group>
          </div>
        </article>

        <!-- 拖拽占位框：标记当前放置位置，被拖卡片让位后留出的空槽 -->
        <div v-if="dragActive" class="project-card__ghost" :style="{ order: ghostOrder }" />
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
}

.project-page__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 28px;
  border-bottom: 1px solid var(--kd-border);
  background: var(--kd-panel);
  flex-wrap: wrap;
}

.search-input {
  width: 260px;
}

.project-page__body {
  flex: 1;
  min-height: 0;
  padding: 20px 28px 40px;
}

.project-page__summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  font-size: $font-sm;
  color: var(--kd-text-2);
}

.project-page__hint {
  color: var(--kd-text-3);
  font-size: $font-xs;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;

  /* 拖拽期间禁用文本选择，避免干扰 */
  &.is-drag-active {
    user-select: none;
  }
}

.project-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: $radius-lg;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, opacity 0.16s ease;

  &:hover {
    transform: translateY(-2px);
    border-color: var(--card-color);
    box-shadow: var(--kd-shadow-md);

    .project-card__bar {
      opacity: 1;
    }
  }

  &.is-floating {
    opacity: 0.95;
    box-shadow: var(--kd-shadow-lg);
    cursor: grabbing;
    user-select: none;
    // 悬浮跟随期间关闭过渡，让卡片实时贴合指针，避免滞后
    transition: none;
  }
}

/* 拖拽占位框：标记当前放置位置 */
.project-card__ghost {
  min-height: 140px;
  border: 2px dashed var(--kd-primary);
  border-radius: $radius-lg;
  background: var(--kd-primary-soft);
  opacity: 0.55;
}

/* 拖拽手柄 */
.project-card__drag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: $radius-sm;
  color: var(--kd-text-3);
  font-size: 16px;
  cursor: grab;
  flex-shrink: 0;
  // 触摸设备上点击手柄时阻止滚动，保证按住即可拖动
  touch-action: none;
  transition: color 0.14s ease, background 0.14s ease;

  &:hover {
    color: var(--kd-primary);
    background: var(--kd-panel-3);
  }

  &:active {
    cursor: grabbing;
  }
}

.project-card__bar {
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--card-color);
  opacity: 0.55;
  transition: opacity 0.16s ease;
}

.project-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.project-card__avatar {
  width: 36px;
  height: 36px;
  border-radius: $radius-md;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  flex-shrink: 0;
}

.project-card__title {
  flex: 1;
  min-width: 0;

  h3 {
    font-size: $font-md;
    @include ellipsis(1);
  }
}

.project-card__time {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.project-card__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--kd-panel-3);
  color: var(--kd-text-3);
  flex-shrink: 0;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--kd-text-3);
  }

  &.is-ok {
    background: var(--kd-success-soft);
    color: var(--kd-success);

    .dot {
      background: var(--kd-success);
    }
  }

  &.is-fail {
    background: var(--kd-danger-soft);
    color: var(--kd-danger);

    .dot {
      background: var(--kd-danger);
    }
  }

  &.is-checking {
    color: var(--kd-primary);
    background: var(--kd-primary-soft);
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

.project-card__url {
  font-size: $font-xs;
  color: var(--kd-primary);
  padding: 5px 8px;
  border-radius: $radius-sm;
  background: var(--kd-panel-2);
  @include ellipsis(1);
}

.project-card__desc {
  font-size: $font-sm;
  color: var(--kd-text-2);
  min-height: 20px;
  @include ellipsis(2);

  &.is-placeholder {
    color: var(--kd-text-3);
  }
}

.project-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-card__meta-text {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.project-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px dashed var(--kd-border);
  margin-top: auto;
}

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

@include respond-to($bp-sm) {
  .project-page__toolbar {
    padding: 12px 16px;
  }

  .project-page__body {
    padding: 16px;
  }

  .search-input {
    width: 100%;
  }
}
</style>
