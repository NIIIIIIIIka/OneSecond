// app.js

// cloud.js 是本地配置（不提交）；新克隆仓库未创建时保持纯本地模式
let cloudConfig = { envId: "" };
try {
  cloudConfig = require("./config/cloud");
} catch (e) {
  // 未创建本地云环境配置
}

App({
  onLaunch() {
    // 只有配置了环境 ID 才初始化云开发；失败时静默保持本地模式
    if (cloudConfig.envId && wx.cloud) {
      try {
        wx.cloud.init({ env: cloudConfig.envId, traceUser: true });
      } catch (e) {
        // 初始化失败不影响本地挑战
      }
    }
  },
});
