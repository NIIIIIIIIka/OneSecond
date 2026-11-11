// 本地成绩与云端成绩的协调规则（纯函数，便于单独测试）

const TARGET_MS = 1000; // 目标时间：1 秒
const VALID_MAX_MS = 3000; // 有效成绩上限

/**
 * 是否为可提交的有效用时
 * 只接受 0–3000ms 的整数毫秒值
 * @param {unknown} elapsed
 */
function isValidElapsed(elapsed) {
  return (
    typeof elapsed === "number" &&
    Number.isFinite(elapsed) &&
    Number.isInteger(elapsed) &&
    elapsed >= 0 &&
    elapsed <= VALID_MAX_MS
  );
}

/**
 * 绝对误差
 * @param {number} elapsed
 */
function errorOf(elapsed) {
  return Math.abs(elapsed - TARGET_MS);
}

/**
 * 归一化最佳成绩记录：只保留 elapsed，并重新计算 error
 * 不信任外部传入的 error 字段
 * @param {unknown} record
 * @returns {{ elapsed: number, error: number } | null}
 */
function normalizeBest(record) {
  if (!record || typeof record !== "object") return null;
  if (!isValidElapsed(record.elapsed)) return null;
  return { elapsed: record.elapsed, error: errorOf(record.elapsed) };
}

/**
 * 比较本地与云端最佳成绩
 *
 * - "none"：双方都没有有效成绩
 * - "cloud"：云端更优（或本地缺失），应采用云端成绩
 * - "local"：本地更优（或云端缺失），应提交本地成绩
 * - "tie"：误差相同，本地展示保持不变；云端保留先前记录
 *
 * @param {{ elapsed: number } | null} local
 * @param {{ elapsed: number } | null} cloud
 * @returns {"none" | "cloud" | "local" | "tie"}
 */
function compareBest(local, cloud) {
  const l = normalizeBest(local);
  const c = normalizeBest(cloud);
  if (!l && !c) return "none";
  if (!l) return "cloud";
  if (!c) return "local";
  if (l.error < c.error) return "local";
  if (l.error > c.error) return "cloud";
  return "tie";
}

module.exports = {
  TARGET_MS,
  VALID_MAX_MS,
  isValidElapsed,
  errorOf,
  normalizeBest,
  compareBest,
};
