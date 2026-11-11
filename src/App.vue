<script setup lang="ts">
// 数据与设置已在 main.ts 挂载前加载完成，这里只负责渲染路由。
</script>

<template>
  <router-view v-slot="{ Component }">
    <transition name="kd-fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
</template>

<style lang="scss" scoped>
.kd-fade-enter-active,
.kd-fade-leave-active {
  transition: opacity 0.18s ease;
}

.kd-fade-enter-from,
.kd-fade-leave-to {
  opacity: 0;
}
</style>
