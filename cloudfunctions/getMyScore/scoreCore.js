// getMyScore 的核心逻辑（不依赖 wx-server-sdk，便于单元测试）
const crypto = require("crypto");

const COLLECTION = "scores";

/**
 * 与 submitScore 保持一致的确定性文档 ID
 */
function scoreDocId(openid) {
  const hash = crypto
    .createHash("sha256")
    .update(String(openid))
    .digest("hex");
  return "best_" + hash;
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * 读取当前用户的最佳成绩
 * 只返回本人数据，不泄露 openid 或其他用户信息
 */
async function readMyBest({ db, openid }) {
  if (!openid) {
    return { ok: false, code: "NO_IDENTITY", hasRecord: false, best: null };
  }
  const docId = scoreDocId(openid);
  try {
    const res = await db.collection(COLLECTION).doc(docId).get();
    const doc = res && res.data;
    if (!doc) {
      return { ok: true, hasRecord: false, best: null };
    }
    return {
      ok: true,
      hasRecord: true,
      best: {
        elapsed: doc.elapsed,
        error: doc.error,
        createdAt: toMillis(doc.createdAt),
        updatedAt: toMillis(doc.updatedAt),
      },
    };
  } catch (e) {
    // 无记录（doc.get 抛错）与查询失败都返回明确空状态
    return { ok: true, hasRecord: false, best: null };
  }
}

module.exports = {
  COLLECTION,
  scoreDocId,
  toMillis,
  readMyBest,
};
