/**
 * 全局页面搜索（Ctrl+F 触发的自定义查找）。
 *
 * 在当前页面内容中搜索关键词，高亮所有匹配并滚动定位到当前匹配。
 * 通过 TreeWalker 遍历文本节点，用 <mark> 包裹匹配片段；切换关键词时先清除旧高亮再重新搜索。
 *
 * 状态为模块级单例：main.ts 的 Ctrl+F 拦截、PageSearchBox 组件都共享同一份状态。
 */

import { ref } from 'vue'

/** 搜索框是否可见 */
const visible = ref(false)
/** 当前关键词 */
const query = ref('')
/** 匹配总数 */
const total = ref(0)
/** 当前匹配序号（从 1 开始；0 表示无匹配） */
const current = ref(0)

/** 当前高亮匹配的元素（用于切换激活样式） */
let activeEl: HTMLElement | null = null
/** 全部匹配元素（按文档顺序） */
let matches: HTMLElement[] = []

/** 搜索时需排除的容器：窗口栏、搜索框自身、脚本样式、可编辑区等 */
const EXCLUDE_SELECTOR =
  '.win-bar, .page-search-box, script, style, noscript, textarea, svg, [contenteditable="true"]'

/** 收集根节点内所有需要参与搜索的文本节点（排除指定容器内的节点） */
function collectTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Text) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      // 排除窗口栏、搜索框等非内容区域
      if (parent.closest(EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT
      const value = node.nodeValue ?? ''
      if (!value.trim()) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const nodes: Text[] = []
  let node = walker.nextNode() as Text | null
  while (node) {
    nodes.push(node)
    node = walker.nextNode() as Text | null
  }
  return nodes
}

/** 清除根节点内所有由本搜索产生的高亮标记，还原原始文本 */
function clearHighlights(root: Element) {
  const marks = root.querySelectorAll<HTMLElement>('mark[data-kd-search]')
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    // 用等价文本节点替换 <mark>，再合并相邻文本节点，还原原结构
    const text = document.createTextNode(mark.textContent ?? '')
    parent.replaceChild(text, mark)
    parent.normalize()
  })
}

/**
 * 在文本节点中包裹所有匹配片段，返回生成的高亮元素。
 *
 * 逐个文本节点处理：定位每个匹配区间，用 DocumentFragment 重组节点，
 * 将匹配部分替换为 <mark>。由于文本节点之间互不嵌套，处理一个不会影响其它。
 */
function highlight(root: Node, keyword: string): HTMLElement[] {
  const marks: HTMLElement[] = []
  if (!keyword) return marks

  const lower = keyword.toLowerCase()
  for (const textNode of collectTextNodes(root)) {
    const text = textNode.nodeValue ?? ''
    if (!text) continue
    const lowerText = text.toLowerCase()
    let idx = lowerText.indexOf(lower, 0)
    if (idx < 0) continue

    const fragment = document.createDocumentFragment()
    let last = 0
    while (idx >= 0) {
      // 匹配前的普通文本
      if (idx > last) fragment.appendChild(document.createTextNode(text.slice(last, idx)))
      // 匹配片段：包裹 <mark>
      const mark = document.createElement('mark')
      mark.setAttribute('data-kd-search', '')
      mark.textContent = text.slice(idx, idx + keyword.length)
      fragment.appendChild(mark)
      marks.push(mark)
      last = idx + keyword.length
      idx = lowerText.indexOf(lower, last)
    }
    // 匹配后的剩余文本
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)))

    const parent = textNode.parentNode
    if (!parent) continue
    parent.replaceChild(fragment, textNode)
  }
  return marks
}

/** 滚动到指定匹配并更新激活样式 */
function scrollToMatch(index: number) {
  const el = matches[index]
  if (!el) return
  if (activeEl) activeEl.classList.remove('is-kd-search-active')
  el.classList.add('is-kd-search-active')
  activeEl = el
  current.value = index + 1
  // block: 'center' 会让所有祖先滚动容器自动把匹配项滚动到可视区域中央
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** 执行一次搜索：清除旧高亮 → 重新高亮 → 定位首个匹配 */
function executeSearch(keyword: string) {
  const root = document.body
  clearHighlights(root)
  matches = []
  if (activeEl) {
    activeEl.classList.remove('is-kd-search-active')
    activeEl = null
  }
  total.value = 0
  current.value = 0

  if (!keyword) return
  matches = highlight(root, keyword)
  total.value = matches.length
  if (matches.length > 0) scrollToMatch(0)
}

/** 打开搜索框（Ctrl+F 调用） */
function openPageSearch() {
  visible.value = true
  query.value = ''
  executeSearch('')
}

/** 关闭搜索框并清除全部高亮 */
function closePageSearch() {
  clearHighlights(document.body)
  matches = []
  if (activeEl) {
    activeEl.classList.remove('is-kd-search-active')
    activeEl = null
  }
  visible.value = false
  query.value = ''
  total.value = 0
  current.value = 0
}

/** 切换搜索框显隐 */
function togglePageSearch() {
  if (visible.value) closePageSearch()
  else openPageSearch()
}

/** 更新关键词并立即搜索 */
function setQuery(keyword: string) {
  query.value = keyword
  executeSearch(keyword)
}

/** 跳到下一个匹配（到末尾后循环回首个） */
function nextMatch() {
  if (matches.length === 0) return
  const next = current.value >= matches.length ? 0 : current.value
  scrollToMatch(next)
}

/** 跳到上一个匹配（到首个后循环回末尾） */
function prevMatch() {
  if (matches.length === 0) return
  const prev = current.value <= 1 ? matches.length - 1 : current.value - 2
  scrollToMatch(prev)
}

/** 供组件使用的响应式状态与操作 */
export function usePageSearch() {
  return {
    visible,
    query,
    total,
    current,
    setQuery,
    nextMatch,
    prevMatch,
    closePageSearch
  }
}

export {
  openPageSearch,
  closePageSearch,
  togglePageSearch
}
