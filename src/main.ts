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
import { openPageSearch } from '@/composables/usePageSearch'
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
 * 生产环境下禁用浏览器 / WebView 的刷新类与查找类快捷键。
 *
 * 桌面客户端中 Ctrl+R / Ctrl+Shift+R / F5 会触发 WebView 整页刷新，丢失当前
 * 桌面端禁用ctrl+p 打印功能
 * 请求状态与已加载的文档，属于无效操作，应当屏蔽。Ctrl+F 会触发浏览器原生
 * 查找，屏蔽后改为唤起本应用的自定义页面搜索框。开发调试环境保留这些快捷键，
 * 以便在浏览器预览或 tauri dev 时排查问题。
 *
 * 使用 capture 阶段尽早拦截，避免 WebView 先完成刷新 / 查找再被阻止。
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
      const mod = event.ctrlKey || event.metaKey
      const keys = ['r', 'p']
      // Ctrl/Cmd + R：普通刷新；按住 Shift 时即强制刷新（Ctrl+Shift+R）
      if (mod && keys.includes(event.key.toLowerCase())) {
        event.preventDefault()
        return
      }
      // Ctrl/Cmd + F：浏览器原生查找，改为唤起自定义搜索框
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openPageSearch()
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

declare global {
  interface Window {
    /** index.html 内联脚本写入：启动页开始展示的时间点（performance.now()） */
    __kdSplashAt?: number
  }
}

/**
 * 启动页最短展示时长（ms）。
 * 需保证 index.html 里启动页的 CSS3 动画（进入 0.45s + 进度条 0.85s）完整播完；
 * 加上 0.4s 的淡出，整体「启动页 → 主页」过渡约 1.4s，控制在 1.5s 以内。
 */
const SPLASH_MIN_DURATION = 1000

/** 启动页开始展示的时间点（优先取 head 内联脚本记录的值，越早越准） */
const SPLASH_STARTED_AT = window.__kdSplashAt ?? performance.now()

void bootstrap().finally(() => {
  app.mount('#app')

  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    // 切到 kd-ready：启动页淡出、应用主体淡入（与 index.html 内联样式对应）
    document.documentElement.classList.add('kd-ready')
  }

  // 若数据加载很快，则补足到最短展示时长再进场；若加载较慢，则立即进场
  const elapsed = performance.now() - SPLASH_STARTED_AT
  const wait = Math.max(0, SPLASH_MIN_DURATION - elapsed)

  window.setTimeout(reveal, wait)
  // 兜底：窗口被遮挡 / 最小化启动导致定时器被节流时，也确保最终能进入主页
  window.setTimeout(reveal, wait + 600)
})
