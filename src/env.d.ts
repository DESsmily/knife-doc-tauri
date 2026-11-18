/// <reference types="vite/client" />

/**
 * 构建期由 vite.config.ts 的 `define` 注入：
 * 值取自 package.json 的 version，作为应用版本号的唯一来源。
 */
declare const __APP_VERSION__: string
