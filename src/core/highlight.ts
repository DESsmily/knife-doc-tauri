/**
 * 轻量语法高亮
 *
 * 不引入任何第三方高亮库，使用「规则列表 + 粘性正则」单遍扫描实现，
 * 覆盖 JSON / JavaScript / TypeScript / XML 四类文本。输出的 HTML 已完成转义。
 */

export type HighlightLang = 'json' | 'javascript' | 'typescript' | 'xml' | 'text'

interface Rule {
  regex: RegExp
  cls: string
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const JSON_RULES: Rule[] = [
  { regex: /"(?:\\["\\/bfnrtu]|[^"\\])*"(?=\s*:)/y, cls: 'key' },
  { regex: /"(?:\\["\\/bfnrtu]|[^"\\])*"/y, cls: 'str' },
  { regex: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, cls: 'num' },
  { regex: /\b(?:true|false|null)\b/y, cls: 'bool' },
  { regex: /[{}[\],:]/y, cls: 'punc' }
]

const JS_KEYWORDS =
  'break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|of|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|as|from|type|interface|enum|implements|declare|readonly|public|private|protected|static|namespace'

const SCRIPT_RULES: Rule[] = [
  { regex: /\/\/[^\n\r]*/y, cls: 'com' },
  { regex: /\/\*[\s\S]*?\*\//y, cls: 'com' },
  { regex: /`(?:\\[\s\S]|[^`\\])*`/y, cls: 'tpl' },
  { regex: /'(?:\\[\s\S]|[^'\\])*'/y, cls: 'str' },
  { regex: /"(?:\\[\s\S]|[^"\\])*"/y, cls: 'str' },
  { regex: new RegExp(`\\b(?:${JS_KEYWORDS})\\b`, 'y'), cls: 'kw' },
  { regex: /\b[A-Z][A-Za-z0-9_]*\b/y, cls: 'type' },
  { regex: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, cls: 'num' },
  { regex: /[{}()[\].,;:?!<>=+\-*/%&|^~]/y, cls: 'punc' }
]

const XML_RULES: Rule[] = [
  { regex: /<!--[\s\S]*?-->/y, cls: 'com' },
  { regex: /<\?[\s\S]*?\?>/y, cls: 'com' },
  { regex: /<\/?[\w:.-]+/y, cls: 'kw' },
  { regex: /\/?>/y, cls: 'kw' },
  { regex: /[\w:.-]+(?==)/y, cls: 'key' },
  { regex: /"(?:[^"\\]|\\.)*"/y, cls: 'str' },
  { regex: /'(?:[^'\\]|\\.)*'/y, cls: 'str' }
]

const RULES: Record<HighlightLang, Rule[]> = {
  json: JSON_RULES,
  javascript: SCRIPT_RULES,
  typescript: SCRIPT_RULES,
  xml: XML_RULES,
  text: []
}

/** 扫描 HTML 中的类名映射到最终 CSS 类 */
const CLASS_MAP: Record<string, string> = {
  key: 'tk-key',
  str: 'tk-str',
  num: 'tk-num',
  bool: 'tk-bool',
  punc: 'tk-punc',
  com: 'tk-com',
  tpl: 'tk-tpl',
  kw: 'tk-kw',
  type: 'tk-type'
}

export function highlight(code: string, lang: HighlightLang = 'text'): string {
  const source = String(code ?? '')
  if (!source) return ''
  const rules = RULES[lang] ?? []
  if (rules.length === 0) return escapeHtml(source)

  let out = ''
  let index = 0

  outer: while (index < source.length) {
    for (const rule of rules) {
      rule.regex.lastIndex = index
      const match = rule.regex.exec(source)
      if (match && match[0].length > 0 && match.index === index) {
        out += `<span class="${CLASS_MAP[rule.cls] ?? ''}">${escapeHtml(match[0])}</span>`
        index += match[0].length
        continue outer
      }
    }
    out += escapeHtml(source[index])
    index++
  }
  return out
}

/** 根据内容猜测语言 */
export function detectLang(text: string): HighlightLang {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return 'text'
  if (/^[\[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      return 'json'
    }
  }
  if (/^<[\w?!]/.test(trimmed)) return 'xml'
  if (/\b(?:import|export|function|const|let|var|return)\b/.test(trimmed)) return 'typescript'
  return 'text'
}
