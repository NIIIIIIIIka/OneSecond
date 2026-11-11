// getMyScore 云函数核心逻辑测试：node test/getMyScore.test.js
const assert = require("assert");
const {
  readMyBest,
  scoreDocId,
} = require("../cloudfunctions/getMyScore/scoreCore");
const {
  handle,
  scoreDocId: submitDocId,
} = require("../cloudfunctions/submitScore/submitCore");
const { createFakeDb } = require("./helpers/fakeDb");

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
  // 两个云函数必须使用相同的文档 ID 规则
  eq(
    scoreDocId("openid-example"),
    submitDocId("openid-example"),
    "getMyScore 与 submitScore 文档 ID 一致"
  );

  const clock = { now: 1700000000000 };
  const db = createFakeDb(clock);

  // ---- 缺少可信身份 ----
  const noIdentity = await readMyBest({ db, openid: "" });
  eq(noIdentity.ok, false, "缺少身份时请求失败");
  eq(noIdentity.code, "NO_IDENTITY", "缺少身份错误码");
  eq(noIdentity.hasRecord, false, "缺少身份时不返回记录");
  eq(noIdentity.best, null, "缺少身份时不返回成绩");

  // ---- 无记录：明确空状态 ----
  let res = await readMyBest({ db, openid: "user-a" });
  eq(res.ok, true, "无记录时请求成功");
  eq(res.hasRecord, false, "无记录标记");
  eq(res.best, null, "无记录返回 null");

  // ---- 写入后读取本人成绩 ----
  await handle({
    event: { elapsed: 995 },
    getOpenId: () => "user-a",
    db,
    now: clock.now,
  });

  res = await readMyBest({ db, openid: "user-a" });
  eq(res.ok, true, "读取本人成绩成功");
  eq(res.hasRecord, true, "存在记录");
  eq(res.best.elapsed, 995, "返回用时");
  eq(res.best.error, 5, "返回误差");
  eq(res.best.elapsed !== undefined, true, "返回必要字段");
  eq(res.best.openid, undefined, "不返回 openid");
  eq(res.best._id, undefined, "不返回文档 _id");

  // ---- 不泄露其他用户成绩 ----
  const other = await readMyBest({ db, openid: "user-b" });
  eq(other.ok, true, "其他用户查询成功");
  eq(other.hasRecord, false, "其他用户无记录");
  eq(other.best, null, "其他用户看不到 user-a 的成绩");

  console.log(`✓ ${passed} 项断言全部通过`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
