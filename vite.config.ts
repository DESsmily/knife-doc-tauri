import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// 版本号唯一来源：直接读 package.json，避免在窗口栏等处再手抄一份导致版本漂移。
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')
) as { version: string }

// Tauri 开发模式说明：
//  - 端口必须固定（strictPort），否则 tauri dev 拿到的 beforeDevCommand 地址会漂移。
//  - 不再需要任何跨域代理：所有 http(s) 请求由 Rust 侧 tauri-plugin-better-cors-fetch
//    透明接管 window.fetch / XMLHttpRequest，跨域在后端进程内完成。
export default defineConfig({
  plugins: [vue()],
  // 构建期注入应用版本号，供窗口栏版本徽标等展示（浏览器预览模式也能取到）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        // 全局注入变量与 mixin，业务样式文件内可直接使用
        additionalData: `@use "@/styles/variables.scss" as *;`
      }
    }
  },
  // 交互式命令（cargo 输出）不应清空 vite 日志
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST ? true : '127.0.0.1',
    open: false,
    watch: {
      // Rust 目标目录不需要监听，否则编译产物会疯狂触发 HMR
      ignored: ['**/src-tauri/**']
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        // 拆包：把体积较大的第三方依赖单独抽出，避免主 chunk 过大
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('element-plus') || id.includes('@element-plus')) return 'element-plus'
            if (id.includes('/vue/') || id.includes('vue-router') || id.includes('pinia')) return 'vue-vendor'
            if (id.includes('axios')) return 'axios'
            return 'vendor'
          }
          return undefined
        }
      }
    }
  }
})
