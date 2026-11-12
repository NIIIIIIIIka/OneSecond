// 云开发调用封装
//
// 未配置环境 ID、或当前运行环境没有 wx.cloud 时，isEnabled() 返回 false，
// 页面会保持纯本地模式，不发起任何云调用。

const cloudConfig = (() => {
  // cloud.js 是本地配置（不提交）；未创建时保持纯本地模式
  try {
    return require("../config/cloud");
  } catch (e) {
    return { envId: "" };
  }
})();

function isEnabled() {
  return (
    Boolean(cloudConfig.envId) &&
    typeof wx !== "undefined" &&
    Boolean(wx.cloud)
  );
}

function callFunction(name, data) {
  if (!isEnabled()) {
    return Promise.reject(new Error("CLOUD_DISABLED"));
  }
  return Promise.resolve(
    wx.cloud.callFunction({ name, data: data || {} })
  ).then((res) => (res ? res.result : null));
}

module.exports = {
  isEnabled,
  submitScore(elapsed) {
    return callFunction("submitScore", { elapsed });
  },
  getMyScore() {
    return callFunction("getMyScore", {});
  },
  getRank() {
    return callFunction("getRank", {});
  },
  getMyRank() {
    return callFunction("getMyRank", {});
  },
};
