<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from '@/core/message'

import EmptyState from '@/components/common/EmptyState.vue'
import MethodTag from '@/components/common/MethodTag.vue'
import DebugTab from '@/components/doc/DebugTab.vue'
import DocBreadcrumb from '@/components/doc/DocBreadcrumb.vue'
import DocInfoPanel from '@/components/doc/DocInfoPanel.vue'
import DocSidebar from '@/components/doc/DocSidebar.vue'
import DocTabs from '@/components/doc/DocTabs.vue'
import DocumentTab from '@/components/doc/DocumentTab.vue'
import GlobalParamDialog from '@/components/doc/GlobalParamDialog.vue'
import ModelDialog from '@/components/doc/ModelDialog.vue'
import ModelsPanel from '@/components/doc/ModelsPanel.vue'
import SampleTab from '@/components/doc/SampleTab.vue'
import { copyText } from '@/core/http'
import { useDocStore } from '@/stores/doc'
import { useGlobalParamStore } from '@/stores/globalParam'
import { useProjectStore } from '@/stores/project'

// 显式声明组件名，供 App.vue 的 keep-alive include 匹配
defineOptions({ name: 'DocView' })

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const projectStore = useProjectStore()
const globalParamStore = useGlobalParamStore()

const activeTab = ref<'doc' | 'debug' | 'sample'>('doc')
const globalDialogVisible = ref(false)
const modelDialogVisible = ref(false)
const modelDialogName = ref('')

/** 左侧接口列表是否折叠 */
const sidebarCollapsed = ref(false)

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

const project = computed(() => projectStore.projects.find((item) => item.id === docStore.projectId) ?? null)

const baseUrl = computed(() => project.value?.baseUrl ?? '')

const detail = computed(() => docStore.activeApi)

const loaderText = computed(() => {
  if (docStore.discovering) return '正在探测接口文档地址…'
  if (docStore.parsing) return '正在解析接口文档…'
  return ''
})

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

async function bootstrap(projectId: string) {
  const found = projectStore.projects.find((item) => item.id === projectId)
  if (!found) {
    message.warning('项目不存在或已被删除')
    void router.replace({ name: 'projects' })
    return
  }
  projectStore.setCurrent(found.id)
  globalParamStore.setProject(found.id)
  try {
    await docStore.openProject(found, { force: docStore.projectId !== found.id })
  } catch {
    /* 错误已写入 store，由模板渲染 */
  }
}

onMounted(() => {
  void bootstrap(String(route.params.projectId ?? ''))
})

watch(
  () => route.params.projectId,
  (value) => {
    if (value) void bootstrap(String(value))
  }
)

/* ------------------------------------------------------------------ */
/* 交互                                                                */
/* ------------------------------------------------------------------ */

const refreshing = ref(false)

async function handleRefreshAll() {
  refreshing.value = true
  try {
    await docStore.reloadAll()
    message.success('文档已重新加载')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '重新加载失败')
  } finally {
    refreshing.value = false
  }
}

async function handleReloadGroup() {
  refreshing.value = true
  try {
    await docStore.reloadCurrentGroup()
    message.success('当前分组已刷新')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '刷新失败')
  } finally {
    refreshing.value = false
  }
}

function openModel(name: string) {
  if (!name) return
  modelDialogName.value = name
  modelDialogVisible.value = true
}

async function handleCopyBase() {
  const ok = await copyText(baseUrl.value)
  message[ok ? 'success' : 'warning'](ok ? '后端地址已复制' : '复制失败')
}

function backToList() {
  void router.push({ name: 'projects' })
}

const contentRef = ref<HTMLElement>()

function resetContentScroll() {
  nextTick(() => contentRef.value?.scrollTo({ top: 0 }))
}

/** 切换接口时：调试/示例面板有按接口缓存的状态，回到文档页；快捷请求面板会自动重新同步 */
watch(
  () => docStore.activeApiId,
  () => {
    if (activeTab.value === 'debug' || activeTab.value === 'sample') activeTab.value = 'doc'
    resetContentScroll()
  }
)

/** 文档 / 调试 / 示例之间切换时回到顶部，避免沿用上一篇内容的滚动位置 */
watch(activeTab, () => resetContentScroll())
</script>

<template>
  <div class="doc-page">
    <!-- 顶栏 -->
    <header class="doc-header">
      <el-button link class="doc-header__back" @click="backToList">
        <el-icon><ArrowLeft /></el-icon>
        <span>项目列表</span>
      </el-button>

      <el-tooltip :content="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'" placement="bottom">
        <el-button link class="doc-header__toggle" @click="toggleSidebar">
          <el-icon><component :is="sidebarCollapsed ? 'Expand' : 'Fold'" /></el-icon>
        </el-button>
      </el-tooltip>

      <div class="doc-header__title">
        <h1>{{ project?.name ?? '接口文档' }}</h1>
        <button type="button" class="doc-header__url kd-mono" title="点击复制" @click="handleCopyBase">
          {{ baseUrl }}
        </button>
      </div>

      <div class="doc-header__actions">
        <!-- 接口搜索：搜索框从左侧边栏移动到这里，替换掉原先的「全局参数」按钮 -->
        <el-input
          v-model="docStore.apiKeyword"
          class="doc-header__search"
          placeholder="搜索接口名称 / 路径"
          clearable
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-tooltip content="刷新当前分组文档" placement="bottom">
          <el-button :loading="refreshing" circle @click="handleReloadGroup">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="重新探测分组" placement="bottom">
          <el-button :loading="refreshing" circle @click="handleRefreshAll">
            <el-icon><RefreshRight /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </header>

    <!-- 加载中 -->
    <div v-if="loaderText" class="doc-loading">
      <el-icon class="is-spin"><Loading /></el-icon>
      <p>{{ loaderText }}</p>
      <span class="doc-loading__hint">正在尝试 springdoc (v3/api-docs) 与 springfox (swagger-resources) 两种入口</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="docStore.error" class="doc-error">
      <el-result icon="error" title="文档加载失败" :sub-title="docStore.error">
        <template #extra>
          <div class="doc-error__actions">
            <el-button type="primary" @click="handleRefreshAll">重试</el-button>
            <el-button @click="backToList">返回项目列表</el-button>
          </div>
          <el-collapse v-if="docStore.logs.length" class="doc-error__logs">
            <el-collapse-item title="查看探测日志" name="logs">
              <pre class="kd-code doc-error__pre">{{ docStore.logs.join('\n') }}</pre>
            </el-collapse-item>
          </el-collapse>
        </template>
      </el-result>
    </div>

    <!-- 主内容 -->
    <div v-else class="doc-main">
      <DocSidebar
        :collapsed="sidebarCollapsed"
        @toggle-collapse="toggleSidebar"
        @open-global="globalDialogVisible = true"
      />

      <div class="doc-body">
        <div class="doc-view">
          <!-- 面包屑：点击模块 / 接口标签可定位并展开左侧列表中的对应位置 -->
          <DocBreadcrumb :project-name="project?.name ?? '接口文档'" />

          <!-- 接口标签栏：只存内存，刷新后仅保留当前访问的接口标签 -->
          <DocTabs />

          <main ref="contentRef" class="doc-content kd-scroll">
            <!-- 接口面板 -->
            <template v-if="docStore.activePanel === 'api'">
              <template v-if="detail">
                <div class="api-bar">
                  <div class="api-bar__left">
                    <MethodTag :method="detail.method" size="large" />
                    <span class="api-bar__path kd-mono">{{ detail.fullPath }}</span>
                    <span class="api-bar__summary">{{ detail.summary }}</span>
                  </div>

                  <el-tabs v-model="activeTab" class="api-tabs">
                    <el-tab-pane name="doc" label="文档" />
                    <el-tab-pane name="debug" label="调试" />
                    <el-tab-pane name="sample" label="示例" />
                  </el-tabs>
                </div>

                <div class="api-panel">
                  <DocumentTab
                    v-if="activeTab === 'doc'"
                    :detail="detail"
                    :global-params="globalParamStore.enabled"
                    :base-url="baseUrl"
                    :models="docStore.models"
                    @open-model="openModel"
                  />
                  <DebugTab
                    v-else-if="activeTab === 'debug'"
                    :detail="detail"
                    :global-params="globalParamStore.list"
                    :base-url="baseUrl"
                  />
                  <SampleTab
                    v-else
                    :detail="detail"
                    :base-url="baseUrl"
                    :models="docStore.models"
                    :global-params="globalParamStore.enabled"
                  />
                </div>
              </template>

              <EmptyState
                v-else
                icon="Document"
                title="请选择左侧的接口"
                description="从左侧接口列表中选择一个接口，即可查看文档、发起调试请求并生成示例代码。"
              />
            </template>

            <!-- 文档信息 -->
            <DocInfoPanel v-else-if="docStore.activePanel === 'info'" />

            <!-- 数据模型 -->
            <ModelsPanel v-else @open-model="openModel" />
          </main>
        </div>
      </div>
    </div>

    <GlobalParamDialog v-model="globalDialogVisible" />
    <ModelDialog
      v-model="modelDialogVisible"
      :model-name="modelDialogName"
      :models="docStore.models"
    />
  </div>
</template>

<style lang="scss" scoped>
.doc-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kd-bg);
  overflow: hidden;
}

.doc-header {
  display: flex;
  align-items: center;
  gap: 16px;
  height: $header-height;
  padding: 0 20px;
  border-bottom: 1px solid var(--kd-border);
  background: var(--kd-panel);
  flex-shrink: 0;
  z-index: $z-header;
}

.doc-header__back {
  flex-shrink: 0;
}

.doc-header__toggle {
  flex-shrink: 0;
  font-size: 17px;
}

.doc-header__title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;

  h1 {
    font-size: $font-lg;
    @include ellipsis(1);
    max-width: 40%;
  }
}

.doc-header__url {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: $font-xs;
  color: var(--kd-text-3);
  cursor: pointer;
  @include ellipsis(1);

  &:hover {
    color: var(--kd-primary);
  }
}

.doc-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.doc-loading,
.doc-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--kd-text-3);
}

.doc-loading {
  .el-icon {
    font-size: 32px;
    color: var(--kd-primary);
  }

  p {
    font-size: $font-md;
    color: var(--kd-text-2);
  }
}

.doc-loading__hint {
  font-size: $font-xs;
}

.is-spin {
  animation: kd-spin 0.9s linear infinite;
}

@keyframes kd-spin {
  to {
    transform: rotate(360deg);
  }
}

.doc-error {
  padding: 24px;

  :deep(.el-result) {
    width: 100%;
    max-width: 720px;
  }

  :deep(.el-result__subtitle) {
    font-size: $font-sm;
    white-space: pre-wrap;
    text-align: left;
    max-width: 680px;
  }
}

.doc-error__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.doc-error__logs {
  margin-top: 20px;
  text-align: left;
}

.doc-error__pre {
  max-height: 260px;
  font-size: 12px;
  white-space: pre-wrap;
}

.doc-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

.doc-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.doc-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 18px 24px 40px;
}

/* 文档视图 */
.doc-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.api-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-radius: $radius-md;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  margin-bottom: 16px;
  position: sticky;
  top: -18px;
  z-index: 10;
}

.api-bar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.api-bar__path {
  font-size: $font-md;
  font-weight: 600;
  color: var(--kd-text);
  @include ellipsis(1);
}

.api-bar__summary {
  font-size: $font-sm;
  color: var(--kd-text-3);
  @include ellipsis(1);
  max-width: 260px;
}

.api-tabs {
  flex-shrink: 0;

  :deep(.el-tabs__header) {
    margin: 0;
  }

  :deep(.el-tabs__nav-wrap::after) {
    display: none;
  }

  :deep(.el-tabs__item) {
    height: 32px;
    line-height: 32px;
    font-size: $font-sm;
  }
}

.api-panel {
  min-height: 0;
}

@include respond-to($bp-lg) {
  .api-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .api-tabs {
    width: 100%;
  }
}

@include respond-to($bp-md) {
  .doc-content {
    padding: 14px 16px 32px;
  }

  .doc-header {
    height: auto;
    padding: 10px 14px;
    flex-wrap: wrap;
  }

  .doc-header__title h1 {
    max-width: 100%;
  }

  .doc-header__search {
    width: 170px;
  }
}
</style>
