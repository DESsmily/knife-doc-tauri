<script setup lang="ts">
/**
 * 顶部「已打开请求」标签栏（对齐 Apifox）：点击切换、中键或 × 关闭、右键出标签操作、
 * 未保存的请求显示小圆点，尾部 + 新建、··· 批量关闭。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessageBox, useZIndex } from 'element-plus'

import { message } from '@/core/message'
import { flushStorage } from '@/core/storage'
import { useQuickRequestStore } from '@/stores/quickRequest'
import { methodColor } from '@/core/utils'
import type { QuickRequest } from '@/core/types'

const store = useQuickRequestStore()

/* ---------- 关闭标签：未保存的草稿先询问 ---------- */

/**
 * 关闭前处理未保存的草稿：
 *  - 没有未保存修改 → 直接关闭；
 *  - 有未保存修改 → 弹框「保存并关闭 / 不保存 / 取消」，点右上角 × 或 ESC 视为取消关闭。
 * 批量关闭（关闭其他 / 左侧 / 右侧 / 全部）只弹一次框，逐条保存后一起关闭。
 */
async function confirmClose(ids: string[], closeAction: () => void) {
  const dirtyIds = ids.filter((id) => store.dirty.includes(id))
  if (dirtyIds.length === 0) {
    closeAction()
    return
  }
  // 提示里优先用草稿名称：用户刚改过的名字更符合「这一个请求」的直觉
  const names = dirtyIds.map(
    (id) => store.drafts[id]?.name ?? store.requests.find((item) => item.id === id)?.name ?? '未命名请求'
  )
  const tip =
    dirtyIds.length === 1
      ? `「${names[0]}」有未保存的修改，是否保存后关闭？`
      : `有 ${dirtyIds.length} 个请求未保存（${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等' : ''}），是否保存后关闭？`
  try {
    await ElMessageBox.confirm(tip, '关闭标签', {
      confirmButtonText: '保存并关闭',
      cancelButtonText: '不保存',
      distinguishCancelAndClose: true,
      type: 'warning'
    })
    for (const id of dirtyIds) store.saveDraft(id)
    // 立刻落盘并反馈失败，避免只依赖 400ms 防抖写入
    void flushStorage().then((ok) => {
      if (!ok) message.warning('保存失败，请检查安装目录是否可写')
    })
    closeAction()
  } catch (action) {
    if (action !== 'cancel') return
    for (const id of dirtyIds) store.discardDraft(id)
    closeAction()
  }
}

function closeTab(id: string) {
  void confirmClose([id], () => store.close(id))
}

function closeOtherTabs(id: string) {
  void confirmClose(
    store.opened.filter((item) => item !== id),
    () => store.closeOthers(id)
  )
}

function closeSideTabs(id: string, side: 'left' | 'right') {
  const anchor = store.opened.indexOf(id)
  if (anchor < 0) return
  const ids = store.opened.filter((_, index) => (side === 'left' ? index < anchor : index > anchor))
  void confirmClose(ids, () => store.closeSide(id, side))
}

function closeAllTabs() {
  void confirmClose([...store.opened], () => store.closeAll())
}

const scrollEl = ref<HTMLElement | null>(null)
const hasTabs = computed(() => store.tabs.length > 0)

function onWheel(event: WheelEvent) {
  const el = scrollEl.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  event.preventDefault()
  menu.value = null
  el.scrollLeft += event.deltaY || event.deltaX
}

/* ---------- 右键菜单：标签操作 ---------- */

/** 菜单尺寸只用于贴边翻转，项数变化时同步改高度 */
const MENU_SIZE = { width: 152, height: 182 }
const { nextZIndex } = useZIndex()
const menu = ref<{ id: string; left: number; top: number; zIndex: number } | null>(null)

const menuTitle = computed(() => {
  const target = menu.value
  const request = target ? store.requests.find((item) => item.id === target.id) : undefined
  return request ? `${request.name} · ${request.method}` : ''
})

const menuItems = computed(() => {
  const target = menu.value
  if (!target) return []
  const id = target.id
  const index = store.opened.indexOf(id)
  const total = store.opened.length
  const run = (action: () => void) => () => {
    action()
    menu.value = null
  }
  return [
    { label: '关闭', disabled: false, onClick: run(() => closeTab(id)) },
    { label: '关闭其他', disabled: total < 2, onClick: run(() => closeOtherTabs(id)) },
    { label: '关闭左侧', disabled: index < 1, onClick: run(() => closeSideTabs(id, 'left')) },
    { label: '关闭右侧', disabled: index < 0 || index >= total - 1, onClick: run(() => closeSideTabs(id, 'right')) },
    { label: '关闭全部', disabled: total < 2, onClick: run(() => closeAllTabs()) }
  ]
})

function openMenu(request: QuickRequest, event: MouseEvent) {
  menu.value = {
    id: request.id,
    left: Math.max(8, Math.min(event.clientX, window.innerWidth - MENU_SIZE.width - 8)),
    top: Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_SIZE.height - 8)),
    zIndex: nextZIndex()
  }
}

function dismiss(event: PointerEvent) {
  if ((event.target as HTMLElement | null)?.closest('.tab-menu')) return
  menu.value = null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') menu.value = null
}

// 标签增删或横向滚动后菜单位置会错位，直接收起
watch(
  () => store.opened.join(),
  () => {
    menu.value = null
  }
)

onMounted(() => {
  window.addEventListener('pointerdown', dismiss, true)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', dismiss, true)
  window.removeEventListener('keydown', onKeydown)
})

/** 切换标签时把目标滚进可视区，长列表才不会看不见当前页 */
watch(
  () => store.activeId,
  async (id) => {
    if (!id) return
    await nextTick()
    scrollEl.value
      ?.querySelector<HTMLElement>(`[data-tab="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
)
</script>

<template>
  <div class="req-tabs">
    <div ref="scrollEl" class="req-tabs__scroll" @wheel="onWheel">
      <div
        v-for="request in store.tabs"
        :key="request.id"
        class="req-tab"
        :class="{ 'is-active': request.id === store.activeId }"
        :data-tab="request.id"
        :title="`${request.method} ${request.url || '未填写地址'}`"
        @click="store.setActive(request.id)"
        @contextmenu.prevent="openMenu(request, $event)"
        @mouseup.middle="closeTab(request.id)"
      >
        <el-icon class="req-tab__icon" :style="{ color: methodColor(request.method) }">
          <Lightning />
        </el-icon>
        <span class="req-tab__name kd-ellipsis">{{ request.name }}</span>
        <span v-if="store.dirty.includes(request.id)" class="req-tab__dot" title="有未保存的修改"></span>
        <button type="button" class="req-tab__close" title="关闭" @click.stop="closeTab(request.id)">
          <el-icon><Close /></el-icon>
        </button>
      </div>
      <span v-if="!hasTabs" class="req-tabs__blank">没有打开的请求</span>
    </div>

    <div class="req-tabs__tools">
      <button type="button" class="tab-btn is-add" title="新建请求" @click="store.addRequest()">
        <el-icon><Plus /></el-icon>
      </button>
      <el-dropdown trigger="click" placement="bottom-end" :disabled="!hasTabs">
        <button type="button" class="tab-btn" title="标签操作" :disabled="!hasTabs">
          <el-icon><MoreFilled /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="closeOtherTabs(store.activeId)">关闭其他</el-dropdown-item>
            <el-dropdown-item @click="closeAllTabs()">关闭全部</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 菜单位于标签之外，Teleport 到 body 用 fixed 定位，才不会被标签栏裁剪 -->
    <Teleport to="body">
      <div
        v-if="menu"
        class="tab-menu"
        :style="{ left: `${menu.left}px`, top: `${menu.top}px`, zIndex: menu.zIndex }"
      >
        <p class="tab-menu__title kd-ellipsis">{{ menuTitle }}</p>
        <button
          v-for="item in menuItems"
          :key="item.label"
          type="button"
          class="tab-menu__item"
          :disabled="item.disabled"
          @click="item.onClick"
        >
          {{ item.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.req-tabs {
  display: flex;
  flex: none;
  align-items: center;
  height: 38px;
  padding: 0 8px;
  background: var(--kd-bg-sub);
  border-bottom: 1px solid var(--kd-border);

  &__scroll {
    display: flex;
    // 标签撑满整行高度，和右侧按钮才在同一条基线上
    flex: 1;
    gap: 2px;
    align-items: stretch;
    min-width: 0;
    height: 100%;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__tools {
    display: flex;
    flex: none;
    gap: 2px;
    align-items: center;
    height: 100%;
    margin-left: 6px;
  }

  &__blank {
    display: flex;
    align-items: center;
    padding: 0 8px;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.req-tab {
  display: flex;
  gap: 6px;
  align-items: center;
  max-width: 220px;
  padding: 0 8px 0 10px;
  cursor: pointer;
  border-right: 1px solid var(--kd-border);
  border-radius: $radius-sm $radius-sm 0 0;

  &:hover {
    background: var(--kd-panel-3);

    .req-tab__close {
      opacity: 1;
    }
  }

  &.is-active {
    background: var(--kd-panel);

    .req-tab__name {
      color: var(--kd-text);
    }

    .req-tab__icon {
      opacity: 1;
    }
  }

  &__icon {
    flex: none;
    font-size: 13px;
    opacity: 0.75;
  }

  &__name {
    max-width: 150px;
    font-size: $font-sm;
    color: var(--kd-text-2);
  }

  &__dot {
    flex: none;
    width: 6px;
    height: 6px;
    background: var(--kd-warning);
    border-radius: 50%;
  }

  &__close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    margin-right: -4px;
    cursor: pointer;
    color: var(--kd-text-3);
    background: none;
    border: none;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;

    &:hover {
      color: var(--kd-text);
      background: var(--kd-panel-2);
    }
  }
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  cursor: pointer;
  color: var(--kd-text-3);
  background: none;
  border: none;
  border-radius: $radius-sm;

  &:hover {
    color: var(--kd-primary);
    background: var(--kd-panel-3);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.is-add {
  color: var(--kd-text-2);
}

.tab-menu {
  position: fixed;
  min-width: 152px;
  padding: 4px 0;
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
    display: block;
    width: 100%;
    padding: 5px 12px;
    font-size: 14px;
    line-height: 22px;
    color: var(--el-text-color-regular);
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;

    &:hover:not(:disabled) {
      color: var(--el-dropdown-menuItem-hover-color);
      background-color: var(--el-dropdown-menuItem-hover-fill);
    }

    &:disabled {
      color: var(--el-disabled-text-color);
      cursor: not-allowed;
    }
  }
}
</style>
