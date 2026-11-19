/**
 * 文档解析器 —— 把原始 Swagger 2.0 / OpenAPI 3.0 文档解析成统一的展示模型。
 *
 * 兼容要点（参考 knife4j 的实现）：
 *  - Swagger 2.0: definitions / parameters(body,formData) / consumes / produces / responses[code].schema
 *  - OpenAPI 3.0: components.schemas / components.parameters($ref) / requestBody.content / responses[code].content
 *  - pathItem 级别参数的合并（operation 覆盖 pathItem）
 *  - tags 分组、x-order 排序、x-author 作者
 */

import type {
  ApiDetail,
  ApiParam,
  ApiResponseCode,
  ApiSummary,
  ApiTagGroup,
  ParamIn,
  SchemaModel,
  SpecKind
} from '../types'
import { SUPPORT_METHODS } from '../types'
import { isPlainObject, prettyJson, stableId, unique } from '../utils'
import {
  buildExample,
  buildFields,
  displayType,
  extractExample,
  rawTypeOf,
  SchemaResolver,
  type RawSchema
} from './schema'

/* ------------------------------------------------------------------ */
/* 宽松取值辅助                                                        */
/* ------------------------------------------------------------------ */

function asObj(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asStr(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function asStrArr(value: unknown): string[] {
  return asArr(value)
    .map((item) => asStr(item))
    .filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* 解析结果                                                            */
/* ------------------------------------------------------------------ */

export interface ParsedInfo {
  title: string
  version: string
  description: string
  /** OAS3 的 servers[0].url，或 OAS2 的 host + basePath */
  host: string
  /** 接口前缀，例如 /api */
  basePath: string
}

export interface ParseOptions {
  /** 来源分组 id */
  groupId: string
  /** 文档地址（错误提示用） */
  sourceUrl?: string
}

interface RawOperation {
  id: string
  path: string
  /** 已含 basePath 的展示路径 */
  fullPath: string
  method: string
  op: Record<string, unknown>
  pathItem: Record<string, unknown>
}

export class DocumentParser {
  readonly specKind: SpecKind
  readonly resolver: SchemaResolver
  readonly info: ParsedInfo
  readonly apis: ApiSummary[]
  readonly tagGroups: ApiTagGroup[]
  readonly schemas: SchemaModel[]
  readonly securitySchemes: Record<string, unknown>

  private readonly groupId: string
  private readonly rawById = new Map<string, RawOperation>()
  private readonly detailCache = new Map<string, ApiDetail>()
  private readonly rawDoc: Record<string, unknown>

  constructor(doc: Record<string, unknown>, options: ParseOptions) {
    this.rawDoc = doc
    this.groupId = options.groupId
    this.specKind = detectSpecKind(doc)
    this.resolver = new SchemaResolver(doc, this.specKind)
    this.info = this.parseInfo(doc)
    this.securitySchemes = this.parseSecuritySchemes(doc)

    const { apis, rawById } = this.parseOperations(doc)
    this.apis = apis
    this.rawById = rawById
    this.tagGroups = this.buildTagGroups(doc, apis)
    this.schemas = this.buildSchemas()
  }

  /** 接口总数 */
  get apiCount(): number {
    return this.apis.length
  }

  /**
   * 原始文档 JSON。
   * 导出「接口 JSON」时直接使用原始文档，避免二次序列化丢失 x- 扩展字段与
   * 其它本项目未建模的内容。
   */
  get document(): Record<string, unknown> {
    return this.rawDoc
  }

  /** 获取接口详情（带缓存） */
  getDetail(apiId: string): ApiDetail | null {
    const cached = this.detailCache.get(apiId)
    if (cached) return cached
    const raw = this.rawById.get(apiId)
    if (!raw) return null
    const detail = this.buildDetail(raw)
    this.detailCache.set(apiId, detail)
    return detail
  }

  /* -------------------------------------------------------------- */
  /* 基础信息                                                        */
  /* -------------------------------------------------------------- */

  private parseInfo(doc: Record<string, unknown>): ParsedInfo {
    const info = asObj(doc.info)
    let host = ''
    let basePath = ''

    if (this.specKind === 'swagger2') {
      basePath = asStr(doc.basePath)
      const hostName = asStr(doc.host)
      const schemes = asStrArr(doc.schemes)
      if (hostName) {
        const scheme = schemes[0] || (hostName.startsWith('localhost') || /^\d/.test(hostName) ? 'http' : 'http')
        host = `${scheme}://${hostName}${basePath}`
      } else {
        host = basePath
      }
    } else {
      const servers = asArr(doc.servers)
      if (servers.length > 0) {
        const first = asObj(servers[0])
        host = asStr(first.url)
        // 从 server url 中剥离 path 部分作为 basePath
        try {
          if (/^https?:\/\//i.test(host)) {
            basePath = new URL(host).pathname.replace(/\/+$/, '')
          } else {
            basePath = host.replace(/\/+$/, '')
          }
        } catch {
          basePath = ''
        }
      }
    }

    return {
      title: asStr(info.title, '接口文档'),
      version: asStr(info.version, ''),
      description: asStr(info.description),
      host,
      basePath: basePath === '/' ? '' : basePath
    }
  }

  private parseSecuritySchemes(doc: Record<string, unknown>): Record<string, unknown> {
    if (this.specKind === 'swagger2') {
      return asObj(doc.securityDefinitions)
    }
    return asObj(asObj(doc.components).securitySchemes)
  }

  /* -------------------------------------------------------------- */
  /* 接口列表                                                        */
  /* -------------------------------------------------------------- */

  private parseOperations(doc: Record<string, unknown>): {
    apis: ApiSummary[]
    rawById: Map<string, RawOperation>
  } {
    const apis: ApiSummary[] = []
    const rawById = new Map<string, RawOperation>()
    const paths = asObj(doc.paths)

    for (const [path, pathItemRaw] of Object.entries(paths)) {
      const pathItem = asObj(pathItemRaw)
      for (const method of SUPPORT_METHODS) {
        const opRaw = pathItem[method]
        if (!isPlainObject(opRaw)) continue
        const op = opRaw as Record<string, unknown>
        // 过滤被标记为隐藏的接口
        if (op['x-hidden'] === true || op.hidden === true) continue

        const operationId = asStr(op.operationId)
        const id = stableId('api', this.groupId, path.toUpperCase(), method)
        const summaryText =
          asStr(op.summary) ||
          asStr(op['x-summary']) ||
          operationId ||
          `${method.toUpperCase()} ${path}`

        const tags = asStrArr(op.tags)
        const tag = tags.length > 0 ? tags[0] : 'default'

        const fullPath = this.joinPath(path)

        const summary: ApiSummary = {
          id,
          groupId: this.groupId,
          method: method.toUpperCase() as ApiSummary['method'],
          path,
          fullPath,
          summary: summaryText,
          operationId: operationId || `${method}${path}`,
          tag,
          deprecated: op.deprecated === true
        }
        apis.push(summary)
        rawById.set(id, { id, path, fullPath, method, op, pathItem })
      }
    }
    return { apis, rawById }
  }

  /** 拼接 basePath，得到展示/请求路径 */
  private joinPath(path: string): string {
    const bp = this.info.basePath || ''
    if (!bp) return path
    const left = bp.replace(/\/+$/, '')
    const right = path.startsWith('/') ? path : `/${path}`
    return `${left}${right}`
  }

  private buildTagGroups(doc: Record<string, unknown>, apis: ApiSummary[]): ApiTagGroup[] {
    const declared = asArr(doc.tags).map((item) => asObj(item))
    const orderMap = new Map<string, number>()
    const descMap = new Map<string, string>()
    declared.forEach((tag, index) => {
      const name = asStr(tag.name)
      if (!name) return
      const orderRaw = tag['x-order'] ?? tag['x-displayName-order']
      const order = typeof orderRaw === 'number' ? orderRaw : Number(orderRaw)
      orderMap.set(name, Number.isFinite(order) ? order : index)
      descMap.set(name, asStr(tag.description))
    })

    const grouped = new Map<string, ApiSummary[]>()
    for (const api of apis) {
      const list = grouped.get(api.tag) ?? []
      list.push(api)
      grouped.set(api.tag, list)
    }

    const groups: ApiTagGroup[] = []
    for (const [name, list] of grouped.entries()) {
      groups.push({
        name,
        description: descMap.get(name) ?? '',
        apis: list.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
      })
    }

    groups.sort((a, b) => {
      const oa = orderMap.get(a.name)
      const ob = orderMap.get(b.name)
      if (oa !== undefined && ob !== undefined) return oa - ob
      if (oa !== undefined) return -1
      if (ob !== undefined) return 1
      if (a.name === 'default') return 1
      if (b.name === 'default') return -1
      return a.name.localeCompare(b.name)
    })

    return groups
  }

  private buildSchemas(): SchemaModel[] {
    const defs = this.resolver.definitions
    const models: SchemaModel[] = []
    for (const [name, def] of Object.entries(defs)) {
      const flat = this.resolver.flattenComposition(def)
      const fields = buildFields(def, this.resolver, {
        in: 'body',
        level: 0,
        pid: name,
        parentTypes: [name]
      })
      const exampleValue = buildExample(def, this.resolver, [name])
      models.push({
        name,
        type: displayType(def, this.resolver),
        description: asStr(flat.description),
        fields,
        example: exampleValue === null ? '' : prettyJson(exampleValue)
      })
    }
    return models.sort((a, b) => a.name.localeCompare(b.name))
  }

  /* -------------------------------------------------------------- */
  /* 接口详情                                                        */
  /* -------------------------------------------------------------- */

  private buildDetail(raw: RawOperation): ApiDetail {
    const { op, path, method, fullPath, id } = raw
    const summary = this.apis.find((item) => item.id === id)

    const parameters = this.buildParameters(raw)
    const { requestMode, requestExample } = this.buildRequestMeta(raw, parameters)
    const responseCodes = this.buildResponses(raw)

    return {
      id,
      groupId: this.groupId,
      method: method.toUpperCase() as ApiDetail['method'],
      path,
      fullPath,
      summary: summary?.summary ?? '',
      operationId: summary?.operationId ?? '',
      tag: summary?.tag ?? 'default',
      deprecated: summary?.deprecated ?? false,
      description: asStr(op.description) || asStr(op.summary),
      author: asStr(op['x-author']) || asStr(op['x-Author']),
      consumes: this.collectMediaTypes(raw, 'consumes'),
      produces: this.collectMediaTypes(raw, 'produces'),
      parameters,
      requestMode,
      requestExample,
      responseCodes,
      securityKeys: this.collectSecurityKeys(op),
      multipartSchema: responseCodes.filter((item) => item.parameters.length > 0).length > 1
    }
  }

  private collectMediaTypes(raw: RawOperation, kind: 'consumes' | 'produces'): string[] {
    const local = asStrArr(raw.op[kind])
    if (local.length > 0) return local
    if (this.specKind === 'swagger2') return asStrArr(this.rawDoc[kind])
    // OAS3 从 requestBody / responses 的 content 推断
    if (kind === 'consumes') {
      const content = asObj(asObj(raw.op.requestBody).content)
      return Object.keys(content)
    }
    const mediaTypes: string[] = []
    for (const res of Object.values(asObj(raw.op.responses))) {
      mediaTypes.push(...Object.keys(asObj(asObj(res).content)))
    }
    return unique(mediaTypes)
  }

  private collectSecurityKeys(op: Record<string, unknown>): string[] {
    const security = asArr(op.security)
    const keys = new Set<string>()
    for (const item of security) {
      Object.keys(asObj(item)).forEach((key) => keys.add(key))
    }
    if (keys.size === 0) {
      // 文档级 security
      for (const item of asArr(this.rawDoc.security)) {
        Object.keys(asObj(item)).forEach((key) => keys.add(key))
      }
    }
    return Array.from(keys)
  }

  /* -------------------------------------------------------------- */
  /* 请求参数                                                        */
  /* -------------------------------------------------------------- */

  private buildParameters(raw: RawOperation): ApiParam[] {
    if (this.specKind === 'swagger2') return this.buildParametersSwagger2(raw)
    return this.buildParametersOpenApi3(raw)
  }

  /** 合并 pathItem 级与 operation 级参数（operation 覆盖） */
  private mergeRawParameters(raw: RawOperation): Record<string, unknown>[] {
    const merged = new Map<string, Record<string, unknown>>()
    const push = (list: unknown[], override: boolean) => {
      for (const itemRaw of list) {
        const item = this.derefParameter(itemRaw)
        if (!item) continue
        const key = `${asStr(item.name)}::${asStr(item.in)}`
        if (override || !merged.has(key)) merged.set(key, item)
      }
    }
    push(asArr(raw.pathItem.parameters), false)
    push(asArr(raw.op.parameters), true)
    return Array.from(merged.values())
  }

  /** 解析参数级别的 $ref（OpenAPI 3 的 components.parameters） */
  private derefParameter(itemRaw: unknown): Record<string, unknown> | null {
    if (!isPlainObject(itemRaw)) return null
    const ref = itemRaw.$ref
    if (typeof ref === 'string' && ref) {
      const name = ref.split('/').pop() ?? ''
      const target = this.resolver.componentParameters[name]
      return isPlainObject(target) ? (target as Record<string, unknown>) : null
    }
    return itemRaw as Record<string, unknown>
  }

  private buildParametersSwagger2(raw: RawOperation): ApiParam[] {
    const result: ApiParam[] = []
    const params = this.mergeRawParameters(raw)

    for (const param of params) {
      const name = asStr(param.name)
      const location = asStr(param.in) as ParamIn
      if (!name || !location) continue

      if (location === 'body') {
        const schema = isPlainObject(param.schema) ? (param.schema as RawSchema) : null
        const refName = this.resolver.refNameOf(schema)
        const label = refName || name || 'body'
        const rootId = stableId('p', 'body', label)
        const children = buildFields(schema, this.resolver, {
          in: 'body',
          level: 1,
          pid: rootId,
          parentTypes: refName ? [refName] : []
        })
        const exampleValue = buildExample(schema, this.resolver, refName ? [refName] : [])
        result.push({
          id: rootId,
          name: label,
          in: 'body',
          type: displayType(schema, this.resolver),
          rawType: rawTypeOf(schema, this.resolver),
          format: '',
          refName,
          required: param.required === true,
          description: asStr(param.description),
          example: exampleValue === null ? '' : prettyJson(exampleValue),
          defaultValue: '',
          enumValues: [],
          children,
          level: 0,
          pid: '',
          parentTypes: [],
          circular: false
        })
        continue
      }

      const schema = isPlainObject(param.schema)
        ? (param.schema as RawSchema)
        : (param as unknown as RawSchema)

      const node = this.buildScalarParam({
        name,
        location,
        schema,
        required: location === 'path' ? true : param.required === true,
        description: asStr(param.description),
        example: extractExample({ ...schema, example: param.example ?? param['x-example'] }, this.resolver),
        defaultValue: param.default !== undefined ? asStr(param.default) : ''
      })
      result.push(node)
    }

    return result
  }

  private buildParametersOpenApi3(raw: RawOperation): ApiParam[] {
    const result: ApiParam[] = []
    const params = this.mergeRawParameters(raw)

    for (const param of params) {
      const name = asStr(param.name)
      const location = asStr(param.in) as ParamIn
      if (!name || !location) continue
      const schema = isPlainObject(param.schema) ? (param.schema as RawSchema) : {}
      const exampleRaw = param.example ?? param['x-example']

      const node = this.buildScalarParam({
        name,
        location,
        schema:
          exampleRaw !== undefined
            ? { ...schema, example: exampleRaw }
            : schema,
        required: location === 'path' ? true : param.required === true,
        description: asStr(param.description),
        example: extractExample(
          exampleRaw !== undefined ? { ...schema, example: exampleRaw } : schema,
          this.resolver
        ),
        defaultValue: param.default !== undefined ? asStr(param.default) : ''
      })

      // schema 是对象/数组时，展开子级（OpenAPI 3 支持 query 参数为对象）
      if (schema.properties || schema.items || this.resolver.refNameOf(schema)) {
        const refName = this.resolver.refNameOf(schema)
        node.children = buildFields(schema, this.resolver, {
          in: location,
          level: 1,
          pid: node.id,
          parentTypes: refName ? [refName] : []
        })
      }
      result.push(node)
    }

    // requestBody
    const requestBodyRaw = raw.op.requestBody
    if (isPlainObject(requestBodyRaw)) {
      const requestBody = this.derefRequestBody(requestBodyRaw as Record<string, unknown>)
      if (requestBody) {
        const content = asObj(requestBody.content)
        const mediaType = pickMediaType(content)
        const mediaObj = asObj(content[mediaType])
        const schema = isPlainObject(mediaObj.schema) ? (mediaObj.schema as RawSchema) : null
        const required = requestBody.required === true
        const refName = this.resolver.refNameOf(schema)
        const mode = mediaTypeToParamIn(mediaType)

        if (schema) {
          const exampleValue =
            resolveMediaExample(mediaObj) ??
            buildExample(schema, this.resolver, refName ? [refName] : [])
          const exampleText = exampleValue === null ? '' : prettyJson(exampleValue)

          if (mode === 'formData') {
            // 表单字段直接提升为顶层参数，调试面板才能逐项填写 / 选择文件
            const fields = buildFields(schema, this.resolver, {
              in: mode,
              level: 0,
              pid: 'form',
              parentTypes: refName ? [refName] : []
            })
            result.push(...fields.map((field) => ({ ...field, required: field.required || required })))
          } else {
            const rootId = stableId('p', mode, refName || mediaType)
            const children = buildFields(schema, this.resolver, {
              in: mode,
              level: 1,
              pid: rootId,
              parentTypes: refName ? [refName] : []
            })
            result.push({
              id: rootId,
              name: refName || mediaType || 'body',
              in: mode,
              type: displayType(schema, this.resolver),
              rawType: rawTypeOf(schema, this.resolver),
              format: '',
              refName,
              required,
              description: asStr(requestBody.description),
              example: exampleText,
              defaultValue: '',
              enumValues: [],
              children,
              level: 0,
              pid: '',
              parentTypes: [],
              circular: false
            })
          }
        }
      }
    }

    return result
  }

  private derefRequestBody(body: Record<string, unknown>): Record<string, unknown> | null {
    const ref = body.$ref
    if (typeof ref === 'string' && ref) {
      const name = ref.split('/').pop() ?? ''
      const components = asObj(this.rawDoc.components)
      const requestBodies = asObj(components.requestBodies)
      const target = requestBodies[name]
      return isPlainObject(target) ? (target as Record<string, unknown>) : null
    }
    return body
  }

  private buildScalarParam(input: {
    name: string
    location: ParamIn
    schema: RawSchema
    required: boolean
    description: string
    example: string
    defaultValue: string
  }): ApiParam {
    const { schema } = input
    const flat = this.resolver.flattenComposition(schema)
    const enumValues = Array.isArray(flat.enum) ? (flat.enum as unknown[]) : []
    // Swagger 2.0 的 default 挂在 parameter 上，OpenAPI 3 的挂在 parameter.schema 上
    const schemaDefault =
      flat.default !== undefined && flat.default !== null ? String(flat.default) : ''
    return {
      id: stableId('p', input.location, input.name),
      name: input.name,
      in: input.location,
      type: displayType(schema, this.resolver),
      rawType: rawTypeOf(schema, this.resolver),
      format: typeof flat.format === 'string' ? flat.format : '',
      refName: this.resolver.refNameOf(schema),
      required: input.required,
      description: input.description,
      example: input.example || extractExample(schema, this.resolver),
      defaultValue: input.defaultValue || schemaDefault,
      enumValues,
      children: [],
      level: 0,
      pid: '',
      parentTypes: [],
      circular: false
    }
  }

  private buildRequestMeta(
    raw: RawOperation,
    parameters: ApiParam[]
  ): { requestMode: ApiDetail['requestMode']; requestExample: string } {
    const mediaTypes = this.collectMediaTypes(raw, 'consumes')
    const isMultipart = mediaTypes.some((item) => item.includes('multipart/form-data'))
    const isUrlencoded = mediaTypes.some((item) => item.includes('application/x-www-form-urlencoded'))

    const bodyNode = parameters.find((item) => item.in === 'body' && item.level === 0)
    if (bodyNode) {
      if (isMultipart) return { requestMode: 'form', requestExample: bodyNode.example }
      if (isUrlencoded) return { requestMode: 'urlencoded', requestExample: bodyNode.example }
      return { requestMode: 'json', requestExample: bodyNode.example }
    }

    const formNodes = parameters.filter((item) => item.in === 'formData' && item.level === 0)
    if (formNodes.length > 0) {
      const hasFile = formNodes.some(
        (item) => item.type.includes('binary') || item.rawType === 'file'
      )
      const mode: ApiDetail['requestMode'] = isMultipart || hasFile
        ? 'form'
        : isUrlencoded
          ? 'urlencoded'
          : 'form'
      const lines = formNodes.map((item) => `${item.name}=${item.example || ''}`)
      return { requestMode: mode, requestExample: lines.join('\n') }
    }

    return { requestMode: 'none', requestExample: '' }
  }

  /* -------------------------------------------------------------- */
  /* 响应                                                            */
  /* -------------------------------------------------------------- */

  private buildResponses(raw: RawOperation): ApiResponseCode[] {
    const responses = asObj(raw.op.responses)
    const result: ApiResponseCode[] = []

    for (const [code, resRaw] of Object.entries(responses)) {
      const res = this.derefResponse(resRaw)
      if (!res) continue
      const description = asStr(res.description, '')

      if (this.specKind === 'swagger2') {
        result.push(this.buildResponseSwagger2(code, description, res))
      } else {
        result.push(this.buildResponseOpenApi3(code, description, res))
      }
    }

    // 200 优先，其次按状态码升序
    return result.sort((a, b) => {
      if (a.code === '200') return -1
      if (b.code === '200') return 1
      const na = Number(a.code)
      const nb = Number(b.code)
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
      return a.code.localeCompare(b.code)
    })
  }

  private derefResponse(resRaw: unknown): Record<string, unknown> | null {
    if (!isPlainObject(resRaw)) return null
    const ref = resRaw.$ref
    if (typeof ref === 'string' && ref) {
      const name = ref.split('/').pop() ?? ''
      const components = asObj(this.rawDoc.components)
      const responses = asObj(components.responses)
      const target = responses[name]
      return isPlainObject(target) ? (target as Record<string, unknown>) : null
    }
    return resRaw as Record<string, unknown>
  }

  private buildResponseSwagger2(
    code: string,
    description: string,
    res: Record<string, unknown>
  ): ApiResponseCode {
    const schema = isPlainObject(res.schema) ? (res.schema as RawSchema) : null
    const refName = this.responseRefName(schema)
    const exampleValue = this.resolveSwagger2ResponseExample(res, schema, refName)

    return {
      code,
      description,
      refName,
      schemaTitle: schema ? displayType(schema, this.resolver) : '',
      example: exampleValue,
      parameters: schema
        ? buildFields(schema, this.resolver, {
            in: 'body',
            level: 0,
            pid: `res_${code}`,
            parentTypes: refName ? [refName] : []
          })
        : [],
      headers: this.buildResponseHeaders(res.headers)
    }
  }

  private resolveSwagger2ResponseExample(
    res: Record<string, unknown>,
    schema: RawSchema | null,
    refName: string
  ): string {
    const examples = asObj(res.examples)
    const jsonExample = examples['application/json']
    if (jsonExample !== undefined) return prettyJson(jsonExample)
    const firstExample = Object.values(examples)[0]
    if (firstExample !== undefined) return prettyJson(firstExample)
    if (!schema) return ''
    const value = buildExample(schema, this.resolver, refName ? [refName] : [])
    return value === null ? '' : prettyJson(value)
  }

  private buildResponseOpenApi3(
    code: string,
    description: string,
    res: Record<string, unknown>
  ): ApiResponseCode {
    const content = asObj(res.content)
    const mediaType = pickMediaType(content)
    const mediaObj = asObj(content[mediaType])
    const schema = isPlainObject(mediaObj.schema) ? (mediaObj.schema as RawSchema) : null
    const refName = this.responseRefName(schema)

    let exampleText = ''
    const mediaExample = resolveMediaExample(mediaObj)
    if (mediaExample !== undefined && mediaExample !== null) {
      exampleText = prettyJson(mediaExample)
    } else if (schema) {
      const value = buildExample(schema, this.resolver, refName ? [refName] : [])
      exampleText = value === null ? '' : prettyJson(value)
    }

    return {
      code,
      description,
      refName,
      schemaTitle: schema ? displayType(schema, this.resolver) : '',
      example: exampleText,
      parameters: schema
        ? buildFields(schema, this.resolver, {
            in: 'body',
            level: 0,
            pid: `res_${code}`,
            parentTypes: refName ? [refName] : []
          })
        : [],
      headers: this.buildResponseHeaders(res.headers)
    }
  }

  /** 响应模型名：直接 $ref 或数组元素 $ref 都算 */
  private responseRefName(schema: RawSchema | null): string {
    if (!schema) return ''
    const direct = this.resolver.refNameOf(schema)
    if (direct) return direct
    const items = schema.items
    if (isPlainObject(items)) return this.resolver.refNameOf(items)
    return ''
  }

  private buildResponseHeaders(headersRaw: unknown): ApiParam[] {
    const headers = asObj(headersRaw)
    return Object.entries(headers).map(([name, headerRaw]) => {
      const header = asObj(headerRaw)
      const schema = isPlainObject(header.schema) ? (header.schema as RawSchema) : (header as RawSchema)
      return {
        id: stableId('h', name),
        name,
        in: 'header' as ParamIn,
        type: asStr(header.type) || displayType(schema, this.resolver),
        rawType: asStr(header.type) || rawTypeOf(schema, this.resolver),
        format: typeof schema.format === 'string' ? schema.format : '',
        refName: '',
        required: header.required === true,
        description: asStr(header.description),
        example: extractExample(schema, this.resolver),
        defaultValue: '',
        enumValues: [],
        children: [],
        level: 0,
        pid: '',
        parentTypes: [],
        circular: false
      }
    })
  }
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

/** 判断文档规范版本 */
export function detectSpecKind(doc: Record<string, unknown>): SpecKind {
  const swagger = asStr(doc.swagger)
  if (swagger.startsWith('2')) return 'swagger2'
  const openapi = asStr(doc.openapi)
  if (openapi.startsWith('3')) return 'openapi3'
  // 兜底：出现 requestBody / components 视为 OAS3
  if (doc.components || doc.openapi) return 'openapi3'
  return 'swagger2'
}

/** 媒体类型优先级 */
const MEDIA_PRIORITY = [
  'application/json',
  'application/vnd.api+json',
  'application/problem+json',
  'text/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'application/xml',
  'text/xml',
  '*/*'
]

/** 从 content 中挑选最合适的媒体类型 */
export function pickMediaType(content: Record<string, unknown>): string {
  const keys = Object.keys(content)
  if (keys.length === 0) return ''
  for (const candidate of MEDIA_PRIORITY) {
    const hit = keys.find((key) => key.toLowerCase().split(';')[0].trim() === candidate)
    if (hit) return hit
  }
  const jsonLike = keys.find((key) => key.includes('json'))
  if (jsonLike) return jsonLike
  return keys[0]
}

/** 媒体类型 -> 参数位置 */
function mediaTypeToParamIn(mediaType: string): ParamIn {
  const type = mediaType.toLowerCase()
  if (type.includes('multipart/form-data')) return 'formData'
  if (type.includes('x-www-form-urlencoded')) return 'formData'
  return 'body'
}

/** OpenAPI 3 媒体类型对象上的示例 */
function resolveMediaExample(mediaObj: Record<string, unknown>): unknown {
  if (mediaObj.example !== undefined && mediaObj.example !== null) return mediaObj.example
  const examples = asObj(mediaObj.examples)
  const first = Object.values(examples)[0]
  if (first !== undefined) {
    if (isPlainObject(first) && 'value' in first) return (first as Record<string, unknown>).value
    return first
  }
  return undefined
}
