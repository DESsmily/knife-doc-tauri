/**
 * 示例代码生成器
 *
 * 参考 Apifox 的示例展示方式：根据接口定义生成可直接运行的 JS / TS / cURL 代码片段。
 *  - JS：axios 调用函数
 *  - TS：可选参数接口 + 响应接口 + 调用函数
 *  - cURL：命令行请求
 *  - JSON：请求参数示例
 */

import type { ApiDetail, ApiParam, ApiResponseCode, SchemaModel } from './types'
import { isNumericIntegerFormat, prettyJson, splitDisplayType } from './utils'

export interface ScriptContext {
  detail: ApiDetail
  /** 后端地址（用于 baseURL 展示） */
  baseUrl: string
  /** 当前分组下的模型定义，用于生成 TS 接口 */
  models?: SchemaModel[]
  /** 全局参数（会被合并进示例） */
  globalParams?: { name: string; in: 'header' | 'query'; value: string }[]
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/** 路径参数名集合 */
function collectParamNames(detail: ApiDetail): {
  path: ApiParam[]
  query: ApiParam[]
  header: ApiParam[]
  body: ApiParam[]
  form: ApiParam[]
} {
  const top = detail.parameters.filter((item) => item.level === 0)
  return {
    path: top.filter((item) => item.in === 'path'),
    query: top.filter((item) => item.in === 'query'),
    header: top.filter((item) => item.in === 'header'),
    body: top.filter((item) => item.in === 'body'),
    form: top.filter((item) => item.in === 'formData')
  }
}

/** 从 operationId 推导函数名 */
export function functionNameOf(detail: ApiDetail): string {
  const raw = detail.operationId || ''
  let name = raw
    .replace(/Using(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE)$/i, '')
    .replace(/[^A-Za-z0-9_$]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!name) {
    name = `${detail.method.toLowerCase()}_${detail.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
  }
  if (!/^[A-Za-z_$]/.test(name)) name = `api_${name}`
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/** 判断是否是合法的 JS 变量名 */
function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}

/** 参数在函数签名中的变量名 */
function varName(name: string): string {
  return isSafeIdentifier(name) ? name : name.replace(/[^A-Za-z0-9_$]/g, '_')
}

/**
 * 把 path 中的 {id} 占位符替换为变量引用，返回模板字面量/字符串拼接表达式。
 *
 * `resolveVar` 决定占位符怎么取值：JS 示例里 path 参数是顶层函数参数，直接用变量名；
 * TS 示例里所有参数都被收进 `params` 对象，需要取成 `params.id`。
 */
function buildUrlExpression(
  path: string,
  style: 'template' | 'concat',
  resolveVar: (name: string) => string = varName
): string {
  const segments: string[] = []
  const regex = /\{([^}]+)\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(path)) !== null) {
    if (match.index > lastIndex) segments.push(path.slice(lastIndex, match.index))
    segments.push(`\${${resolveVar(match[1])}}`)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < path.length) segments.push(path.slice(lastIndex))

  if (segments.length === 1 && !segments[0].includes('${')) {
    return style === 'template' ? `'${segments[0]}'` : `'${segments[0]}'`
  }
  const body = segments.join('')
  if (style === 'template') return `\`${body}\``
  // 拼接形式
  const parts = segments.map((seg) =>
    seg.includes('${') ? seg.replace(/\$\{(.*?)\}/g, '$1') : `'${seg}'`
  )
  return parts.filter(Boolean).join(' + ')
}

/** TS 示例里 path 参数通过 params 对象取值 */
function tsPathVar(name: string): string {
  return isSafeIdentifier(name) ? `params.${name}` : `params[${JSON.stringify(name)}]`
}

/** 该参数在前端是否应按 number 处理 */
function isNumericParam(param: ApiParam): boolean {
  if (param.rawType === 'number') return true
  if (param.rawType !== 'integer') return false
  const format = param.format || splitDisplayType(param.type).format
  return isNumericIntegerFormat(format)
}

/** 生成默认值字面量 */
function defaultValueLiteral(param: ApiParam): string {
  if (isNumericParam(param)) return '0'
  switch (param.rawType) {
    case 'boolean':
      return 'true'
    case 'array':
      return '[]'
    case 'object':
      return '{}'
    default:
      return "''"
  }
}

/* ------------------------------------------------------------------ */
/* TypeScript 类型                                                      */
/* ------------------------------------------------------------------ */

/** 把展示类型名映射为 TS 基础类型 */
function tsBaseType(name: string): string {
  const { base, format } = splitDisplayType(name)
  switch (base) {
    case 'string':
      return 'string'
    case 'integer':
    case 'long':
      // int32 及更小的整型才是 number；int64（Java long）与未声明 format 的
      // integer 超出 JS 安全整数范围，后端通常序列化为字符串，前端按 string 处理
      return isNumericIntegerFormat(format) ? 'number' : 'string'
    case 'number':
    case 'float':
    case 'double':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'Record<string, any>'
    case 'file':
      return 'File | Blob'
    default: {
      const mapRecord = /^object\{(.+)\}$/.exec(base)
      if (mapRecord) return `Record<string, ${tsBaseType(mapRecord[1])}>`
      if (/^[A-Z]/.test(base)) return base
      return 'any'
    }
  }
}

/**
 * 生成字段的单行 JSDoc 注释内容（不含 `/**` 外壳）。
 *
 * 描述里的换行会被折叠成空格，`*​/` 会被转义，避免生成的注释块被提前闭合。
 */
function fieldComment(param: ApiParam, extra?: string): string {
  const parts: string[] = []
  const description = String(param.description ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (description) parts.push(description)
  if (param.enumValues.length > 0) parts.push(`可选值: ${param.enumValues.join(' / ')}`)
  if (extra) parts.push(extra)
  return parts.join(' · ').replace(/\*\//g, '*\\/')
}

function objectLiteral(children: ApiParam[], depth: number, style: 'interface' | 'inline'): string {
  const pad = '  '.repeat(depth + 1)
  const closingPad = '  '.repeat(depth)
  const lines: string[] = []
  for (const child of children) {
    if (/^方案\d+$/.test(child.name)) continue
    const key = isSafeIdentifier(child.name) ? child.name : `'${child.name.replace(/'/g, "\\'")}'`
    const optional = child.required ? '' : '?'
    // 把接口文档里的字段描述带进生成的类型，便于在使用处直接看到字段含义
    const comment = fieldComment(child)
    if (comment) lines.push(`${pad}/** ${comment} */`)
    lines.push(`${pad}${key}${optional}: ${tsTypeOf(child, depth + 1, style)}`)
  }
  if (lines.length === 0) return 'Record<string, any>'
  return `{\n${lines.join('\n')}\n${closingPad}}`
}

/** 推导某个参数节点的 TS 类型 */
function tsTypeOf(param: ApiParam, depth: number, style: 'interface' | 'inline'): string {
  const arrayMatch = /^array\[(.*)\](\(.*\))?$/.exec(param.type)
  if (arrayMatch) {
    const innerName = arrayMatch[1]
    // 数组元素是引用模型时直接用模型名，避免无限内联
    if (/^[A-Z]/.test(innerName)) return `${innerName}[]`
    if (param.children.length > 0) {
      const literal = objectLiteral(param.children, depth, style)
      return literal.startsWith('{') ? `(${literal})[]` : `${literal}[]`
    }
    const base = tsBaseType(innerName)
    return /[|{}[\]]/.test(base) ? `(${base})[]` : `${base}[]`
  }

  const mapMatch = /^object\{(.+)\}$/.exec(param.type)
  if (mapMatch) return `Record<string, ${tsBaseType(mapMatch[1])}>`

  // 引用命名模型：直接使用模型名，接口由 renderModelInterface 单独输出
  if (param.refName) return param.refName

  if (param.children.length > 0) {
    return objectLiteral(param.children, depth, style)
  }

  return tsBaseType(param.type)
}

/** 收集参数树中引用到的模型名 */
function collectRefs(params: ApiParam[], bucket = new Set<string>()): Set<string> {
  for (const param of params) {
    if (param.refName) bucket.add(param.refName)
    const arrayMatch = /^array\[(.*)\]/.exec(param.type)
    if (arrayMatch && /^[A-Z]/.test(arrayMatch[1])) bucket.add(arrayMatch[1])
    if (param.children.length) collectRefs(param.children, bucket)
  }
  return bucket
}

/** 生成模型对应的 TS interface */
function renderModelInterface(model: SchemaModel): string {
  const body = objectLiteral(model.fields, 0, 'interface')
  const doc = model.description ? `/** ${model.description} */\n` : ''
  return `${doc}export interface ${model.name} ${body}`
}

/* ------------------------------------------------------------------ */
/* 集合构建                                                            */
/* ------------------------------------------------------------------ */

function buildHeaderObject(ctx: ScriptContext, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {}
  const { detail } = ctx
  const produces = detail.produces[0]
  if (produces) headers.Accept = produces
  if (detail.requestMode === 'json') headers['Content-Type'] = 'application/json'
  else if (detail.requestMode === 'urlencoded') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  for (const header of detail.parameters.filter((item) => item.in === 'header' && item.level === 0)) {
    headers[header.name] = header.example || defaultValueLiteral(header).replace(/'/g, '')
  }
  for (const global of ctx.globalParams ?? []) {
    if (global.in === 'header') headers[global.name] = global.value
  }
  return { ...headers, ...extra }
}

function buildQueryObject(ctx: ScriptContext): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  for (const param of ctx.detail.parameters.filter((item) => item.in === 'query' && item.level === 0)) {
    query[param.name] = param.example || ''
  }
  for (const global of ctx.globalParams ?? []) {
    if (global.in === 'query') query[global.name] = global.value
  }
  return query
}

/* ------------------------------------------------------------------ */
/* JS 示例                                                             */
/* ------------------------------------------------------------------ */

export function generateJavaScript(ctx: ScriptContext): string {
  const { detail } = ctx
  const name = functionNameOf(detail)
  const params = collectParamNames(detail)
  const signature: string[] = []

  for (const param of params.path) {
    signature.push(`${varName(param.name)} = ${defaultValueLiteral(param)}`)
  }
  if (params.query.length > 0) signature.push('query = {}')
  if (params.header.length > 0) signature.push('headers = {}')
  if (params.body.length > 0 || detail.requestMode === 'json') signature.push('data = {}')
  if (detail.requestMode === 'form' || detail.requestMode === 'urlencoded') signature.push('form = {}')
  signature.push('options = {}')

  const lines: string[] = []
  lines.push("import axios from 'axios'")
  lines.push('')
  lines.push('/**')
  lines.push(` * ${detail.summary || name}`)
  lines.push(` * ${detail.method} ${detail.fullPath}`)
  if (detail.description && detail.description !== detail.summary) {
    for (const line of String(detail.description).split('\n').slice(0, 6)) {
      lines.push(` * ${line}`)
    }
  }
  lines.push(' */')
  lines.push(`export function ${name}(${signature.join(', ')}) {`)
  lines.push('  return axios({')
  lines.push(`    baseURL: '${ctx.baseUrl}',`)
  lines.push(`    url: ${buildUrlExpression(detail.path, 'template')},`)
  lines.push(`    method: '${detail.method}',`)

  const query = buildQueryObject(ctx)
  if (Object.keys(query).length > 0) {
    lines.push(`    params: {`)
    for (const [key, value] of Object.entries(query)) {
      const keyText = isSafeIdentifier(key) ? key : `'${key}'`
      const isPathVariable = params.path.some((item) => item.name === key)
      lines.push(`      ${keyText}: ${isPathVariable ? varName(key) : `'${String(value)}'`},`)
    }
    lines.push('    },')
  } else if (params.path.length > 0) {
    lines.push(`    params,`)
  }

  const headers = buildHeaderObject(ctx)
  lines.push(`    headers: {`)
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`      '${key}': '${value}',`)
  }
  lines.push('    },')
  lines.push('    ...options')
  lines.push('  })')
  lines.push('}')

  if (params.header.length > 0) {
    lines.push('')
    lines.push(`// 说明：headers 参数可覆盖默认请求头，例如 ${name}(..., { Authorization: 'Bearer xxx' })`)
  }

  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* TS 示例                                                             */
/* ------------------------------------------------------------------ */

export interface TypeScriptSection {
  /** 区块标识 */
  key: 'request' | 'response' | 'function'
  /** 区块标题 */
  title: string
  code: string
}

/** 收集某组参数引用到的模型 interface（含模型间递归引用） */
function renderRefModels(
  refs: Set<string>,
  models: SchemaModel[] | undefined
): string[] {
  const modelMap = new Map((models ?? []).map((model) => [model.name, model]))
  const rendered: string[] = []
  const emitted = new Set<string>()
  const queue = Array.from(refs)

  while (queue.length > 0) {
    const modelName = queue.shift() as string
    if (emitted.has(modelName)) continue
    const model = modelMap.get(modelName)
    if (!model) continue
    emitted.add(modelName)
    rendered.push(renderModelInterface(model))
    for (const ref of collectRefs(model.fields)) {
      if (!emitted.has(ref)) queue.push(ref)
    }
  }
  return rendered
}

/**
 * 响应能直接沿用后端模型名时返回对应的 TS 类型，否则返回空串。
 * `array[X]` 也算模型引用，避免把模型字段再抄一份到合成的 XResponse 里。
 */
function responseModelType(
  code: ApiResponseCode | undefined,
  models: SchemaModel[] | undefined
): string {
  if (!code?.refName) return ''
  if (!(models ?? []).some((model) => model.name === code.refName)) return ''
  if (code.schemaTitle === code.refName) return code.refName
  if (code.schemaTitle === `array[${code.refName}]`) return `${code.refName}[]`
  return ''
}

/**
 * 生成 TypeScript 示例，按「请求类型 → 响应类型 → 调用函数」分区块输出，
 * 便于文档页面把请求与响应类型拆成可折叠的代码块展示。
 */
export function generateTypeScriptSections(ctx: ScriptContext): TypeScriptSection[] {
  const { detail } = ctx
  const name = functionNameOf(detail)
  const pascal = name.charAt(0).toUpperCase() + name.slice(1)
  const params = collectParamNames(detail)
  const paramsInterface = `${pascal}Params`
  const responseInterface = `${pascal}Response`

  // 请求与响应各自引用的模型分开收集，保证响应模型不会跑到请求区块前面
  const requestRefs = new Set<string>()
  collectRefs(detail.parameters, requestRefs)
  const responseRefs = new Set<string>()
  for (const code of detail.responseCodes) collectRefs(code.parameters, responseRefs)

  /* ---------- 请求类型区块 ---------- */
  const requestLines: string[] = []
  for (const model of renderRefModels(requestRefs, ctx.models)) {
    requestLines.push(model)
    requestLines.push('')
  }

  const paramsMembers: string[] = []
  const pushMember = (param: ApiParam, locationLabel: string) => {
    const key = isSafeIdentifier(param.name) ? param.name : `'${param.name}'`
    const optional = param.required ? '' : '?'
    const doc = fieldComment(param, `位置: ${locationLabel}`)
    if (doc) paramsMembers.push(`  /** ${doc} */`)
    paramsMembers.push(`  ${key}${optional}: ${tsTypeOf(param, 1, 'interface')}`)
  }

  for (const param of params.path) pushMember(param, 'path')
  for (const param of params.query) pushMember(param, 'query')
  for (const param of params.header) pushMember(param, 'header')

  const bodyParam = params.body[0]
  const hasBody = Boolean(bodyParam)

  if (paramsMembers.length > 0) {
    requestLines.push(`/** ${detail.summary} 请求参数 */`)
    requestLines.push(`export interface ${paramsInterface} {`)
    requestLines.push(...paramsMembers)
    requestLines.push('}')
    requestLines.push('')
  }

  // 能直接写进签名的类型（后端类名、模型数组、基础类型）不再包一层 XBody
  let bodySignature = ''
  if (hasBody) {
    const bodyType = tsTypeOf(bodyParam as ApiParam, 0, 'interface')
    if (bodyType.includes('\n')) {
      requestLines.push(`/** ${detail.summary} 请求体 */`)
      requestLines.push(`export type ${pascal}Body = ${bodyType}`)
      requestLines.push('')
      bodySignature = `${pascal}Body`
    } else {
      bodySignature = bodyType
    }
  }

  /* ---------- 响应类型区块 ---------- */
  const successCode =
    detail.responseCodes.find((item) => item.code === '200') ?? detail.responseCodes[0]

  // 响应本身就是后端命名模型时直接沿用类名，不再生成一份 XResponse 副本
  const responseModel = responseModelType(successCode, ctx.models)
  if (responseModel && successCode) responseRefs.add(successCode.refName)

  const responseLines: string[] = []
  for (const model of renderRefModels(responseRefs, ctx.models)) {
    responseLines.push(model)
    responseLines.push('')
  }

  if (successCode && !responseModel) {
    if (successCode.parameters.length > 0) {
      responseLines.push(`/** ${detail.summary} 响应数据 */`)
      responseLines.push(`export interface ${responseInterface} ${objectLiteral(successCode.parameters, 0, 'interface')}`)
      responseLines.push('')
    } else {
      responseLines.push(`/** ${detail.summary} 响应数据 */`)
      responseLines.push(`export type ${responseInterface} = any`)
      responseLines.push('')
    }
  }

  /* ---------- 调用函数区块 ---------- */
  const signature: string[] = []
  if (paramsMembers.length > 0) signature.push(`params: ${paramsInterface}`)
  if (hasBody) signature.push(`body: ${bodySignature}`)
  signature.push('options: { headers?: Record<string, string> } = {}')

  const responseType = responseModel || (successCode?.parameters.length ? responseInterface : 'any')

  const functionLines: string[] = []
  functionLines.push("import axios, { type AxiosResponse } from 'axios'")
  functionLines.push('')
  functionLines.push('/**')
  functionLines.push(` * ${detail.summary || name}`)
  functionLines.push(` * ${detail.method} ${detail.fullPath}`)
  functionLines.push(' */')
  functionLines.push(`export function ${name}(${signature.join(', ')}): Promise<AxiosResponse<${responseType}>> {`)

  const query = buildQueryObject(ctx)
  functionLines.push('  return axios({')
  functionLines.push(`    baseURL: '${ctx.baseUrl}',`)
  functionLines.push(`    url: ${buildUrlExpression(detail.path, 'template', tsPathVar)},`)
  functionLines.push(`    method: '${detail.method}',`)
  if (Object.keys(query).length > 0) {
    functionLines.push('    params,')
  }
  if (hasBody) {
    functionLines.push('    data: body,')
  }
  const headers = buildHeaderObject(ctx)
  functionLines.push('    headers: {')
  for (const [key, value] of Object.entries(headers)) {
    functionLines.push(`      '${key}': '${value}',`)
  }
  functionLines.push('      ...options.headers')
  functionLines.push('    }')
  functionLines.push('  })')
  functionLines.push('}')

  const sections: TypeScriptSection[] = []
  const requestCode = requestLines.join('\n').trimEnd()
  if (requestCode) {
    sections.push({ key: 'request', title: '请求类型', code: requestCode })
  }
  const responseCode = responseLines.join('\n').trimEnd()
  if (responseCode) {
    sections.push({ key: 'response', title: '响应类型', code: responseCode })
  }
  sections.push({ key: 'function', title: '调用函数', code: functionLines.join('\n') })
  return sections
}

export function generateTypeScript(ctx: ScriptContext): string {
  return generateTypeScriptSections(ctx)
    .map((section) => section.code)
    .join('\n\n')
}

/* ------------------------------------------------------------------ */
/* cURL / JSON 示例                                                     */
/* ------------------------------------------------------------------ */

export function generateCurl(ctx: ScriptContext): string {
  const { detail } = ctx
  const headers = buildHeaderObject(ctx)
  const query = buildQueryObject(ctx)
  const parts: string[] = [`curl -X ${detail.method}`]

  for (const [key, value] of Object.entries(headers)) {
    parts.push(`  -H '${key}: ${value}'`)
  }

  const queryString = Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  const fullUrl = `${ctx.baseUrl}${detail.path}${queryString ? `?${queryString}` : ''}`
  parts.push(`  '${fullUrl}'`)

  return parts.join(' \\\n')
}

/** 请求参数示例 JSON（含 body 展开） */
export function generateRequestJson(ctx: ScriptContext): string {
  const { detail } = ctx
  const bodyParam = detail.parameters.find((item) => item.in === 'body' && item.level === 0)
  if (bodyParam) {
    if (bodyParam.example) return bodyParam.example
    return prettyJson(buildSampleFromChildren(bodyParam.children))
  }
  const formParams = detail.parameters.filter((item) => item.in === 'formData' && item.level === 0)
  if (formParams.length > 0) {
    const result: Record<string, unknown> = {}
    for (const param of formParams) {
      result[param.name] = sampleValueOf(param)
    }
    return prettyJson(result)
  }
  const queryParams = detail.parameters.filter((item) => item.in === 'query' && item.level === 0)
  if (queryParams.length > 0) {
    const result: Record<string, unknown> = {}
    for (const param of queryParams) result[param.name] = sampleValueOf(param)
    return prettyJson(result)
  }
  return ''
}

function buildSampleFromChildren(children: ApiParam[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const child of children) {
    if (/^方案\d+$/.test(child.name)) continue
    result[child.name] = sampleValueOf(child)
  }
  return result
}

function sampleValueOf(param: ApiParam): unknown {
  if (param.example) {
    try {
      return JSON.parse(param.example)
    } catch {
      return param.example
    }
  }
  if (param.enumValues.length > 0) return param.enumValues[0]
  if (param.defaultValue) return param.defaultValue
  if (param.rawType === 'array') {
    return param.children.length ? [buildSampleFromChildren(param.children)] : []
  }
  if (param.rawType === 'object' || param.children.length > 0) {
    return buildSampleFromChildren(param.children)
  }
  if (isNumericParam(param)) return 0
  if (param.rawType === 'boolean') return true
  return ''
}
