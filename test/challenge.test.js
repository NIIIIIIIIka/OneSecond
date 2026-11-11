// 页面状态机与计时逻辑测试：node test/challenge.test.js
const assert = require("assert");

// ---- 模拟微信小程序运行环境 ----
const storage = new Map();

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  vibrateShort() {},
};

let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};

const realDateNow = Date.now;
let now = 1700000000000;
let nowCalls = 0;
Date.now = () => {
  nowCalls += 1;
  return now;
};

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

let passed = 0;
function eq(actual, expected, label) {
  assert.strictEqual(
    actual,
    expected,
    `${label}（期望 ${expected}，实际 ${actual}）`
  );
  passed += 1;
}

function freshPage() {
  storage.clear();
  const page = createPage();
  page.onLoad();
  return page;
}

// ---- 1. idle → ready：不启动计时 ----
let page = freshPage();
eq(page.data.status, "idle", "初始为 idle");

const callsBeforeReady = nowCalls;
page.onStartGame();
eq(page.data.status, "ready", "开始游戏进入 ready");
eq(page._startTime, 0, "ready 状态不记录开始时间");
eq(nowCalls, callsBeforeReady, "ready 状态不读取当前时间");

// ---- 2. ready → running：点击开始计时才记录时间 ----
const callsBeforeStart = nowCalls;
page.onStartTiming();
eq(page.data.status, "running", "开始计时进入 running");
eq(page._startTime, now, "开始计时记录开始时间");
eq(nowCalls - callsBeforeStart, 1, "只在开始计时读取一次时间");

const callsAfterStart = nowCalls;
page.onStartTiming(); // 连续点击
eq(page._startTime, now, "重复点击开始计时不重置开始时间");
eq(nowCalls, callsAfterStart, "重复点击不重复读取时间");

// ---- 3. running → result：点击就现在才记录停止时间 ----
now += 1010;
const callsBeforeStop = nowCalls;
page.onStop();
eq(page.data.status, "result", "就现在进入 result");
eq(nowCalls - callsBeforeStop, 1, "只在停止时读取一次时间");
eq(page.data.elapsed, 1010, "实际用时");
eq(page.data.error, 10, "误差计算");
eq(page.data.durationText, "1.010", "实际用时保留三位小数");
eq(page.data.direction, "偏慢了", "偏慢判定");
eq(page.data.tier, "人体原子钟", "成绩分级");
eq(page.data.isNewBest, true, "首局成为个人最佳");
eq(storage.get("bestError"), 10, "最佳误差已保存");
eq(storage.get("bestElapsed"), 1010, "最佳用时已保存");
eq(page.data.bestDurationText, "1.010", "结果页展示最佳用时");

// 重复停止不会重复结算
const callsBeforeStopAgain = nowCalls;
const settledSnapshot = {
  status: page.data.status,
  elapsed: page.data.elapsed,
  error: page.data.error,
};
page.onStop();
eq(page.data.status, settledSnapshot.status, "重复停止不改变状态");
eq(page.data.elapsed, settledSnapshot.elapsed, "重复停止不改变用时");
eq(page.data.error, settledSnapshot.error, "重复停止不改变误差");
eq(nowCalls, callsBeforeStopAgain, "重复停止不重复读取时间");

// ---- 4. result → ready：再来一局不直接计时 ----
const callsBeforeRestart = nowCalls;
const startBeforeRestart = page._startTime;
page.onRestart();
eq(page.data.status, "ready", "再来一局进入 ready");
eq(page._startTime, startBeforeRestart, "再来一局不记录开始时间");
eq(nowCalls, callsBeforeRestart, "再来一局不读取当前时间");

// ---- 5. 较差成绩不覆盖最佳 ----
page.onStartTiming();
now += 1500;
page.onStop();
eq(page.data.status, "result", "第二局正常结算");
eq(page.data.isNewBest, false, "较差成绩不是新纪录");
eq(storage.get("bestError"), 10, "较差成绩不覆盖最佳误差");
eq(storage.get("bestElapsed"), 1010, "较差成绩不覆盖最佳用时");
eq(page.data.bestDurationText, "1.010", "最佳用时展示保持不变");

// ---- 6. 超过 3000ms 的成绩无效 ----
page.onRestart();
page.onStartTiming();
now += 3001;
page.onStop();
eq(page.data.invalid, true, "3001ms 成绩无效");
eq(page.data.durationText, "3.001", "无效成绩仍展示实际用时");
eq(page.data.isNewBest, false, "无效成绩不是新纪录");
eq(storage.get("bestError"), 10, "无效成绩不覆盖最佳误差");

// ---- 7. 切后台取消 running ----
page.onRestart();
page.onStartTiming();
eq(page.data.status, "running", "重新进入 running");
page.onHide();
eq(page.data.status, "ready", "切后台后取消挑战并回到 ready");
const storageSnapshot = {
  error: storage.get("bestError"),
  elapsed: storage.get("bestElapsed"),
};
page.onStop();
eq(page.data.status, "ready", "取消后点击就现在不会结算");
eq(storage.get("bestError"), storageSnapshot.error, "取消的挑战不写入最佳");
eq(storage.get("bestElapsed"), storageSnapshot.elapsed, "取消的挑战不写入用时");

// ---- 8. 正好一秒与偏快 ----
page = freshPage();
page.onStartGame();
page.onStartTiming();
now += 1000;
page.onStop();
eq(page.data.error, 0, "正好一秒误差为 0");
eq(page.data.direction, "正好一秒", "正好一秒判定");
eq(page.data.durationText, "1.000", "1.000 秒");
eq(page.data.isNewBest, true, "0ms 成为最佳");

page.onRestart();
page.onStartTiming();
now += 985;
page.onStop();
eq(page.data.error, 15, "偏快时误差为 15ms");
eq(page.data.direction, "偏快了", "偏快判定");

// ---- 9. 本地存储兼容性 ----
storage.clear();
storage.set("bestError", 25);
page = createPage();
page.onLoad();
eq(page.data.hasBest, true, "读取旧版本只有误差的最佳成绩");
eq(page.data.bestError, 25, "旧最佳误差值");
eq(page.data.bestDurationText, "", "旧数据没有最佳用时");

storage.clear();
storage.set("bestError", 0);
page = createPage();
page.onLoad();
eq(page.data.hasBest, true, "0ms 最佳成绩存在");
eq(page.data.bestError, 0, "0ms 最佳成绩值");

// ---- 10. 非法状态点击无效 ----
page = freshPage();
page.onStartTiming();
eq(page.data.status, "idle", "idle 下不能直接开始计时");

page.onStartGame();
page.onRestart();
eq(page.data.status, "ready", "ready 下再来一局无效");

console.log(`✓ ${passed} 项断言全部通过`);

Date.now = realDateNow;
