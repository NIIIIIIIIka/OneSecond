// submitScore 的核心逻辑（不依赖 wx-server-sdk，便于单元测试）
const crypto = require("crypto");

const COLLECTION = "scores";
const TARGET_MS = 1000;
const VALID_MAX_MS = 3000;
const RATE_LIMIT_MS = 1000;

/**
 * 校验 elapsed：必须是 0–3000 的整数毫秒
 * @returns {string} 错误码，合法时返回空字符串
 */
function validateElapsed(elapsed) {
  if (typeof elapsed !== "number") return "INVALID_ELAPSED";
  if (!Number.isFinite(elapsed)) return "INVALID_ELAPSED";
  if (!Number.isInteger(elapsed)) return "INVALID_ELAPSED";
  if (elapsed < 0 || elapsed > VALID_MAX_MS) return "INVALID_ELAPSED";
  return "";
}

/**
 * 确定性的个人最佳文档 ID：同一 openid 永远对应同一条文档
 * 使用哈希，避免把原始 openid 写进 _id
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

function publicBest(doc) {
  if (!doc) return null;
  return {
    elapsed: doc.elapsed,
    error: doc.error,
    createdAt: toMillis(doc.createdAt),
    updatedAt: toMillis(doc.updatedAt),
  };
}

async function getDoc(coll, docId) {
  try {
    const res = await coll.doc(docId).get();
    return res && res.data ? res.data : null;
  } catch (e) {
    // 文档不存在时 wx-server-sdk 会抛错，统一视为空
    return null;
  }
}

/**
 * 处理一次成绩提交
 *
 * @param {object} options
 * @param {object} options.event 云函数入参（只读取 elapsed）
 * @param {() => string} options.getOpenId 从可信上下文获取用户身份
 * @param {object} options.db 数据库实例
 * @param {number} [options.now] 服务端当前时间（测试注入）
 */
async function handle({ event, getOpenId, db, now = Date.now() }) {
  const elapsed = event ? event.elapsed : undefined;
  const invalid = validateElapsed(elapsed);
  if (invalid) {
    return { ok: false, code: invalid };
  }

  // 身份只来自服务端上下文，绝不读取 event 中的 openid
  const openid = getOpenId();
  if (!openid) {
    return { ok: false, code: "NO_IDENTITY" };
  }
  const error = Math.abs(elapsed - TARGET_MS);
  const docId = scoreDocId(openid);
  const coll = db.collection(COLLECTION);

  let existing = await getDoc(coll, docId);
  let afterCreationRace = false;

  if (!existing) {
    try {
      await coll.add({
        data: {
          _id: docId,
          openid,
          elapsed,
          error,
          // 时间戳由服务端生成
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          lastSubmitAt: db.serverDate(),
        },
      });
      const created = await getDoc(coll, docId);
      return {
        ok: true,
        refreshed: true,
        reason: "created",
        best: publicBest(created),
      };
    } catch (e) {
      // 并发的首次提交：文档已被另一个请求创建
      existing = await getDoc(coll, docId);
      if (!existing) {
        // 常见原因：集合未创建、无权限或写入参数非法
        console.error(
          "[submitScore] 创建记录失败：",
          (e && (e.message || e)) || e
        );
        return { ok: false, code: "INTERNAL_ERROR" };
      }
      afterCreationRace = true;
    }
  }

  // 每秒最多一次提交。首次创建竞态由确定性 _id 去重，
  // 这里跳过限流，避免较好的并发成绩被另一条首次提交挡住。
  if (!afterCreationRace) {
    const lastMs = toMillis(existing.lastSubmitAt);
    if (lastMs > 0 && now - lastMs < RATE_LIMIT_MS) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        retryAfterMs: Math.max(0, RATE_LIMIT_MS - (now - lastMs)),
      };
    }
  }

  if (error < existing.error) {
    // 条件更新：仅当库中误差仍然更大时才写入，避免并发覆盖更好的成绩
    const res = await coll
      .where({ _id: docId, error: db.command.gt(error) })
      .update({
        data: {
          elapsed,
          error,
          updatedAt: db.serverDate(),
          lastSubmitAt: db.serverDate(),
        },
      });

    const updated = res && res.stats ? res.stats.updated : 0;
    if (updated > 0) {
      const doc = await getDoc(coll, docId);
      return {
        ok: true,
        refreshed: true,
        reason: "improved",
        best: publicBest(doc),
      };
    }

    // 并发中已有更好成绩写入，保留现有记录
    const doc = await getDoc(coll, docId);
    return {
      ok: true,
      refreshed: false,
      reason: "kept",
      best: publicBest(doc),
    };
  }

  // 误差相同或更差：保留原成绩与 createdAt，只记录本次提交时间用于限流
  try {
    await coll.doc(docId).update({ data: { lastSubmitAt: db.serverDate() } });
  } catch (e) {
    // 限流时间的更新失败不影响本次返回
  }

  return {
    ok: true,
    refreshed: false,
    reason: "kept",
    best: publicBest(existing),
  };
}

module.exports = {
  COLLECTION,
  TARGET_MS,
  VALID_MAX_MS,
  RATE_LIMIT_MS,
  validateElapsed,
  scoreDocId,
  toMillis,
  publicBest,
  handle,
};
