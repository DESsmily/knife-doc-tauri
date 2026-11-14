import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIcons from '@element-plus/icons-vue'

// 样式引入顺序很重要：先 Element Plus 基础样式与暗色变量，再覆盖自定义主题令牌
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@/styles/index.scss'

import App from './App.vue'
import router from './router'
import { CORSFetch } from 'tauri-plugin-better-cors-fetch'
import { isTauri } from '@/core/tauri'
import { initStorage } from '@/core/storage'
import { useAppStore } from '@/stores/app'
import { useGlobalParamStore } from '@/stores/globalParam'
import { useProjectStore } from '@/stores/project'
import { useQuickRequestStore } from '@/stores/quickRequest'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn, size: 'default' })

// 全局注册 Element Plus 图标，方便在模板里直接使用 <el-icon><Search /></el-icon>
for (const [name, component] of Object.entries(ElementPlusIcons)) {
  app.component(name, component)
}

/**
 * 禁用浏览器 / WebView 的默认右键菜单。
 *
 * 本应用为桌面端工具，右键菜单由业务侧自行实现（如侧边栏接口项的自定义菜单），
 * 不需要浏览器原生的「检查 / 复制 / 粘贴」等上下文菜单。阻止默认行为即可。
 */
window.addEventListener('contextmenu', (event) => event.preventDefault())

/**
 * 生产环境下禁用浏览器 / WebView 的刷新类快捷键。
 *
 * 桌面客户端中 Ctrl+R / Ctrl+Shift+R / F5 会触发 WebView 整页刷新，丢失当前
 * 请求状态与已加载的文档，属于无效操作，应当屏蔽。开发调试环境保留这些快捷键，
 * 以便在浏览器预览或 tauri dev 时排查问题。
 *
 * 使用 capture 阶段尽早拦截，避免 WebView 先完成刷新再被阻止。
 */
if (import.meta.env.PROD) {
  window.addEventListener(
    'keydown',
    (event) => {
      // F5：直接刷新
      if (event.key === 'F5') {
        event.preventDefault()
        return
      }
      // Ctrl/Cmd + R：普通刷新；按住 Shift 时即强制刷新（Ctrl+Shift+R）
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'r') {
        event.preventDefault()
      }
    },
    { capture: true }
  )
}

/**
 * 请求接管与数据加载都要在挂载前完成：
 * CORSFetch.init() 把 window.fetch / XMLHttpRequest 换成由 Rust 发出的实现（原生实现
 * 保留在 window.fetchNative），这样文档探测与调试请求都不受同源策略限制；
 * 随后把安装目录里的数据与设置读进内存，主题也在首帧前定下来，避免闪一下亮色。
 */
async function bootstrap() {
  if (isTauri) await CORSFetch.init()
  await initStorage()
  await useAppStore().init()
  useProjectStore().init()
  useGlobalParamStore().init()
  useQuickRequestStore().init()
}

void bootstrap().finally(() => app.mount('#app'))
