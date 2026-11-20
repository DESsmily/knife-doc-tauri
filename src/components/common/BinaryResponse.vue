<script setup lang="ts">
/**
 * 二进制响应占位卡。
 *
 * 响应是文件（图片 / 压缩包 / 音视频 / Office ...）时不渲染任何内容，
 * 只展示文件名、类型与大小，并提供「下载文件」按钮走原生另存为对话框。
 * 直接把字节流塞进代码高亮会卡死界面，因此这里有意不做预览。
 */

import { computed, ref } from 'vue'
import { message } from '@/core/message'

import { binaryFileName, saveBinaryFile, type DebugResponseResult } from '@/core/http'
import { formatBytes } from '@/core/utils'

const props = withDefaults(
  defineProps<{
    response: DebugResponseResult
    /** Content-Disposition / URL 都没给出文件名时的兜底名 */
    downloadName?: string
  }>(),
  { downloadName: 'download' }
)

const saving = ref(false)

const fileName = computed(() => binaryFileName(props.response, props.downloadName))

const contentType = computed(() => {
  const headers = props.response.headers ?? {}
  const key = Object.keys(headers).find((item) => item.toLowerCase() === 'content-type')
  return (key ? headers[key] : '') || '未知类型'
})

const sizeLabel = computed(() => formatBytes(props.response.size))

async function download() {
  if (saving.value) return
  saving.value = true
  try {
    const path = await saveBinaryFile(fileName.value, props.response.bodyBytes)
    if (path) message.success(`已保存到 ${path}`)
  } catch (error) {
    message.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    saving.value = false
  }
}

defineExpose({ download })
</script>

<template>
  <div class="binary-response">
    <el-icon class="binary-response__icon"><Document /></el-icon>
    <div class="binary-response__main">
      <div class="binary-response__name kd-mono" :title="fileName">{{ fileName }}</div>
      <div class="binary-response__meta">
        <span>{{ sizeLabel }}</span>
        <span class="binary-response__dot">·</span>
        <span class="kd-mono binary-response__type" :title="contentType">{{ contentType }}</span>
      </div>
      <p class="binary-response__hint">二进制响应不做渲染（避免大文件卡死界面），可直接下载到本地查看。</p>
    </div>
    <el-button type="primary" :loading="saving" class="binary-response__btn" @click="download">
      <el-icon v-if="!saving"><Download /></el-icon>
      <span>{{ saving ? '保存中' : '下载文件' }}</span>
    </el-button>
  </div>
</template>

<style lang="scss" scoped>
.binary-response {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border: 1px dashed var(--kd-border-strong);
  border-radius: $radius-md;
  background: var(--kd-panel-2);

  &__icon {
    flex: none;
    font-size: 30px;
    color: var(--kd-primary);
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__name {
    font-size: $font-sm;
    font-weight: 600;
    color: var(--kd-text);
    @include ellipsis(1);
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }

  &__type {
    max-width: 320px;
    @include ellipsis(1);
  }

  &__dot {
    color: var(--kd-border-strong);
  }

  &__hint {
    margin: 6px 0 0;
    font-size: $font-xs;
    line-height: 1.6;
    color: var(--kd-text-3);
  }

  &__btn {
    flex: none;
  }
}
</style>
