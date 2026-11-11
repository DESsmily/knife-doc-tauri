<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
  }>(),
  { title: '暂无数据', description: '', icon: 'Box' }
)
</script>

<template>
  <div class="empty-state">
    <el-icon class="empty-state__icon"><component :is="icon" /></el-icon>
    <div class="empty-state__title">{{ title }}</div>
    <div v-if="description" class="empty-state__desc">{{ description }}</div>
    <div v-if="$slots.default" class="empty-state__extra">
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 48px 24px;
  text-align: center;
  color: var(--kd-text-3);
}

.empty-state__icon {
  font-size: 40px;
  color: var(--kd-border-strong);
  margin-bottom: 4px;
}

.empty-state__title {
  font-size: $font-md;
  font-weight: 600;
  color: var(--kd-text-2);
}

.empty-state__desc {
  font-size: $font-sm;
  max-width: 420px;
  line-height: 1.7;
}

.empty-state__extra {
  margin-top: 12px;
}
</style>
