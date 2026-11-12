// 排名结果的展示规则（纯函数，便于单独测试）

/**
 * 名次文案
 * @param {number} rank
 */
function formatRank(rank) {
  if (!Number.isInteger(rank) || rank < 1) return "";
  return `第 ${rank} 名`;
}

/**
 * 超越百分比文案
 *
 * - 只有一名上榜玩家时显示 100%（不补 .0）
 * - 其余情况保留一位小数
 *
 * @param {number} percentile
 * @param {number} total
 */
function formatPercent(percentile, total) {
  if (typeof percentile !== "number" || !Number.isFinite(percentile)) {
    return "";
  }
  if (total === 1) return "超越 100%";
  return `超越 ${percentile.toFixed(1)}%`;
}

/**
 * 距上一名差距文案
 * @param {{ isFirst?: boolean, gap?: number|null }} result
 */
function formatGap(result) {
  if (!result) {
    return "上一名数据更新中";
  }
  if (result.isFirst) {
    return "你就是第一名";
  }
  if (result.gap === 0) {
    return "与上一名误差相同，提交时间稍晚";
  }
  if (
    typeof result.gap === "number" &&
    Number.isFinite(result.gap) &&
    result.gap > 0
  ) {
    return `距离上一名只差 ${result.gap} ms`;
  }
  return "上一名数据更新中";
}

/**
 * 将 getMyRank 的响应转换成页面可直接展示的文案。
 *
 * @param {object|null} res getMyRank 云函数返回
 * @param {{ isNewBest?: boolean }} options
 * @returns {object|null}
 */
function buildRankFeedback(res, options) {
  if (!res || res.ok !== true || !res.hasRecord) return null;
  if (!Number.isInteger(res.rank) || res.rank < 1) return null;
  if (!Number.isInteger(res.total) || res.total < 1) return null;
  if (res.rank > res.total) return null;

  const isNewBest = Boolean(options && options.isNewBest);
  // 名次是权威字段；即使服务端 isFirst 标志异常，也以 rank === 1 派生第一名文案。
  const isFirst = res.rank === 1;
  return {
    rank: res.rank,
    rankText: formatRank(res.rank),
    percentText: formatPercent(res.percentile, res.total),
    gapText: formatGap({ isFirst, gap: res.gap }),
    bestText: isNewBest ? "本局刷新个人最佳" : "本局未刷新个人最佳",
    onlyOne: res.total === 1,
    total: res.total,
    percentile: res.percentile,
    previousError: res.previousError,
    gap: res.gap,
    isFirst,
  };
}

module.exports = {
  formatRank,
  formatPercent,
  formatGap,
  buildRankFeedback,
};
