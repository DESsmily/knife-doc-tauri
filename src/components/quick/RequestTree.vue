<script setup lang="ts">
/**
 * 快捷请求左侧树：一级请求 + 分类，支持新建 / 重命名 / 删除 / 移动 / 复制 / 导入导出。
 * 请求支持右键菜单，以及长按拖拽排序与跨分类移动。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessageBox, useZIndex, type DropdownInstance } from 'element-plus'
import { message } from '@/core/message'

import MethodTag from '@/components/common/MethodTag.vue'
import { fromNow } from '@/core/utils'
import { exportJson, saveTempFile } from '@/core/http'
import { isTauri } from '@/core/tauri'
import type { QuickRequest } from '@/core/types'
import { useQuickRequestStore } from '@/stores/quickRequest'

const store = useQuickRequestStore()

const nodes = computed(() => store.matchedNodes)
/** 一级请求：不属于任何分类，直接展示在树的最上层 */
const rootRequests = computed(() => store.matchedRootRequests)
const isEmpty = computed(() => store.requests.length === 0 && store.folders.length === 0)
/** 有无可见内容（搜索无结果时展示提示） */
const hasResult = computed(() => nodes.value.length > 0 || rootRequests.value.length > 0)

/** 折叠的分类 */
const collapsed = ref<string[]>([])

function toggleGroup(id: string) {
  collapsed.value = collapsed.value.includes(id)
    ? collapsed.value.filter((item) => item !== id)
    : [...collapsed.value, id]
}

function isCollapsed(id: string): boolean {
  return collapsed.value.includes(id)
}

/** 单行列表放不下地址，鼠标悬停时用原生 title 补全 */
function rowTitle(request: QuickRequest): string {
  const sent = request.lastSentAt ? `\n最近发送：${fromNow(request.lastSentAt)}` : ''
  return `${request.method} ${request.url || '未填写地址'}${sent}`
}

/** 移动到子菜单：一级（不属于任何分类）+ 除当前所在分类外的所有分类 */
function moveTargets(request: QuickRequest) {
  return [{ id: '', name: '一级' }, ...store.folders.filter((it) => it.id !== request.folderId)]
}

const { nextZIndex } = useZIndex()

/**
 * 「移动到」二级悬浮框。
 *
 * 下拉面板内部是 el-scrollbar，任何越出面板的绝对定位都会被裁剪并撑出滚动条，
 * 因此浮层 Teleport 到 body 用 fixed 定位，坐标取父项的 rect，空间不足时向左翻转。
 */
const flyout = ref<{
  requestId: string
  targets: { id: string; name: string }[]
  left: number
  top: number
  zIndex: number
} | null>(null)
const flyoutEl = ref<HTMLElement | null>(null)
const menus = new Map<string, DropdownInstance>()
let hideTimer: ReturnType<typeof setTimeout> | undefined

function setMenuRef(id: string, el: unknown) {
  if (el) menus.set(id, el as DropdownInstance)
  else menus.delete(id)
}

function holdFlyout() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = undefined
}

/** 延迟关闭，留出跨越 4px 间隙的时间 */
function leaveFlyout() {
  holdFlyout()
  hideTimer = setTimeout(() => (flyout.value = null), 180)
}

async function enterMoveItem(request: QuickRequest, event: MouseEvent) {
  holdFlyout()
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect()
  flyout.value = {
    requestId: request.id,
    targets: moveTargets(request),
    left: anchor.right + 4,
    top: anchor.top,
    zIndex: nextZIndex()
  }
  await nextTick()
  const box = flyoutEl.value?.getBoundingClientRect()
  const current = flyout.value
  if (!box || !current) return
  let { left, top } = current
  if (left + box.width > window.innerWidth - 8) left = Math.max(8, anchor.left - box.width - 4)
  if (top + box.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - box.height)
  if (left !== current.left || top !== current.top) flyout.value = { ...current, left, top }
}

function closeFlyout() {
  holdFlyout()
  flyout.value = null
}

/** 父级下拉关掉时（点击别处、选中项）二级悬浮框一起收起；打开时收起右键菜单 */
function onMenuVisible(visible: boolean) {
  if (!visible) {
    closeFlyout()
    return
  }
  if (itemMenu.visible) closeItemMenu()
}

function moveTo(folderId: string) {
  const current = flyout.value
  if (!current) return
  const target = current.targets.find((item) => item.id === folderId)
  store.move(current.requestId, folderId)
  closeFlyout()
  menus.get(current.requestId)?.handleClose()
  // 右键菜单里移动时，父级菜单也要一起收起
  itemMenu.visible = false
  itemMenu.request = null
  message.success(`已移动到「${target?.name ?? '一级'}」`)
}

/* ------------------------------ 请求右键菜单 ---------------------------- */

interface ItemMenuState {
  visible: boolean
  x: number
  y: number
  /** 浮层 z-index：先打开菜单再展开「移动到」，后者层级更高 */
  zIndex: number
  request: QuickRequest | null
}

const itemMenu = reactive<ItemMenuState>({
  visible: false,
  x: 0,
  y: 0,
  zIndex: 2000,
  request: null
})
const itemMenuRef = ref<HTMLElement | null>(null)

/** 在鼠标位置打开请求操作菜单，并保证菜单不溢出视口 */
function openItemMenu(event: MouseEvent, request: QuickRequest) {
  event.preventDefault()
  event.stopPropagation()
  closeFlyout()
  itemMenu.visible = true
  itemMenu.request = request
  itemMenu.x = event.clientX
  itemMenu.y = event.clientY
  itemMenu.zIndex = nextZIndex()
  void nextTick(() => {
    const el = itemMenuRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    if (itemMenu.x + rect.width + margin > window.innerWidth) {
      itemMenu.x = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (itemMenu.y + rect.height + margin > window.innerHeight) {
      itemMenu.y = Math.max(margin, window.innerHeight - rect.height - margin)
    }
  })
}

function closeItemMenu() {
  itemMenu.visible = false
  itemMenu.request = null
  closeFlyout()
}

function menuRename() {
  const request = itemMenu.request
  if (!request) return
  closeItemMenu()
  void renameRequest(request)
}

function menuDuplicate() {
  const request = itemMenu.request
  if (!request) return
  closeItemMenu()
  store.duplicate(request.id)
  message.success('已复制一份请求')
}

function menuRemove() {
  const request = itemMenu.request
  if (!request) return
  closeItemMenu()
  void removeRequest(request)
}

/** 右键菜单的「移动到」：悬停展开分类列表（复用下拉菜单的二级浮层） */
function enterMoveMenuItem(event: MouseEvent) {
  const request = itemMenu.request
  if (!request) return
  void enterMoveItem(request, event)
}

/* ------------------------------ 长按拖拽排序 ---------------------------- */
// 与项目列表一致：WebView 对原生 HTML5 draggable 支持不稳定，改用 Pointer Events。
// 长按 400ms 进入拖拽，跟随鼠标的悬浮标签 + 目标位置插入指示线；
// 落在分类标题 / 空分类区域即移入该分类（追加到末尾），落在列表空白处回到一级。

/** 长按触发拖拽的阈值（毫秒） */
const LONG_PRESS_MS = 400
/** 长按期间允许的移动容差（像素），超过则视为滚动 / 点击而非拖拽 */
const PRESS_TOLERANCE = 8

interface DragState {
  id: string
  name: string
  method: QuickRequest['method']
  /** 悬浮标签位置（跟随鼠标） */
  x: number
  y: number
  /** 当前落点：目标分类与插入到哪个请求之前（空串 = 追加到末尾） */
  folderId: string
  beforeId: string
  /** 当前是否存在有效落点 */
  hasDrop: boolean
  /** 指示线：悬停的请求 id 与其上下方向 */
  overId: string
  overPosition: 'before' | 'after' | ''
  /** 悬停的分类（标题 / 空白区域高亮） */
  overFolderId: string
}

const drag = ref<DragState | null>(null)
const listRef = ref<HTMLElement | null>(null)

/** 搜索时禁用拖拽，避免在过滤后的列表上排序导致顺序混乱 */
const dragEnabled = computed(() => store.keyword.trim() === '')

/** 长按计时器句柄 */
let pressTimer: number | undefined
/** 按下时命中的请求 */
let pressRequest: QuickRequest | null = null
/** 按下起始位置，用于判断移动距离 */
const pressStart = { x: 0, y: 0 }
/** 指针当前位置（长按计时结束时以它为起点生成悬浮标签） */
const pointerPos = { x: 0, y: 0 }
/** 拖拽刚结束时抑制一次 click，避免松手后误打开请求 */
let suppressClick = false

function clearPress() {
  if (pressTimer !== undefined) {
    clearTimeout(pressTimer)
    pressTimer = undefined
  }
  pressRequest = null
}

/** 请求行 pointerdown：启动长按计时，超时后进入拖拽 */
function onItemPointerDown(request: QuickRequest, event: PointerEvent) {
  if (!dragEnabled.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  // 在按钮 / 表单等交互元素上按下时不启动拖拽，交给按钮自己处理
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, select, textarea, [role="button"]')) return
  clearPress()
  pressRequest = request
  pressStart.x = event.clientX
  pressStart.y = event.clientY
  pointerPos.x = event.clientX
  pointerPos.y = event.clientY
  pressTimer = window.setTimeout(beginDrag, LONG_PRESS_MS)
}

/** 进入拖拽模式：生成跟随鼠标的悬浮标签 */
function beginDrag() {
  const request = pressRequest
  if (drag.value || !request) return
  pressTimer = undefined
  closeItemMenu()
  closeFlyout()
  // 收起可能还开着的行操作下拉，避免与拖拽同时出现在屏幕上
  for (const menu of menus.values()) menu.handleClose()
  document.body.classList.add('kd-drag-active')
  drag.value = {
    id: request.id,
    name: request.name,
    method: request.method,
    x: pointerPos.x,
    y: pointerPos.y,
    folderId: request.folderId,
    beforeId: '',
    hasDrop: false,
    overId: '',
    overPosition: '',
    overFolderId: ''
  }
  updateDrop(pointerPos.x, pointerPos.y)
}

/** 同分类中 id 之后的下一个请求（跳过正在拖拽的请求），用于「放到某行下方」 */
function nextSiblingId(folderId: string, id: string, excludeId: string): string {
  const list = store.requests.filter((item) => item.folderId === folderId)
  let index = list.findIndex((item) => item.id === id) + 1
  while (index > 0 && index < list.length) {
    if (list[index].id !== excludeId) return list[index].id
    index += 1
  }
  return ''
}

/** 按指针位置计算落点并更新插入指示 */
function updateDrop(x: number, y: number) {
  const state = drag.value
  if (!state) return
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const host = listRef.value
  // 指针移出列表（例如拖到右侧编辑器上）：没有落点，松手即取消
  if (!host || !el || !host.contains(el)) {
    state.hasDrop = false
    state.overId = ''
    state.overPosition = ''
    state.overFolderId = ''
    return
  }

  const item = el.closest<HTMLElement>('[data-req-id]') ?? null
  if (item) {
    const id = item.dataset.reqId ?? ''
    // 悬停在自身：没有有效落点，松手即取消
    if (id === state.id) {
      state.hasDrop = false
      state.overId = ''
      state.overPosition = ''
      state.overFolderId = ''
      return
    }
    const folderId = item.dataset.reqFolder ?? ''
    const rect = item.getBoundingClientRect()
    const after = y > rect.top + rect.height / 2
    state.hasDrop = true
    state.folderId = folderId
    state.beforeId = after ? nextSiblingId(folderId, id, state.id) : id
    state.overId = id
    state.overPosition = after ? 'after' : 'before'
    state.overFolderId = ''
    return
  }

  const group = el?.closest<HTMLElement>('[data-folder-id]') ?? null
  if (group) {
    // 分类标题 / 空分类的空白区域：移入该分类并追加到末尾
    state.hasDrop = true
    state.folderId = group.dataset.folderId ?? ''
    state.beforeId = ''
    state.overId = ''
    state.overPosition = ''
    state.overFolderId = state.folderId
    return
  }

  // 列表空白区域：回到一级末尾
  state.hasDrop = true
  state.folderId = ''
  state.beforeId = ''
  state.overId = ''
  state.overPosition = ''
  state.overFolderId = ''
}

/** 拖到列表上下边缘时自动滚动 */
function autoScroll(y: number) {
  const host = listRef.value
  if (!host) return
  const rect = host.getBoundingClientRect()
  const edge = 32
  if (y < rect.top + edge) host.scrollTop -= 12
  else if (y > rect.bottom - edge) host.scrollTop += 12
}

/** 全局 pointermove：未进入拖拽时移动过大取消长按；拖拽中跟随鼠标并更新落点 */
function onPointerMove(event: PointerEvent) {
  if (!drag.value) {
    if (!pressRequest) return
    pointerPos.x = event.clientX
    pointerPos.y = event.clientY
    if (
      Math.abs(event.clientX - pressStart.x) > PRESS_TOLERANCE ||
      Math.abs(event.clientY - pressStart.y) > PRESS_TOLERANCE
    ) {
      clearPress()
    }
    return
  }
  // 拖拽中阻止文本选择等默认行为
  event.preventDefault()
  pointerPos.x = event.clientX
  pointerPos.y = event.clientY
  const state = drag.value
  state.x = event.clientX
  state.y = event.clientY
  autoScroll(event.clientY)
  updateDrop(event.clientX, event.clientY)
}

/** 结束拖拽；commit 为 false 时仅还原（ESC / pointercancel） */
function endDrag(commit: boolean) {
  const state = drag.value
  if (!state) return
  if (commit && state.hasDrop) store.moveTo(state.id, state.folderId, state.beforeId)
  drag.value = null
  document.body.classList.remove('kd-drag-active')
  clearPress()
  // 抑制拖拽结束后的误触 click；兜底延迟重置，防止 click 未触发而残留
  suppressClick = true
  window.setTimeout(() => {
    suppressClick = false
  }, 300)
}

function onPointerUp() {
  if (drag.value) {
    endDrag(true)
    return
  }
  clearPress()
}

function onPointerCancel() {
  if (drag.value) endDrag(false)
  else clearPress()
}

/** ESC 取消拖拽 / 收起右键菜单 */
function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (drag.value) endDrag(false)
  if (itemMenu.visible) closeItemMenu()
}

/** 点击列表行：拖拽刚结束时忽略这次误触的 click */
function openRequest(request: QuickRequest) {
  if (suppressClick) return
  store.open(request.id)
}

/** 点击空白处收起右键菜单 */
function handleWindowClick() {
  if (itemMenu.visible) closeItemMenu()
}

/** 右键其它位置时收起右键菜单（菜单 / 请求行上的右键已 stopPropagation） */
function handleWindowContextMenu(event: MouseEvent) {
  if (!itemMenu.visible) return
  const el = event.target as HTMLElement | null
  if (el?.closest('.item-ctx')) return
  closeItemMenu()
}

/** 滚动列表时收起右键菜单，避免菜单脱离列表项 */
function handleListScroll() {
  if (itemMenu.visible) closeItemMenu()
}

onMounted(() => {
  // 拖拽期间需在列表之外也能收到 pointermove / pointerup
  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('click', handleWindowClick)
  window.addEventListener('contextmenu', handleWindowContextMenu)
})

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
  clearPress()
  document.body.classList.remove('kd-drag-active')
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('click', handleWindowClick)
  window.removeEventListener('contextmenu', handleWindowContextMenu)
})

function createRequest(folderId = '') {
  const request = store.addRequest({ folderId })
  message.success('已新建请求，填写地址后即可发送')
  return request
}

async function createFolder() {
  try {
    const { value } = await ElMessageBox.prompt('分类用于把快捷请求分组管理', '新建分类', {
      inputPlaceholder: '例如：本地服务 / 线上订单',
      confirmButtonText: '创建',
      cancelButtonText: '取消'
    })
    store.addFolder(String(value ?? ''))
  } catch {
    /* 用户取消 */
  }
}

function onNew(command: string | number) {
  if (command === 'folder') void createFolder()
  else createRequest()
}

async function renameFolder(id: string, name: string) {
  try {
    const { value } = await ElMessageBox.prompt('分类名称', '重命名分类', {
      inputValue: name,
      confirmButtonText: '保存',
      cancelButtonText: '取消'
    })
    store.renameFolder(id, String(value ?? ''))
  } catch {
    /* 取消 */
  }
}

async function removeFolder(id: string, name: string, count: number) {
  if (count === 0) {
    store.removeFolder(id, false)
    return
  }
  try {
    await ElMessageBox.confirm(
      `分类「${name}」下有 ${count} 条请求，请选择处理方式。`,
      '删除分类',
      {
        confirmButtonText: '连同请求一起删除',
        cancelButtonText: '仅删除分类',
        distinguishCancelAndClose: true,
        type: 'warning'
      }
    )
    store.removeFolder(id, true)
    message.success('分类及其请求已删除')
  } catch (action) {
    if (action === 'cancel') {
      store.removeFolder(id, false)
      message.success('请求已移到一级')
    }
    /* close = 放弃操作 */
  }
}

async function renameRequest(request: QuickRequest) {
  try {
    const { value } = await ElMessageBox.prompt('请求名称', '重命名请求', {
      inputValue: request.name,
      confirmButtonText: '保存',
      cancelButtonText: '取消'
    })
    store.rename(request.id, String(value ?? ''))
  } catch {
    /* 取消 */
  }
}

async function removeRequest(request: QuickRequest) {
  try {
    await ElMessageBox.confirm(`确定删除「${request.name}」？该操作不可撤销。`, '删除请求', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  store.remove(request.id)
}

async function exportAll() {
  try {
    const path = await exportJson('knife-doc-quick-requests.json', store.exportData())
    if (!path) return
    message.success(isTauri ? `已导出到 ${path}` : '已导出请求集合')
  } catch (error) {
    message.error(`导出失败：${String(error)}`)
  }
}

/** 导入：桌面端用原生文件对话框，浏览器退回隐藏 input */
async function importAll(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  try {
    const text = await file.text()
    const added = store.importData(JSON.parse(text))
    message.success(`导入完成，新增 ${added} 条请求`)
  } catch (error) {
    message.error(`导入失败：${String(error)}`)
  }
}

/** 拖拽 json 文件到列表也能导入（Apifox 同习惯） */
async function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  event.preventDefault()
  try {
    store.importData(JSON.parse(await file.text()))
    message.success('已导入拖入的请求文件')
  } catch (error) {
    message.error(`导入失败：${String(error)}`)
  }
}

async function saveToTemp() {
  if (!isTauri) {
    message.info('临时文件仅桌面客户端可用')
    return
  }
  const path = await saveTempFile('quick-requests.json', JSON.stringify(store.exportData(), null, 2))
  message.success(`已写入临时目录：${path}`)
}
</script>

<template>
  <aside class="req-tree">
    <header class="req-tree__head">
      <span class="req-tree__title">快捷请求</span>
      <div class="req-tree__head-tools">
        <el-dropdown trigger="click" placement="bottom-end">
          <button type="button" class="tool-btn" title="导入 / 导出">
            <el-icon><More /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="exportAll">导出全部请求</el-dropdown-item>
              <el-dropdown-item @click="saveToTemp">写到临时目录</el-dropdown-item>
              <li class="dropdown-file">
                <span>导入请求 JSON</span>
                <input type="file" accept="application/json,.json" @change="importAll" />
              </li>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="req-tree__tools">
      <el-input
        v-model="store.keyword"
        class="req-tree__search"
        placeholder="搜索请求名 / 地址"
        clearable
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-dropdown trigger="click" placement="bottom-end" @command="onNew">
        <button type="button" class="req-tree__add" title="新建">
          <el-icon><Plus /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="request">新建请求</el-dropdown-item>
            <el-dropdown-item command="folder">新建分类</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div
      ref="listRef"
      class="req-tree__list kd-scroll"
      @drop="onDrop"
      @dragover.prevent
      @scroll="handleListScroll"
    >
      <div v-if="isEmpty" class="req-tree__empty">
        <el-icon :size="26"><Lightning /></el-icon>
        <p>还没有快捷请求</p>
        <span>不依赖接口文档，随手发一个 HTTP 请求</span>
        <button type="button" class="req-tree__create" @click="createRequest()">
          <el-icon><Plus /></el-icon>
          <span>新建第一个请求</span>
        </button>
      </div>

      <template v-else>
        <!-- 一级请求：不挂在任何分类下，直接列在最上层 -->
        <ul v-if="rootRequests.length" class="req-root">
          <li
            v-for="request in rootRequests"
            :key="request.id"
            class="req-item"
            :class="{
              'is-active': request.id === store.activeId,
              'is-dragging': drag?.id === request.id,
              'is-drop-before': drag?.hasDrop && drag.overId === request.id && drag.overPosition === 'before',
              'is-drop-after': drag?.hasDrop && drag.overId === request.id && drag.overPosition === 'after'
            }"
            :data-req-id="request.id"
            data-req-folder=""
            :title="rowTitle(request)"
            @pointerdown="onItemPointerDown(request, $event)"
            @contextmenu="openItemMenu($event, request)"
            @click="openRequest(request)"
          >
            <MethodTag :method="request.method" text />
            <span class="req-item__name kd-ellipsis">{{ request.name }}</span>

            <el-dropdown
              trigger="click"
              placement="bottom-end"
              :ref="(el: unknown) => setMenuRef(request.id, el)"
              @visible-change="onMenuVisible"
            >
              <button type="button" class="item-menu" title="请求操作" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="renameRequest(request)">重命名</el-dropdown-item>
                  <el-dropdown-item @click="store.duplicate(request.id)">复制一份</el-dropdown-item>
                  <li
                    class="dropdown-submenu"
                    @mouseenter="enterMoveItem(request, $event)"
                    @mouseleave="leaveFlyout"
                  >
                    <span>移动到</span>
                    <el-icon class="dropdown-submenu__arrow"><ArrowRight /></el-icon>
                  </li>
                  <el-dropdown-item divided @click="removeRequest(request)">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </li>
        </ul>

        <!-- 分类：标题行可折叠，落点高亮提示可移入该分类 -->
        <section
          v-for="node in nodes"
          :key="node.id"
          class="req-group"
          :data-folder-id="node.id"
          :class="{ 'is-drop-target': drag?.hasDrop && drag.overFolderId === node.id }"
        >
          <header class="req-group__head" :title="isCollapsed(node.id) ? '展开' : '折叠'" @click="toggleGroup(node.id)">
            <el-icon class="req-group__caret" :class="{ 'is-collapsed': isCollapsed(node.id) }">
              <CaretBottom />
            </el-icon>
            <el-icon class="req-group__icon"><Folder /></el-icon>
            <span class="req-group__name kd-ellipsis">{{ node.name }}</span>
            <em class="req-group__count">({{ node.requests.length }})</em>

            <el-dropdown trigger="click" placement="bottom-end">
              <button type="button" class="group-menu" title="分类操作" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="createRequest(node.id)">在此分类新建请求</el-dropdown-item>
                  <el-dropdown-item @click="renameFolder(node.id, node.name)">重命名</el-dropdown-item>
                  <el-dropdown-item divided @click="removeFolder(node.id, node.name, node.requests.length)">
                    删除分类
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </header>

          <ul v-if="!isCollapsed(node.id) && node.requests.length" class="req-group__items">
            <li
              v-for="request in node.requests"
              :key="request.id"
              class="req-item"
              :class="{
                'is-active': request.id === store.activeId,
                'is-dragging': drag?.id === request.id,
                'is-drop-before': drag?.hasDrop && drag.overId === request.id && drag.overPosition === 'before',
                'is-drop-after': drag?.hasDrop && drag.overId === request.id && drag.overPosition === 'after'
              }"
              :data-req-id="request.id"
              :data-req-folder="node.id"
              :title="rowTitle(request)"
              @pointerdown="onItemPointerDown(request, $event)"
              @contextmenu="openItemMenu($event, request)"
              @click="openRequest(request)"
            >
              <MethodTag :method="request.method" text />
              <span class="req-item__name kd-ellipsis">{{ request.name }}</span>

              <el-dropdown
                trigger="click"
                placement="bottom-end"
                :ref="(el: unknown) => setMenuRef(request.id, el)"
                @visible-change="onMenuVisible"
              >
                <button type="button" class="item-menu" title="请求操作" @click.stop>
                  <el-icon><MoreFilled /></el-icon>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="renameRequest(request)">重命名</el-dropdown-item>
                    <el-dropdown-item @click="store.duplicate(request.id)">复制一份</el-dropdown-item>
                    <li
                      class="dropdown-submenu"
                      @mouseenter="enterMoveItem(request, $event)"
                      @mouseleave="leaveFlyout"
                    >
                      <span>移动到</span>
                      <el-icon class="dropdown-submenu__arrow"><ArrowRight /></el-icon>
                    </li>
                    <el-dropdown-item divided @click="removeRequest(request)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </li>
          </ul>
          <p v-else-if="!isCollapsed(node.id)" class="req-group__blank">无请求</p>
        </section>

        <p v-if="!hasResult && store.keyword.trim()" class="req-tree__hint">
          没有匹配「{{ store.keyword }}」的快捷请求
        </p>
      </template>
    </div>

    <footer class="req-tree__footer">
      <span>{{ store.total }} 条请求 · {{ store.folders.length }} 个分类</span>
      <span class="req-tree__footer-hint">拖入 JSON 导入</span>
    </footer>

    <Teleport to="body">
      <div
        v-if="flyout"
        ref="flyoutEl"
        class="move-flyout"
        :style="{ left: `${flyout.left}px`, top: `${flyout.top}px`, zIndex: flyout.zIndex }"
        @mouseenter="holdFlyout"
        @mouseleave="leaveFlyout"
      >
        <p class="move-flyout__title">移动到</p>
        <button
          v-for="target in flyout.targets"
          :key="target.id || '__none'"
          type="button"
          class="move-flyout__item"
          @click="moveTo(target.id)"
        >
          <el-icon class="move-flyout__icon">
            <Folder v-if="target.id" />
            <Files v-else />
          </el-icon>
          <span class="kd-ellipsis">{{ target.name }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 拖拽时跟随鼠标的悬浮标签 -->
    <Teleport to="body">
      <div
        v-if="drag"
        class="drag-ghost"
        :style="{ left: `${drag.x + 14}px`, top: `${drag.y + 10}px` }"
      >
        <MethodTag :method="drag.method" text />
        <span class="kd-ellipsis">{{ drag.name }}</span>
      </div>
    </Teleport>

    <!-- 请求右键菜单 -->
    <Teleport to="body">
      <div
        v-if="itemMenu.visible && itemMenu.request"
        ref="itemMenuRef"
        class="item-ctx"
        :style="{ left: `${itemMenu.x}px`, top: `${itemMenu.y}px`, zIndex: itemMenu.zIndex }"
        @click.stop
        @contextmenu.prevent
      >
        <button type="button" class="item-ctx__item" @click="menuRename">
          <el-icon><EditPen /></el-icon>
          <span>重命名</span>
        </button>
        <button type="button" class="item-ctx__item" @click="menuDuplicate">
          <el-icon><CopyDocument /></el-icon>
          <span>复制一份</span>
        </button>
        <div class="item-ctx__sub" @mouseenter="enterMoveMenuItem" @mouseleave="leaveFlyout">
          <el-icon><FolderOpened /></el-icon>
          <span>移动到</span>
          <el-icon class="item-ctx__arrow"><ArrowRight /></el-icon>
        </div>
        <div class="item-ctx__divider" />
        <button type="button" class="item-ctx__item is-danger" @click="menuRemove">
          <el-icon><Delete /></el-icon>
          <span>删除</span>
        </button>
      </div>
    </Teleport>
  </aside>
</template>

<style lang="scss" scoped>
.req-tree {
  display: flex;
  flex-direction: column;
  width: $sidebar-width;
  min-width: $sidebar-width;
  border-right: 1px solid var(--kd-border);
  background: var(--kd-panel);

  &__head {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 10px 4px 12px;
  }

  &__title {
    font-size: $font-md;
    font-weight: 600;
    color: var(--kd-text);
  }

  &__head-tools {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }

  &__tools {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 12px 10px;
    border-bottom: 1px solid var(--kd-border);
  }

  &__search {
    flex: 1;
    min-width: 0;
  }

  &__add {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    cursor: pointer;
    color: #fff;
    background: var(--kd-primary);
    border: none;
    border-radius: $radius-sm;

    &:hover {
      background: var(--kd-primary-hover);
    }
  }

  &__list {
    flex: 1;
    padding: 8px 8px 12px;
    min-height: 0;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    padding: 40px 16px;
    color: var(--kd-text-3);
    text-align: center;

    p {
      font-size: $font-md;
      color: var(--kd-text-2);
    }

    span {
      margin-bottom: 2px;
      font-size: $font-xs;
    }
  }

  &__footer {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 7px 12px;
    font-size: $font-xs;
    color: var(--kd-text-3);
    border-top: 1px solid var(--kd-border);
  }

  &__create {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 6px 14px;
    margin-top: 2px;
    font-size: $font-sm;
    color: var(--kd-text-2);
    cursor: pointer;
    background: var(--kd-panel-2);
    border: 1px dashed var(--kd-border-strong);
    border-radius: $radius-md;
    transition:
      color 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease;

    &:hover {
      color: var(--kd-primary);
      background: var(--kd-primary-soft);
      border-color: var(--kd-primary);
    }
  }

  &__footer-hint {
    opacity: 0.75;
  }

  &__hint {
    padding: 18px 12px;
    margin: 0;
    font-size: $font-xs;
    color: var(--kd-text-3);
    text-align: center;
  }
}

/* 一级请求列表：不缩进，与分类标题左对齐 */
.req-root {
  padding: 0;
  margin: 0 0 2px;
  list-style: none;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: $radius-sm;
  color: var(--kd-text-3);

  &:hover {
    color: var(--kd-primary);
    background: var(--kd-panel-3);
  }
}

.req-group {
  margin-bottom: 2px;

  /* 拖拽悬停在分类上：整块标题高亮，提示松手即可移入该分类 */
  &.is-drop-target > &__head {
    color: var(--kd-primary);
    background: var(--kd-primary-soft);
    box-shadow: inset 0 0 0 1px var(--kd-primary);
  }

  &__head {
    display: flex;
    gap: 5px;
    align-items: center;
    padding: 5px 6px;
    font-size: $font-sm;
    color: var(--kd-text-2);
    cursor: pointer;
    border-radius: $radius-sm;

    &:hover {
      background: var(--kd-panel-2);
    }
  }

  &__caret {
    flex: none;
    font-size: 12px;
    color: var(--kd-text-3);
    transition: transform 0.15s ease;

    &.is-collapsed {
      transform: rotate(-90deg);
    }
  }

  &__icon {
    flex: none;
  }

  &__name {
    min-width: 0;
    font-weight: 600;
  }

  &__count {
    flex: none;
    font-size: $font-xs;
    font-style: normal;
    color: var(--kd-text-3);
  }

  &__items {
    padding-left: 14px;
    margin: 0;
    list-style: none;
  }

  &__blank {
    padding: 3px 10px 3px 20px;
    margin: 0;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.req-item {
  position: relative;
  display: flex;
  gap: 7px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  cursor: pointer;
  border-radius: $radius-sm;
  /* 长按拖拽时避免选中行内文字 */
  user-select: none;

  &:hover {
    background: var(--kd-panel-2);

    .item-menu {
      opacity: 1;
    }
  }

  &.is-active {
    background: var(--kd-panel-3);

    .req-item__name {
      color: var(--kd-primary);
    }
  }

  /* 拖拽中的原始行：淡出，落点由插入指示线表达 */
  &.is-dragging {
    opacity: 0.4;
  }

  /* 插入指示线：落在该行上方 / 下方 */
  &.is-drop-before::before,
  &.is-drop-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--kd-primary);
    border-radius: 1px;
    pointer-events: none;
  }

  &.is-drop-before::before {
    top: -1px;
  }

  &.is-drop-after::after {
    bottom: -1px;
  }

  &__name {
    flex: 1;
    min-width: 0;
    font-size: $font-sm;
    color: var(--kd-text);
  }

  // 方法名左对齐到同一列，列表才像 Apifox 那样整齐
  :deep(.method-tag) {
    min-width: 48px;
    justify-content: flex-start;
  }
}

.group-menu,
.item-menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  margin-left: auto;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: $radius-sm;
  color: var(--kd-text-3);
  opacity: 0;
  transition: opacity 0.15s ease;

  &:hover {
    color: var(--kd-primary);
    background: var(--kd-panel-3);
  }
}

.req-group__head:hover .group-menu,
.req-item:hover .item-menu,
.req-item.is-active .item-menu,
.group-menu:focus-visible,
.item-menu:focus-visible {
  opacity: 1;
}

.dropdown-file {
  position: relative;
  padding: 4px 14px;
  font-size: 13px;
  line-height: 22px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  list-style: none;

  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  &:hover {
    background: var(--kd-panel-2);
  }
}

// 「移动到」父项：外观对齐 el-dropdown-item，二级面板由 .move-flyout 承载
.dropdown-submenu {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 5px 16px;
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  list-style: none;

  &:hover {
    color: var(--el-dropdown-menuItem-hover-color);
    background-color: var(--el-dropdown-menuItem-hover-fill);

    .dropdown-submenu__arrow {
      color: var(--el-dropdown-menuItem-hover-color);
    }
  }

  &__arrow {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.move-flyout {
  position: fixed;
  min-width: 168px;
  max-width: 240px;
  max-height: 320px;
  padding: 4px 0;
  overflow-y: auto;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: $radius-sm;
  box-shadow: var(--el-box-shadow-light);

  &__title {
    padding: 3px 12px 5px;
    margin: 0;
    font-size: 12px;
    line-height: 18px;
    color: var(--el-text-color-secondary);
  }

  &__item {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 5px 12px;
    font-size: 14px;
    line-height: 22px;
    color: var(--el-text-color-regular);
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;

    &:hover {
      color: var(--el-dropdown-menuItem-hover-color);
      background-color: var(--el-dropdown-menuItem-hover-fill);
    }
  }

  &__icon {
    flex: none;
  }
}

/* ------------------------------ 拖拽悬浮标签 ---------------------------- */
.drag-ghost {
  position: fixed;
  z-index: 4000;
  display: flex;
  gap: 7px;
  align-items: center;
  max-width: 240px;
  padding: 5px 10px;
  font-size: $font-sm;
  color: var(--kd-text);
  pointer-events: none;
  background: var(--kd-panel);
  border: 1px solid var(--kd-primary);
  border-radius: $radius-md;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);

  :deep(.method-tag) {
    min-width: 48px;
    justify-content: flex-start;
  }
}

/* ------------------------------ 请求右键菜单 ---------------------------- */
.item-ctx {
  position: fixed;
  min-width: 172px;
  padding: 4px;
  background: var(--kd-panel);
  border: 1px solid var(--kd-border-strong);
  border-radius: $radius-md;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);

  &__item,
  &__sub {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 7px 10px;
    font-size: $font-sm;
    color: var(--kd-text-2);
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: 0;
    border-radius: $radius-sm;
    transition:
      color 0.14s ease,
      background 0.14s ease;

    &:hover {
      color: var(--kd-primary);
      background: var(--kd-primary-soft);
    }

    &.is-danger:hover {
      color: var(--el-color-danger);
      background: rgba(245, 108, 108, 0.12);
    }
  }

  &__arrow {
    margin-left: auto;
    font-size: 12px;
    color: var(--kd-text-3);
  }

  &__divider {
    height: 1px;
    margin: 4px 6px;
    background: var(--kd-border);
  }
}
</style>

<style lang="scss">
/* 拖拽期间：全局禁止选中文本并显示抓取光标 */
body.kd-drag-active {
  cursor: grabbing;
  user-select: none;
}
</style>
