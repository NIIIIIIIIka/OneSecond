// pages/ranking/ranking.js
const ranking = require("../../services/ranking");
const share = require("../../utils/share");
const stats = require("../../services/stats");
const { formatPercent, formatGap } = require("../../utils/ranking");

function isValidMyRank(res) {
  return (
    res &&
    res.ok === true &&
    res.hasRecord === true &&
    Number.isInteger(res.rank) &&
    res.rank >= 1 &&
    Number.isInteger(res.total) &&
    res.total >= 1 &&
    res.rank <= res.total
  );
}

function mapListItem(item, index) {
  const rank =
    Number.isInteger(item && item.rank) && item.rank >= 1
      ? item.rank
      : index + 1;
  const isMe = Boolean(item && item.isMe);
  return {
    rank,
    name: (item && item.name) || "挑战者",
    error: item && Number.isFinite(item.error) ? item.error : 0,
    isMe,
    rowClass:
      "rank-row" +
      (rank <= 3 ? " top-" + rank : "") +
      (isMe ? " is-me" : ""),
    rankClass: "rank-no" + (rank <= 3 ? " medal-" + rank : ""),
  };
}

Page({
  data: {
    cloudEnabled: false,
    state: "loading", // loading | ready | empty | error | disabled
    stateText: "加载中…",
    loading: true,
    refreshError: "",
    cacheNotice: "",
    list: [],
    total: 0,
    meInTop100: false,
    myStatus: "idle", // idle | loading | ready | empty | error
    my: null,
    myText: "",
    showBottomBar: false,
    showMySummary: false,
  },

  onLoad() {
    this._requestId = 0;
    this._unloaded = false;
    stats.recordRankingOpen();

    const enabled = ranking.isEnabled();
    this.setData({ cloudEnabled: enabled });
    if (!enabled) {
      this.setData({
        state: "disabled",
        stateText: "排行榜暂未开放",
        loading: false,
        refreshError: "",
        cacheNotice: "",
        list: [],
        total: 0,
        meInTop100: false,
        myStatus: "idle",
        my: null,
        myText: "",
        showBottomBar: false,
        showMySummary: false,
      });
      return undefined;
    }

    this._loadPromise = this.load(false);
    return this._loadPromise;
  },

  onUnload() {
    this._unloaded = true;
  },

  onPullDownRefresh() {
    const done = () => {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    };
    this.load(true).then(done, done);
  },

  onRetry() {
    this.load(true);
  },

  async load(force) {
    if (this._unloaded) return;
    if (!this.data.cloudEnabled) {
      this.setData({
        state: "disabled",
        stateText: "排行榜暂未开放",
        loading: false,
      });
      return;
    }

    const req = ++this._requestId;
    const hadContent =
      this.data.state === "ready" || this.data.state === "empty";

    const patch = { loading: true, refreshError: "" };
    if (!hadContent) {
      patch.state = "loading";
      patch.stateText = "加载中…";
      patch.cacheNotice = "";
    }
    this.setData(patch);

    // 榜单与个人排名并行请求；先渲染榜单，再补充底部个人排名。
    const topTask = ranking.fetchTop({ force: Boolean(force) }).then(
      (res) => ({ ok: true, res }),
      (err) => ({ ok: false, err })
    );
    const myTask = ranking.fetchMyRank().then(
      (res) => ({ ok: true, res }),
      (err) => ({ ok: false, err })
    );

    const topResult = await topTask;
    if (this._unloaded || req !== this._requestId) return;

    if (!topResult.ok) {
      if (hadContent && this.data.list.length > 0) {
        this.setData({
          loading: false,
          refreshError: "刷新失败，当前显示缓存排名，可能不是最新",
          cacheNotice: "当前显示缓存排名，可能不是最新",
        });
      } else {
        this.setData({
          state: "error",
          stateText: "排行榜加载失败，请下拉刷新重试",
          loading: false,
          refreshError: "",
          cacheNotice: "",
          list: [],
          total: 0,
          meInTop100: false,
          myStatus: "idle",
          my: null,
          myText: "",
          showBottomBar: false,
          showMySummary: false,
        });
      }
      return;
    }

    const top = topResult.res;
    if (!top || !top.ok || !Array.isArray(top.list)) {
      this.setData({
        state: "error",
        stateText: "排行榜加载失败，请下拉刷新重试",
        loading: false,
        refreshError: "",
        cacheNotice: "",
        list: [],
        total: 0,
        meInTop100: false,
        myStatus: "idle",
        my: null,
        myText: "",
        showBottomBar: false,
        showMySummary: false,
      });
      return;
    }

    const list = top.list.map(mapListItem);
    const total = Math.max(
      Number.isFinite(top.total) ? top.total : 0,
      list.length
    );
    const meInTop100 =
      Boolean(top.meInTop100) || list.some((item) => item.isMe);

    let state = "ready";
    let stateText = "";
    if (list.length === 0 && total === 0) {
      state = "empty";
      stateText = "目前无人上榜，第一名等你来拿。";
    } else if (list.length === 0) {
      state = "error";
      stateText = "排行榜加载异常，请下拉刷新重试";
    }

    const nextMyStatus =
      this.data.myStatus === "idle" ? "loading" : this.data.myStatus;
    const cacheNotice = top.fromCache
      ? "当前显示缓存排名，可能不是最新"
      : "";
    const refreshError =
      top.fromCache && top.stale
        ? "刷新失败，当前显示缓存排名"
        : "";
    this.setData({
      state,
      stateText,
      loading: false,
      refreshError,
      cacheNotice,
      list,
      total,
      meInTop100,
      myStatus: nextMyStatus,
      showBottomBar: state === "ready" && !meInTop100 && total > 0,
      showMySummary: false,
    });

    const myResult = await myTask;
    if (this._unloaded || req !== this._requestId) return;
    if (state === "error") return;

    this.applyMyRank(myResult, meInTop100, total);
  },

  applyMyRank(myResult, meInTop100, total) {
    let myStatus = "error";
    let my = null;
    let myText = "我的排名暂不可用";

    if (myResult.ok) {
      const res = myResult.res;
      if (res && res.ok && res.hasRecord) {
        if (isValidMyRank(res)) {
          myStatus = "ready";
          my = {
            rank: res.rank,
            percentText: formatPercent(res.percentile, res.total),
            gapText: formatGap({ isFirst: res.rank === 1, gap: res.gap }),
            onlyOne: res.total === 1,
            total: res.total,
            percentile: res.percentile,
            isFirst: res.rank === 1,
          };
          myText = "";
        }
      } else if (res && res.ok && !res.hasRecord) {
        myStatus = "empty";
        myText = "还没有上榜成绩，完成一次有效挑战即可上榜";
      }
    }

    this.setData({
      myStatus,
      my,
      myText,
      showBottomBar:
        this.data.state === "ready" &&
        !meInTop100 &&
        (total > 0 || myStatus === "ready"),
      showMySummary:
        this.data.state === "ready" &&
        meInTop100 &&
        myStatus === "ready",
    });
  },

  onShareTap() {
    stats.recordShareEntryClick();
  },

  onShareAppMessage() {
    const rank = this.data.my && this.data.my.rank;
    return share.buildRankingShare({
      rankConfirmed: this.data.myStatus === "ready",
      rank,
    });
  },

  onBackToChallenge() {
    const goHome = () => {
      if (typeof wx.reLaunch === "function") {
        wx.reLaunch({ url: share.SHARE_PATH });
      }
    };
    if (typeof wx.navigateBack === "function") {
      try {
        wx.navigateBack({ delta: 1, fail: goHome });
      } catch (e) {
        goHome();
      }
      return;
    }
    goHome();
  },
});
