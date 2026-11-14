<script setup lang="ts">
/**
 * 设置页：关闭行为、主题、默认超时，以及安装目录下的数据 / 缓存 / 临时文件管理。
 */

import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { formatBytes } from '@/core/utils'
import { useAppStore } from '@/stores/app'
import { useTheme } from '@/composables/useTheme'
import type { CloseBehavior, DirTarget, ThemeModeSetting } from '@/core/tauri'

const appStore = useAppStore()
const router = useRouter()
const { setTheme } = useTheme()

const busy = ref('')

onMounted(() => {
  void appStore.refreshUsage()
})

function backToHome() {
  void router.push({ name: 'projects' })
}

const CLOSE_OPTIONS: { value: CloseBehavior; label: string; hint: string }[] = [
  { value: 'minimizeToTray', label: '最小化到托盘', hint: '窗口隐藏，进程常驻，点托盘图标可立即恢复现场' },
  { value: 'quit', label: '退出应用程序', hint: '直接结束进程，下次启动重新加载文档' }
]

const THEME_OPTIONS: { value: ThemeModeSetting; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' }
]

const TIMEOUT_OPTIONS = [
  { label: '10 秒', value: 10000 },
  { label: '30 秒', value: 30000 },
  { label: '60 秒', value: 60000 },
  { label: '5 分钟', value: 300000 },
  { label: '不限制', value: 0 }
]

const SOURCE_LABEL: Record<string, string> = {
  install: '安装目录',
  appData: '系统应用数据目录',
  env: '环境变量指定'
}

const sourceLabel = computed(() => SOURCE_LABEL[appStore.info?.source ?? 'appData'])

const dataFiles = computed(() => {
  const usage = appStore.usage
  return [
    { name: 'data.json', desc: '项目、全局参数、快捷请求', size: usage.dataBytes },
    { name: 'cache/', desc: '文档 JSON 缓存', size: usage.cacheBytes },
    { name: 'temp/', desc: '临时导出文件', size: usage.tempBytes }
  ]
})

async function update(patch: Parameters<typeof appStore.saveSettings>[0], message = '设置已保存') {
  const ok = await appStore.saveSettings(patch)
  ElMessage[ok ? 'success' : 'error'](ok ? message : appStore.error || '保存失败')
}

async function changeTheme(value: ThemeModeSetting) {
  await update({ theme: value }, '主题已更新')
  setTheme(value)
}

async function openDir(target: DirTarget) {
  try {
    await appStore.openDir(target)
  } catch (error) {
    ElMessage.error(`打开目录失败：${String(error)}`)
  }
}

async function clear(target: 'cache' | 'temp') {
  const label = target === 'cache' ? '文档缓存' : '临时文件'
  try {
    await ElMessageBox.confirm(`将删除 ${label} 目录下的所有文件，业务数据不受影响。`, `清空${label}`, {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  busy.value = target
  try {
    const freed = await appStore.clearDir(target)
    ElMessage.success(`已清空${label}，释放 ${formatBytes(freed)}`)
  } catch (error) {
    ElMessage.error(`清空失败：${String(error)}`)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="setting-page">
    <header class="setting-page__header">
      <el-button link class="setting-page__back" @click="backToHome">
        <el-icon><ArrowLeft /></el-icon>
        <span>返回</span>
      </el-button>

      <div class="setting-page__brand">
        <div class="brand-text">
          <h1>设置</h1>
          <p>客户端行为、外观与本地数据</p>
        </div>
      </div>
    </header>

    <main class="setting-page__body kd-scroll">
      <div v-if="!appStore.isDesktop" class="notice">
        当前运行在浏览器预览模式：关闭行为与数据目录仅桌面客户端生效，设置暂存于 localStorage。
      </div>

      <section class="card">
        <h2 class="card__title">
          <el-icon><SwitchButton /></el-icon>
          <span>窗口与托盘</span>
        </h2>
        <div class="row">
          <span class="row__label">关闭主窗口</span>
          <el-radio-group
            :model-value="appStore.settings.closeBehavior"
            :disabled="!appStore.isDesktop"
            @update:model-value="(value: CloseBehavior) => update({ closeBehavior: value })"
          >
            <el-radio v-for="item in CLOSE_OPTIONS" :key="item.value" :value="item.value" class="radio-item">
              <span class="radio-item__label">{{ item.label }}</span>
              <span class="radio-item__hint">{{ item.hint }}</span>
            </el-radio>
          </el-radio-group>
        </div>
        <p class="card__foot">
          选择「最小化到托盘」后，可从屏幕右下角的 Knife Doc Tool 图标恢复窗口；右键图标选择「退出」才会真正结束进程。
        </p>
      </section>

      <section class="card">
        <h2 class="card__title">
          <el-icon><Brush /></el-icon>
          <span>外观与请求</span>
        </h2>
        <div class="row">
          <span class="row__label">界面主题</span>
          <el-radio-group
            :model-value="appStore.settings.theme"
            @update:model-value="(value: ThemeModeSetting) => changeTheme(value)"
          >
            <el-radio-button v-for="item in THEME_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="row">
          <span class="row__label">默认请求超时</span>
          <el-select
            :model-value="appStore.settings.requestTimeout"
            style="width: 150px"
            @update:model-value="(value: number) => update({ requestTimeout: value })"
          >
            <el-option v-for="item in TIMEOUT_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <span class="row__hint">文档调试与未单独设置超时的快捷请求使用它。</span>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">
          <el-icon><FolderOpened /></el-icon>
          <span>本地数据</span>
        </h2>

        <div class="row">
          <span class="row__label">数据目录</span>
          <code class="path kd-mono">{{ appStore.dataRootLabel }}</code>
          <el-tag size="small" :type="appStore.isDesktop ? (appStore.atInstallDir ? 'success' : 'warning') : 'info'" effect="plain">
            {{ appStore.isDesktop ? sourceLabel : '浏览器' }}
          </el-tag>
          <el-button v-if="appStore.isDesktop" link type="primary" size="small" @click="openDir('root')">
            <el-icon><FolderOpened /></el-icon>
            <span>打开</span>
          </el-button>
        </div>

        <el-alert
          v-if="appStore.isDesktop && !appStore.atInstallDir"
          type="warning"
          :closable="false"
          show-icon
          class="path-alert"
          :title="`安装目录不可写，已改用系统应用数据目录。候选位置：${appStore.info?.installCandidate ?? '未知'}`"
          description="通常是因为应用被装到了 Program Files 等需要管理员权限的目录；改用 per-user 安装即可把数据放回安装目录。"
        />

        <el-table :data="dataFiles" size="small" class="file-table">
          <el-table-column prop="name" label="文件 / 目录" width="180" class-name="kd-mono" />
          <el-table-column prop="desc" label="内容" />
          <el-table-column label="占用" width="110">
            <template #default="{ row }">{{ formatBytes(row.size) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="right">
            <template #default="{ row }">
              <template v-if="appStore.isDesktop && row.name !== 'data.json'">
                <el-button link size="small" @click="openDir(row.name === 'cache/' ? 'cache' : 'temp')">打开</el-button>
                <el-button
                  link
                  type="danger"
                  size="small"
                  :loading="busy === (row.name === 'cache/' ? 'cache' : 'temp')"
                  @click="clear(row.name === 'cache/' ? 'cache' : 'temp')"
                >
                  清空
                </el-button>
              </template>
              <span v-else class="kd-text-3">—</span>
            </template>
          </el-table-column>
        </el-table>

        <p class="card__foot">
          全部数据只存在本机：文档与调试请求经 Rust 进程转发，不经过任何第三方服务，也不上传到服务器。
        </p>
      </section>

      <section class="card">
        <h2 class="card__title">
          <el-icon><InfoFilled /></el-icon>
          <span>关于</span>
        </h2>
        <div class="about">
          <div class="about__item">
            <span>名称</span>
            <strong>{{ appStore.info?.productName ?? 'Knife Doc Tool' }}</strong>
          </div>
          <div class="about__item">
            <span>版本</span>
            <strong>{{ appStore.info?.version ?? '开发模式' }}</strong>
          </div>
          <div class="about__item">
            <span>运行环境</span>
            <strong>{{ appStore.isDesktop ? `桌面客户端 · ${appStore.info?.os}/${appStore.info?.arch}` : '浏览器预览' }}</strong>
          </div>
          <div class="about__item">
            <span>跨域处理</span>
            <strong>tauri-plugin-better-cors-fetch 透明转发</strong>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.setting-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kd-bg);

  &__header {
    display: flex;
    align-items: center;
    gap: 16px;
    height: $header-height;
    padding: 0 20px;
    background: var(--kd-panel);
    border-bottom: 1px solid var(--kd-border);
  }

  &__brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  &__back {
    flex-shrink: 0;
  }

  &__body {
    flex: 1;
    min-height: 0;
    padding: 18px 20px 40px;
  }
}

.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--kd-primary), #2f3aa8);
  border-radius: 9px;
}

.brand-text {
  h1 {
    margin: 0;
    font-size: $font-lg;
  }

  p {
    margin: 0;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.notice {
  padding: 10px 14px;
  margin-bottom: 14px;
  font-size: $font-sm;
  color: var(--kd-warning);
  background: rgba(255, 143, 31, 0.12);
  border-radius: $radius-md;
}

.card {
  max-width: 900px;
  padding: 16px 18px 18px;
  margin: 0 auto 16px;
  @include card;

  &__title {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 0 0 14px;
    font-size: $font-md;
    color: var(--kd-text);

    .el-icon {
      color: var(--kd-primary);
    }
  }

  &__foot {
    margin: 12px 0 0;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.radio-item {
  display: block;

  &__label {
    font-size: $font-md;
  }

  &__hint {
    display: block;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.radio-item + .radio-item {
  margin-top: 6px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 8px 0;

  &__label {
    min-width: 96px;
    font-size: $font-sm;
    color: var(--kd-text-2);
  }

  &__hint {
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.path {
  padding: 3px 8px;
  font-size: $font-xs;
  color: var(--kd-text);
  background: var(--kd-panel-3);
  border-radius: $radius-sm;
}

.path-alert {
  margin: 6px 0 12px;
}

.file-table {
  width: 100%;
}

.about {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 20px;

  &__item {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: $font-sm;

    span {
      color: var(--kd-text-3);
    }

    strong {
      color: var(--kd-text);
      font-weight: 600;
    }
  }
}
</style>
