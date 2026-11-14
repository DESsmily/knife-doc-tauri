<script setup lang="ts">
/**
 * 快捷请求左侧树：分类 + 请求列表，支持新建 / 重命名 / 删除 / 移动 / 复制 / 导入导出。
 */

import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
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
const isEmpty = computed(() => store.requests.length === 0)

/** 折叠的分类，未分类用 '__root' 占位 */
const collapsed = ref<string[]>([])

function toggleGroup(id: string) {
  const key = id || '__root'
  collapsed.value = collapsed.value.includes(key)
    ? collapsed.value.filter((item) => item !== key)
    : [...collapsed.value, key]
}

function isCollapsed(id: string): boolean {
  return collapsed.value.includes(id || '__root')
}

/** 单行列表放不下地址，鼠标悬停时用原生 title 补全 */
function rowTitle(request: QuickRequest): string {
  const sent = request.lastSentAt ? `\n最近发送：${fromNow(request.lastSentAt)}` : ''
  return `${request.method} ${request.url || '未填写地址'}${sent}`
}

/** 移动到子菜单：未分类 + 除当前所在分类外的所有分类 */
function moveTargets(request: QuickRequest) {
  return [{ id: '', name: '未分类' }, ...store.folders.filter((it) => it.id !== request.folderId)]
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

/** 父级下拉关掉时（点击别处、选中项）二级悬浮框一起收起 */
function onMenuVisible(visible: boolean) {
  if (!visible) closeFlyout()
}

function moveTo(folderId: string) {
  const current = flyout.value
  if (!current) return
  const target = current.targets.find((item) => item.id === folderId)
  store.move(current.requestId, folderId)
  closeFlyout()
  menus.get(current.requestId)?.handleClose()
  message.success(`已移动到「${target?.name ?? '未分类'}」`)
}

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
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
      message.success('请求已移到未分类')
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
        size="small"
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

    <div class="req-tree__list kd-scroll" @drop="onDrop" @dragover.prevent>
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
        <section v-for="node in nodes" :key="node.id || '__root'" class="req-group">
          <header class="req-group__head" :title="isCollapsed(node.id) ? '展开' : '折叠'" @click="toggleGroup(node.id)">
            <el-icon class="req-group__caret" :class="{ 'is-collapsed': isCollapsed(node.id) }">
              <CaretBottom />
            </el-icon>
            <el-icon class="req-group__icon"><Folder /></el-icon>
            <span class="req-group__name kd-ellipsis">{{ node.name }}</span>
            <em class="req-group__count">({{ node.requests.length }})</em>

            <el-dropdown v-if="node.isFolder" trigger="click" placement="bottom-end">
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
              :class="{ 'is-active': request.id === store.activeId }"
              :title="rowTitle(request)"
              @click="store.open(request.id)"
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
      margin-bottom: 8px;
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
  display: flex;
  gap: 7px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  cursor: pointer;
  border-radius: $radius-sm;

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
</style>
