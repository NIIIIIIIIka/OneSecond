// pages/index/index.js
const { calcResult, formatSeconds } = require("../../utils/score");

// M1 已使用的键，保持兼容
const BEST_ERROR_KEY = "bestError";
// M1.1 新增：用于展示“个人最佳”的实际用时；旧数据可能没有这个键
const BEST_ELAPSED_KEY = "bestElapsed";

Page({
  data: {
    status: "idle", // idle | ready | running | result
    elapsed: 0,
    error: 0,
    durationText: "0.000",
    tier: "",
    direction: "",
    isNewBest: false,
    invalid: false,
    bestError: null,
    bestDurationText: "",
    hasBest: false,
  },

  // 开始时间保存在实例字段中，setData 触发的重渲染不会重置它
  _startTime: 0,
  _settled: false,

  onLoad() {
    this.loadBest();
  },

  onHide() {
    // 挑战中切到后台或页面被隐藏：取消本局，回到可继续操作的准备状态
    this.cancelRunning();
  },

  onUnload() {
    this.cancelRunning();
  },

  loadBest() {
    let bestError = null;
    let bestElapsed = null;
    try {
      const savedError = wx.getStorageSync(BEST_ERROR_KEY);
      if (savedError !== "" && savedError !== undefined && savedError !== null) {
        const num = Number(savedError);
        if (Number.isFinite(num)) {
          bestError = num;
        }
      }

      const savedElapsed = wx.getStorageSync(BEST_ELAPSED_KEY);
      if (
        savedElapsed !== "" &&
        savedElapsed !== undefined &&
        savedElapsed !== null
      ) {
        const num = Number(savedElapsed);
        if (Number.isFinite(num)) {
          bestElapsed = num;
        }
      }
    } catch (e) {
      // 读取失败时保持空状态，保证页面正常渲染
      bestError = null;
      bestElapsed = null;
    }

    this.setData({
      bestError,
      hasBest: bestError !== null,
      bestDurationText: bestElapsed !== null ? formatSeconds(bestElapsed) : "",
    });
  },

  // idle → ready：只切换界面，绝不开始计时
  onStartGame() {
    if (this.data.status !== "idle") return;
    this.setData({ status: "ready" });
  },

  // ready → running：只有这里才记录开始时间
  onStartTiming() {
    if (this.data.status !== "ready") return;
    // 立即记录开始时间，之前不做任何异步操作
    this._startTime = Date.now();
    this._settled = false;
    this.setData({ status: "running" });
  },

  // running → result：只有这里才记录停止时间
  onStop() {
    if (this.data.status !== "running" || this._settled) return;
    // 立即记录停止时间
    const elapsed = Date.now() - this._startTime;
    this._settled = true;

    const result = calcResult(elapsed, this.data.bestError);

    if (result.isNewBest) {
      try {
        wx.setStorageSync(BEST_ERROR_KEY, result.error);
        wx.setStorageSync(BEST_ELAPSED_KEY, result.elapsed);
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
      direction: result.direction,
      isNewBest: result.isNewBest,
      invalid: !result.valid,
      bestError,
      hasBest: bestError !== null,
      bestDurationText: result.isNewBest
        ? result.durationText
        : this.data.bestDurationText,
    });
  },

  // result → ready：回到准备状态，不直接开始计时
  onRestart() {
    if (this.data.status !== "result") return;
    this.setData({ status: "ready" });
  },

  // running 被中断（切后台 / 页面隐藏）：取消本局，回到 ready
  cancelRunning() {
    if (this.data.status !== "running") return;
    this._settled = true;
    this.setData({ status: "ready" });
  },
});
