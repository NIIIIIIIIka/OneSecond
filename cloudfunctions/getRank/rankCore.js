// getRank 的核心逻辑（不依赖 wx-server-sdk，便于单元测试）
const crypto = require("crypto");

const COLLECTION = "scores";
// wx-server-sdk 服务端单次 get 上限为 1000 条；这里显式限制 100，
// 不依赖默认值，也不需要读取超过前 100 名的数据。
const TOP_LIMIT = 100;

/**
 * 与 submitScore / getMyScore 保持一致的确定性文档 ID。
 * 文档 ID 本身不会返回给客户端，只用于服务端定位和排序。
 */
function scoreDocId(openid) {
  const hash = crypto
    .createHash("sha256")
    .update(String(openid))
    .digest("hex");
  return "best_" + hash;
}

/**
 * 稳定的匿名展示名。
 * 从文档 ID 的哈希部分截取 10 位十六进制字符，既不暴露 openid，
 * 也足以让榜单上的玩家互相区分；同一用户的名称永远稳定。
 */
function displayName(docId) {
  const raw = String(docId || "");
  if (!raw) return "挑战者";
  // 正常文档 ID 是 best_<sha256(openid)>，直接取哈希前缀。
  // 对非标准旧文档再哈希一次，避免把任意原始 ID 前缀暴露到榜单。
  const hash =
    raw.indexOf("best_") === 0
      ? raw.slice(5)
      : crypto.createHash("sha256").update(raw).digest("hex");
  return "挑战者·" + hash.slice(0, 10).toUpperCase();
}

/**
 * 排行榜只返回公开展示所需字段，不返回 openid / 完整 _id。
 */
function toPublicItem(doc, rank, myDocId) {
  return {
    rank,
    name: displayName(doc._id),
    error: doc.error,
    isMe: Boolean(myDocId && doc._id === myDocId),
  };
}

/**
 * 读取总榜前 100 名。
 *
 * 排序规则（必须与 getMyRank 的条件计数完全一致）：
 *   1. error 升序
 *   2. createdAt 升序
 *   3. _id 升序（确定性 tie-breaker）
 *
 * 只读取前 100 条，不读取整个集合；总人数使用 count()。
 * 列表与总人数是两次查询，并发提交时可能出现轻微快照差异；
 * 这是低成本排行榜可接受的最终一致性，刷新即可收敛。
 */
async function readRank({ db, openid }) {
  const coll = db.collection(COLLECTION);

  const [topRes, countRes] = await Promise.all([
    coll
      .orderBy("error", "asc")
      .orderBy("createdAt", "asc")
      .orderBy("_id", "asc")
      .limit(TOP_LIMIT)
      .get(),
    coll.count(),
  ]);

  const docs = topRes && Array.isArray(topRes.data) ? topRes.data : [];
  const totalFromDb =
    countRes && Number.isFinite(countRes.total) ? countRes.total : 0;
  // 防止 count 与列表查询之间的并发写入导致 total < list.length
  const total = Math.max(totalFromDb, docs.length);
  const myDocId = openid ? scoreDocId(openid) : "";

  const list = docs.map((doc, index) => toPublicItem(doc, index + 1, myDocId));

  return {
    ok: true,
    list,
    total,
    meInTop100: Boolean(
      myDocId && docs.some((doc) => doc._id === myDocId)
    ),
  };
}

module.exports = {
  COLLECTION,
  TOP_LIMIT,
  scoreDocId,
  displayName,
  toPublicItem,
  readRank,
};
