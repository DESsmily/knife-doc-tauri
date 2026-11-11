/**
 * 文档地址探测
 *
 * 参考 knife4j 的实现，按优先级依次尝试：
 *  1. springdoc 的  `{base}/v3/api-docs/swagger-config`  →  `{ urls: [{ name, url }] }`
 *  2. springfox 的  `{base}/swagger-resources`           →  `[{ name, url, location, swaggerVersion }]`
 *  3. 直连 `{base}/v3/api-docs`  （单一分组，OpenAPI 3）
 *  4. 直连 `{base}/v2/api-docs`  （单一分组，Swagger 2）
 *
 * 另外兼容用户直接把 `.../v3/api-docs`、`.../doc.html` 或某个 json 地址粘进输入框。
 */

import { fetchJson } from './http'
import type { DiscoverResult, DocGroup, SpecKind } from './types'
import { isAbsoluteUrl, normalizeBaseUrl, resolveUrl, stableId } from './utils'

/** 候选入口地址 */
const CANDIDATES = {
  springdocConfig: 'v3/api-docs/swagger-config',
  springfoxResources: 'swagger-resources',
  directV3: 'v3/api-docs',
  directV2: 'v2/api-docs'
} as const

interface GroupSeed {
  name: string
  url: string
  swaggerVersion: string
}

function toGroup(seed: GroupSeed, baseUrl: string, specKind: SpecKind): DocGroup {
  const url = resolveUrl(baseUrl, seed.url)
  return {
    id: stableId('group', seed.name, url),
    name: seed.name || 'default',
    url,
    swaggerVersion: seed.swaggerVersion || (specKind === 'openapi3' ? '3.0.3' : '2.0'),
    specKind,
    title: '',
    apiVersion: '',
    description: '',
    host: '',
    basePath: '',
    apiCount: 0,
    loaded: false,
    error: null
  }
}

function detectKindFromVersion(version: string): SpecKind {
  return String(version).startsWith('2') ? 'swagger2' : 'openapi3'
}

/**
 * 从 `swagger-resources` / `swagger-config` 的原始数据里抽取分组种子
 */
function extractSeeds(payload: unknown, source: DiscoverResult['source']): GroupSeed[] {
  const seeds: GroupSeed[] = []

  if (source === 'springfox-resources') {
    const list = Array.isArray(payload) ? payload : []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const name = String(record.name ?? 'default')
      const url = String(record.url ?? record.location ?? '')
      const version = String(record.swaggerVersion ?? '2.0')
      if (!url) continue
      seeds.push({ name, url, swaggerVersion: version })
    }
    return seeds
  }

  if (source === 'springdoc-config') {
    if (!payload || typeof payload !== 'object') return seeds
    const record = payload as Record<string, unknown>
    const urls = Array.isArray(record.urls) ? record.urls : []
    for (const item of urls) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const name = String(entry.name ?? 'default')
      const url = String(entry.url ?? '')
      if (!url) continue
      seeds.push({ name, url, swaggerVersion: '3.0.3' })
    }
    if (seeds.length === 0 && typeof record.url === 'string' && record.url) {
      // 没有配置 GroupedOpenApi bean 时，springdoc 只返回单个 url
      seeds.push({
        name: String(record['urls.primaryName'] ?? 'default'),
        url: record.url,
        swaggerVersion: '3.0.3'
      })
    }
    return seeds
  }

  return seeds
}

/** 判断返回的 JSON 是否是一份 OpenAPI 文档本身（而非分组列表） */
function looksLikeApiDoc(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  return Boolean(record.swagger || record.openapi || record.paths || record.info)
}

/** 尝试探测一个地址的 JSON，失败返回 null */
async function tryFetch(url: string): Promise<{ payload: unknown } | null> {
  try {
    const result = await fetchJson(url, { timeout: 12000 })
    return { payload: result.data }
  } catch {
    return null
  }
}

/**
 * 探测入口应放在哪里：
 * 如果用户填的地址本身已经指向一个 api-docs 端点，则以其所在的「根」作为 base 继续探测，
 * 同时把该地址本身也加入候选。
 */
function normalizeEntry(baseUrl: string): {
  base: string
  /** 用户直接指定文档地址时为非空 */
  explicitDocUrl: string
  explicitKind: SpecKind | null
} {
  const raw = String(baseUrl ?? '').trim()
  if (!raw) return { base: '', explicitDocUrl: '', explicitKind: null }

  const docMatch = /^(.*?)\/(v3\/api-docs|v2\/api-docs)(\?.*)?$/i.exec(raw)
  if (docMatch && docMatch[1]) {
    const kind: SpecKind = docMatch[2].toLowerCase().startsWith('v2') ? 'swagger2' : 'openapi3'
    return { base: docMatch[1], explicitDocUrl: raw, explicitKind: kind }
  }

  return { base: normalizeBaseUrl(raw), explicitDocUrl: '', explicitKind: null }
}

/**
 * 探测文档入口，返回分组列表。
 * 任何一步失败都会记录日志并继续尝试下一个候选，全部失败才抛出错误。
 */
export async function discover(baseUrl: string): Promise<DiscoverResult> {
  const logs: string[] = []
  const { base, explicitDocUrl, explicitKind } = normalizeEntry(baseUrl)

  if (!base) throw new Error('请先填写后端地址')

  const candidates: {
    url: string
    source: DiscoverResult['source']
    kind: SpecKind | null
  }[] = []

  if (explicitDocUrl) {
    candidates.push({
      url: explicitDocUrl,
      source: explicitKind === 'swagger2' ? 'direct-v2' : 'direct-v3',
      kind: explicitKind
    })
    logs.push(`检测到用户直接指定了文档地址：${explicitDocUrl}`)
  }

  candidates.push(
    { url: resolveUrl(base, CANDIDATES.springdocConfig), source: 'springdoc-config', kind: null },
    { url: resolveUrl(base, CANDIDATES.springfoxResources), source: 'springfox-resources', kind: null },
    { url: resolveUrl(base, CANDIDATES.directV3), source: 'direct-v3', kind: 'openapi3' },
    { url: resolveUrl(base, CANDIDATES.directV2), source: 'direct-v2', kind: 'swagger2' }
  )

  const errors: string[] = []

  for (const candidate of candidates) {
    logs.push(`尝试探测 ${candidate.url}`)
    const result = await tryFetch(candidate.url)
    if (!result) {
      logs.push(`  ✕ 无响应`)
      errors.push(candidate.url)
      continue
    }

    const payload = result.payload

    // 分组列表型响应
    if (candidate.source === 'springdoc-config' || candidate.source === 'springfox-resources') {
      const seeds = extractSeeds(payload, candidate.source)
      if (seeds.length > 0) {
        logs.push(`  ✓ 发现 ${seeds.length} 个分组`)
        const groups = seeds.map((seed) => toGroup(seed, base, detectKindFromVersion(seed.swaggerVersion)))
        return {
          source: candidate.source,
          title: '',
          version: '',
          groups,
          logs
        }
      }
      // springdoc 在没有分组时可能直接返回文档本身
      if (looksLikeApiDoc(payload) && candidate.source === 'springdoc-config') {
        logs.push('  ✓ 该地址直接返回了 OpenAPI 文档')
        const group = toGroup({ name: 'default', url: candidate.url, swaggerVersion: '3.0.3' }, base, 'openapi3')
        return { source: 'direct-v3', title: '', version: '', groups: [group], logs }
      }
      logs.push('  ✕ 响应内容不是有效的分组列表')
      continue
    }

    // 直连文档型响应
    if (looksLikeApiDoc(payload)) {
      logs.push('  ✓ 获取到接口文档')
      const kind = candidate.kind ?? 'openapi3'
      const group = toGroup(
        {
          name: 'default',
          url: candidate.url,
          swaggerVersion: kind === 'swagger2' ? '2.0' : '3.0.3'
        },
        base,
        kind
      )
      return { source: candidate.source, title: '', version: '', groups: [group], logs }
    }

    logs.push('  ✕ 响应内容不是 OpenAPI 文档')
  }

  const hint = errors.length
    ? `已尝试：\n${errors.map((item) => `  · ${item}`).join('\n')}`
    : ''
  throw new Error(
    `未能自动发现接口文档地址。请确认后端地址正确、服务已启动，且已引入 springfox / springdoc 依赖。\n${hint}`
  )
}

/**
 * 加载并解析单个分组文档，返回原始文档对象。
 */
export async function loadGroupDocument(
  group: DocGroup
): Promise<{ doc: Record<string, unknown>; finalUrl: string }> {
  const result = await fetchJson<Record<string, unknown>>(group.url, { timeout: 30000 })
  const payload = result.data
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('接口文档响应格式异常，期望一个 JSON 对象')
  }
  return { doc: payload, finalUrl: result.url }
}

/** 猜测分组文档的规范版本（从 swaggerVersion 字段或实际内容判断） */
export function guessSpecKind(group: DocGroup, doc: Record<string, unknown>): SpecKind {
  return guessSpecKindFromDoc(doc) ?? group.specKind
}

function guessSpecKindFromDoc(doc: Record<string, unknown>): SpecKind | null {
  if (typeof doc.openapi === 'string' && doc.openapi) return 'openapi3'
  if (typeof doc.swagger === 'string' && doc.swagger) return 'swagger2'
  if (doc.components) return 'openapi3'
  if (doc.definitions) return 'swagger2'
  return null
}

/** 供 UI 展示：当前地址是否可被解析为绝对地址 */
export function isRemoteBase(baseUrl: string): boolean {
  return isAbsoluteUrl(baseUrl)
}
