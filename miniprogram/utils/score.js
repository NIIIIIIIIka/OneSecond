// 成绩计算与误差分级（纯函数，便于单独测试）

const TARGET_MS = 1000; // 目标时间：1 秒
const VALID_MIN_MS = 0; // 有效成绩下限
const VALID_MAX_MS = 3000; // 有效成绩上限

/**
 * 根据误差返回鉴定文案
 * @param {number} error 绝对误差（ms）
 */
function getTier(error) {
  if (error <= 20) return "人体原子钟";
  if (error <= 50) return "手表成精";
  if (error <= 100) return "人类高质量手感";
  if (error <= 200) return "一秒有点弹性";
  if (error <= 500) return "时间管理反向大师";
  return "建议先练习呼吸";
}

/**
 * 偏快 / 偏慢描述
 * @param {number} elapsed 实际用时（ms）
 */
function getFastSlowText(elapsed) {
  const diff = elapsed - TARGET_MS;
  if (diff === 0) return "正中一秒，误差为 0";
  if (diff < 0) return `偏快了 ${Math.abs(diff)}ms`;
  return `偏慢了 ${diff}ms`;
}

/**
 * 偏快 / 偏慢 / 正好一秒（用于结果页方向展示）
 * @param {number} elapsed 实际用时（ms）
 */
function getDirectionText(elapsed) {
  const diff = elapsed - TARGET_MS;
  if (diff === 0) return "正好一秒";
  return diff < 0 ? "偏快了" : "偏慢了";
}

/**
 * 毫秒转“秒”，保留 3 位小数
 * @param {number} ms
 */
function formatSeconds(ms) {
  return (ms / 1000).toFixed(3);
}

/**
 * 计算一局的结果
 * @param {number} elapsed 实际用时（ms）
 * @param {number|null} bestError 历史最佳误差（ms），无记录为 null
 */
function calcResult(elapsed, bestError) {
  const error = Math.abs(elapsed - TARGET_MS);
  const valid = elapsed >= VALID_MIN_MS && elapsed <= VALID_MAX_MS;
  const hasBest = typeof bestError === "number" && Number.isFinite(bestError);
  const isNewBest = valid && (!hasBest || error < bestError);

  return {
    elapsed,
    error,
    valid,
    isNewBest,
    tier: getTier(error),
    direction: getDirectionText(elapsed),
    fastSlowText: getFastSlowText(elapsed),
    durationText: formatSeconds(elapsed),
  };
}

module.exports = {
  TARGET_MS,
  VALID_MIN_MS,
  VALID_MAX_MS,
  getTier,
  getFastSlowText,
  getDirectionText,
  formatSeconds,
  calcResult,
};
