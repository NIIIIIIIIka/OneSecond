// getMyRank 的核心逻辑（不依赖 wx-server-sdk，便于单元测试）
const crypto = require("crypto");

const COLLECTION = "scores";

/**
 * 与 submitScore / getMyScore / getRank 保持一致的确定性文档 ID。
 */
function scoreDocId(openid) {
  const hash = crypto
    .createHash("sha256")
    .update(String(openid))
    .digest("hex");
  return "best_" + hash;
}

function toDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date;
    }
  }
  return null;
}

/**
 * 超越百分比（保留一位小数）。
 *
 *   N > 1: (N - rank) / (N - 1) * 100%
 *   N = 1: 100%
 *
 * 返回 number（例如 3.8），格式化由客户端完成。
 */
function computePercentile(rank, total) {
  if (
    !Number.isInteger(rank) ||
    !Number.isInteger(total) ||
    total < 1 ||
    rank < 1 ||
    rank > total
  ) {
    return null;
  }
  if (total === 1) return 100;
  const raw = ((total - rank) / (total - 1)) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 10) / 10;
}

async function countWhere(coll, condition) {
  const res = await coll.where(condition).count();
  if (!res || !Number.isFinite(res.total)) {
    throw new Error("INVALID_COUNT_RESULT");
  }
  return res.total;
}

async function countAll(coll) {
  const res = await coll.count();
  if (!res || !Number.isFinite(res.total)) {
    throw new Error("INVALID_COUNT_RESULT");
  }
  return res.total;
}

async function findOne(coll, condition, orders) {
  let query = coll.where(condition);
  orders.forEach((order) => {
    query = query.orderBy(order.field, order.direction);
  });
  const res = await query.limit(1).get();
  const docs = res && Array.isArray(res.data) ? res.data : [];
  return docs.length > 0 ? docs[0] : null;
}

/**
 * 读取当前用户的个人最佳与完整排名。
 *
 * rank 通过对完整排序规则做条件计数得到，不依赖只读取前 100 名：
 *   rank = 1
 *        + count(error < myError)
 *        + count(error == myError && createdAt < myCreatedAt)
 *        + count(error == myError && createdAt == myCreatedAt && _id < myId)
 *
 * 上一名按以下优先级查找（越靠前越接近当前用户）：
 *   1. 同 error、createdAt 更早的最近一条
 *   2. 同 error、同 createdAt、_id 更小的最近一条
 *   3. 没有同 error 的更早记录时，error 更小的最近一条
 *
 * 排名、上一名和总人数是多次查询，没有使用事务/全局锁；并发提交时
 * 可能出现轻微快照差异。这是低成本排行榜的明确取舍，刷新即可收敛。
 */
async function readMyRank({ db, openid }) {
  if (!openid) {
    return {
      ok: false,
      code: "NO_IDENTITY",
      hasRecord: false,
      best: null,
      rank: null,
      total: null,
      percentile: null,
      previousError: null,
      gap: null,
      isFirst: false,
    };
  }

  const docId = scoreDocId(openid);
  const coll = db.collection(COLLECTION);
  const cmd = db.command;

  // 使用 where + limit(1) 而不是 doc().get()，让“没有记录”和数据库故障
  // 可以区分：没有记录返回空数组，故障会抛错并由云函数入口处理。
  const mineRes = await coll.where({ _id: docId }).limit(1).get();
  const mine = mineRes && mineRes.data ? mineRes.data[0] : null;

  if (!mine) {
    return {
      ok: true,
      hasRecord: false,
      best: null,
      rank: null,
      total: null,
      percentile: null,
      previousError: null,
      gap: null,
      isFirst: false,
    };
  }

  const myError = mine.error;
  const myCreatedAt = toDate(mine.createdAt);
  if (
    !Number.isFinite(myError) ||
    myError < 0 ||
    !myCreatedAt
  ) {
    return {
      ok: false,
      code: "INVALID_RECORD",
      hasRecord: false,
      best: null,
      rank: null,
      total: null,
      percentile: null,
      previousError: null,
      gap: null,
      isFirst: false,
    };
  }

  const [
    totalFromDb,
    beforeError,
    beforeTime,
    beforeId,
    prevByTime,
    prevById,
    prevByError,
  ] = await Promise.all([
    countAll(coll),
    countWhere(coll, { error: cmd.lt(myError) }),
    countWhere(coll, {
      error: myError,
      createdAt: cmd.lt(myCreatedAt),
    }),
    countWhere(coll, {
      error: myError,
      createdAt: myCreatedAt,
      _id: cmd.lt(docId),
    }),
    findOne(
      coll,
      { error: myError, createdAt: cmd.lt(myCreatedAt) },
      [
        { field: "createdAt", direction: "desc" },
        { field: "_id", direction: "desc" },
      ]
    ),
    findOne(
      coll,
      { error: myError, createdAt: myCreatedAt, _id: cmd.lt(docId) },
      [{ field: "_id", direction: "desc" }]
    ),
    findOne(coll, { error: cmd.lt(myError) }, [
      { field: "error", direction: "desc" },
      { field: "createdAt", direction: "desc" },
      { field: "_id", direction: "desc" },
    ]),
  ]);

  const rank = 1 + beforeError + beforeTime + beforeId;
  // 防止 count 与列表查询之间的并发写入导致 total < rank
  const total = Math.max(totalFromDb, rank);

  const previous = prevByTime || prevById || prevByError;
  const previousError =
    previous && Number.isFinite(previous.error) ? previous.error : null;
  const gap =
    previousError === null ? null : Math.max(0, myError - previousError);

  return {
    ok: true,
    hasRecord: true,
    best: {
      elapsed: mine.elapsed,
      error: mine.error,
    },
    rank,
    total,
    percentile: computePercentile(rank, total),
    previousError,
    gap,
    isFirst: rank === 1,
  };
}

module.exports = {
  COLLECTION,
  scoreDocId,
  toDate,
  computePercentile,
  readMyRank,
};
