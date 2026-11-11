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
