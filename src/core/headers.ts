/**
 * 常用 HTTP 请求头常量
 *
 * 供调试面板与快捷请求的 Header 参数名输入框做自动补全数据源使用。
 * 按字母序排列，仅保留业界常用、语义明确的标准请求头与常见扩展头。
 */

export const COMMON_HEADERS: string[] = [
  'Accept',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Accept-Ranges',
  'Access-Control-Allow-Origin',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Disposition',
  'Content-Length',
  'Content-MD5',
  'Content-Type',
  'Cookie',
  'Date',
  'DNT',
  'Expires',
  'From',
  'Host',
  'If-Modified-Since',
  'If-None-Match',
  'If-Range',
  'Origin',
  'Pragma',
  'Proxy-Authorization',
  'Referer',
  'Sec-Fetch-Dest',
  'Sec-Fetch-Mode',
  'Sec-Fetch-Site',
  'Sec-Fetch-User',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'Upgrade-Insecure-Requests',
  'User-Agent',
  'Vary',
  'Via',
  'Warning',
  'WWW-Authenticate',
  'X-API-Key',
  'X-Auth-Token',
  'X-CSRF-Token',
  'X-CSRF-TOKEN',
  'X-Forwarded-For',
  'X-Forwarded-Host',
  'X-Requested-With',
  'X-Real-IP',
  'X-Token'
]

/**
 * 自动补全的候选项：把常用请求头包装成 el-autocomplete 需要的
 * `{ value, label }[]` 结构，label 与 value 相同，便于直接匹配。
 */
export function headerSuggestions(): { value: string; label: string }[] {
  return COMMON_HEADERS.map((name) => ({ value: name, label: name }))
}
