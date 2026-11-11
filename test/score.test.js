// 成绩逻辑测试：node test/score.test.js
const assert = require("assert");
const { getTier, calcResult, formatSeconds } = require("../miniprogram/utils/score");

let passed = 0;

function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, `${label}（期望 ${expected}，实际 ${actual}）`);
  passed += 1;
}

// ---- 误差分级边界 ----
eq(getTier(0), "人体原子钟", "误差 0ms");
eq(getTier(20), "人体原子钟", "误差 20ms");
eq(getTier(21), "手表成精", "误差 21ms");
eq(getTier(50), "手表成精", "误差 50ms");
eq(getTier(51), "人类高质量手感", "误差 51ms");
eq(getTier(100), "人类高质量手感", "误差 100ms");
eq(getTier(101), "一秒有点弹性", "误差 101ms");
eq(getTier(200), "一秒有点弹性", "误差 200ms");
eq(getTier(201), "时间管理反向大师", "误差 201ms");
eq(getTier(500), "时间管理反向大师", "误差 500ms");
eq(getTier(501), "建议先练习呼吸", "误差 501ms");

// ---- 误差计算与格式化 ----
const r1 = calcResult(1000, null);
eq(r1.error, 0, "1000ms 的误差");
eq(r1.valid, true, "1000ms 有效");
eq(r1.isNewBest, true, "首次有效成绩自动成为最佳");
eq(r1.tier, "人体原子钟", "1000ms 鉴定");
eq(r1.fastSlowText, "正中一秒，误差为 0", "正中一秒文案");
eq(r1.durationText, "1.000", "1000ms 格式化");

const r2 = calcResult(842, null);
eq(r2.error, 158, "842ms 的误差");
eq(r2.valid, true, "842ms 有效");
eq(r2.durationText, "0.842", "842ms 格式化");
eq(r2.fastSlowText, "偏快了 158ms", "偏快文案");

const r3 = calcResult(1158, null);
eq(r3.fastSlowText, "偏慢了 158ms", "偏慢文案");

// ---- 只有严格小于才刷新 ----
eq(calcResult(1005, 5).isNewBest, false, "误差相同不刷新");
eq(calcResult(1000, 5).isNewBest, true, "误差更小刷新");
eq(calcResult(996, 5).isNewBest, true, "另一侧误差更小也刷新");

// ---- 有效成绩范围 0–3000ms ----
eq(calcResult(0, null).valid, true, "0ms 有效");
eq(calcResult(3000, null).valid, true, "3000ms 有效");

const r6 = calcResult(3001, null);
eq(r6.valid, false, "3001ms 无效");
eq(r6.isNewBest, false, "无效成绩不刷新");
eq(r6.error, 2001, "3001ms 的误差");

const r7 = calcResult(3001, 2500);
eq(r7.isNewBest, false, "无效成绩即使误差更小也不刷新");

// ---- 格式化 ----
eq(formatSeconds(0), "0.000", "0ms 格式化");
eq(formatSeconds(1599), "1.599", "1599ms 格式化");

console.log(`✓ ${passed} 项断言全部通过`);
