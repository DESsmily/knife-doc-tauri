<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { message } from '@/core/message'

import { copyText } from '@/core/http'
import { detectLang, highlight, type HighlightLang } from '@/core/highlight'

const props = withDefaults(
  defineProps<{
    code: string
    /** 语言；不传则自动推断 */
    lang?: HighlightLang | 'auto'
    /** 标题 */
    title?: string
    /** 最大高度，超出滚动 */
    maxHeight?: string
    /** 是否显示行号 */
    lineNumbers?: boolean
    /** 是否显示复制按钮 */
    copyable?: boolean
    /** 是否让顶层容器铺满剩余空间 */
    fill?: boolean
    /** 是否支持编辑器式代码折叠（行号旁显示 - / + 折叠标记） */
    foldable?: boolean
  }>(),
  {
    lang: 'auto',
    title: '',
    maxHeight: '480px',
    lineNumbers: false,
    copyable: true,
    fill: false,
    foldable: false
  }
)

const copied = ref(false)

const resolvedLang = computed<HighlightLang>(() =>
  props.lang === 'auto' ? detectLang(props.code) : props.lang
)

const html = computed(() => highlight(props.code ?? '', resolvedLang.value))

/** 按行切分高亮结果；生成的示例代码没有跨行 token，按 \n 切分是安全的 */
const lineHtmls = computed(() => html.value.split('\n'))

const rawLines = computed(() => String(props.code ?? '').split('\n'))

const isEmpty = computed(() => !String(props.code ?? '').trim())

/* ------------------------------------------------------------------ */
/* 代码折叠：扫描花括号匹配出可折叠区域                                  */
/* ------------------------------------------------------------------ */

interface FoldRegion {
  /** 区域起始行（包含，0 基） */
  start: number
  /** 区域结束行（包含，0 基，闭合花括号所在行） */
  end: number
}

/**
 * 去掉一行里的字符串与行注释内容，避免其中的花括号干扰配对。
 * 模板字符串整体跳过（其中的 `${}` 自成一对，跳过不影响平衡）。
 */
function stripNoise(line: string): string {
  let out = ''
  let state: 'normal' | 'single' | 'double' | 'template' | 'comment' = 'normal'
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1]
    if (state === 'normal') {
      if (ch === '/' && next === '/') {
        state = 'comment'
        out += '  '
        i++
      } else if (ch === "'") {
        state = 'single'
        out += ' '
      } else if (ch === '"') {
        state = 'double'
        out += ' '
      } else if (ch === '`') {
        state = 'template'
        out += ' '
      } else {
        out += ch
      }
    } else if (state === 'comment') {
      out += ' '
    } else {
      out += ' '
      if (ch === '\\') {
        out += ' '
        i++
      } else if (
        (state === 'single' && ch === "'") ||
        (state === 'double' && ch === '"') ||
        (state === 'template' && ch === '`')
      ) {
        state = 'normal'
      }
    }
  }
  return out
}

/** 扫描代码，返回所有可折叠区域（一行内开合并的区域没有意义，会被忽略） */
function findFoldRegions(code: string): FoldRegion[] {
  const regions: FoldRegion[] = []
  const stack: { depth: number; line: number }[] = []
  let depth = 0
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const text = stripNoise(lines[i])
    for (const ch of text) {
      if (ch === '{') {
        depth++
        stack.push({ depth, line: i })
      } else if (ch === '}') {
        depth--
        const top = stack[stack.length - 1]
        if (top && top.depth === depth + 1) {
          stack.pop()
          if (i > top.line) regions.push({ start: top.line, end: i })
        }
      }
    }
  }
  return regions
}

const foldRegions = computed(() => (props.foldable ? findFoldRegions(props.code ?? '') : []))

/** 起始行 → 区域 */
const regionAtLine = computed(() => {
  const map = new Map<number, FoldRegion>()
  for (const region of foldRegions.value) map.set(region.start, region)
  return map
})

/** 结束行 → 区域（折叠后用于在闭合行渲染 ⋯ 标记） */
const foldedEndLines = computed(() => {
  const map = new Map<number, FoldRegion>()
  for (const region of foldRegions.value) {
    if (collapsedLines.value.has(region.start)) map.set(region.end, region)
  }
  return map
})

/** 已折叠区域起始行集合 */
const collapsedLines = ref<Set<number>>(new Set())

function toggleFold(line: number) {
  const next = new Set(collapsedLines.value)
  if (next.has(line)) next.delete(line)
  else next.add(line)
  collapsedLines.value = next
}

/**
 * 折叠时隐藏的行：只隐藏区域内部行，闭合行保留显示（与 VS Code 一致）。
 */
const hiddenLines = computed(() => {
  const hidden = new Set<number>()
  for (const region of foldRegions.value) {
    if (collapsedLines.value.has(region.start)) {
      for (let i = region.start + 1; i < region.end; i++) hidden.add(i)
    }
  }
  return hidden
})

/** 实际渲染的行（跳过隐藏行，行号保持原始编号） */
const displayLines = computed(() => {
  const hidden = hiddenLines.value
  const lines = rawLines.value
  const rows: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!hidden.has(i)) rows.push(i)
  }
  return rows
})

/**
 * 可见文本与完整源码的映射：复制时按「行 + 列」重建选区内容。
 * Range.toString() 不会在块级元素间插入换行，因此不能用全文偏移换算，
 * 必须先定位选区覆盖到哪几行，再把被折叠区域的内部行补回来。
 */
const preRef = ref<HTMLElement>()

/** 折叠区域隐藏的 interior 行数（用于 ⋯ 标记提示） */
function foldedHiddenCount(index: number): number {
  const region = foldedEndLines.value.get(index)
  return region ? region.end - region.start - 1 : 0
}

/**
 * 解析选区端点：返回该点所在的行（displayLines 中的位置）与列号。
 * 命中代码末尾的空白占位区时返回 pos = displayLines.length（视为文档末尾）。
 */
function resolvePoint(container: Node, offset: number): { pos: number; col: number } | null {
  const pre = preRef.value
  if (!pre) return null
  let el: HTMLElement | null =
    container.nodeType === Node.ELEMENT_NODE ? (container as HTMLElement) : container.parentElement
  while (el && el.parentElement !== pre) el = el.parentElement
  if (!el) return null
  const pos = Array.prototype.indexOf.call(pre.children, el)
  if (pos < 0) return null
  const dl = displayLines.value
  if (pos >= dl.length) return { pos: dl.length, col: 0 }
  // 行内只有内联 span，用 range.toString 求列号是准确的
  const colRange = document.createRange()
  colRange.selectNodeContents(el)
  try {
    colRange.setEnd(container, offset)
  } catch {
    return { pos, col: el.textContent?.length ?? 0 }
  }
  return { pos, col: colRange.toString().length }
}

/**
 * 拦截代码区的复制事件（document 级别监听，因为非编辑内容的 copy
 * 事件不会在选区 DOM 上冒泡）：把可见选区映射回完整源码，
 * 选中包含折叠块的区域复制时，剪贴板里是未折叠的完整内容。
 */
function handleNativeCopy(e: ClipboardEvent) {
  if (!props.foldable || collapsedLines.value.size === 0) return
  if (!e.clipboardData) return
  const sel = window.getSelection()
  const pre = preRef.value
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !pre) return
  const range = sel.getRangeAt(0)
  if (!range.intersectsNode(pre)) return

  const dl = displayLines.value
  const lines = rawLines.value
  if (dl.length === 0) return
  const lastPos = dl.length - 1
  const lastCol = lines[dl[lastPos]].length

  // 选区可能延伸到代码区之外（行号栏、代码下方空白），裁剪到代码范围
  const preRange = document.createRange()
  preRange.selectNodeContents(pre)
  let startP: { pos: number; col: number }
  let endP: { pos: number; col: number }
  if (preRange.comparePoint(range.startContainer, range.startOffset) < 0) {
    startP = { pos: 0, col: 0 }
  } else {
    const p = resolvePoint(range.startContainer, range.startOffset)
    if (!p || p.pos >= dl.length) return // 起点在代码之后的空白区，无可复制内容
    startP = p
  }
  if (preRange.comparePoint(range.endContainer, range.endOffset) > 0) {
    endP = { pos: lastPos, col: lastCol }
  } else {
    const p = resolvePoint(range.endContainer, range.endOffset)
    if (!p) return
    endP = p.pos >= dl.length ? { pos: lastPos, col: lastCol } : p
  }
  if (endP.pos < startP.pos || (endP.pos === startP.pos && endP.col <= startP.col)) return

  // 按行拼接：行之间补 '\n'，折叠区域内部的隐藏行一并补回
  let out = ''
  for (let p = startP.pos; p <= endP.pos; p++) {
    const rawIdx = dl[p]
    const lineText = lines[rawIdx]
    const from = p === startP.pos ? startP.col : 0
    const to = p === endP.pos ? endP.col : lineText.length
    out += lineText.slice(from, to)
    if (p < endP.pos) {
      out += '\n'
      const region = regionAtLine.value.get(rawIdx)
      if (region && collapsedLines.value.has(rawIdx)) {
        out += lines.slice(region.start + 1, region.end).join('\n') + '\n'
      }
    }
  }
  e.preventDefault()
  e.clipboardData.setData('text/plain', out)
}

onMounted(() => {
  document.addEventListener('copy', handleNativeCopy)
})

onBeforeUnmount(() => {
  document.removeEventListener('copy', handleNativeCopy)
})

async function handleCopy() {
  const ok = await copyText(props.code ?? '')
  if (ok) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } else {
    message.warning('复制失败，请手动选择内容复制')
  }
}
</script>

<template>
  <div class="code-block" :class="{ 'is-fill': fill }">
    <div v-if="title || copyable" class="code-block__head">
      <span class="code-block__title">{{ title }}</span>
      <div class="code-block__actions">
        <slot name="actions" />
        <el-button
          v-if="copyable"
          link
          size="small"
          :disabled="isEmpty"
          @click="handleCopy"
        >
          <el-icon><component :is="copied ? 'Select' : 'CopyDocument'" /></el-icon>
          <span>{{ copied ? '已复制' : '复制' }}</span>
        </el-button>
      </div>
    </div>

    <div v-if="isEmpty" class="code-block__empty">暂无内容</div>

    <div v-else class="code-block__body" :style="{ maxHeight: fill ? 'none' : maxHeight }">
      <div v-if="lineNumbers || foldable" class="code-block__gutter">
        <span v-for="index in displayLines" :key="`g${index}`" class="code-block__gutter-line">
          <button
            v-if="regionAtLine.has(index)"
            type="button"
            class="code-block__fold"
            :class="{ 'is-collapsed': collapsedLines.has(index) }"
            :title="collapsedLines.has(index) ? '展开' : '折叠'"
            @click="toggleFold(index)"
          >
            {{ collapsedLines.has(index) ? '+' : '−' }}
          </button>
          <i v-else-if="foldedEndLines.has(index)" class="code-block__folded-dot" />
          <i v-else class="code-block__fold-placeholder" />
          {{ index + 1 }}
        </span>
      </div>
      <pre
        ref="preRef"
        class="kd-code code-block__pre"
      ><div v-for="index in displayLines" :key="`c${index}`" class="code-block__line"><span v-html="lineHtmls[index]" /><span v-if="foldedEndLines.has(index)" class="code-block__folded-mark" :title="`已折叠 ${foldedHiddenCount(index)} 行，点击行号旁的 + 展开`" /></div><div class="code-block__tail" aria-hidden="true" /></pre>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.code-block {
  display: flex;
  flex-direction: column;
  min-width: 0;

  &.is-fill {
    flex: 1;
    min-height: 0;
  }
}

.code-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  min-height: 26px;
}

.code-block__title {
  font-size: $font-sm;
  font-weight: 600;
  color: var(--kd-text-2);
}

.code-block__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.code-block__body {
  position: relative;
  display: flex;
  overflow: auto;
  border-radius: $radius-md;
  @include scrollbar;

  .is-fill & {
    flex: 1;
    min-height: 0;
  }
}

.code-block__gutter {
  display: flex;
  flex-direction: column;
  padding: 14px 8px 14px 4px;
  background: var(--kd-panel-2);
  border: 1px solid var(--kd-border);
  border-right: none;
  border-radius: $radius-md 0 0 $radius-md;
  color: var(--kd-text-3);
  font-family: $font-mono;
  font-size: $font-sm;
  line-height: 1.7;
  text-align: right;
  user-select: none;
  flex-shrink: 0;
}

.code-block__gutter-line {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-height: 1.7em;
}

.code-block__fold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid var(--kd-border);
  border-radius: 3px;
  background: var(--kd-panel-3);
  color: var(--kd-text-3);
  font-family: $font-mono;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: var(--kd-text-1);
    border-color: var(--kd-text-3);
  }
}

.code-block__fold-placeholder,
.code-block__folded-dot {
  width: 14px;
  flex-shrink: 0;
}

.code-block__folded-dot {
  &::before {
    content: '⋯';
    font-size: 11px;
    color: var(--kd-text-3);
  }
}

.code-block__pre {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-radius: $radius-md;
  margin: 0;

  .code-block__gutter + & {
    border-radius: 0 $radius-md $radius-md 0;
  }
}

.code-block__line {
  min-height: 1.7em;
  white-space: pre;
}

/* 代码下方撑满剩余高度的空白区：鼠标拖选到这里会把选区延伸到文档末尾 */
.code-block__tail {
  flex: 1;
  min-height: 0;
}

/* ⋯ 标记用 ::before 渲染，不属于文本内容，不会进入复制选区 */
.code-block__folded-mark {
  display: inline-block;
  margin-left: 8px;
  vertical-align: middle;

  &::before {
    content: '⋯';
    color: var(--kd-text-3);
    font-size: $font-sm;
  }
}

.code-block__empty {
  padding: 18px;
  border: 1px dashed var(--kd-border);
  border-radius: $radius-md;
  color: var(--kd-text-3);
  font-size: $font-sm;
  text-align: center;
}
</style>
