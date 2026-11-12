// 结果页 / 排行榜页分享与本地统计测试：node test/page-share.test.js
const assert = require("assert");

const storage = new Map();
let cloudHandler = () => Promise.reject(new Error("NO_CLOUD"));
let navigateToCalls = [];
let reLaunchCalls = [];
let navigateBackCalls = [];

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  vibrateShort() {},
  navigateTo(options) {
    navigateToCalls.push(options);
  },
  reLaunch(options) {
    reLaunchCalls.push(options);
  },
  navigateBack(options) {
    navigateBackCalls.push(options);
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
cloudConfig.envId = "";
const ranking = require("../miniprogram/services/ranking");
const stats = require("../miniprogram/services/stats");
const share = require("../miniprogram/utils/share");

let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};

require("../miniprogram/pages/index/index.js");
const indexDefinition = pageDefinition;
pageDefinition = null;
require("../miniprogram/pages/ranking/ranking.js");
const rankingDefinition = pageDefinition;

const realDateNow = Date.now;
let now = 1700000000000;
Date.now = () => now;

function createPage(definition) {
  const page = {};
  Object.keys(definition).forEach((key) => {
    page[key] = definition[key];
  });
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch) {
    Object.keys(patch).forEach((key) => {
      this.data[key] = patch[key];
    });
  };
  return page;
}

function freshIndex() {
  const page = createPage(indexDefinition);
  page._startTime = 0;
  page._settled = false;
  page.onLoad();
  return page;
}

function freshRanking() {
  const page = createPage(rankingDefinition);
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

function noCloudRecord() {
  return { ok: true, hasRecord: false, best: null };
}

function usefulRank(overrides) {
  return {
    ok: true,
    hasRecord: true,
    best: { elapsed: 1010, error: 10 },
    rank: 2,
    total: 3,
    percentile: 50,
    previousError: 5,
    gap: 5,
    isFirst: false,
    ...(overrides || {}),
  };
}

function play(page, elapsed) {
  page.onStartGame();
  page.onStartTiming();
  now += elapsed;
  page.onStop();
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

function includes(value, expected, label) {
  assert.ok(
    value.includes(expected),
    `${label}（期望包含 ${expected}，实际 ${value}）`
  );
  passed += 1;
}

function excludes(value, expected, label) {
  assert.ok(
    !value.includes(expected),
    `${label}（不应包含 ${expected}，实际 ${value}）`
  );
  passed += 1;
}

async function main() {
  // ---- 1. 无云环境：结果页仍可分享真实误差，并累计本地指标 ----
  {
    storage.clear();
    cloudConfig.envId = "";
    cloudHandler = () => Promise.reject(new Error("SHOULD_NOT_CALL"));

    const page = freshIndex();
    const idleShare = page.onShareAppMessage();
    eq(idleShare.title, share.DEFAULT_RESULT_TITLE, "非结果页使用通用标题");
    eq(idleShare.path, share.SHARE_PATH, "非结果页分享进入首页");

    play(page, 1010);
    eq(page.data.status, "result", "无云端时正常结算");
    eq(page.data.cloudEnabled, false, "无云端时不启用云端功能");
    eq(page.data.rankStatus, "", "无云端时不显示排名状态");

    const result = page.onShareAppMessage();
    includes(result.title, "10ms", "无云环境分享包含真实误差");
    excludes(result.title, "第", "无云环境不伪造排名");
    eq(result.path, share.SHARE_PATH, "结果分享路径为首页");

    page.onShareTap();
    const data = stats.readStats();
    eq(data.validChallenges, 1, "有效挑战累计一次");
    eq(data.shareEntryClicks, 1, "分享入口点击累计一次");
    eq(data.rankingOpens, 0, "进入结果页不增加排行榜打开次数");
  }

  // ---- 2. 排名已确认：结果页分享使用真实名次 ----
  {
    storage.clear();
    cloudConfig.envId = "test-share-env";
    cloudHandler = (name) => {
      if (name === "getMyScore") return Promise.resolve(noCloudRecord());
      if (name === "submitScore") {
        return Promise.resolve({
          ok: true,
          refreshed: true,
          reason: "created",
          best: { elapsed: 1010, error: 10 },
        });
      }
      if (name === "getMyRank") return Promise.resolve(usefulRank());
      return Promise.resolve({ ok: false });
    };

    const page = freshIndex();
    await tick();
    play(page, 1010);
    await tick(6);

    eq(page.data.rankStatus, "ready", "排名已确认");
    const result = page.onShareAppMessage();
    includes(result.title, "第 2 名", "结果分享包含确认排名");
    eq(result.path, share.SHARE_PATH, "带排名分享仍进入首页");

    // 排名尚未确认时不能使用旧名次
    page.setData({ rankStatus: "loading", rankNo: 0 });
    const fallback = page.onShareAppMessage();
    includes(fallback.title, "10ms", "排名未确认时回退到误差");
    excludes(fallback.title, "第 2 名", "排名未确认时不使用旧名次");
  }

  // ---- 3. 无效成绩：不描述为有效记录，不请求排名 ----
  {
    storage.clear();
    cloudConfig.envId = "test-share-env";
    let rankCalls = 0;
    cloudHandler = (name) => {
      if (name === "getMyScore") return Promise.resolve(noCloudRecord());
      if (name === "getMyRank") {
        rankCalls += 1;
        return Promise.resolve(usefulRank());
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshIndex();
    await tick();
    play(page, 4000);
    await tick(4);

    eq(page.data.invalid, true, "超出范围成绩无效");
    eq(page.data.rankStatus, "", "无效成绩不展示排名状态");
    eq(rankCalls, 0, "无效成绩不请求个人排名");

    const result = page.onShareAppMessage();
    includes(result.title, "超出有效范围", "无效分享明确说明范围");
    excludes(result.title, "只差", "无效分享不写有效误差");
    excludes(result.title, "第", "无效分享不携带排名");

    const data = stats.readStats();
    eq(data.validChallenges, 0, "无效成绩不计入有效挑战");
    eq(data.shareEntryClicks, 0, "未点击分享入口不计数");
  }

  // ---- 4. 排名失败可重试，重试成功后分享使用新排名 ----
  {
    storage.clear();
    cloudConfig.envId = "test-share-env";
    let rankCalls = 0;
    cloudHandler = (name) => {
      if (name === "getMyScore") return Promise.resolve(noCloudRecord());
      if (name === "submitScore") {
        return Promise.resolve({
          ok: true,
          refreshed: true,
          reason: "created",
          best: { elapsed: 1010, error: 10 },
        });
      }
      if (name === "getMyRank") {
        rankCalls += 1;
        if (rankCalls === 1) {
          return Promise.reject(new Error("RANK_DOWN"));
        }
        return Promise.resolve(usefulRank({ rank: 1, total: 1, percentile: 100, gap: null, isFirst: true }));
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshIndex();
    await tick();
    play(page, 1010);
    await tick(6);

    eq(page.data.rankStatus, "unavailable", "首次排名失败");
    eq(page.data.canRetryRank, true, "失败后提供重试");
    const failed = page.onShareAppMessage();
    includes(failed.title, "10ms", "失败时分享回退到误差");

    page.onRetryRank();
    await tick(6);
    eq(rankCalls, 2, "重试重新请求排名");
    eq(page.data.rankStatus, "ready", "重试后排名成功");
    const retried = page.onShareAppMessage();
    includes(retried.title, "第 1 名", "重试后分享使用新排名");
  }

  // ---- 5. 排行榜页分享：有确认排名，并累计打开次数 ----
  {
    storage.clear();
    cloudConfig.envId = "test-share-env";
    ranking.invalidate();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({
          ok: true,
          list: [{ rank: 1, name: "挑战者·ONE", error: 1, isMe: false }],
          total: 3,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") {
        return Promise.resolve(usefulRank({ rank: 2, total: 3 }));
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshRanking();
    await page._loadPromise;

    eq(page.data.myStatus, "ready", "排行榜个人排名已确认");
    const result = page.onShareAppMessage();
    includes(result.title, "第 2 名", "排行榜分享包含确认排名");
    eq(result.path, share.SHARE_PATH, "排行榜分享进入首页");

    page.onShareTap();
    const data = stats.readStats();
    eq(data.rankingOpens, 1, "打开排行榜累计一次");
    eq(data.shareEntryClicks, 1, "排行榜分享入口点击累计一次");
  }

  // ---- 6. 无云环境：排行榜仍显示分享入口并可分享通用文案 ----
  {
    storage.clear();
    cloudConfig.envId = "";
    ranking.invalidate();
    cloudHandler = () => Promise.reject(new Error("SHOULD_NOT_CALL"));

    const page = freshRanking();
    eq(page.data.state, "disabled", "无云环境排行榜禁用");
    const result = page.onShareAppMessage();
    eq(result.title, share.RANKING_TITLE, "无排名时使用排行榜通用标题");
    eq(result.path, share.SHARE_PATH, "无云环境分享路径有效");
    eq(stats.readStats().rankingOpens, 1, "禁用状态也累计打开次数");
  }

  // ---- 7. 空榜：提供返回挑战页入口 ----
  {
    storage.clear();
    cloudConfig.envId = "test-share-env";
    ranking.invalidate();
    cloudHandler = (name) => {
      if (name === "getRank") {
        return Promise.resolve({ ok: true, list: [], total: 0, meInTop100: false });
      }
      if (name === "getMyRank") return Promise.resolve(noCloudRecord());
      return Promise.resolve({ ok: false });
    };

    navigateBackCalls = [];
    reLaunchCalls = [];
    global.wx.navigateBack = (options) => {
      navigateBackCalls.push(options);
      if (options && options.fail) options.fail();
    };

    const page = freshRanking();
    await page._loadPromise;
    eq(page.data.state, "empty", "空榜状态");

    page.onBackToChallenge();
    eq(navigateBackCalls.length, 1, "优先返回上一页");
    eq(reLaunchCalls.length, 1, "无上一页时回到挑战页");
    eq(reLaunchCalls[0].url, share.SHARE_PATH, "返回入口指向首页");
  }

  // ---- 8. 网络失败但有缓存：显示缓存并明确标识非实时 ----
  {
    storage.clear();
    cloudConfig.envId = "test-share-env";
    ranking.invalidate();
    let failRank = false;
    cloudHandler = (name) => {
      if (name === "getRank") {
        if (failRank) return Promise.reject(new Error("NETWORK_DOWN"));
        return Promise.resolve({
          ok: true,
          list: [{ rank: 1, name: "挑战者·CACHE", error: 1, isMe: false }],
          total: 1,
          meInTop100: false,
        });
      }
      if (name === "getMyRank") return Promise.resolve(noCloudRecord());
      return Promise.resolve({ ok: false });
    };

    const page = freshRanking();
    await page._loadPromise;
    eq(page.data.state, "ready", "首次榜单加载成功");

    failRank = true;
    await page.load(true);
    eq(page.data.state, "ready", "刷新失败仍展示缓存榜单");
    eq(page.data.list[0].name, "挑战者·CACHE", "缓存内容保留");
    includes(page.data.cacheNotice, "缓存", "明确标识缓存数据");
    includes(page.data.refreshError, "刷新失败", "提示刷新失败");
    excludes(page.data.cacheNotice, "实时", "不把缓存说成实时数据");
  }

  console.log(`✓ ${passed} 项断言全部通过`);
}

main()
  .then(() => {
    Date.now = realDateNow;
  })
  .catch((err) => {
    Date.now = realDateNow;
    console.error(err);
    process.exit(1);
  });
