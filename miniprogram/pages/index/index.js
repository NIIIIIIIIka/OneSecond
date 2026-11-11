// pages/index/index.js
const { calcResult, formatSeconds } = require("../../utils/score");
const { normalizeBest, compareBest } = require("../../utils/sync");
const cloud = require("../../services/cloud");

// M1 已使用的键，保持兼容
const BEST_ERROR_KEY = "bestError";
// M1.1 新增：用于展示“个人最佳”的实际用时；旧数据可能没有这个键
const BEST_ELAPSED_KEY = "bestElapsed";
// M2 新增：最近一次由云端确认的最佳成绩缓存
const CLOUD_BEST_KEY = "cloudBest";

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
    // M2：云同步状态
    cloudEnabled: false,
    syncStatus: "", // "" | syncing | synced | pending
    syncText: "",
  },

  // 开始时间保存在实例字段中，setData 触发的重渲染不会重置它
  _startTime: 0,
  _settled: false,
  // M2：云端缓存与同步状态
  _cloudBest: null,
  _syncing: false,
  _fetching: false,
  _onNetworkChange: null,
  _unloaded: false,
  _cloudVersion: 0,

  onLoad() {
    this.loadBest();
    this.initCloud();
  },

  onShow() {
    // 页面重新可见时，若存在待同步成绩则重试
    if (this.data.cloudEnabled) {
      this.trySync();
    }
  },

  onHide() {
    // 挑战中切到后台或页面被隐藏：取消本局，回到可继续操作的准备状态
    this.cancelRunning();
  },

  onUnload() {
    this.cancelRunning();
    this._unloaded = true;
    this.unbindNetwork();
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

    // 只有真正有效的成绩才需要同步；异步执行，绝不阻塞结果展示
    if (result.valid) {
      this.trySync();
    }
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

  /* ---------- M2：本地 / 云端协调 ---------- */

  initCloud() {
    if (!cloud.isEnabled()) {
      this.setData({ cloudEnabled: false, syncStatus: "", syncText: "" });
      return;
    }

    this.setData({ cloudEnabled: true });
    this._cloudBest = this.loadCloudCache();
    this.applyInitialSyncStatus();
    this.bindNetwork();
    this.refreshCloudBest();
  },

  bindNetwork() {
    if (typeof wx.onNetworkStatusChange !== "function") return;
    if (this._onNetworkChange) return;
    this._onNetworkChange = (res) => {
      if (res && res.isConnected && this.data.cloudEnabled) {
        this.trySync();
      }
    };
    wx.onNetworkStatusChange(this._onNetworkChange);
  },

  unbindNetwork() {
    if (
      this._onNetworkChange &&
      typeof wx.offNetworkStatusChange === "function"
    ) {
      wx.offNetworkStatusChange(this._onNetworkChange);
    }
    this._onNetworkChange = null;
  },

  loadCloudCache() {
    try {
      return normalizeBest(wx.getStorageSync(CLOUD_BEST_KEY));
    } catch (e) {
      return null;
    }
  },

  saveCloudCache(best) {
    if (!best) return;
    try {
      wx.setStorageSync(CLOUD_BEST_KEY, {
        elapsed: best.elapsed,
        error: best.error,
      });
    } catch (e) {
      // 缓存失败只影响下次启动时的同步判断，不影响挑战
    }
  },

  // 读取本地可同步的最佳成绩（需要 bestElapsed；仅有旧版 bestError 时无法确定用时）
  getLocalBest() {
    try {
      const savedElapsed = wx.getStorageSync(BEST_ELAPSED_KEY);
      if (
        savedElapsed === "" ||
        savedElapsed === undefined ||
        savedElapsed === null
      ) {
        return null;
      }
      return normalizeBest({ elapsed: Number(savedElapsed) });
    } catch (e) {
      return null;
    }
  },

  // 根据本地缓存快速给出初始同步状态，随后由 getMyScore 校正
  applyInitialSyncStatus() {
    const local = this.getLocalBest();
    if (!local) {
      this.updateSyncStatus("");
      return;
    }

    const cmp = compareBest(local, this._cloudBest);
    if (cmp === "cloud") {
      this.applyCloudBest(this._cloudBest);
      this.updateSyncStatus("synced");
    } else if (cmp === "tie") {
      this.updateSyncStatus("synced");
    } else {
      this.updateSyncStatus("pending");
    }
  },

  // 采用更优的云端成绩：写回本地存储并更新页面展示
  applyCloudBest(best) {
    if (this._unloaded) return;
    const target = normalizeBest(best);
    if (!target) return;

    const local = this.getLocalBest();
    if (compareBest(local, target) !== "cloud") return;

    try {
      wx.setStorageSync(BEST_ERROR_KEY, target.error);
      wx.setStorageSync(BEST_ELAPSED_KEY, target.elapsed);
    } catch (e) {
      // 写入失败时仍更新本次页面展示
    }

    this.setData({
      bestError: target.error,
      hasBest: true,
      bestDurationText: formatSeconds(target.elapsed),
    });
  },

  async refreshCloudBest() {
    if (this._fetching) return;
    this._fetching = true;
    const version = this._cloudVersion;
    try {
      const res = await cloud.getMyScore();
      if (version !== this._cloudVersion) {
        // 拉取期间已有更新的提交结果，丢弃过期响应
        return;
      }
      if (!res || !res.ok) {
        // 带上云函数返回的错误码，便于区分部署、权限或数据库问题
        throw new Error(
          "FETCH_FAILED" + (res && res.code ? ":" + res.code : "")
        );
      }

      if (res.hasRecord && res.best) {
        const serverBest = normalizeBest(res.best);
        if (serverBest) {
          this._cloudVersion += 1;
          this._cloudBest = serverBest;
          this.saveCloudCache(serverBest);
          this.applyCloudBest(serverBest);
        }
      } else {
        this._cloudBest = null;
      }

      this.trySync();
    } catch (e) {
      // 拉取失败：保留本地成绩与上次确认的缓存，待同步成绩标记为 pending
      console.warn(
        "[OneSecond] getMyScore 调用失败：",
        (e && (e.errMsg || e.message)) || e
      );
      const local = this.getLocalBest();
      if (local && compareBest(local, this._cloudBest) === "local") {
        this.updateSyncStatus("pending");
      }
    } finally {
      this._fetching = false;
    }
  },

  // 决定是否提交；提交永远异步进行，不阻塞挑战
  trySync() {
    if (!this.data.cloudEnabled || this._syncing) return;

    const local = this.getLocalBest();
    if (!local) {
      this.updateSyncStatus("");
      return;
    }

    const cmp = compareBest(local, this._cloudBest);
    if (cmp === "cloud") {
      this.applyCloudBest(this._cloudBest);
      this.updateSyncStatus("synced");
      return;
    }
    if (cmp === "tie") {
      this.updateSyncStatus("synced");
      return;
    }

    this.submitLocalBest(local);
  },

  async submitLocalBest(local) {
    if (this._syncing) return;
    this._syncing = true;
    this.updateSyncStatus("syncing");

    try {
      const res = await cloud.submitScore(local.elapsed);
      if (!res || !res.ok) {
        // 包括限流：保留待同步状态，稍后由下次触发重试
        console.warn(
          "[OneSecond] submitScore 返回失败：",
          res && (res.code || res)
        );
        this.updateSyncStatus("pending");
        return;
      }

      if (res.best) {
        const serverBest = normalizeBest(res.best);
        if (serverBest) {
          this._cloudVersion += 1;
          this._cloudBest = serverBest;
          this.saveCloudCache(serverBest);
          this.applyCloudBest(serverBest);
        }
      }

      const current = this.getLocalBest();
      const server = this._cloudBest;
      if (current && (!server || current.error < server.error)) {
        // 提交期间本地又产生了更好的成绩：旧请求的结果不能算“已同步”
        this.updateSyncStatus("pending");
      } else {
        this.updateSyncStatus("synced");
      }
    } catch (e) {
      // 网络或云函数不可用：本地挑战继续，成绩保持待同步
      console.warn(
        "[OneSecond] submitScore 调用失败：",
        (e && (e.errMsg || e.message)) || e
      );
      this.updateSyncStatus("pending");
    } finally {
      this._syncing = false;
    }
  },

  updateSyncStatus(status) {
    if (this._unloaded) return;
    let syncText = "";
    if (status === "syncing") syncText = "同步中";
    else if (status === "synced") syncText = "已同步";
    else if (status === "pending") syncText = "待同步";
    this.setData({ syncStatus: status, syncText });
  },
});
