// 结果页排名反馈测试：node test/page-rank-feedback.test.js
const assert = require("assert");

const storage = new Map();
let cloudHandler = () => Promise.reject(new Error("NO_CLOUD"));

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  vibrateShort() {},
  cloud: {
    callFunction({ name, data }) {
      return Promise.resolve()
        .then(() => cloudHandler(name, data))
        .then((result) => ({ result }));
    },
  },
};

const cloudConfig = require("../miniprogram/config/cloud");
cloudConfig.envId = "test-env";

let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};

const realDateNow = Date.now;
let now = 1700000000000;
Date.now = () => now;

require("../miniprogram/pages/index/index.js");

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
  page._startTime = 0;
  page._settled = false;
  return page;
}

function freshPage() {
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

let passed = 0;
function eq(actual, expected, label) {
  assert.strictEqual(
    actual,
    expected,
    `${label}（期望 ${expected}，实际 ${actual}）`
  );
  passed += 1;
}

async function play(page, elapsed) {
  page.onStartGame();
  page.onStartTiming();
  now += elapsed;
  page.onStop();
}

async function main() {
  // ---- 1. 云开发未配置：结果页不发起排名请求 ----
  {
    storage.clear();
    cloudConfig.envId = "";
    let rankCalls = 0;
    cloudHandler = (name) => {
      if (name === "getMyRank") rankCalls += 1;
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick();
    eq(page.data.cloudEnabled, false, "未配置云环境时关闭云端功能");

    await play(page, 1010);
    await tick(4);
    eq(page.data.status, "result", "无云端时结果页正常展示");
    eq(page.data.rankStatus, "", "无云端时不显示排名状态");
    eq(rankCalls, 0, "无云端时不调用 getMyRank");

    cloudConfig.envId = "test-env";
  }

  // ---- 2. 正常排名反馈：异步显示，不阻塞结果 ----
  {
    storage.clear();
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
        return Promise.resolve(usefulRank());
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick();
    await play(page, 1010);

    eq(page.data.status, "result", "结果页立即可见");
    eq(page.data.durationText, "1.010", "结果用时立即展示");
    eq(page.data.rankStatus, "loading", "排名异步加载中");
    eq(page.data.elapsed, 1010, "排名请求不改变实际用时");

    await tick(6);
    eq(page.data.syncStatus, "synced", "提交成功标记已同步");
    eq(page.data.rankStatus, "ready", "排名加载完成");
    eq(page.data.rankText, "第 2 名", "展示我的名次");
    eq(page.data.rankPercentText, "超越 50.0%", "展示超越百分比");
    eq(
      page.data.rankGapText,
      "距离上一名只差 5 ms",
      "展示距上一名差距"
    );
    eq(page.data.rankBestText, "本局刷新个人最佳", "展示是否刷新最佳");
    eq(page.data.rankOnlyOne, false, "多人榜不显示单人提示");
    eq(rankCalls, 1, "正常结果只请求一次个人排名");
  }

  // ---- 3. 第一名：没有上一名，单人榜显示 100% ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getMyScore") return Promise.resolve(noCloudRecord());
      if (name === "submitScore") {
        return Promise.resolve({
          ok: true,
          refreshed: true,
          reason: "created",
          best: { elapsed: 1000, error: 0 },
        });
      }
      if (name === "getMyRank") {
        return Promise.resolve(
          usefulRank({
            best: { elapsed: 1000, error: 0 },
            rank: 1,
            total: 1,
            percentile: 100,
            previousError: null,
            gap: null,
            isFirst: true,
          })
        );
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick();
    await play(page, 1000);
    await tick(6);

    eq(page.data.rankStatus, "ready", "第一名排名加载完成");
    eq(page.data.rankText, "第 1 名", "第一名名次");
    eq(page.data.rankPercentText, "超越 100%", "单人榜百分比 100%");
    eq(page.data.rankGapText, "你就是第一名", "第一名文案");
    eq(page.data.rankOnlyOne, true, "单人榜提示");
    eq(
      page.data.rankBestText,
      "本局刷新个人最佳",
      "第一名刷新个人最佳"
    );
  }

  // ---- 4. 与上一名误差相同：gap = 0 文案 ----
  {
    storage.clear();
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
        return Promise.resolve(
          usefulRank({
            rank: 2,
            total: 3,
            percentile: 50,
            previousError: 10,
            gap: 0,
          })
        );
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick();
    await play(page, 1010);
    await tick(6);

    eq(page.data.rankStatus, "ready", "同误差排名加载完成");
    eq(
      page.data.rankGapText,
      "与上一名误差相同，提交时间稍晚",
      "同误差差距文案"
    );
    eq(page.data.rankPercentText, "超越 50.0%", "同误差百分比");
  }

  // ---- 5. 网络失败：结果保留，排名明确不可用 ----
  {
    storage.clear();
    cloudHandler = (name) => {
      if (name === "getMyScore") {
        return Promise.resolve(noCloudRecord());
      }
      return Promise.reject(new Error("NETWORK_DOWN"));
    };

    const page = freshPage();
    await tick();
    await play(page, 1010);
    await tick(6);

    eq(page.data.status, "result", "网络失败仍展示结果");
    eq(page.data.durationText, "1.010", "网络失败仍展示用时");
    eq(page.data.syncStatus, "pending", "提交失败标记待同步");
    eq(page.data.rankStatus, "unavailable", "排名明确不可用");
    eq(page.data.rankUnavailableText, "排名暂不可用", "排名失败文案");
    eq(page.data.rankGapText, "", "失败时不展示虚假差距");

    page.onRestart();
    eq(page.data.status, "ready", "网络失败后仍可重新挑战");
    eq(page.data.rankStatus, "", "重新挑战清空旧排名状态");
  }

  // ---- 6. 旧排名响应不覆盖下一局状态 ----
  {
    storage.clear();
    const rankDeferred = deferred();
    let rankStarted = false;
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
        rankStarted = true;
        return rankDeferred.promise;
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick();
    await play(page, 1010);
    await tick(6);
    eq(rankStarted, true, "已发起第一局排名请求");

    page.onRestart();
    page.onStartTiming();
    eq(page.data.status, "running", "已开始下一局");

    rankDeferred.resolve(
      usefulRank({
        rank: 9,
        total: 10,
        percentile: 10,
        previousError: 10,
        gap: 0,
      })
    );
    await tick(4);

    eq(page.data.status, "running", "旧响应不改变当前状态");
    eq(page.data.rankStatus, "", "旧响应不写入排名状态");
    eq(page.data.rankText, "", "旧响应不写入名次");
  }

  // ---- 7. 上一局响应不覆盖新一局结果 ----
  {
    storage.clear();
    const rankDeferreds = [];
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
        const d = deferred();
        rankDeferreds.push(d);
        return d.promise;
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick();
    await play(page, 1010);
    await tick(6);
    eq(rankDeferreds.length, 1, "第一局已发起排名请求");

    page.onRestart();
    await play(page, 1010);
    await tick(6);
    eq(rankDeferreds.length, 2, "第二局已发起排名请求");

    rankDeferreds[1].resolve(
      usefulRank({
        rank: 1,
        total: 1,
        percentile: 100,
        previousError: null,
        gap: null,
        isFirst: true,
      })
    );
    await tick(4);
    eq(page.data.rankStatus, "ready", "第二局排名已展示");
    eq(page.data.rankText, "第 1 名", "第二局名次正确");
    eq(page.data.rankGapText, "你就是第一名", "第二局第一名文案");

    rankDeferreds[0].resolve(
      usefulRank({
        rank: 9,
        total: 10,
        percentile: 10,
        previousError: 10,
        gap: 0,
      })
    );
    await tick(4);
    eq(page.data.rankStatus, "ready", "旧响应到达后状态不变");
    eq(page.data.rankText, "第 1 名", "旧响应不覆盖新名次");
    eq(page.data.rankGapText, "你就是第一名", "旧响应不覆盖新文案");
  }

  // ---- 8. 本地最佳更好但未同步：不展示旧云端名次 ----
  {
    storage.clear();
    storage.set("bestError", 5);
    storage.set("bestElapsed", 995);

    cloudHandler = (name) => {
      if (name === "getMyScore") return Promise.resolve(noCloudRecord());
      if (name === "submitScore") {
        return Promise.reject(new Error("NETWORK_DOWN"));
      }
      if (name === "getMyRank") {
        return Promise.resolve(
          usefulRank({
            best: { elapsed: 1010, error: 10 },
            rank: 5,
            total: 10,
            percentile: 44.4,
            previousError: 10,
            gap: 0,
          })
        );
      }
      return Promise.resolve({ ok: false });
    };

    const page = freshPage();
    await tick();
    await play(page, 995);
    await tick(6);

    eq(page.data.rankStatus, "pending", "旧云端名次标记为待同步");
    eq(page.data.rankText, "", "不展示旧云端名次");
    eq(page.data.rankGapText, "", "不展示旧云端差距");
    eq(page.data.syncStatus, "pending", "同步状态保持待同步");
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
