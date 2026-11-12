// 本地体验统计
//
// 仅保存在本机，用于 M5 小范围测试观察使用情况。
// 不采集 openid、手机号、设备信息或其他个人身份信息。
// 分享入口点击次数不等于分享成功次数。

const STATS_KEY = "os_stats_v1";

function emptyStats() {
  return {
    validChallenges: 0,
    rankingOpens: 0,
    shareEntryClicks: 0,
  };
}

function toCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * 读取本地统计；数据缺失或损坏时返回零值，不影响游戏。
 * @returns {{ validChallenges: number, rankingOpens: number, shareEntryClicks: number }}
 */
function readStats() {
  let raw;
  try {
    raw = wx.getStorageSync(STATS_KEY);
  } catch (e) {
    return emptyStats();
  }

  if (!raw || typeof raw !== "object") {
    return emptyStats();
  }

  return {
    validChallenges: toCount(raw.validChallenges),
    rankingOpens: toCount(raw.rankingOpens),
    shareEntryClicks: toCount(raw.shareEntryClicks),
  };
}

function increment(field) {
  const next = readStats();
  next[field] += 1;
  try {
    wx.setStorageSync(STATS_KEY, next);
  } catch (e) {
    // 统计写入失败不影响挑战、分享或排行榜
  }
  return next;
}

/**
 * 记录一次有效的完整挑战（无效成绩、取消的挑战不计数）。
 */
function recordValidChallenge() {
  return increment("validChallenges");
}

/**
 * 记录一次排行榜页面打开。
 */
function recordRankingOpen() {
  return increment("rankingOpens");
}

/**
 * 记录一次分享入口点击；不代表用户真正完成了分享。
 */
function recordShareEntryClick() {
  return increment("shareEntryClicks");
}

module.exports = {
  STATS_KEY,
  readStats,
  recordValidChallenge,
  recordRankingOpen,
  recordShareEntryClick,
};
