// 本地 / 云端成绩协调规则测试：node test/sync.test.js
const assert = require("assert");
const {
  isValidElapsed,
  errorOf,
  normalizeBest,
  compareBest,
} = require("../miniprogram/utils/sync");

let passed = 0;
function eq(actual, expected, label) {
  assert.strictEqual(
    actual,
    expected,
    `${label}（期望 ${expected}，实际 ${actual}）`
  );
  passed += 1;
}

// ---- 有效用时 ----
eq(isValidElapsed(0), true, "0ms 有效");
eq(isValidElapsed(1000), true, "1000ms 有效");
eq(isValidElapsed(3000), true, "3000ms 有效");

[-1, 3001, 1000.5, NaN, Infinity, "1000", null, undefined, {}].forEach(
  (value) => {
    eq(isValidElapsed(value), false, `非法用时应被拒绝：${String(value)}`);
  }
);

// ---- 误差 ----
eq(errorOf(990), 10, "偏快误差");
eq(errorOf(1010), 10, "偏慢误差");
eq(errorOf(1000), 0, "正好一秒");
eq(errorOf(0), 1000, "0ms 误差");
eq(errorOf(3000), 2000, "3000ms 误差");

// ---- 归一化 ----
eq(normalizeBest({ elapsed: 1010 }).error, 10, "归一化重新计算误差");
eq(normalizeBest({ elapsed: 1010 }).elapsed, 1010, "归一化保留用时");
eq(normalizeBest({ elapsed: 1010, error: 999 }).error, 10, "不信任传入的 error");
eq(normalizeBest({ elapsed: 3001 }), null, "超范围成绩不合法");
eq(normalizeBest({ error: 10 }), null, "缺少用时无法同步");
eq(normalizeBest(null), null, "空记录");
eq(normalizeBest("bad"), null, "非法记录");

// ---- 本地 / 云端比较 ----
eq(compareBest(null, null), "none", "双方都无成绩");
eq(compareBest({ elapsed: 990 }, null), "local", "只有本地成绩");
eq(compareBest(null, { elapsed: 1010 }), "cloud", "只有云端成绩");
eq(compareBest({ elapsed: 995 }, { elapsed: 1010 }), "local", "本地误差更小");
eq(compareBest({ elapsed: 1010 }, { elapsed: 995 }), "cloud", "云端误差更小");
eq(compareBest({ elapsed: 1500 }, { elapsed: 1010 }), "cloud", "本地明显更差");
eq(compareBest({ elapsed: 1010 }, { elapsed: 990 }), "tie", "误差相同");
eq(compareBest({ elapsed: 990 }, { elapsed: 1010 }), "tie", "误差相同（顺序无关）");

console.log(`✓ ${passed} 项断言全部通过`);
