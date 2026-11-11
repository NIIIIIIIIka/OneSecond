// 页面云同步行为测试：node test/page-cloud.test.js
const assert = require("assert");

// ---- 模拟微信小程序运行环境 ----
const storage = new Map();
let networkHandler = null;
let cloudHandler = () => Promise.reject(new Error("NO_CLOUD"));

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  vibrateShort() {},
  onNetworkStatusChange(handler) {
    networkHandler = handler;
  },
  offNetworkStatusChange() {
    networkHandler = null;
  },
  cloud: {
    callFunction({ name, data }) {
      return Promise.resolve()
        .then(() => cloudHandler(name, data))
        .then((result) => ({ result }));
    },
  },
};

// 开启云开发（测试进程内有效）
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
  // ---- 1. 云端不可用时，本地挑战照常，成绩标记待同步 ----
  {
    storage.clear();
    cloudHandler = () => Promise.reject(new Error("NETWORK_DOWN"));

    const page = freshPage();
    await tick();

    eq(page.data.cloudEnabled, true, "已配置环境时启用云同步");
    eq(page.data.status, "idle", "云端不可用不影响初始状态");

    page.onStartGame();
    page.onStartTiming();
    now += 1010;
    page.onStop();

    eq(page.data.status, "result", "云端不可用时仍正常结算");
    eq(page.data.elapsed, 1010, "计时结果不受网络影响");
    eq(page.data.error, 10, "误差正常计算");
    eq(page.data.isNewBest, true, "本地最佳照常更新");
    eq(storage.get("bestError"), 10, "本地最佳误差已保存");
    eq(storage.get("bestElapsed"), 1010, "本地最佳用时已保存");

    await tick();
    eq(page.data.syncStatus, "pending", "提交失败标记待同步");
    eq(page.data.syncText, "待同步", "待同步文案");

    // ---- 2. 网络恢复后重试待同步成绩 ----
    let submitted = null;
    cloudHandler = (name, data) => {
      if (name === "submitScore") {
        submitted = data;
        return Promise.resolve({
          ok: true,
          refreshed: true,
          reason: "improved",
          best: { elapsed: 1010, error: 10 },
        });
      }
      return Promise.resolve({
        ok: true,
        hasRecord: true,
        best: { elapsed: 1010, error: 10 },
      });
    };

    eq(typeof networkHandler, "function", "已注册网络状态监听");
    networkHandler({ isConnected: true });
    await tick();

    eq(submitted && submitted.elapsed, 1010, "网络恢复后重试本地最佳");
    eq(page.data.syncStatus, "synced", "重试成功标记已同步");
    eq(storage.get("cloudBest").error, 10, "云端确认结果已缓存");
  }

  // ---- 3. 云端成绩更优时采用云端 ----
  {
    storage.clear();
    storage.set("bestError", 25);
    storage.set("bestElapsed", 975); // 误差 25

    cloudHandler = (name) => {
      if (name === "getMyScore") {
        return Promise.resolve({
          ok: true,
          hasRecord: true,
          best: { elapsed: 995, error: 5 },
        });
      }
      return Promise.resolve({ ok: false, code: "RATE_LIMITED" });
    };

    const page = freshPage();
    await tick();

    eq(page.data.bestError, 5, "采用云端更优误差");
    eq(page.data.bestDurationText, "0.995", "展示云端更优用时");
    eq(storage.get("bestElapsed"), 995, "云端成绩写回本地");
    eq(storage.get("bestError"), 5, "云端误差写回本地");
    eq(page.data.syncStatus, "synced", "云端更优时标记已同步");
  }

  // ---- 4. 本地成绩更优时提交云端 ----
  {
    storage.clear();
    storage.set("bestError", 5);
    storage.set("bestElapsed", 995);

    let submitted = null;
    cloudHandler = (name, data) => {
      if (name === "getMyScore") {
        return Promise.resolve({
          ok: true,
          hasRecord: true,
          best: { elapsed: 1010, error: 10 },
        });
      }
      submitted = data;
      return Promise.resolve({
        ok: true,
        refreshed: true,
        reason: "improved",
        best: { elapsed: 995, error: 5 },
      });
    };

    const page = freshPage();
    await tick();

    eq(submitted && submitted.elapsed, 995, "提交本地更优成绩");
    eq(page.data.syncStatus, "synced", "提交成功标记已同步");
    eq(storage.get("cloudBest").elapsed, 995, "缓存云端最新最佳");
  }

  // ---- 5. 误差相同：不重复提交，保留本地展示 ----
  {
    storage.clear();
    storage.set("bestError", 10);
    storage.set("bestElapsed", 1010);

    let submitCalls = 0;
    cloudHandler = (name) => {
      if (name === "getMyScore") {
        return Promise.resolve({
          ok: true,
          hasRecord: true,
          best: { elapsed: 990, error: 10 },
        });
      }
      submitCalls += 1;
      return Promise.resolve({
        ok: true,
        refreshed: false,
        reason: "kept",
        best: { elapsed: 990, error: 10 },
      });
    };

    const page = freshPage();
    await tick();

    eq(page.data.bestError, 10, "相同误差保持本地误差展示");
    eq(page.data.bestDurationText, "1.010", "相同误差保持本地用时展示");
    eq(storage.get("bestElapsed"), 1010, "相同误差不改写本地用时");
    eq(submitCalls, 0, "相同误差不重复提交");
    eq(page.data.syncStatus, "synced", "相同误差视为已同步");
  }

  // ---- 6. 服务端限流：保持待同步，不误报成功 ----
  {
    storage.clear();
    storage.set("bestError", 5);
    storage.set("bestElapsed", 995);

    cloudHandler = (name) => {
      if (name === "getMyScore") {
        return Promise.resolve({ ok: true, hasRecord: false, best: null });
      }
      return Promise.resolve({
        ok: false,
        code: "RATE_LIMITED",
        retryAfterMs: 800,
      });
    };

    const page = freshPage();
    await tick(5);

    eq(page.data.syncStatus, "pending", "限流时保持待同步");
  }

  // ---- 7. 旧请求成功返回时，本地已产生更好成绩则不算已同步 ----
  {
    storage.clear();
    storage.set("bestError", 10);
    storage.set("bestElapsed", 1010);

    let resolveSubmit = null;
    cloudHandler = (name) => {
      if (name === "getMyScore") {
        return Promise.resolve({ ok: true, hasRecord: false, best: null });
      }
      return new Promise((resolve) => {
        resolveSubmit = resolve;
      });
    };

    const page = freshPage();
    await tick();

    eq(typeof resolveSubmit, "function", "已发起首次提交");
    eq(page.data.syncStatus, "syncing", "提交中状态");

    // 提交进行中，本地又产生了更好的成绩
    storage.set("bestError", 5);
    storage.set("bestElapsed", 995);

    resolveSubmit({
      ok: true,
      refreshed: true,
      reason: "created",
      best: { elapsed: 1010, error: 10 },
    });
    await tick();

    eq(
      page.data.syncStatus,
      "pending",
      "旧请求成功后仍保持待同步，避免误报"
    );
    eq(storage.get("bestError"), 5, "更好的本地成绩未被覆盖");
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
