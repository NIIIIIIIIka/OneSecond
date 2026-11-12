// pages/index/index.js
const { calcResult, formatSeconds } = require("../../utils/score");
const { normalizeBest, compareBest } = require("../../utils/sync");
const { buildRankFeedback } = require("../../utils/ranking");
const cloud = require("../../services/cloud");
const ranking = require("../../services/ranking");

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
    // M3：结果页排名反馈
    rankStatus: "", // "" | loading | ready | pending | unavailable
    rankText: "",
    rankPercentText: "",
    rankGapText: "",
    rankBestText: "",
    rankOnlyOne: false,
    rankUnavailableText: "",
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
  // M3：排名请求令牌与局次，防止旧异步响应覆盖新状态
  _rankToken: 0,
  _resultRound: 0,
  _syncPromise: null,

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
    this._rankToken += 1;
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

    this._resultRound += 1;
    this._rankToken += 1;
    const round = this._resultRound;

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
      rankStatus: this.data.cloudEnabled ? "loading" : "",
      rankText: "",
      rankPercentText: "",
      rankGapText: "",
      rankBestText: "",
      rankOnlyOne: false,
      rankUnavailableText: "",
    });

    // 同步与排名均为异步执行，绝不阻塞结果展示或重新挑战
    let syncPromise = this._syncPromise;
    if (result.valid) {
      syncPromise = this.trySync();
    }
    if (this.data.cloudEnabled) {
      this.refreshRankAfterSync(round, syncPromise);
    }
  },

  // result → ready：回到准备状态，不直接开始计时
  onRestart() {
    if (this.data.status !== "result") return;
    this._resultRound += 1;
    this.resetRankFeedback();
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
      this.setData({
        cloudEnabled: false,
        syncStatus: "",
        syncText: "",
        rankStatus: "",
        rankText: "",
        rankPercentText: "",
        rankGapText: "",
        rankBestText: "",
        rankOnlyOne: false,
        rankUnavailableText: "",
      });
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
          const previousCloudBest = normalizeBest(this._cloudBest);
          const cloudBestChanged =
            !previousCloudBest ||
            previousCloudBest.elapsed !== serverBest.elapsed ||
            previousCloudBest.error !== serverBest.error;
          this._cloudVersion += 1;
          this._cloudBest = serverBest;
          this.saveCloudCache(serverBest);
          this.applyCloudBest(serverBest);
          // 只有云端最佳确实变化时才清榜单缓存；普通页面进入不再重复拉榜。
          if (cloudBestChanged) ranking.invalidate();
        }
      } else {
        if (this._cloudBest) ranking.invalidate();
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

  // 决定是否提交；提交永远异步进行，不阻塞挑战。
  // 返回 Promise，方便结果页在同步结束后再刷新排名（排名必须与云端最佳一致）。
  trySync() {
    if (!this.data.cloudEnabled) return Promise.resolve();
    if (this._syncing) return this._syncPromise || Promise.resolve();

    const local = this.getLocalBest();
    if (!local) {
      this.updateSyncStatus("");
      return Promise.resolve();
    }

    const cmp = compareBest(local, this._cloudBest);
    if (cmp === "cloud") {
      this.applyCloudBest(this._cloudBest);
      this.updateSyncStatus("synced");
      return Promise.resolve();
    }
    if (cmp === "tie") {
      this.updateSyncStatus("synced");
      return Promise.resolve();
    }

    return this.submitLocalBest(local);
  },

  submitLocalBest(local) {
    if (this._syncing) return this._syncPromise || Promise.resolve();

    this._syncing = true;
    const promise = this.runSubmitLocalBest(local);
    this._syncPromise = promise;
    promise.then(
      () => {
        if (this._syncPromise === promise) this._syncPromise = null;
      },
      () => {
        if (this._syncPromise === promise) this._syncPromise = null;
      }
    );
    return promise;
  },

  async runSubmitLocalBest(local) {
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
          const previousCloudBest = normalizeBest(this._cloudBest);
          const cloudBestChanged =
            !previousCloudBest ||
            previousCloudBest.elapsed !== serverBest.elapsed ||
            previousCloudBest.error !== serverBest.error;
          this._cloudVersion += 1;
          this._cloudBest = serverBest;
          this.saveCloudCache(serverBest);
          this.applyCloudBest(serverBest);
          // 成绩未刷新时复用现有榜单缓存，避免无意义的重复请求。
          if (cloudBestChanged) ranking.invalidate();
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

      // 结果页若正在显示“排名待同步/不可用”，提交成功后补一次排名
      if (
        this.data.status === "result" &&
        (this.data.rankStatus === "pending" ||
          this.data.rankStatus === "unavailable")
      ) {
        this.refreshRankForResult(this._resultRound);
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

  /* ---------- M3：结果页排名反馈 ---------- */

  resetRankFeedback() {
    this._rankToken += 1;
    this.setData({
      rankStatus: "",
      rankText: "",
      rankPercentText: "",
      rankGapText: "",
      rankBestText: "",
      rankOnlyOne: false,
      rankUnavailableText: "",
    });
  },

  // 等云端同步结束后再取排名，避免显示上一版最佳的名次。
  async refreshRankAfterSync(round, syncPromise) {
    if (!this.data.cloudEnabled) return;
    if (syncPromise) {
      try {
        await syncPromise;
      } catch (e) {
        // 同步失败也继续尝试；排名请求会自行降级
      }
    }
    if (this._unloaded) return;
    if (round !== this._resultRound || this.data.status !== "result") return;
    await this.refreshRankForResult(round);
  },

  async refreshRankForResult(round) {
    if (this._unloaded || !this.data.cloudEnabled) return;
    if (this.data.status !== "result" || round !== this._resultRound) return;

    const token = ++this._rankToken;
    this.setData({ rankStatus: "loading", rankUnavailableText: "" });

    try {
      const res = await ranking.fetchMyRank();
      if (
        this._unloaded ||
        token !== this._rankToken ||
        round !== this._resultRound ||
        this.data.status !== "result"
      ) {
        // 用户已开始下一局或发起了更新的排名请求，丢弃旧响应
        return;
      }

      if (!res || !res.ok) {
        this.setData({
          rankStatus: "unavailable",
          rankUnavailableText: "排名暂不可用",
        });
        return;
      }

      if (!res.hasRecord || !res.best) {
        const local = this.getLocalBest();
        if (local && this.data.syncStatus !== "synced") {
          this.setData({ rankStatus: "pending", rankUnavailableText: "" });
        } else {
          this.setData({
            rankStatus: "unavailable",
            rankUnavailableText: "完成一次有效挑战即可上榜",
          });
        }
        return;
      }

      const serverBest = normalizeBest(res.best);
      if (!serverBest) {
        this.setData({
          rankStatus: "unavailable",
          rankUnavailableText: "排名暂不可用",
        });
        return;
      }

      const local = this.getLocalBest();
      if (local && local.error < serverBest.error) {
        // 本地已有更好的成绩但尚未同步，不能展示旧名次冒充本局排名
        this.setData({ rankStatus: "pending", rankUnavailableText: "" });
        return;
      }
      if (local && compareBest(local, serverBest) === "cloud") {
        this.applyCloudBest(serverBest);
      }

      const feedback = buildRankFeedback(res, {
        isNewBest: this.data.isNewBest,
      });
      if (!feedback) {
        this.setData({
          rankStatus: "unavailable",
          rankUnavailableText: "排名暂不可用",
        });
        return;
      }

      this.setData({
        rankStatus: "ready",
        rankText: feedback.rankText,
        rankPercentText: feedback.percentText,
        rankGapText: feedback.gapText,
        rankBestText: feedback.bestText,
        rankOnlyOne: feedback.onlyOne,
        rankUnavailableText: "",
      });
    } catch (e) {
      if (
        this._unloaded ||
        token !== this._rankToken ||
        round !== this._resultRound ||
        this.data.status !== "result"
      ) {
        return;
      }
      console.warn(
        "[OneSecond] getMyRank 调用失败：",
        (e && (e.errMsg || e.message)) || e
      );
      this.setData({
        rankStatus: "unavailable",
        rankUnavailableText: "排名暂不可用",
      });
    }
  },

  onOpenRanking() {
    if (typeof wx.navigateTo !== "function") return;
    wx.navigateTo({
      url: "/pages/ranking/ranking",
      fail: () => {
        if (typeof wx.showToast === "function") {
          wx.showToast({ title: "排行榜暂不可用", icon: "none" });
        }
      },
    });
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
