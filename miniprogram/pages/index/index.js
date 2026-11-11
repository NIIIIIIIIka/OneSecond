// pages/index/index.js
const { calcResult } = require("../../utils/score");

const BEST_KEY = "bestError";

Page({
  data: {
    status: "idle", // idle | running | result
    elapsed: 0,
    error: 0,
    durationText: "0.000",
    tier: "",
    fastSlowText: "",
    isNewBest: false,
    invalid: false,
    bestError: null,
    hasBest: false,
  },

  // 开始时间保存在实例字段中，setData 触发的重渲染不会重置它
  _startTime: 0,
  _settled: false,

  onLoad() {
    this.loadBest();
  },

  onHide() {
    // 挑战中切到后台或页面被隐藏：取消本局，避免产生异常成绩
    this.cancelRunning();
  },

  onUnload() {
    this.cancelRunning();
  },

  loadBest() {
    let best = null;
    try {
      const saved = wx.getStorageSync(BEST_KEY);
      if (saved !== "" && saved !== undefined && saved !== null) {
        const num = Number(saved);
        if (Number.isFinite(num)) {
          best = num;
        }
      }
    } catch (e) {
      // 读取失败时保持空状态，保证页面正常渲染
      best = null;
    }
    this.setData({ bestError: best, hasBest: best !== null });
  },

  onStart() {
    if (this.data.status !== "idle") return;
    // 立即记录开始时间，之前不做任何异步操作
    this._startTime = Date.now();
    this._settled = false;
    this.setData({ status: "running" });
  },

  onStop() {
    if (this.data.status !== "running" || this._settled) return;
    // 立即记录停止时间
    const elapsed = Date.now() - this._startTime;
    this._settled = true;

    const result = calcResult(elapsed, this.data.bestError);

    if (result.isNewBest) {
      try {
        wx.setStorageSync(BEST_KEY, result.error);
      } catch (e) {
        // 写入失败不影响本局，挑战仍可继续
      }
    }

    try {
      wx.vibrateShort({ type: "light", fail: () => {} });
    } catch (e) {
      // 震动失败静默处理
    }

    const bestError = result.isNewBest ? result.error : this.data.bestError;

    this.setData({
      status: "result",
      elapsed: result.elapsed,
      error: result.error,
      durationText: result.durationText,
      tier: result.tier,
      fastSlowText: result.fastSlowText,
      isNewBest: result.isNewBest,
      invalid: !result.valid,
      bestError,
      hasBest: bestError !== null,
    });
  },

  onRestart() {
    if (this.data.status !== "result") return;
    // “再来一次”直接进入挑战，重新记录开始时间
    this._startTime = Date.now();
    this._settled = false;
    this.setData({ status: "running" });
  },

  cancelRunning() {
    if (this.data.status !== "running") return;
    this.setData({ status: "idle" });
  },
});
