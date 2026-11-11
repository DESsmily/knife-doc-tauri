<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'

import MethodTag from '@/components/common/MethodTag.vue'
import type { ApiSummary, DocGroup } from '@/core/types'
import { useDocStore } from '@/stores/doc'
import { useGlobalParamStore } from '@/stores/globalParam'

const emit = defineEmits<{
  (e: 'open-global'): void
}>()

const docStore = useDocStore()
const globalParamStore = useGlobalParamStore()

/* ------------------------------ 分组切换 -------------------------------- */

const groupValue = computed({
  get: () => docStore.currentGroupId,
  set: (value: string) => {
    if (value && value !== docStore.currentGroupId) void docStore.selectGroup(value)
  }
})

function groupLabel(group: DocGroup): string {
  const suffix = group.apiCount ? `（${group.apiCount}）` : ''
  return `${group.name}${suffix}`
}

/* ------------------------------ 搜索 ---------------------------------- */

/** 搜索框已移到页面顶栏，这里只读取 Store 里的关键字 */
const keyword = computed(() => docStore.apiKeyword)

const searching = computed(() => keyword.value.trim().length > 0)

const filteredTags = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const tags = docStore.tagGroups
  if (!kw) return tags
  return tags
    .map((tag) => ({
      ...tag,
      apis: tag.apis.filter(
        (api) =>
          api.summary.toLowerCase().includes(kw) ||
          api.path.toLowerCase().includes(kw) ||
          api.method.toLowerCase().includes(kw) ||
          api.operationId.toLowerCase().includes(kw)
      )
    }))
    .filter((tag) => tag.apis.length > 0)
})

const matchCount = computed(() => filteredTags.value.reduce((sum, tag) => sum + tag.apis.length, 0))

/* ------------------------------ 折叠状态 -------------------------------- */

/**
 * 模块展开状态：未记录的模块一律视为收缩，只有显式写入 `false` 才表示展开，
 * 因此默认就是「全部收缩」。各模块状态互相独立，可同时展开多个，
 * 不使用手风琴式的互斥展开。
 */
const collapsed = reactive<Record<string, boolean>>({})

function isCollapsed(name: string): boolean {
  return collapsed[name] !== false
}

function toggleTag(name: string) {
  collapsed[name] = !isCollapsed(name)
}

function expandTag(name: string) {
  collapsed[name] = false
}

/** 切换分组后回到默认收缩状态 */
watch(
  () => docStore.currentGroupId,
  () => {
    for (const key of Object.keys(collapsed)) delete collapsed[key]
  }
)

/** 有搜索词时自动展开全部，清空搜索后回到默认收缩 */
watch(keyword, (value) => {
  const expand = value.trim().length > 0
  for (const tag of docStore.tagGroups) collapsed[tag.name] = !expand
})

/* ------------------------------ 列表定位 -------------------------------- */

const listRef = ref<HTMLElement | null>(null)

/**
 * 展开目标所在模块，并把列表滚动到该模块 / 接口的位置。
 * target 形如 `tag:用户管理` 或 `api:<apiId>`。
 */
function reveal(target: string) {
  const index = target.indexOf(':')
  const kind = target.slice(0, index)
  const key = target.slice(index + 1)
  if (!key) return

  if (kind === 'tag') {
    expandTag(key)
  } else if (kind === 'api') {
    const api = docStore.apiMap.get(key)
    if (api) expandTag(api.tag)
  }

  // 展开是下一帧才渲染出来的，等 DOM 更新后再滚动
  void nextTick(() => {
    const host = listRef.value
    if (!host) return
    const el = host.querySelector<HTMLElement>(`[data-reveal="${CSS.escape(target)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

watch(
  () => docStore.revealRequest,
  (request) => {
    if (request) reveal(request.target)
  }
)

/* ------------------------------ 选中逻辑 -------------------------------- */

function isActive(api: ApiSummary): boolean {
  return docStore.activeApiId === api.id && docStore.activePanel === 'api'
}

function selectApi(api: ApiSummary) {
  docStore.setActiveApi(api.id)
}

function selectPanel(panel: 'info' | 'models') {
  docStore.setPanel(panel)
}

const enabledGlobalCount = computed(() => globalParamStore.enabledCount)
const totalGlobalCount = computed(() => globalParamStore.list.length)
</script>

<template>
  <aside class="doc-sidebar">
    <!-- 分组选择 -->
    <div class="doc-sidebar__group">
      <el-select
        v-model="groupValue"
        class="group-select"
        placeholder="选择分组"
        :disabled="docStore.groups.length === 0"
        :loading="docStore.discovering"
      >
        <el-option
          v-for="group in docStore.groups"
          :key="group.id"
          :label="groupLabel(group)"
          :value="group.id"
        >
          <div class="group-option">
            <span class="group-option__name">{{ group.name }}</span>
            <span class="group-option__meta">
              <span v-if="group.loaded">{{ group.apiCount }} 个接口</span>
              <span v-else>未加载</span>
            </span>
          </div>
        </el-option>
      </el-select>
    </div>

    <!-- 固定入口 -->
    <div class="doc-sidebar__fixed">
      <button
        type="button"
        class="fixed-item"
        :class="{ 'is-active': docStore.activePanel === 'info' }"
        @click="selectPanel('info')"
      >
        <el-icon><Document /></el-icon>
        <span>文档信息</span>
      </button>
      <button
        type="button"
        class="fixed-item"
        :class="{ 'is-active': docStore.activePanel === 'models' }"
        @click="selectPanel('models')"
      >
        <el-icon><Grid /></el-icon>
        <span>数据模型</span>
        <em v-if="docStore.models.length" class="fixed-item__count">{{ docStore.models.length }}</em>
      </button>
      <button type="button" class="fixed-item" @click="emit('open-global')">
        <el-icon><Setting /></el-icon>
        <span>全局参数</span>
        <em v-if="totalGlobalCount" class="fixed-item__count is-primary">
          {{ enabledGlobalCount }}/{{ totalGlobalCount }}
        </em>
      </button>
    </div>

    <!-- 接口列表（搜索框已移动到页面顶栏） -->
    <div ref="listRef" class="doc-sidebar__list kd-scroll">
      <div v-if="docStore.parsing" class="list-loading">
        <el-skeleton :rows="6" animated />
      </div>

      <template v-else-if="filteredTags.length > 0">
        <div
          v-for="tag in filteredTags"
          :key="tag.name"
          class="tag-block"
          :data-reveal="`tag:${tag.name}`"
        >
          <button type="button" class="tag-head" @click="toggleTag(tag.name)">
            <el-icon class="tag-head__arrow" :class="{ 'is-collapsed': isCollapsed(tag.name) }">
              <CaretBottom />
            </el-icon>
            <span class="tag-head__name">{{ tag.name }}</span>
            <span class="tag-head__count">{{ tag.apis.length }}</span>
          </button>

          <div v-show="!isCollapsed(tag.name)" class="tag-apis">
            <button
              v-for="api in tag.apis"
              :key="api.id"
              type="button"
              class="api-item"
              :class="{ 'is-active': isActive(api), 'is-deprecated': api.deprecated }"
              :data-reveal="`api:${api.id}`"
              :title="`${api.method} ${api.fullPath}`"
              @click="selectApi(api)"
            >
              <MethodTag :method="api.method" size="small" />
              <span class="api-item__name">{{ api.summary }}</span>
            </button>
          </div>
        </div>
      </template>

      <div v-else-if="searching" class="list-empty">
        <p>没有匹配「{{ keyword }}」的接口</p>
        <span v-if="matchCount === 0" class="list-empty__hint">共 {{ docStore.apiCount }} 个接口</span>
      </div>

      <div v-else class="list-empty">
        <p>当前分组暂无接口</p>
      </div>
    </div>

    <!-- 底部统计 -->
    <div class="doc-sidebar__footer">
      <span>{{ docStore.apiCount }} 个接口</span>
      <span class="dot-sep">·</span>
      <span>{{ docStore.tagGroups.length }} 个模块</span>
      <template v-if="docStore.parser">
        <span class="dot-sep">·</span>
        <span>{{ docStore.parser.specKind === 'swagger2' ? 'Swagger 2.0' : 'OpenAPI 3' }}</span>
      </template>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.doc-sidebar {
  display: flex;
  flex-direction: column;
  width: $sidebar-width;
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  background: var(--kd-panel);
  border-right: 1px solid var(--kd-border);
}

.doc-sidebar__group {
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--kd-border);
}

.group-select {
  width: 100%;
}

.group-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.group-option__name {
  @include ellipsis(1);
}

.group-option__meta {
  font-size: 11px;
  color: var(--kd-text-3);
  flex-shrink: 0;
}

.doc-sidebar__fixed {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-bottom: 1px solid var(--kd-border);
}

.fixed-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: $radius-md;
  background: transparent;
  color: var(--kd-text-2);
  font-size: $font-sm;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    background: var(--kd-panel-3);
    color: var(--kd-text);
  }

  &.is-active {
    background: var(--kd-primary-soft);
    color: var(--kd-primary);
    font-weight: 600;
  }
}

.fixed-item__count {
  margin-left: auto;
  font-size: 11px;
  font-style: normal;
  padding: 0 6px;
  height: 17px;
  line-height: 17px;
  border-radius: 999px;
  background: var(--kd-panel-3);
  color: var(--kd-text-3);

  &.is-primary {
    background: var(--kd-primary-soft);
    color: var(--kd-primary);
  }
}

.doc-sidebar__list {
  flex: 1;
  min-height: 0;
  padding: 6px 8px 12px;
}

.tag-block {
  margin-bottom: 2px;
}

.tag-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  background: transparent;
  color: var(--kd-text-2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-radius: $radius-sm;

  &:hover {
    background: var(--kd-panel-2);
  }
}

.tag-head__arrow {
  font-size: 11px;
  color: var(--kd-text-3);
  transition: transform 0.16s ease;

  &.is-collapsed {
    transform: rotate(-90deg);
  }
}

.tag-head__name {
  flex: 1;
  min-width: 0;
  text-align: left;
  @include ellipsis(1);
}

.tag-head__count {
  font-size: 11px;
  font-weight: 500;
  color: var(--kd-text-3);
  background: var(--kd-panel-3);
  padding: 0 6px;
  border-radius: 999px;
}

.tag-apis {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0 4px;
}

.api-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px 6px 18px;
  border: 0;
  border-radius: $radius-md;
  background: transparent;
  color: var(--kd-text-2);
  font-size: $font-sm;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    background: var(--kd-panel-2);
    color: var(--kd-text);
  }

  &.is-active {
    background: var(--kd-primary-soft);
    color: var(--kd-primary);

    .api-item__name {
      font-weight: 600;
    }
  }

  &.is-deprecated .api-item__name {
    text-decoration: line-through;
    color: var(--kd-text-3);
  }
}

.api-item__name {
  flex: 1;
  min-width: 0;
  @include ellipsis(1);
}

.list-loading {
  padding: 8px 12px;
}

.list-empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--kd-text-3);
  font-size: $font-sm;

  p {
    margin-bottom: 4px;
  }
}

.list-empty__hint {
  font-size: $font-xs;
  color: var(--kd-text-3);
}

.doc-sidebar__footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-top: 1px solid var(--kd-border);
  font-size: $font-xs;
  color: var(--kd-text-3);
  background: var(--kd-panel-2);
}

.dot-sep {
  opacity: 0.6;
}

@include respond-to($bp-md) {
  .doc-sidebar {
    width: 260px;
  }
}
</style>
