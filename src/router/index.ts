import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'projects',
    component: () => import('@/views/ProjectListView.vue'),
    meta: { title: '项目管理' }
  },
  {
    path: '/quick',
    name: 'quick',
    component: () => import('@/views/QuickRequestView.vue'),
    meta: { title: '快捷请求' }
  },
  {
    path: '/setting',
    name: 'setting',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '设置' }
  },
  {
    path: '/doc/:projectId',
    name: 'doc',
    component: () => import('@/views/DocView.vue'),
    meta: { title: '接口文档' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  // hash 模式：桌面客户端用自定义协议加载，hash 路由无需任何服务端 rewrite
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

router.afterEach((to) => {
  const title = (to.meta?.title as string | undefined) ?? '接口文档'
  document.title = `${title} · Knife Doc`
})

export default router
