/**
 * 全局数据模型定义
 *
 * 说明：项目开启了 `erasableSyntaxOnly`，因此不使用 enum / namespace，
 * 统一使用联合类型 + `as const` 常量对象来表达枚举语义。
 */

/** HTTP 请求方法（大写，用于展示与请求构造） */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS'
  | 'TRACE'

/** 解析阶段支持的小写方法名列表 */
export const SUPPORT_METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'head',
  'options',
  'trace'
] as const

/** 参数所在位置 */
export type ParamIn = 'path' | 'query' | 'header' | 'cookie' | 'body' | 'formData'

/** OpenAPI 规范版本类别 */
export type SpecKind = 'swagger2' | 'openapi3'

/* ------------------------------------------------------------------ */
/* 项目管理                                                             */
/* ------------------------------------------------------------------ */

export interface ProjectMeta {
  /** 探测到的分组数量 */
  groupCount?: number
  /** 探测到的接口总数 */
  apiCount?: number
  /** 最近一次同步时间 */
  lastSyncAt?: number
  /** 接口文档标题（info.title） */
  title?: string
  /** 规范版本，如 "2.0" / "3.0.3" */
  specVersion?: string
}

/** 一条被记录的接口文档项目（持久化到本地 data.json） */
export interface DocProject {
  id: string
  /** 项目名称 */
  name: string
  /** 后端地址，例如 http://127.0.0.1:9999（已归一化，不含尾部斜杠与 doc.html） */
  baseUrl: string
  /** 备注描述 */
  description: string
  /** 卡片主题色 */
  color: string
  createdAt: number
  lastOpened: number | null
  meta?: ProjectMeta
}

/* ------------------------------------------------------------------ */
/* 分组 / 接口                                                          */
/* ------------------------------------------------------------------ */

/** 一个分组（springfox 的 group / springdoc 的 url 条目） */
export interface DocGroup {
  id: string
  /** 分组名称 */
  name: string
  /** 该分组接口文档的真实 JSON 地址 */
  url: string
  /** 规范版本 */
  swaggerVersion: string
  /** 解析后确定：swagger2 / openapi3 */
  specKind: SpecKind
  /** 文档 info.title */
  title: string
  /** 文档 info.version */
  apiVersion: string
  description: string
  /** 服务地址（OAS2 的 host + basePath，OAS3 的 servers[0]） */
  host: string
  basePath: string
  /** 接口数量 */
  apiCount: number
  loaded: boolean
  error: string | null
}

/** 接口概要 —— 左侧列表展示用 */
export interface ApiSummary {
  id: string
  groupId: string
  method: HttpMethod
  /** 原始 path，如 /user/{id} */
  path: string
  /** 拼接 basePath 之后的展示路径 */
  fullPath: string
  /** 接口名称（summary 优先，否则 operationId） */
  summary: string
  operationId: string
  /** 所属 tag（即分组下的模块） */
  tag: string
  deprecated: boolean
}

/** 接口列表按 tag 聚合的结构 */
export interface ApiTagGroup {
  /** tag 名 */
  name: string
  /** tag 描述 */
  description: string
  apis: ApiSummary[]
}

/* ------------------------------------------------------------------ */
/* 参数 / 模型字段                                                       */
/* ------------------------------------------------------------------ */

/** 统一参数 / 模型字段节点（每个接口的所有参数都是这个结构，body 是它的子树） */
export interface ApiParam {
  id: string
  /** 字段名 */
  name: string
  /** 参数位置；body 子节点沿用父级的 in */
  in: ParamIn
  /** 展示用类型：string / integer / array[string] / object(引用名) */
  type: string
  /** 原始 JSON Schema type */
  rawType: string
  /** JSON Schema format */
  format: string
  /** $ref 指向的模型名 */
  refName: string
  /** 是否必填 */
  required: boolean
  /** 描述 */
  description: string
  /** 示例值 */
  example: string
  /** 默认值 */
  defaultValue: string
  /** 枚举可选值 */
  enumValues: unknown[]
  /** 子节点（object / array[object] 展开） */
  children: ApiParam[]
  /** 层级，0 为顶层 */
  level: number
  /** 父节点 id */
  pid: string
  /** 展开链路，用于阻断循环引用 */
  parentTypes: string[]
  /** 是否因循环引用被截断 */
  circular: boolean
}

/* ------------------------------------------------------------------ */
/* 响应                                                                 */
/* ------------------------------------------------------------------ */

/** 一个响应状态码的完整信息 */
export interface ApiResponseCode {
  code: string
  description: string
  /** 响应模型名（$ref 指向的 schema 名） */
  refName: string
  /** 响应模型类型描述 */
  schemaTitle: string
  /** 响应示例 JSON 字符串 */
  example: string
  /** 响应参数树 */
  parameters: ApiParam[]
  /** 响应头 */
  headers: ApiParam[]
}

/** 接口完整详情 */
export interface ApiDetail extends ApiSummary {
  /** 接口描述（支持 Markdown） */
  description: string
  /** 开发者（x-author / 扩展属性） */
  author: string
  /** 请求数据类型 */
  consumes: string[]
  /** 响应数据类型 */
  produces: string[]
  /** 请求参数（path/query/header/cookie + body/formData 展开后的参数） */
  parameters: ApiParam[]
  /** 请求体类型：json / form / urlencoded / raw / none */
  requestMode: 'json' | 'form' | 'urlencoded' | 'raw' | 'none'
  /** 请求体示例 */
  requestExample: string
  /** 响应状态码列表 */
  responseCodes: ApiResponseCode[]
  /** 是否需要鉴权 */
  securityKeys: string[]
  /** 标记：接口存在多个 schema 响应（多状态码不同模型） */
  multipartSchema: boolean
}

/* ------------------------------------------------------------------ */
/* Schema 定义（components.schemas / definitions）                      */
/* ------------------------------------------------------------------ */

/** 一个命名的模型定义 */
export interface SchemaModel {
  name: string
  type: string
  description: string
  fields: ApiParam[]
  /** 模型自身示例 JSON */
  example: string
}

/* ------------------------------------------------------------------ */
/* 全局参数                                                             */
/* ------------------------------------------------------------------ */

export type GlobalParamIn = 'header' | 'query'

/** 用户为某个项目配置的全局参数 */
export interface GlobalParam {
  id: string
  /** 参数名 */
  name: string
  /** 参数位置 */
  in: GlobalParamIn
  /** 参数值 */
  value: string
  /** 是否启用（勾选后注入所有接口） */
  enabled: boolean
  /** 备注 */
  description: string
}

/* ------------------------------------------------------------------ */
/* 网络层                                                               */
/* ------------------------------------------------------------------ */

/** 地址探测结果 */
export interface DiscoverResult {
  /** 探测方式 */
  source: 'springdoc-config' | 'springfox-resources' | 'direct-v2' | 'direct-v3' | 'custom'
  /** 文档标题 */
  title: string
  version: string
  groups: DocGroup[]
  /** 探测过程中的可读日志 */
  logs: string[]
}

/* ------------------------------------------------------------------ */
/* 快捷请求                                                             */
/* ------------------------------------------------------------------ */

/** 请求体类型，与调试 Tab 保持一致的语义 */
export type QuickBodyMode = 'none' | 'json' | 'form' | 'urlencoded' | 'raw'

/** 鉴权方式 */
export type QuickAuthType = 'none' | 'bearer' | 'basic' | 'apikey'

/** query / header / 表单字段的一行键值 */
export interface QuickKV {
  id: string
  name: string
  value: string
  enabled: boolean
  description: string
  /** 字段类型：string / number / boolean / file，决定发送时如何序列化值 */
  type: 'string' | 'number' | 'boolean' | 'file'
}

/** 鉴权配置，发送时转换成 header 或 query */
export interface QuickAuth {
  type: QuickAuthType
  /** bearer 令牌，支持 Bearer 前缀缺失时自动补齐 */
  token: string
  username: string
  password: string
  /** apikey 的参数名 */
  keyName: string
  /** apikey 的参数值 */
  keyValue: string
  /** apikey 放在 header 还是 query */
  keyIn: 'header' | 'query'
}

/** 请求体 */
export interface QuickBody {
  mode: QuickBodyMode
  /** json / raw 模式的文本 */
  text: string
  /** json 模式下的 Content-Type，默认 application/json */
  contentType: string
  /** form / urlencoded 的字段 */
  fields: QuickKV[]
  /** 标记哪些字段是文件字段（文件本体只存在于内存，不落盘） */
  fileFields: string[]
}

/** 一条快捷请求 */
export interface QuickRequest {
  id: string
  /** 所属分类，空串表示直接挂在根上 */
  folderId: string
  name: string
  method: HttpMethod
  /** 完整地址，含协议与主机 */
  url: string
  params: QuickKV[]
  headers: QuickKV[]
  body: QuickBody
  auth: QuickAuth
  /** 超时毫秒，0 表示不限制 */
  timeout: number
  /** 备注（Markdown） */
  remark: string
  createdAt: number
  updatedAt: number
  /** 最近一次发送时间 */
  lastSentAt: number | null
}

/** 快捷请求分类（单层，Apifox 的「管理中的快捷请求」目录） */
export interface QuickFolder {
  id: string
  name: string
  createdAt: number
}

/** 快捷请求整体数据桶 */
export interface QuickData {
  folders: QuickFolder[]
  requests: QuickRequest[]
  /** 当前打开的请求 id */
  activeId: string
  /** 顶部标签栏里打开的请求 id，按打开顺序 */
  opened: string[]
}
