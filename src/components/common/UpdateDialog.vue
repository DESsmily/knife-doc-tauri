<script setup lang="ts">
/**
 * 更新提示弹框
 *
 * 发现新版本时展示版本号、发布日期与更新说明（release notes），
 * 用户可选择「稍候更新」或「立即更新」；下载过程中的进度也在弹框内实时展示。
 *
 * 状态与逻辑都在 useUpdate 中（全应用单例），本组件只负责渲染与派发动作，
 * 因此启动自动检查与设置页手动检查共用同一个弹框实例（挂在 App.vue 上）。
 */

import { computed } from 'vue'

import MarkdownText from '@/components/common/MarkdownText.vue'
import { useUpdate } from '@/composables/useUpdate'

const { visible, info, phase, downloaded, total, errorText, close, install } = useUpdate()

/** 下载中且已知总大小时才展示确定进度，否则用不确定态动画 */
const indeterminate = computed(() => phase.value === 'downloading' && !total.value)

/** 下载进度百分比 */
const percentage = computed(() => {
  if (!total.value || total.value <= 0) return 0
  return Math.min(100, Math.round((downloaded.value / total.value) * 100))
})

const formatMB = (bytes: number) => (bytes / 1048576).toFixed(1)

/** 进度文案：已知总量展示 已下载 / 总量，否则只展示已下载 */
const sizeText = computed(() =>
  total.value && total.value > 0
    ? `${formatMB(downloaded.value)} / ${formatMB(total.value)} MB`
    : `${formatMB(downloaded.value)} MB`
)

const busy = computed(() => phase.value === 'downloading')

async function handleInstall() {
  await install()
}
</script>

<template>
  <el-dialog
    v-model="visible"
    width="520px"
    top="9vh"
    append-to-body
    class="update-dialog"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
  >
    <template #header>
      <div class="update-dialog__header">
        <span class="update-dialog__title">发现新版本</span>
        <el-tag v-if="info" type="success" size="small" effect="dark">v{{ info.version }}</el-tag>
      </div>
    </template>

    <div v-if="info" class="update-dialog__body">
      <div class="update-dialog__meta">
        <span>当前版本 v{{ info.currentVersion }}</span>
        <span v-if="info.date" class="update-dialog__date">发布于 {{ info.date }}</span>
      </div>

      <!-- 更新说明 -->
      <div class="update-dialog__notes kd-scroll">
        <p class="update-dialog__notes-label">更新内容</p>
        <MarkdownText v-if="info.body" :text="info.body" />
        <p v-else class="update-dialog__empty">本次更新未提供具体说明。</p>
      </div>

      <!-- 下载 / 安装进度 -->
      <div v-if="phase === 'downloading' || phase === 'installed'" class="update-dialog__progress">
        <el-progress
          :percentage="phase === 'installed' ? 100 : percentage"
          :status="phase === 'installed' ? 'success' : undefined"
          :indeterminate="indeterminate"
          :show-text="!indeterminate"
        />
        <p class="update-dialog__hint">
          <template v-if="phase === 'installed'">更新已下载并安装，重启应用后即可生效。</template>
          <template v-else>正在下载更新… {{ sizeText }}</template>
        </p>
      </div>

      <!-- 下载失败 -->
      <el-alert
        v-if="phase === 'error'"
        class="update-dialog__error"
        type="error"
        :closable="false"
        show-icon
        title="更新下载失败"
        :description="errorText || '请检查网络连接后重试。'"
      />
    </div>

    <template #footer>
      <div class="update-dialog__footer">
        <template v-if="phase === 'installed'">
          <el-button type="primary" @click="close">完成</el-button>
        </template>
        <template v-else>
          <el-button :disabled="busy" @click="close">
            {{ phase === 'error' ? '稍后再说' : '稍候更新' }}
          </el-button>
          <el-button type="primary" :loading="busy" @click="handleInstall">
            {{ phase === 'error' ? '重试更新' : '立即更新' }}
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.update-dialog__header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.update-dialog__title {
  font-size: $font-lg;
  font-weight: 600;
  color: var(--kd-text);
}

.update-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.update-dialog__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.update-dialog__notes {
  max-height: 42vh;
  padding: 12px 14px;
  border: 1px solid var(--kd-border);
  border-radius: $radius-md;
  background: var(--kd-panel-2);
}

.update-dialog__notes-label {
  margin: 0 0 8px;
  font-size: $font-sm;
  font-weight: 600;
  color: var(--kd-text-2);
}

.update-dialog__empty {
  margin: 0;
  font-size: $font-sm;
  color: var(--kd-text-3);
}

.update-dialog__progress {
  padding: 4px 2px 0;
}

.update-dialog__hint {
  margin: 10px 0 0;
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.update-dialog__error {
  margin: 0;
}

.update-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
