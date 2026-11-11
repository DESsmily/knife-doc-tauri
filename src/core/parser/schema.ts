/**
 * JSON Schema 解析引擎
 *
 * 负责把 Swagger 2.0 的 `definitions` 与 OpenAPI 3.0 的 `components.schemas`
 * 统一解析成可渲染的参数/字段树，并处理：
 *  - `$ref` 引用解析
 *  - `allOf` / `oneOf` / `anyOf` 组合
 *  - `array` / `object` / `additionalProperties` 递归展开
 *  - 循环引用防护
 *  - 示例值推导（用于生成响应示例 JSON）
 */

import type { ApiParam, ParamIn, SpecKind } from '../types'
import { isNumericIntegerFormat, isPlainObject, stableId } from '../utils'

/** 原始文档中一个 schema 节点的宽松类型 */
export type RawSchema = Record<string, unknown>

/* ------------------------------------------------------------------ */
/* 引用解析器                                                           */
/* ------------------------------------------------------------------ */

export class SchemaResolver {
  /** 规范类别 */
  readonly specKind: SpecKind
  /** 原始文档（swagger / openapi 根对象） */
  private readonly doc: Record<string, unknown>

  constructor(doc: Record<string, unknown>, specKind: SpecKind) {
    this.doc = doc
    this.specKind = specKind
  }

  /** 所有命名模型定义 */
  get definitions(): Record<string, RawSchema> {
    if (this.specKind === 'swagger2') {
      const defs = this.doc.definitions
      return isPlainObject(defs) ? (defs as Record<string, RawSchema>) : {}
    }
    const components = this.doc.components
    if (isPlainObject(components)) {
      const schemas = (components as Record<string, unknown>).schemas
      return isPlainObject(schemas) ? (schemas as Record<string, RawSchema>) : {}
    }
    return {}
  }

  /** components.parameters / components.responses 等复用组件 */
  get componentParameters(): Record<string, unknown> {
    if (this.specKind === 'swagger2') return {}
    const components = this.doc.components
    if (isPlainObject(components)) {
      const params = (components as Record<string, unknown>).parameters
      return isPlainObject(params) ? (params as Record<string, unknown>) : {}
    }
    return {}
  }

  /** 从 $ref 中提取模型名 */
  getRefName(ref: unknown): string {
    if (typeof ref !== 'string' || !ref) return ''
    const patterns =
      this.specKind === 'swagger2'
        ? [/#\/definitions\/(.+)$/]
        : [/#\/components\/schemas\/(.+)$/, /#\/definitions\/(.+)$/]
    for (const pattern of patterns) {
      const match = pattern.exec(ref)
      if (match && match[1]) return decodeURIComponent(match[1])
    }
    return ''
  }

  /** 按名称取模型定义 */
  getDefinition(name: string): RawSchema | null {
    if (!name) return null
    const direct = this.definitions[name]
    if (direct) return direct
    // 兼容 OpenAPI 3 中 $ref 名带转义字符的情况
    const decoded = name.replace(/~1/g, '/').replace(/~0/g, '~')
    return this.definitions[decoded] ?? null
  }

  /** 解析可能是 $ref 的节点 */
  deref(schema: unknown): RawSchema | null {
    if (!isPlainObject(schema)) return null
    const ref = schema.$ref
    if (typeof ref === 'string' && ref) {
      const name = this.getRefName(ref)
      return name ? this.getDefinition(name) : null
    }
    return schema as RawSchema
  }

  /** 取节点的 $ref 模型名（无则返回空串） */
  refNameOf(schema: unknown): string {
    if (!isPlainObject(schema)) return ''
    return this.getRefName(schema.$ref)
  }

  /** 合并 allOf 得到扁平的 properties / required */
  flattenComposition(schema: RawSchema, visited: string[] = []): RawSchema {
    const result: RawSchema = { ...schema }
    const mergeInto = (target: RawSchema, part: unknown) => {
      if (!isPlainObject(part)) return
      const refName = this.refNameOf(part)
      if (refName) {
        if (visited.includes(refName)) return
        const def = this.getDefinition(refName)
        if (def) {
          mergeInto(target, this.flattenComposition(def, [...visited, refName]))
        }
        return
      }
      const nested = part as RawSchema
      const sub = this.flattenComposition(nested, visited)
      const targetProps = isPlainObject(target.properties) ? (target.properties as Record<string, unknown>) : {}
      const subProps = isPlainObject(sub.properties) ? (sub.properties as Record<string, unknown>) : {}
      target.properties = { ...targetProps, ...subProps }
      const targetRequired = Array.isArray(target.required) ? (target.required as string[]) : []
      const subRequired = Array.isArray(sub.required) ? (sub.required as string[]) : []
      target.required = Array.from(new Set([...targetRequired, ...subRequired]))
      if (!target.type && sub.type) target.type = sub.type
      if (!target.description && sub.description) target.description = sub.description
    }

    for (const key of ['allOf'] as const) {
      const parts = result[key]
      if (Array.isArray(parts)) {
        delete result[key]
        for (const part of parts) mergeInto(result, part)
      }
    }
    return result
  }
}

/* ------------------------------------------------------------------ */
/* 类型推导                                                            */
/* ------------------------------------------------------------------ */

/** 把 JSON Schema 节点转换成展示用类型名 */
export function displayType(
  schema: RawSchema | null,
  resolver: SchemaResolver,
  depth = 0
): string {
  if (!schema) return 'object'
  const refName = resolver.refNameOf(schema)
  if (refName) return refName

  const type = typeof schema.type === 'string' ? schema.type : ''
  if (type === 'array') {
    const inner = displayType(
      isPlainObject(schema.items) ? (schema.items as RawSchema) : null,
      resolver,
      depth + 1
    )
    return `array[${inner}]`
  }
  if (type === 'object' || !type) {
    if (isPlainObject(schema.additionalProperties)) {
      const inner = displayType(schema.additionalProperties as RawSchema, resolver, depth + 1)
      return `object{${inner}}`
    }
    const flat = resolver.flattenComposition(schema)
    if (isPlainObject(flat.properties)) {
      const props = flat.properties as Record<string, unknown>
      const keys = Object.keys(props)
      if (keys.length === 1 && keys[0] === 'additionalProperties') return 'object'
      return 'object'
    }
    if (Array.isArray(flat.oneOf)) return 'object'
    if (Array.isArray(flat.anyOf)) return 'object'
    return 'object'
  }
  const format = typeof schema.format === 'string' && schema.format ? `(${schema.format})` : ''
  return `${type}${format}`
}

/** 原始类型名（不含 format） */
export function rawTypeOf(schema: RawSchema | null, resolver: SchemaResolver): string {
  if (!schema) return 'object'
  const refName = resolver.refNameOf(schema)
  if (refName) return 'object'
  const type = typeof schema.type === 'string' ? schema.type : ''
  return type || 'object'
}

/* ------------------------------------------------------------------ */
/* 字段树构建                                                          */
/* ------------------------------------------------------------------ */

/**
 * 统计某个模型名在展开链路上出现的次数。
 *
 * 循环引用的处理策略：允许同一类型在链路上出现 **最多两次**。
 * 这样 `User.friends: User[]` 能展示一层嵌套字段（可读性更好），
 * 而再往下的 `friends.friends` 会被标记为循环引用并停止展开，从而保证终止。
 */
export function countType(parentTypes: string[], name: string): number {
  if (!name) return 0
  let count = 0
  for (const item of parentTypes) {
    if (item === name) count++
  }
  return count
}

/** 是否已超出循环引用允许的层级 */
function isCyclic(parentTypes: string[], name: string): boolean {
  return countType(parentTypes, name) >= 2
}

export interface BuildFieldOptions {
  /** 参数位置 */
  in: ParamIn
  /** 当前层级 */
  level: number
  /** 父节点 id */
  pid: string
  /** 展开链路（用于循环引用防护） */
  parentTypes: string[]
  /** 是否强制必填（path 参数） */
  forceRequired?: boolean
  /** 必填字段名集合 */
  requiredNames?: string[]
  /** 最大展开深度 */
  maxDepth?: number
}

/**
 * 把一个命名模型（或内联 schema）展开成字段树。
 */
export function buildFields(
  schema: RawSchema | null,
  resolver: SchemaResolver,
  options: BuildFieldOptions
): ApiParam[] {
  if (!schema) return []

  // 顶层即 $ref 时先解引用，否则 properties 为空会直接返回空数组
  const topRefName = resolver.refNameOf(schema)
  const target = topRefName ? (resolver.getDefinition(topRefName) ?? schema) : schema
  const flat = resolver.flattenComposition(target)

  // 顶层是数组时，直接展开数组元素的结构
  if (flat.type === 'array') {
    const items = isPlainObject(flat.items) ? (flat.items as RawSchema) : null
    const itemRef = resolver.refNameOf(items)
    if (itemRef) {
      if (isCyclic(options.parentTypes, itemRef)) return []
      return buildFields(resolver.getDefinition(itemRef), resolver, {
        ...options,
        parentTypes: [...options.parentTypes, itemRef]
      })
    }
    return items ? buildFields(items, resolver, options) : []
  }

  // oneOf / anyOf：作为「可选分支」展开
  for (const combo of ['oneOf', 'anyOf'] as const) {
    const parts = flat[combo]
    if (Array.isArray(parts) && parts.length > 0) {
      return parts.map((part, index) => {
        const sub = resolver.deref(part) ?? {}
        const subFlat = resolver.flattenComposition(sub)
        const refName = resolver.refNameOf(part)
        const label = refName || `方案${index + 1}`
        const node = createParam({
          name: label,
          in: options.in,
          type: displayType(part as RawSchema, resolver),
          rawType: rawTypeOf(part as RawSchema, resolver),
          schema: part as RawSchema,
          resolver,
          required: false,
          description: typeof subFlat.description === 'string' ? subFlat.description : '',
          level: options.level,
          pid: options.pid,
          parentTypes: options.parentTypes
        })
        node.children = buildFields(
          refName ? (resolver.getDefinition(refName) ?? sub) : sub,
          resolver,
          {
            ...options,
            level: options.level + 1,
            pid: node.id,
            parentTypes: refName ? [...options.parentTypes, refName] : options.parentTypes
          }
        )
        return node
      })
    }
  }

  const properties = isPlainObject(flat.properties)
    ? (flat.properties as Record<string, unknown>)
    : null

  // additionalProperties：map 结构
  if (!properties && isPlainObject(flat.additionalProperties)) {
    const ap = flat.additionalProperties as RawSchema
    const refName = resolver.refNameOf(ap)
    const node = createParam({
      name: 'key',
      in: options.in,
      type: displayType(ap, resolver),
      rawType: rawTypeOf(ap, resolver),
      schema: ap,
      resolver,
      required: false,
      description: '动态 key，值为以下结构',
      level: options.level,
      pid: options.pid,
      parentTypes: options.parentTypes
    })
    if (refName && !isCyclic(options.parentTypes, refName)) {
      node.children = buildFields(resolver.getDefinition(refName), resolver, {
        ...options,
        level: options.level + 1,
        pid: node.id,
        parentTypes: [...options.parentTypes, refName]
      })
    } else if (!refName) {
      node.children = buildFields(ap, resolver, {
        ...options,
        level: options.level + 1,
        pid: node.id
      })
    }
    return [node]
  }

  if (!properties) return []

  const requiredNames = Array.isArray(flat.required)
    ? (flat.required as string[])
    : options.requiredNames ?? []

  return Object.entries(properties).map(([name, raw]) => {
    const childFlat = resolver.deref(raw) ?? (isPlainObject(raw) ? (raw as RawSchema) : {})
    const merged = resolver.flattenComposition(childFlat)
    const required = options.forceRequired || requiredNames.includes(name)
    const node = createParam({
      name,
      in: options.in,
      type: displayType(isPlainObject(raw) ? (raw as RawSchema) : null, resolver),
      rawType: rawTypeOf(isPlainObject(raw) ? (raw as RawSchema) : null, resolver),
      schema: isPlainObject(raw) ? (raw as RawSchema) : {},
      resolver,
      required,
      description: typeof merged.description === 'string' ? merged.description : '',
      level: options.level,
      pid: options.pid,
      parentTypes: options.parentTypes
    })

    const maxDepth = options.maxDepth ?? 12
    const nextLevel = options.level + 1

    // $ref 引用
    const refName = resolver.refNameOf(raw)
    if (refName) {
      if (isCyclic(options.parentTypes, refName) || nextLevel > maxDepth) {
        node.circular = true
        return node
      }
      node.children = buildFields(resolver.getDefinition(refName), resolver, {
        ...options,
        level: nextLevel,
        pid: node.id,
        parentTypes: [...options.parentTypes, refName]
      })
      return node
    }

    // 数组
    if (merged.type === 'array') {
      const items = isPlainObject(merged.items) ? (merged.items as RawSchema) : null
      const itemRef = resolver.refNameOf(items)
      if (itemRef) {
        if (isCyclic(options.parentTypes, itemRef) || nextLevel > maxDepth) {
          node.circular = true
          return node
        }
        node.children = buildFields(resolver.getDefinition(itemRef), resolver, {
          ...options,
          level: nextLevel,
          pid: node.id,
          parentTypes: [...options.parentTypes, itemRef]
        })
      } else if (items && (isPlainObject(items.properties) || Array.isArray(items.allOf))) {
        node.children = buildFields(items, resolver, {
          ...options,
          level: nextLevel,
          pid: node.id
        })
      }
      return node
    }

    // 对象
    if (
      merged.type === 'object' ||
      isPlainObject(merged.properties) ||
      Array.isArray(merged.allOf) ||
      isPlainObject(merged.additionalProperties)
    ) {
      if (nextLevel > maxDepth) {
        node.circular = true
        return node
      }
      node.children = buildFields(merged, resolver, {
        ...options,
        level: nextLevel,
        pid: node.id
      })
    }
    return node
  })
}

/** 构造单个参数字典对象的内部辅助函数 */
function createParam(input: {
  name: string
  in: ParamIn
  type: string
  rawType: string
  schema: RawSchema
  resolver: SchemaResolver
  required: boolean
  description: string
  level: number
  pid: string
  parentTypes: string[]
}): ApiParam {
  const { schema, resolver } = input
  const flat = resolver.flattenComposition(schema)
  const format = typeof flat.format === 'string' ? flat.format : ''
  const enumValues = Array.isArray(flat.enum) ? (flat.enum as unknown[]) : []
  const example = extractExample(flat, resolver)
  const defaultValue =
    flat.default !== undefined && flat.default !== null ? formatScalar(flat.default) : ''
  const description =
    input.description ||
    (typeof flat.description === 'string' ? flat.description : '') ||
    (typeof flat.title === 'string' ? flat.title : '')

  return {
    id: stableId('p', input.in, input.pid, input.name, String(input.level), input.type),
    name: input.name,
    in: input.in,
    type: input.type,
    rawType: input.rawType,
    format,
    refName: resolver.refNameOf(schema),
    required: input.required,
    description,
    example,
    defaultValue,
    enumValues,
    children: [],
    level: input.level,
    pid: input.pid,
    parentTypes: input.parentTypes,
    circular: false
  }
}

/** 从 schema 中提取示例值文本 */
export function extractExample(schema: RawSchema, resolver: SchemaResolver): string {
  if (schema.example !== undefined && schema.example !== null) {
    return formatScalar(schema.example)
  }
  const flat = resolver.flattenComposition(schema)
  if (flat.example !== undefined && flat.example !== null) return formatScalar(flat.example)
  if (Array.isArray(flat.enum) && flat.enum.length > 0) return formatScalar(flat.enum[0])
  if (flat.default !== undefined && flat.default !== null) return formatScalar(flat.default)
  return ''
}

/** 标量转字符串 */
function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/* ------------------------------------------------------------------ */
/* 示例值推导                                                          */
/* ------------------------------------------------------------------ */

/**
 * 根据 schema 推导一个示例值（用于生成响应示例 JSON / 请求体模板）。
 */
export function buildExample(
  schema: RawSchema | null,
  resolver: SchemaResolver,
  visited: string[] = [],
  depth = 0
): unknown {
  if (!schema || depth > 12) return null
  const refName = resolver.refNameOf(schema)
  if (refName) {
    // 与字段树保持一致的循环引用策略：同一类型最多展开两层
    if (countType(visited, refName) >= 2) return {}
    const def = resolver.getDefinition(refName)
    if (!def) return {}
    return buildExample(def, resolver, [...visited, refName], depth + 1)
  }

  const flat = resolver.flattenComposition(schema)

  // 显式 example
  const explicit = pickExplicitExample(flat)
  if (explicit !== undefined) return explicit

  if (Array.isArray(flat.enum) && flat.enum.length > 0) return flat.enum[0]

  for (const combo of ['oneOf', 'anyOf'] as const) {
    const parts = flat[combo]
    if (Array.isArray(parts) && parts.length > 0) {
      return buildExample(parts[0] as RawSchema, resolver, visited, depth + 1)
    }
  }

  const type = typeof flat.type === 'string' ? flat.type : isPlainObject(flat.properties) ? 'object' : ''

  switch (type) {
    case 'array': {
      const items = isPlainObject(flat.items) ? (flat.items as RawSchema) : null
      const itemValue = buildExample(items, resolver, visited, depth + 1)
      return itemValue === null ? [] : [itemValue]
    }
    case 'object': {
      const properties = isPlainObject(flat.properties)
        ? (flat.properties as Record<string, unknown>)
        : {}
      const required = Array.isArray(flat.required) ? (flat.required as string[]) : []
      const keys = Object.keys(properties)
      // 优先只为必填字段生成示例，字段过多时全部生成
      const targetKeys =
        required.length > 0 && required.length <= 12 ? required : keys.slice(0, 24)
      const result: Record<string, unknown> = {}
      for (const key of targetKeys) {
        if (!(key in properties)) continue
        const child = properties[key]
        result[key] = buildExample(
          isPlainObject(child) ? (child as RawSchema) : null,
          resolver,
          visited,
          depth + 1
        )
      }
      return result
    }
    case 'string':
      return stringSample(flat)
    case 'integer':
      // int32 及更小的整型才是数字；int64 与未声明 format 的 integer 超出
      // JS 安全整数范围，后端一般序列化为字符串，示例同样按字符串给出
      return isNumericIntegerFormat(typeof flat.format === 'string' ? flat.format : '') ? 0 : ''
    case 'number':
      return 0
    case 'boolean':
      return true
    default: {
      if (isPlainObject(flat.properties)) {
        return buildExample({ ...flat, type: 'object' }, resolver, visited, depth + 1)
      }
      if (isPlainObject(flat.additionalProperties)) {
        return {
          key: buildExample(flat.additionalProperties as RawSchema, resolver, visited, depth + 1)
        }
      }
      return null
    }
  }
}

function pickExplicitExample(flat: RawSchema): unknown {
  if (flat.example !== undefined && flat.example !== null) return flat.example
  if (flat['x-example'] !== undefined && flat['x-example'] !== null) return flat['x-example']
  if (flat.default !== undefined && flat.default !== null) return flat.default
  return undefined
}

function stringSample(flat: RawSchema): string {
  const format = typeof flat.format === 'string' ? flat.format : ''
  switch (format) {
    case 'date-time':
      return '2026-01-01T00:00:00'
    case 'date':
      return '2026-01-01'
    case 'email':
      return 'user@example.com'
    case 'uri':
    case 'url':
      return 'https://example.com'
    case 'uuid':
      return '00000000-0000-0000-0000-000000000000'
    case 'password':
      return '******'
    case 'byte':
      return 'c3RyaW5n'
    case 'binary':
      return '<binary>'
    default:
      return ''
  }
}
