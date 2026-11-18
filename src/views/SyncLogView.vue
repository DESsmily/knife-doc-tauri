<script setup lang="ts">
/**
 * 同步日志页
 *
 * 目前展示两组信息：
 *  - 本次会话的探测日志：来自 docStore.logs，记录打开项目时的入口探测过程；
 *  - 服务同步记录：来自项目 store 的 meta，展示每个服务最近一次同步的规模与时间。
 *
 * 说明：当前版本只在内存中保留「本次会话」的日志，完整的历史同步记录需要落盘保存，
 * 属于后续迭代内容；因此本页在信息缺失时给出明确的空状态而不是伪造数据。
 */

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import EmptyState from '@/components/common/EmptyState.vue'
import { copyText } from '@/core/http'
import { message } from '@/core/message'
import { formatTime, fromNow } from '@/core/utils'
import { useDocStore } from '@/stores/doc'
import { useProjectStore } from '@/stores/project'

const router = useRouter()
const docStore = useDocStore()
const projectStore = useProjectStore()

/** 当前项目名，用于标注日志来源 */
const currentProjectName = computed(
  () => projectStore.projects.find((item) => item.id === docStore.projectId)?.name ?? ''
)

const logs = computed(() => docStore.logs)

const copying = ref(false)

async function copyLogs() {
  if (logs.value.length === 0) return
  copying.value = true
  try {
    const ok = await copyText(logs.value.join('\n'))
    message[ok ? 'success' : 'warning'](ok ? '日志已复制到剪贴板' : '复制失败')
  } finally {
    copying.value = false
  }
}

/** 服务同步记录：按最近同步时间倒序，未同步的排在最后 */
const syncRecords = computed(() =>
  [...projectStore.projects].sort((a, b) => (b.meta?.lastSyncAt ?? 0) - (a.meta?.lastSyncAt ?? 0))
)

function openProject(id: string) {
  void router.push({ name: 'doc', params: { projectId: id } })
}
</script>

<template>
  <div class="log-page">
    <!-- 页头 -->
    <header class="log-page__header">
      <div class="log-page__titles">
        <h1>同步日志</h1>
        <p>记录接口文档的探测与同步过程，便于定位「文档打不开 / 分组缺失」这类问题。</p>
      </div>

      <button
        type="button"
        class="ghost-btn"
        :disabled="logs.length === 0 || copying"
        @click="copyLogs"
      >
        <el-icon><CopyDocument /></el-icon>
        <span>复制会话日志</span>
      </button>
    </header>

    <main class="log-page__body kd-scroll">
      <!-- 本次会话的探测日志 -->
      <section class="log-card">
        <div class="log-card__head">
          <h2>本次会话的探测日志</h2>
          <span class="log-card__meta">
            <template v-if="currentProjectName">{{ currentProjectName }} · </template>
            {{ logs.length }} 条
          </span>
        </div>

        <pre v-if="logs.length" class="kd-code log-card__pre">{{ logs.join('\n') }}</pre>

        <EmptyState
          v-else
          icon="Clock"
          title="本次会话还没有探测记录"
          description="打开任意项目的接口文档后，这里会记录 springdoc / springfox 入口的探测过程与结果。"
        />
      </section>

      <!-- 服务同步记录 -->
      <section class="log-card">
        <div class="log-card__head">
          <h2>服务同步记录</h2>
          <span class="log-card__meta">{{ syncRecords.length }} 个服务</span>
        </div>

        <div v-if="syncRecords.length" class="record-list">
          <button
            v-for="item in syncRecords"
            :key="item.id"
            type="button"
            class="record"
            @click="openProject(item.id)"
          >
            <span class="record__avatar" :style="{ '--card-color': item.color, background: item.color + '29' }">
              {{ item.name.slice(0, 1).toUpperCase() }}
            </span>

            <span class="record__name">{{ item.name }}</span>
            <span class="record__url kd-mono">{{ item.baseUrl }}</span>

            <span class="record__scale" :class="{ 'is-pending': !item.meta?.lastSyncAt }">
              <template v-if="item.meta?.lastSyncAt">
                {{ item.meta.apiCount ?? 0 }} 接口 · {{ item.meta.groupCount ?? 0 }} 分组
              </template>
              <template v-else><i class="record__dot" />尚未同步</template>
            </span>

            <span class="record__time">
              <template v-if="item.meta?.lastSyncAt">
                {{ fromNow(item.meta.lastSyncAt) }}
                <em>{{ formatTime(item.meta.lastSyncAt) }}</em>
              </template>
              <template v-else>—</template>
            </span>
          </button>
        </div>

        <EmptyState
          v-else
          icon="Files"
          title="还没有可同步的服务"
          description="先在「项目管理」中添加一个后端服务地址，同步后即可在此查看记录。"
        />
      </section>

      <p class="log-page__note">
        历史同步记录（跨会话保留）将在后续版本落盘保存；当前仅展示本次会话的内存日志与各服务的最近同步快照。
      </p>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.log-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kd-bg);
  overflow: hidden;
}

.log-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}

.log-page__titles {
  min-width: 0;

  h1 {
    font-size: $font-lg;
  }

  p {
    margin-top: 2px;
    font-size: $font-xs;
    color: var(--kd-text-3);
  }
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--kd-border);
  background: var(--kd-panel);
  color: var(--kd-text-2);
  font-size: $font-xs;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.16s ease, color 0.16s ease;

  &:hover:not(:disabled) {
    border-color: var(--kd-primary);
    color: var(--kd-primary);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
}

.log-page__body {
  flex: 1;
  min-height: 0;
  padding: 0 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.log-card {
  @include card;
  padding: 16px 18px 18px;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;

    h2 {
      font-size: $font-md;
    }
  }

  &__meta {
    font-size: $font-xs;
    color: var(--kd-text-3);
  }

  &__pre {
    max-height: 320px;
    font-size: $font-xs;
    white-space: pre-wrap;
    word-break: break-all;
  }
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.record {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--kd-border);
  border-radius: $radius-md;
  background: var(--kd-panel-2);
  color: var(--kd-text);
  font-size: $font-sm;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;

  &:hover {
    border-color: var(--kd-primary);
    background: var(--kd-primary-soft);
  }
}

.record__avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--card-color, var(--kd-primary));
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}

.record__name {
  width: 180px;
  flex-shrink: 0;
  font-weight: 600;
  @include ellipsis(1);
}

.record__url {
  flex: 1;
  min-width: 0;
  font-size: $font-xs;
  color: var(--kd-primary);
  @include ellipsis(1);
}

.record__scale {
  width: 190px;
  flex-shrink: 0;
  font-size: $font-xs;
  color: var(--kd-text-2);

  &.is-pending {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--kd-warning);
  }
}

.record__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kd-warning);
}

.record__time {
  width: 190px;
  flex-shrink: 0;
  font-size: $font-xs;
  color: var(--kd-text-3);

  em {
    margin-left: 6px;
    font-style: normal;
    color: var(--kd-text-3);
    opacity: 0.75;
  }
}

.log-page__note {
  font-size: $font-xs;
  color: var(--kd-text-3);
  line-height: 1.7;
}

@include respond-to($bp-md) {
  .log-page__header {
    padding: 14px 14px 10px;
  }

  .log-page__body {
    padding: 0 14px 24px;
  }

  .record__url,
  .record__time {
    display: none;
  }

  .record__scale {
    width: auto;
  }
}
</style>
