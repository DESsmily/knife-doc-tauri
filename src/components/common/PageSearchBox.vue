<script setup lang="ts">
/**
 * 全局页面搜索框（Ctrl+F 唤起）。
 *
 * 固定在窗口栏下方、水平居中靠上，搜索当前页面内容：输入关键词后高亮全部匹配，
 * 自动滚动定位到首个匹配；Enter 跳下一个、Shift+Enter 跳上一个、Esc 关闭。
 * 匹配计数实时显示为「当前 / 总数」。
 */

import { nextTick, ref, watch } from 'vue'

import { usePageSearch } from '@/composables/usePageSearch'

const { visible, query, total, current, setQuery, nextMatch, prevMatch, closePageSearch } =
  usePageSearch()

/** 输入框实例，用于聚焦与键盘事件 */
const inputRef = ref<HTMLInputElement>()

// 打开时聚焦输入框，方便直接开始输入
watch(visible, async (open) => {
  if (open) {
    await nextTick()
    inputRef.value?.focus()
  }
})

/** 输入即搜 */
function handleInput(value: string) {
  setQuery(value)
}

/** Enter 跳下一个、Shift+Enter 跳上一个、Esc 关闭 */
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) prevMatch()
    else nextMatch()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closePageSearch()
  }
}

/** 关闭并清除高亮 */
function handleClose() {
  closePageSearch()
}
</script>

<template>
  <Transition name="kd-search-pop">
    <div v-if="visible" class="page-search-box" role="dialog" aria-label="页面搜索">
      <div class="page-search-box__inner">
        <el-icon class="page-search-box__icon"><Search /></el-icon>

        <input
          ref="inputRef"
          :value="query"
          class="page-search-box__input"
          type="text"
          placeholder="搜索当前页面内容…"
          autocomplete="off"
          spellcheck="false"
          @input="handleInput(($event.target as HTMLInputElement).value)"
          @keydown="handleKeydown"
        />

        <span class="page-search-box__count">
          <template v-if="query">{{ current }} / {{ total }}</template>
        </span>

        <div class="page-search-box__actions">
          <button
            type="button"
            class="page-search-box__btn"
            title="上一个 (Shift+Enter)"
            @click="prevMatch"
          >
            <el-icon><ArrowUp /></el-icon>
          </button>
          <button
            type="button"
            class="page-search-box__btn"
            title="下一个 (Enter)"
            @click="nextMatch"
          >
            <el-icon><ArrowDown /></el-icon>
          </button>
          <button
            type="button"
            class="page-search-box__btn page-search-box__btn--close"
            title="关闭 (Esc)"
            @click="handleClose"
          >
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.page-search-box {
  position: fixed;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  pointer-events: auto;

  &__inner {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(560px, calc(100vw - 32px));
    padding: 6px 8px 6px 12px;
    background: var(--kd-panel);
    border: 1px solid var(--kd-border-strong);
    border-radius: $radius-lg;
    box-shadow: var(--kd-shadow-lg);
  }

  &__icon {
    color: var(--kd-text-3);
    font-size: 16px;
    flex-shrink: 0;
  }

  &__input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: $font-md;
    color: var(--kd-text);
    line-height: 1.5;

    &::placeholder {
      color: var(--kd-text-3);
    }
  }

  &__count {
    flex-shrink: 0;
    min-width: 56px;
    text-align: center;
    font-size: $font-xs;
    color: var(--kd-text-3);
    font-variant-numeric: tabular-nums;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  &__btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    background: transparent;
    color: var(--kd-text-2);
    font-size: 14px;
    cursor: pointer;
    border-radius: $radius-sm;
    transition: background 0.14s ease, color 0.14s ease;

    &:hover {
      background: var(--kd-panel-3);
      color: var(--kd-text);
    }

    &--close:hover {
      background: var(--kd-danger-soft);
      color: var(--kd-danger);
    }
  }
}

.kd-search-pop-enter-active,
.kd-search-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.kd-search-pop-enter-from,
.kd-search-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
