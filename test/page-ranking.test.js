// 排行榜页面测试：node test/page-ranking.test.js
const assert = require("assert");

const storage = new Map();
let cloudHandler = () => Promise.reject(new Error("NO_CLOUD"));
let stopPullDownCalls = 0;

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  stopPullDownRefresh() {
    stopPullDownCalls += 1;
  },
  cloud: {
    callFunction({ name, data }) {
      return Promise.resolve()
        .then(() => cloudHandler(name, data))
        .then((result) => ({ result }));
    },
  },
};

const cloudConfig = require("../miniprogram/config/cloud");
cloudConfig.envId = "test-ranking-env";

let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};

let now = 1700000000000;
Date.now = () => now;

const ranking = require("../miniprogram/services/ranking");
require("../miniprogram/pages/ranking/ranking.js");

function createPage() {
  const page = {};
  Object.keys(pageDefinition).forEach((key) => {
    page[key] = pageDefinition[key];
  });
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page.setData = function (patch) {
    Object.keys(patch).forEach((key) => {
      this.data[key] = patch[key];
    });
  };
  return page;
}

function freshPage() {
  ranking.invalidate();
  const page = createPage();
  page.onLoad();
  return page;
}

function tick(times = 3) {
  let chain = Promise.resolve();
  for (let i = 0; i < times; i += 1) {
    chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return chain;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function rankItem(rank, name, error, isMe, extra) {
  return {
    rank,
    name,
    error,
    isMe,
    ...(extra || {}),
  };
}

function noRecord() {
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

let passed = 0;
function eq(actual, expected, label) {
  assert.strictEqual(
    actual,
    expected,
    `${label}（期望 ${expected}，实际 ${actual}）`
  );
  passed += 1;
}

async function main() {
  // ---- 1. 云开发未配置：排行榜暂未开放 ----
  {
    storage.clear();
    cloudConfig.envId = "";
    cloudHandler = () => Promise.reject(new Error("SHOULD_NOT_CALL"));

    const page = freshPage();
    await tick();
    eq(page.data.cloudEnabled, false, "未配置云环境");
    eq(page.data.state, "disabled", "排行榜禁用状态");
    eq(page.data.stateText, "排行榜暂未开放", "禁用文案");
    eq(page.data.loading, false, "禁用时不显示加载中");
    eq(page.data.list.length, 0, "禁用时不显示榜单");
    eq(page.data.showBottomBar, false, "禁用时不显示我的排名");

    cloudConfig.envId = "test-ranking-env";
  }

  // ---- 2. 空排行榜：指定空榜文案 ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [],
          total: 0,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") return Promise.resolve(noRecord());
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;

    eq(page.data.state, "empty", "空榜状态");
    eq(
      page.data.stateText,
      "目前无人上榜，第一名等你来拿。",
      "空榜文案"
    );
    eq(page.data.total, 0, "空榜总人数");
    eq(page.data.list.length, 0, "空榜列表");
    eq(page.data.showBottomBar, false, "空榜不显示我的排名栏");
    eq(page.data.showMySummary, false, "空榜不显示我的排名摘要");
    eq(page.data.loading, false, "空榜加载完成");
  }

  // ---- 2b. 空榜与个人排名快照不一致：仍以空榜为准，不显示虚假摘要 ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [],
          total: 0,
          meInTop100: true,
        });
      }
      if (name === "getMyRank") {
        return Promise.resolve({
          ok: true,
          hasRecord: true,
          best: { elapsed: 1000, error: 0 },
          rank: 1,
          total: 1,
          percentile: 100,
          previousError: null,
          gap: null,
          isFirst: true,
        });
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;

    eq(page.data.state, "empty", "快照不一致时保持空榜状态");
    eq(page.data.showMySummary, false, "空榜不显示个人摘要");
    eq(page.data.showBottomBar, false, "空榜不显示底部个人栏");
  }

  // ---- 3. 当前用户在前 100：高亮本人，前三名样式 ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [
            rankItem(1, "挑战者·AAAAAAAAAA", 2, false, {
              openid: "secret-a",
              _id: "best_secret_a",
            }),
            rankItem(2, "挑战者·BBBBBBBBBB", 5, true, {
              openid: "secret-b",
              _id: "best_secret_b",
            }),
            rankItem(3, "挑战者·CCCCCCCCCC", 8, false),
          ],
          total: 10,
          meInTop100: true,
        });
      }
      if (name === "getMyRank") {
        return Promise.resolve({
          ok: true,
          hasRecord: true,
          best: { elapsed: 1005, error: 5 },
          rank: 2,
          total: 10,
          percentile: 88.9,
          previousError: 2,
          gap: 3,
          isFirst: false,
        });
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;

    eq(page.data.state, "ready", "榜单加载完成");
    eq(page.data.stateText, "", "有榜单时不显示状态文案");
    eq(page.data.list.length, 3, "榜单条数");
    eq(page.data.total, 10, "榜单总人数");
    eq(page.data.meInTop100, true, "本人在前 100");

    eq(page.data.list[0].rowClass, "rank-row top-1", "第一名样式");
    eq(page.data.list[0].rankClass, "rank-no medal-1", "金牌样式");
    eq(page.data.list[1].rowClass, "rank-row top-2 is-me", "第二名本人高亮");
    eq(page.data.list[1].rankClass, "rank-no medal-2", "银牌样式");
    eq(page.data.list[2].rowClass, "rank-row top-3", "第三名样式");
    eq(page.data.list[2].rankClass, "rank-no medal-3", "铜牌样式");

    eq(page.data.list[0].openid, undefined, "页面不保留 openid");
    eq(page.data.list[0]._id, undefined, "页面不保留完整 _id");

    eq(page.data.showMySummary, true, "前 100 显示我的排名摘要");
    eq(page.data.showBottomBar, false, "前 100 不显示底部固定栏");
    eq(page.data.myStatus, "ready", "个人排名加载完成");
    eq(page.data.my.rank, 2, "个人排名");
    eq(page.data.my.percentText, "超越 88.9%", "个人百分比");
    eq(page.data.my.gapText, "距离上一名只差 3 ms", "个人差距");
    eq(page.data.my.onlyOne, false, "多人榜单人提示关闭");
  }

  // ---- 4. 当前用户不在前 100：底部固定显示我的排名 ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [
            rankItem(1, "挑战者·AAAAAAAAAA", 1, false),
            rankItem(2, "挑战者·BBBBBBBBBB", 2, false),
          ],
          total: 105,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") {
        return Promise.resolve({
          ok: true,
          hasRecord: true,
          best: { elapsed: 1101, error: 101 },
          rank: 101,
          total: 105,
          percentile: 3.8,
          previousError: 100,
          gap: 1,
          isFirst: false,
        });
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;

    eq(page.data.state, "ready", "榜外用户榜单正常");
    eq(page.data.total, 105, "总人数 105");
    eq(page.data.meInTop100, false, "本人不在前 100");
    eq(page.data.showBottomBar, true, "榜外显示底部排名栏");
    eq(page.data.showMySummary, false, "榜外不显示顶部摘要");
    eq(page.data.myStatus, "ready", "榜外个人排名完成");
    eq(page.data.my.rank, 101, "榜外个人排名 101");
    eq(page.data.my.percentText, "超越 3.8%", "榜外个人百分比");
    eq(page.data.my.gapText, "距离上一名只差 1 ms", "榜外个人差距");
  }

  // ---- 5. 榜单请求失败：错误状态可重试 ----
  {
    storage.clear();
    let failOnce = true;
    let getRankCalls = 0;
    cloudHandler = (name) => {
      if (name === "getRank") {
        getRankCalls += 1;
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error("NETWORK_DOWN"));
        }
        return Promise.resolve({
          ok: true,
          list: [rankItem(1, "挑战者·RETRY", 1, false)],
          total: 1,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") return Promise.resolve(noRecord());
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;

    eq(page.data.state, "error", "榜单失败状态");
    eq(
      page.data.stateText,
      "排行榜加载失败，请下拉刷新重试",
      "榜单失败文案"
    );
    eq(page.data.list.length, 0, "失败时不展示假数据");
    eq(page.data.loading, false, "失败时结束加载");
    eq(page.data.showBottomBar, false, "失败时不显示排名栏");

    page.onRetry();
    await tick(6);
    eq(getRankCalls, 2, "重试会重新请求榜单");
    eq(page.data.state, "ready", "重试后恢复榜单");
    eq(page.data.list.length, 1, "重试后展示数据");
  }

  // ---- 6. 榜单成功、个人排名失败：榜单仍可用 ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [
            rankItem(1, "挑战者·ONE", 1, false),
            rankItem(2, "挑战者·TWO", 2, false),
          ],
          total: 2,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") {
        return Promise.reject(new Error("MY_RANK_DOWN"));
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;

    eq(page.data.state, "ready", "个人排名失败不影响榜单");
    eq(page.data.list.length, 2, "榜单仍有数据");
    eq(page.data.myStatus, "error", "个人排名失败状态");
    eq(page.data.my, null, "个人排名失败不返回假数据");
    eq(page.data.showBottomBar, true, "榜外显示个人排名占位");
    eq(page.data.myText, "我的排名暂不可用", "个人排名失败文案");
  }

  // ---- 7. 旧榜单请求不覆盖新榜单 ----
  {
    storage.clear();
    const rankDeferreds = [];
    cloudHandler = (name) => {
      if (name === "getRank") {
        const d = deferred();
        rankDeferreds.push(d);
        return d.promise;
      }
      if (name === "getMyRank") return Promise.resolve(noRecord());
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick(2);
    eq(rankDeferreds.length, 1, "首次榜单请求已发起");

    const secondLoad = page.load(true);
    await tick(2);
    eq(rankDeferreds.length, 2, "第二次榜单请求已发起");

    rankDeferreds[1].resolve({
      ok: true,
      list: [rankItem(1, "挑战者·NEW", 1, false)],
      total: 1,
      meInTop100: false,
    });
    await secondLoad;
    eq(page.data.list[0].name, "挑战者·NEW", "展示新榜单");

    rankDeferreds[0].resolve({
      ok: true,
      list: [rankItem(1, "挑战者·OLD", 99, false)],
      total: 1,
      meInTop100: false,
    });
    await tick(6);
    eq(page.data.list[0].name, "挑战者·NEW", "旧响应不覆盖新榜单");
    eq(page.data.list[0].error, 1, "旧响应不覆盖新误差");
  }

  // ---- 8. 榜单短缓存：普通重复加载不重复请求，强制刷新绕过 ----
  {
    storage.clear();
    let getRankCalls = 0;
    cloudHandler = (name) => {
      if (name === "getRank") {
        getRankCalls += 1;
        return Promise.resolve({
          ok: true,
          list: [rankItem(1, "挑战者·CACHE", 1, false)],
          total: 1,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") return Promise.resolve(noRecord());
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;
    eq(getRankCalls, 1, "首次加载请求榜单");

    await page.load(false);
    eq(getRankCalls, 1, "缓存期内不重复请求榜单");

    now += ranking.CACHE_TTL_MS + 1;
    await page.load(false);
    eq(getRankCalls, 2, "缓存过期后重新请求榜单");

    await page.load(true);
    eq(getRankCalls, 3, "强制刷新绕过缓存");
  }

  // ---- 9. 下拉刷新：重新请求并停止刷新动画 ----
  {
    storage.clear();
    stopPullDownCalls = 0;
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [rankItem(1, "挑战者·PULL", 1, false)],
          total: 1,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") return Promise.resolve(noRecord());
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;
    page.onPullDownRefresh();
    await tick(6);

    eq(stopPullDownCalls, 1, "下拉刷新结束后停止动画");
    eq(page.data.state, "ready", "下拉刷新后榜单正常");
  }

  // ---- 10. 单人榜：底部摘要 / 100% 文案 ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [rankItem(1, "挑战者·SOLO", 0, true)],
          total: 1,
          meInTop100: true,
        });
      }
      if (name === "getMyRank") {
        return Promise.resolve({
          ok: true,
          hasRecord: true,
          best: { elapsed: 1000, error: 0 },
          rank: 1,
          total: 1,
          percentile: 100,
          previousError: null,
          gap: null,
          isFirst: true,
        });
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await page._loadPromise;

    eq(page.data.showMySummary, true, "单人榜显示摘要");
    eq(page.data.showBottomBar, false, "单人榜不显示底部栏");
    eq(page.data.my.rank, 1, "单人榜第一名");
    eq(page.data.my.percentText, "超越 100%", "单人榜 100% 文案");
    eq(page.data.my.gapText, "你就是第一名", "单人榜第一名文案");
    eq(page.data.my.onlyOne, true, "单人榜提示");
  }

  console.log(`✓ ${passed} 项断言全部通过`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
