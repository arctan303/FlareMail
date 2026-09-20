<template>
  <div class="main-box-hide">
    <router-view class="main-view" v-slot="{ Component, route }">
      <transition name="page-fade-slide" mode="out-in">
        <keep-alive :include="['email','send','sys-setting','star','user','draft']">
          <component :is="Component" :key="route.name"/>
        </keep-alive>
      </transition>
    </router-view>
  </div>
</template>
<style lang="scss" scoped>
.main-box-hide{display:grid;grid-template-columns:minmax(0,1fr);flex:1;height:100%;min-width:0;overflow:hidden;background:var(--paper);}
.main-view {
  background: var(--paper);
  height: 100%;
  overflow: hidden;
}

.navigation {
  height: 30px;
  border-bottom: solid 1px var(--el-menu-border-color);
  display: inline-flex;
  justify-items: center;
  align-items: center;
  width: 100%;
  .tag {
    background: var(--paper);
    margin-left: 5px;
  }
}
</style>
