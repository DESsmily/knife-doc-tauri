<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'

import EmptyState from '@/components/common/EmptyState.vue'
import TopNav from '@/components/common/TopNav.vue'
import { copyText, probe } from '@/core/http'
import type { DocProject } from '@/core/types'
import { fromNow, normalizeBaseUrl } from '@/core/utils'
import { useTheme } from '@/composables/useTheme'
import { useAppStore } from '@/stores/app'
import { useProjectStore, type ProjectInput } from '@/stores/project'

const router = useRouter()
const projectStore = useProjectStore()
const appStore = useAppStore()
const { isDark, toggleTheme } = useTheme()

/* ------------------------------ 列表与搜索 ------------------------------ */

const keyword = ref('')

const filteredProjects = computed<DocProject[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = projectStore.sorted
  if (!kw) return list
  return list.filter(
    (item) =>
      item.name.toLowerCase().includes(kw) ||
      item.baseUrl.toLowerCase().includes(kw) ||
      (item.description ?? '').toLowerCase().includes(kw)
  )
})

/* ------------------------------ 新增 / 编辑 ----------------------------- */

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref('')
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  name: '',
  baseUrl: '',
  description: ''
})

const rules = computed<FormRules>(() => ({
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { max: 40, message: '项目名称不能超过 40 个字符', trigger: 'blur' }
  ],
  baseUrl: [
    { required: true, message: '请输入后端地址', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) => {
        const normalized = normalizeBaseUrl(value)
        if (!/^https?:\/\/.+/i.test(normalized)) {
          callback(new Error('地址需以 http:// 或 https:// 开头'))
          return
        }
        const duplicated = projectStore.projects.some(
          (item) => item.id !== editingId.value && item.baseUrl === normalized
        )
        if (duplicated) {
          callback(new Error('该地址已存在，请勿重复添加'))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ]
}))

function openCreate() {
  dialogMode.value = 'create'
  editingId.value = ''
  form.name = ''
  form.baseUrl = ''
  form.description = ''
  dialogVisible.value = true
  void nextTick(() => formRef.value?.clearValidate())
}

function openEdit(project: DocProject) {
  dialogMode.value = 'edit'
  editingId.value = project.id
  form.name = project.name
  form.baseUrl = project.baseUrl
  form.description = project.description ?? ''
  dialogVisible.value = true
  void nextTick(() => formRef.value?.clearValidate())
}

async function handleSubmit() {
  const instance = formRef.value
  if (!instance) return
  const valid = await instance.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const payload: ProjectInput = {
      name: form.name,
      baseUrl: form.baseUrl,
      description: form.description
    }
    if (dialogMode.value === 'create') {
      const created = projectStore.add(payload)
      ElMessage.success('项目已添加')
      dialogVisible.value = false
      // 直接进入新项目，省去用户再点一次
      void router.push({ name: 'doc', params: { projectId: created.id } })
    } else {
      projectStore.update(editingId.value, payload)
      ElMessage.success('项目已更新')
      dialogVisible.value = false
    }
  } finally {
    submitting.value = false
  }
}

/* ------------------------------ 删除 ---------------------------------- */

async function handleRemove(project: DocProject) {
  try {
    await ElMessageBox.confirm(
      `确定要删除项目「${project.name}」吗？该操作只会移除本地的地址记录，不会影响后端服务。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  projectStore.remove(project.id)
  ElMessage.success('已删除')
}

/* ------------------------------ 打开 / 探测 ---------------------------- */

function openProject(project: DocProject) {
  projectStore.setCurrent(project.id)
  void router.push({ name: 'doc', params: { projectId: project.id } })
}

/** 记录中的接口数量等信息 */
function metaText(project: DocProject): string {
  const meta = project.meta
  if (!meta || (!meta.apiCount && !meta.groupCount)) return '尚未同步文档'
  const parts: string[] = []
  if (meta.apiCount) parts.push(`${meta.apiCount} 个接口`)
  if (meta.groupCount && meta.groupCount > 1) parts.push(`${meta.groupCount} 个分组`)
  if (meta.specVersion) parts.push(meta.specVersion.startsWith('2') ? 'Swagger 2.0' : `OpenAPI ${meta.specVersion}`)
  return parts.join(' · ') || '尚未同步文档'
}

/** 地址可用性探测缓存 */
const statusMap = reactive<Record<string, 'idle' | 'checking' | 'ok' | 'fail'>>({})

async function checkStatus(project: DocProject) {
  statusMap[project.id] = 'checking'
  const ok = await probe(`${project.baseUrl}/v3/api-docs/swagger-config`, 5000)
  if (ok) {
    statusMap[project.id] = 'ok'
    return
  }
  const ok2 = await probe(`${project.baseUrl}/swagger-resources`, 5000)
  if (ok2) {
    statusMap[project.id] = 'ok'
    return
  }
  const ok3 = await probe(`${project.baseUrl}/v2/api-docs`, 5000)
  statusMap[project.id] = ok3 ? 'ok' : 'fail'
}

async function checkAll() {
  await Promise.all(projectStore.projects.map((item) => checkStatus(item)))
}

async function handleCopyUrl(project: DocProject) {
  const ok = await copyText(project.baseUrl)
  ElMessage[ok ? 'success' : 'warning'](ok ? '地址已复制' : '复制失败')
}

onMounted(() => {
  projectStore.init()
  if (projectStore.projects.length > 0) void checkAll()
})
</script>

<template>
  <div class="project-page">
    <header class="project-page__header">
      <div class="project-page__brand">
        <div class="brand-logo">KD</div>
        <div class="brand-text">
          <h1>Knife Doc</h1>
          <p>Swagger / OpenAPI 接口文档聚合、调试与快捷请求</p>
        </div>
      </div>

      <div class="project-page__actions">
        <TopNav />

        <el-input
          v-model="keyword"
          class="search-input"
          placeholder="搜索项目名称或地址"
          clearable
          size="default"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-tooltip :content="isDark ? '切换到亮色' : '切换到暗色'" placement="bottom">
          <el-button circle @click="toggleTheme">
            <el-icon><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
          </el-button>
        </el-tooltip>

        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          <span>新增项目</span>
        </el-button>
      </div>
    </header>

    <main class="project-page__body kd-scroll">
      <div class="project-page__summary">
        <span>共 {{ projectStore.count }} 个项目</span>
        <span v-if="projectStore.projects.length" class="project-page__hint">
          {{
            appStore.isDesktop
              ? `数据保存在 ${appStore.dataRootLabel} 的 data.json，不会上传到任何服务器`
              : '浏览器预览模式：数据暂存在 localStorage'
          }}
        </span>
      </div>

      <EmptyState
        v-if="projectStore.projects.length === 0"
        icon="Files"
        title="还没有任何项目"
        description="添加一个后端服务地址（例如 http://127.0.0.1:9999），系统会自动发现 springfox / springdoc 暴露的接口文档。"
      >
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          <span>新增第一个项目</span>
        </el-button>
      </EmptyState>

      <EmptyState
        v-else-if="filteredProjects.length === 0"
        icon="Search"
        title="没有匹配的项目"
        description="换个关键词试试"
      />

      <div v-else class="project-grid">
        <article
          v-for="project in filteredProjects"
          :key="project.id"
          class="project-card"
          :style="{ '--card-color': project.color }"
          @click="openProject(project)"
        >
          <div class="project-card__bar" />

          <div class="project-card__head">
            <div class="project-card__avatar" :style="{ background: project.color }">
              {{ project.name.slice(0, 1).toUpperCase() }}
            </div>
            <div class="project-card__title">
              <h3>{{ project.name }}</h3>
              <span class="project-card__time">最近访问：{{ fromNow(project.lastOpened) }}</span>
            </div>

            <span
              class="project-card__status"
              :class="`is-${statusMap[project.id] ?? 'idle'}`"
              @click.stop
            >
              <template v-if="statusMap[project.id] === 'checking'">
                <el-icon class="is-spin"><Loading /></el-icon>
                检测中
              </template>
              <template v-else-if="statusMap[project.id] === 'ok'">
                <i class="dot" />
                可访问
              </template>
              <template v-else-if="statusMap[project.id] === 'fail'">
                <i class="dot" />
                不可达
              </template>
              <template v-else>
                <i class="dot" />
                未检测
              </template>
            </span>
          </div>

          <div class="project-card__url kd-mono">{{ project.baseUrl }}</div>

          <p v-if="project.description" class="project-card__desc">{{ project.description }}</p>
          <p v-else class="project-card__desc is-placeholder">暂无备注</p>

          <div class="project-card__meta">
            <span class="project-card__meta-text">{{ metaText(project) }}</span>
          </div>

          <div class="project-card__footer" @click.stop>
            <el-button size="small" type="primary" plain @click="openProject(project)">
              <el-icon><Document /></el-icon>
              <span>查看文档</span>
            </el-button>
            <el-button-group>
              <el-tooltip content="检测连通性" placement="top">
                <el-button size="small" @click="checkStatus(project)">
                  <el-icon><Connection /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="复制地址" placement="top">
                <el-button size="small" @click="handleCopyUrl(project)">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="编辑" placement="top">
                <el-button size="small" @click="openEdit(project)">
                  <el-icon><EditPen /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button size="small" type="danger" plain @click="handleRemove(project)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </el-tooltip>
            </el-button-group>
          </div>
        </article>
      </div>
    </main>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增文档项目' : '编辑文档项目'"
      width="520px"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="88px"
        label-position="right"
        @submit.prevent
      >
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：用户中心服务" maxlength="40" show-word-limit />
        </el-form-item>

        <el-form-item label="后端地址" prop="baseUrl">
          <el-input v-model="form.baseUrl" placeholder="例如：http://127.0.0.1:9999" class="kd-mono" />
          <div class="form-tip">
            无需填写 <code>/v2/api-docs</code> 等路径，系统会自动探测；也可直接粘贴
            <code>doc.html</code> 地址。
          </div>
        </el-form-item>

        <el-form-item label="备注">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="120"
            show-word-limit
            placeholder="选填，例如：本地开发环境"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ dialogMode === 'create' ? '添加并打开' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.project-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kd-bg);
}

.project-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 28px;
  border-bottom: 1px solid var(--kd-border);
  background: var(--kd-panel);
  flex-wrap: wrap;
}

.project-page__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  width: 40px;
  height: 40px;
  border-radius: $radius-md;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--kd-primary), #8a5cf6);
  color: #fff;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.5px;
}

.brand-text {
  h1 {
    font-size: $font-lg;
    line-height: 1.3;
  }

  p {
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.project-page__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input {
  width: 240px;
}

.project-page__body {
  flex: 1;
  min-height: 0;
  padding: 20px 28px 40px;
}

.project-page__summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  font-size: $font-sm;
  color: var(--kd-text-2);
}

.project-page__hint {
  color: var(--kd-text-3);
  font-size: $font-xs;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.project-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: $radius-lg;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;

  &:hover {
    transform: translateY(-2px);
    border-color: var(--card-color);
    box-shadow: var(--kd-shadow-md);

    .project-card__bar {
      opacity: 1;
    }
  }
}

.project-card__bar {
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--card-color);
  opacity: 0.55;
  transition: opacity 0.16s ease;
}

.project-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.project-card__avatar {
  width: 36px;
  height: 36px;
  border-radius: $radius-md;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  flex-shrink: 0;
}

.project-card__title {
  flex: 1;
  min-width: 0;

  h3 {
    font-size: $font-md;
    @include ellipsis(1);
  }
}

.project-card__time {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.project-card__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--kd-panel-3);
  color: var(--kd-text-3);
  flex-shrink: 0;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--kd-text-3);
  }

  &.is-ok {
    background: var(--kd-success-soft);
    color: var(--kd-success);

    .dot {
      background: var(--kd-success);
    }
  }

  &.is-fail {
    background: var(--kd-danger-soft);
    color: var(--kd-danger);

    .dot {
      background: var(--kd-danger);
    }
  }

  &.is-checking {
    color: var(--kd-primary);
    background: var(--kd-primary-soft);
  }
}

.is-spin {
  animation: kd-spin 0.9s linear infinite;
}

@keyframes kd-spin {
  to {
    transform: rotate(360deg);
  }
}

.project-card__url {
  font-size: $font-xs;
  color: var(--kd-primary);
  padding: 5px 8px;
  border-radius: $radius-sm;
  background: var(--kd-panel-2);
  @include ellipsis(1);
}

.project-card__desc {
  font-size: $font-sm;
  color: var(--kd-text-2);
  min-height: 20px;
  @include ellipsis(2);

  &.is-placeholder {
    color: var(--kd-text-3);
  }
}

.project-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-card__meta-text {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.project-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px dashed var(--kd-border);
  margin-top: auto;
}

.form-tip {
  margin-top: 6px;
  font-size: $font-xs;
  color: var(--kd-text-3);
  line-height: 1.6;

  code {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--kd-panel-3);
    color: var(--kd-danger);
  }
}

@include respond-to($bp-sm) {
  .project-page__header {
    padding: 14px 16px;
  }

  .project-page__body {
    padding: 16px;
  }

  .search-input {
    width: 100%;
  }

  .project-page__actions {
    width: 100%;
  }
}
</style>
