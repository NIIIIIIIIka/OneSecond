// 排行榜调用与短缓存
//
// 排行榜只通过受控云函数读取；客户端不直接访问数据库。
// 前 100 名缓存 60 秒，避免页面来回切换时重复查询；下拉刷新会强制绕过缓存。

const cloud = require("./cloud");

const CACHE_TTL_MS = 60 * 1000;

let cache = null;
let inflight = null;
let requestSeq = 0;

function isEnabled() {
  return cloud.isEnabled();
}

function makeError(code, res) {
  const err = new Error(code + (res && res.code ? ":" + res.code : ""));
  err.result = res;
  return err;
}

// 给页面一个明确的缓存来源标记，避免把缓存内容误认为实时榜单。
function withCacheMeta(data, fromCache, cachedAt, stale) {
  return Object.assign({}, data, {
    fromCache: Boolean(fromCache),
    cachedAt: fromCache && Number.isFinite(cachedAt) ? cachedAt : null,
    stale: Boolean(stale),
  });
}

/**
 * 读取前 100 名榜单。
 * @param {{ force?: boolean }} options force 为 true 时绕过缓存与在途请求
 */
function fetchTop(options) {
  const force = Boolean(options && options.force);
  if (!isEnabled()) {
    return Promise.reject(new Error("CLOUD_DISABLED"));
  }

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Promise.resolve(withCacheMeta(cache.data, true, cache.at, false));
  }
  if (!force && inflight) {
    return inflight;
  }

  const seq = ++requestSeq;
  const promise = cloud
    .getRank()
    .then((res) => {
      if (!res || !res.ok) {
        throw makeError("GET_RANK_FAILED", res);
      }
      // 只让最新一次请求写入缓存，避免旧响应覆盖新数据
      if (seq === requestSeq) {
        cache = { at: Date.now(), data: res };
      }
      return withCacheMeta(res, false, null, false);
    })
    .catch((err) => {
      // 请求失败时优先展示上次成功缓存，并标记为非实时数据。
      if (cache) {
        return withCacheMeta(cache.data, true, cache.at, true);
      }
      throw err;
    });

  inflight = promise;
  promise.then(
    () => {
      if (inflight === promise) inflight = null;
    },
    () => {
      if (inflight === promise) inflight = null;
    }
  );
  return promise;
}

/**
 * 读取当前用户的排名。个人排名不缓存，确保刚提交的成绩尽快反映。
 */
function fetchMyRank() {
  if (!isEnabled()) {
    return Promise.reject(new Error("CLOUD_DISABLED"));
  }
  return cloud.getMyRank().then((res) => {
    if (!res || !res.ok) {
      throw makeError("GET_MY_RANK_FAILED", res);
    }
    return res;
  });
}

/**
 * 成绩提交成功或本地最佳变化后调用，避免榜单显示旧数据。
 */
function invalidate() {
  cache = null;
  requestSeq += 1;
  // 旧请求可能仍在网络中；清掉在途引用，后续普通加载会重新请求，
  // 避免把提交前的旧榜单返回给页面。
  inflight = null;
}

module.exports = {
  CACHE_TTL_MS,
  isEnabled,
  fetchTop,
  fetchMyRank,
  invalidate,
};
