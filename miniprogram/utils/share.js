// 分享标题与路径规则（纯函数，便于单独测试）

const SHARE_PATH = "/pages/index/index";
const DEFAULT_RESULT_TITLE = "一秒不差？来挑战你的时间感！";
const RANKING_TITLE = "一秒不差？看看你能排第几！";
const INVALID_RESULT_TITLE = "我挑战 1 秒超出有效范围，你能稳住吗？";

function isValidRank(rank) {
  return Number.isInteger(rank) && rank >= 1;
}

function isValidError(error) {
  return Number.isInteger(error) && error >= 0;
}

/**
 * 结果页分享内容。
 *
 * 只在排名已确认时使用排名；否则使用本局真实误差。
 * 无效成绩不描述为有效记录，也不携带排名。
 *
 * @param {{ valid?: boolean, error?: number, rankConfirmed?: boolean, rank?: number }} input
 * @returns {{ title: string, path: string }}
 */
function buildResultShare(input) {
  const data = input || {};

  if (!data.valid) {
    return { title: INVALID_RESULT_TITLE, path: SHARE_PATH };
  }

  if (data.rankConfirmed && isValidRank(data.rank)) {
    return {
      title: `我在一秒挑战排第 ${data.rank} 名，你能超越吗？`,
      path: SHARE_PATH,
    };
  }

  if (isValidError(data.error)) {
    const errorText =
      data.error === 0 ? "误差只有 0ms" : `只差 ${data.error}ms`;
    return {
      title: `我挑战 1 秒，${errorText}！你能超过吗？`,
      path: SHARE_PATH,
    };
  }

  return { title: DEFAULT_RESULT_TITLE, path: SHARE_PATH };
}

/**
 * 排行榜页分享内容。
 *
 * 只有个人排名确认后才包含名次，否则使用通用邀请文案。
 *
 * @param {{ rankConfirmed?: boolean, rank?: number }} input
 * @returns {{ title: string, path: string }}
 */
function buildRankingShare(input) {
  const data = input || {};
  if (data.rankConfirmed && isValidRank(data.rank)) {
    return {
      title: `一秒不差？我已排第 ${data.rank} 名，看看你能排第几！`,
      path: SHARE_PATH,
    };
  }
  return { title: RANKING_TITLE, path: SHARE_PATH };
}

module.exports = {
  SHARE_PATH,
  DEFAULT_RESULT_TITLE,
  RANKING_TITLE,
  INVALID_RESULT_TITLE,
  buildResultShare,
  buildRankingShare,
};
