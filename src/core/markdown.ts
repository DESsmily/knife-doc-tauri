/**
 * 极简 Markdown 渲染
 *
 * 接口描述里常见的 Markdown 语法（标题、粗体、行内代码、链接、列表、引用、代码块）在此实现。
 * 安全性：先对原文做 HTML 转义，再做语法替换，因此不会执行任何内联 HTML / 脚本。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行内语法 */
function inline(text: string): string {
  let out = text
  // 行内代码
  out = out.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>')
  // 粗体
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  // 斜体
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // 删除线
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  // 链接 [text](url)
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  )
  // 自动链接
  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
  )
  return out
}

export function renderMarkdown(source: string): string {
  const text = String(source ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return ''

  const escaped = escapeHtml(text)
  const lines = escaped.split('\n')
  const result: string[] = []

  let inCode = false
  let codeBuffer: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    result.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const flushList = () => {
    if (listType) {
      result.push(`</${listType}>`)
      listType = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine

    // 代码块围栏
    const fence = /^\s*```(.*)$/.exec(line)
    if (fence) {
      if (inCode) {
        result.push(`<pre class="md-pre"><code>${codeBuffer.join('\n')}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        flushParagraph()
        flushList()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      result.push(`<h${level} class="md-h">${inline(heading[2])}</h${level}>`)
      continue
    }

    // 分割线
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph()
      flushList()
      result.push('<hr class="md-hr" />')
      continue
    }

    // 引用
    const quote = /^\s*&gt;\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph()
      flushList()
      result.push(`<blockquote class="md-quote">${inline(quote[1])}</blockquote>`)
      continue
    }

    // 无序列表
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ul) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        result.push('<ul class="md-ul">')
        listType = 'ul'
      }
      result.push(`<li>${inline(ul[1])}</li>`)
      continue
    }

    // 有序列表
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ol) {
      flushParagraph()
      if (listType !== 'ol') {
        flushList()
        result.push('<ol class="md-ol">')
        listType = 'ol'
      }
      result.push(`<li>${inline(ol[1])}</li>`)
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  if (inCode && codeBuffer.length > 0) {
    result.push(`<pre class="md-pre"><code>${codeBuffer.join('\n')}</code></pre>`)
  }
  flushParagraph()
  flushList()

  return result.join('\n')
}

/** 判断文本是否包含 Markdown 语法 */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|&gt;\s)|`|\*\*|\[.+\]\(.+\)/.test(String(text ?? ''))
}
