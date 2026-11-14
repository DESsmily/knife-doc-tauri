/**
 * 接口详情 → 快捷请求 的转换工具
 *
 * 把一条 ApiDetail（含入参定义、请求体类型、全局参数）转换为一条 QuickRequest 的部分数据，
 * 供侧边栏右键「添加到快捷请求」与文档页内嵌快捷请求使用。取值以文档示例为准，
 * 不依赖调试面板的用户输入状态。
 */

import type { ApiDetail, GlobalParam, QuickBody, QuickKV, QuickRequest } from '@/core/types'
import { escapeRegExp, uid } from '@/core/utils'

/** 从参数节点判断是否为文件字段 */
function isFileParam(param: { rawType: string; format: string; type: string }): boolean {
  if (param.rawType === 'file' || param.format === 'binary') return true
  return /^(file|array\[file\]|string\(binary\)|array\[string\(binary\)\])$/.test(param.type)
}

/** 替换路径中的 {id} 占位符为示例值 */
function resolvePath(path: string, pathParams: { name: string; example: string }[]): string {
  let result = path
  for (const param of pathParams) {
    result = result.replace(new RegExp(`\\{${escapeRegExp(param.name)}\\}`, 'g'), encodeURIComponent(param.example ?? ''))
  }
  return result
}

/**
 * 把接口详情快照成一条快捷请求的输入数据（Partial<QuickRequest>），
 * 交由 quickRequest store 的 addRequest 补全默认字段后落盘。
 */
export function apiDetailToQuickRequest(
  detail: ApiDetail,
  baseUrl: string,
  globalParams: GlobalParam[]
): Partial<QuickRequest> {
  const top = detail.parameters.filter((item) => item.level === 0)

  /* ---- Query 参数 ---- */
  const params: QuickKV[] = []
  for (const param of top.filter((item) => item.in === 'query')) {
    params.push({
      id: uid('kv'),
      name: param.name,
      value: param.example ?? '',
      enabled: true,
      description: param.description,
      type: 'string'
    })
  }

  /* ---- Header 参数（含文档声明的 Accept 与全局 header） ---- */
  const headers: QuickKV[] = []
  if (detail.produces[0]) {
    headers.push({
      id: uid('kv'),
      name: 'Accept',
      value: detail.produces[0],
      enabled: true,
      description: '文档声明的响应类型',
      type: 'string'
    })
  }
  for (const param of top.filter((item) => item.in === 'header')) {
    headers.push({
      id: uid('kv'),
      name: param.name,
      value: param.example ?? '',
      enabled: true,
      description: param.description,
      type: 'string'
    })
  }
  for (const global of globalParams.filter((item) => item.in === 'header' && item.enabled)) {
    headers.push({
      id: uid('kv'),
      name: global.name,
      value: global.value,
      enabled: true,
      description: global.description || '全局参数',
      type: 'string'
    })
  }

  /* ---- 请求体 ---- */
  let body: QuickBody
  const bodyParam = top.find((item) => item.in === 'body')
  const formParams = top.filter((item) => item.in === 'formData')

  if (bodyParam) {
    body = {
      mode: detail.requestMode === 'raw' ? 'raw' : 'json',
      text: bodyParam.example || detail.requestExample || '{}',
      contentType: detail.requestMode === 'raw' ? 'text/plain;charset=utf-8' : 'application/json',
      fields: [],
      fileFields: []
    }
  } else if (formParams.length > 0) {
    const fields: QuickKV[] = []
    const fileFields: string[] = []
    for (const param of formParams) {
      const isFile = isFileParam(param)
      const item: QuickKV = {
        id: uid('kv'),
        name: param.name,
        value: param.example ?? '',
        enabled: true,
        description: param.description,
        type: isFile ? 'file' : 'string'
      }
      fields.push(item)
      if (isFile) fileFields.push(item.id)
    }
    body = {
      mode: detail.requestMode === 'urlencoded' ? 'urlencoded' : 'form',
      text: '',
      contentType: '',
      fields,
      fileFields
    }
  } else {
    body = { mode: 'none', text: '', contentType: 'application/json', fields: [], fileFields: [] }
  }

  /* ---- 拼接地址（替换 path 占位符） ---- */
  const pathParams = top.filter((item) => item.in === 'path')
  const resolvedPath = resolvePath(detail.path, pathParams)
  const url = `${(baseUrl || '').replace(/\/+$/, '')}${resolvedPath}`

  return {
    name: detail.summary || detail.operationId || detail.path,
    method: detail.method,
    url,
    params,
    headers,
    body,
    timeout: 60000,
    remark: `来自接口文档 ${detail.method} ${detail.fullPath}`
  }
}
