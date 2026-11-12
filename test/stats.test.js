// 本地体验统计测试：node test/stats.test.js
const assert = require("assert");

const storage = new Map();
let getThrows = false;
let setThrows = false;

global.wx = {
  getStorageSync(key) {
    if (getThrows) throw new Error("STORAGE_READ_FAILED");
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    if (setThrows) throw new Error("STORAGE_WRITE_FAILED");
    storage.set(key, value);
  },
};

const stats = require("../miniprogram/services/stats");

let passed = 0;
function eq(actual, expected, label) {
  assert.strictEqual(
    actual,
    expected,
    `${label}（期望 ${expected}，实际 ${actual}）`
  );
  passed += 1;
}

function resetStorage() {
  storage.clear();
  getThrows = false;
  setThrows = false;
}

// ---- 1. 初始零值 ----
{
  resetStorage();
  const data = stats.readStats();
  eq(data.validChallenges, 0, "有效挑战初始为 0");
  eq(data.rankingOpens, 0, "排行榜打开初始为 0");
  eq(data.shareEntryClicks, 0, "分享入口点击初始为 0");
}

// ---- 2. 累计有效挑战 ----
{
  resetStorage();
  stats.recordValidChallenge();
  stats.recordValidChallenge();
  const data = stats.readStats();
  eq(data.validChallenges, 2, "有效挑战累计两次");
  eq(data.rankingOpens, 0, "记录挑战不改变排行榜次数");
  eq(data.shareEntryClicks, 0, "记录挑战不改变分享点击次数");
}

// ---- 3. 累计排行榜打开 ----
{
  resetStorage();
  stats.recordRankingOpen();
  stats.recordRankingOpen();
  const data = stats.readStats();
  eq(data.rankingOpens, 2, "排行榜打开累计两次");
  eq(data.validChallenges, 0, "记录排行榜不改变挑战次数");
}

// ---- 4. 分享入口点击与成功分享概念分离 ----
{
  resetStorage();
  stats.recordShareEntryClick();
  const data = stats.readStats();
  eq(data.shareEntryClicks, 1, "分享入口点击累计一次");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(data, "shareSuccess"),
    false,
    "不记录成功分享次数"
  );
  passed += 1;
}

// ---- 5. 数据损坏时安全归零 ----
{
  resetStorage();
  storage.set(stats.STATS_KEY, "not-an-object");
  eq(stats.readStats().validChallenges, 0, "字符串数据安全归零");

  storage.set(stats.STATS_KEY, {
    validChallenges: -3,
    rankingOpens: "many",
    shareEntryClicks: 2.5,
  });
  const data = stats.readStats();
  eq(data.validChallenges, 0, "负数归零");
  eq(data.rankingOpens, 0, "非数字归零");
  eq(data.shareEntryClicks, 0, "小数归零");
}

// ---- 6. 存储异常不影响调用 ----
{
  resetStorage();
  getThrows = true;
  eq(stats.readStats().validChallenges, 0, "读取异常时归零");

  getThrows = false;
  setThrows = true;
  const next = stats.recordValidChallenge();
  eq(next.validChallenges, 1, "写入异常仍返回内存计数");
  eq(stats.readStats().validChallenges, 0, "写入异常不破坏已有存储");
}

// ---- 7. 只保存三个体验指标，不保存身份信息 ----
{
  resetStorage();
  stats.recordValidChallenge();
  stats.recordRankingOpen();
  stats.recordShareEntryClick();
  const data = stats.readStats();
  eq(
    Object.keys(data).sort().join(","),
    "rankingOpens,shareEntryClicks,validChallenges",
    "统计字段固定"
  );
  const serialized = JSON.stringify(data);
  assert.strictEqual(serialized.includes("openid"), false, "不保存 openid");
  assert.strictEqual(serialized.includes("phone"), false, "不保存手机号");
  assert.strictEqual(serialized.includes("userId"), false, "不保存用户标识");
  passed += 3;
}

console.log(`✓ ${passed} 项断言全部通过`);
