// submitScore 云函数核心逻辑测试：node test/submitScore.test.js
const assert = require("assert");
const {
  handle,
  scoreDocId,
  RATE_LIMIT_MS,
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

function setup(openid = "user-openid") {
  const clock = { now: 1700000000000 };
  const db = createFakeDb(clock);
  const docId = scoreDocId(openid);

  function submit(event, user = openid) {
    return handle({
      event,
      getOpenId: () => user,
      db,
      now: clock.now,
    });
  }

  return { clock, db, docId, submit, openid };
}

async function main() {
  // ---- 1. 首次有效成绩保存 ----
  {
    const { clock, db, docId, submit } = setup();
    const res = await submit({ elapsed: 1010 });

    eq(res.ok, true, "首次提交成功");
    eq(res.refreshed, true, "首次提交刷新最佳");
    eq(res.reason, "created", "首次提交状态为 created");
    eq(res.best.elapsed, 1010, "返回云端最佳用时");
    eq(res.best.error, 10, "返回服务端计算的误差");

    const doc = db.get("scores", docId);
    eq(doc.elapsed, 1010, "文档保存用时");
    eq(doc.error, 10, "文档保存服务端误差");
    eq(doc.openid, "user-openid", "文档保存可信 openid");
    eq(doc.createdAt instanceof Date, true, "createdAt 为服务端时间");
    eq(doc.createdAt.getTime(), clock.now, "createdAt 为服务端当前时间");
    eq(db.size("scores"), 1, "同一用户只有一条文档");
  }

  // ---- 2. 不信任客户端传入的 openid ----
  {
    const { db, docId, submit } = setup("trusted-openid");
    const res = await submit(
      { elapsed: 995, openid: "fake-openid" },
      "trusted-openid"
    );

    eq(res.ok, true, "使用可信身份提交成功");
    eq(db.get("scores", docId).openid, "trusted-openid", "忽略客户端 openid");
    eq(db.size("scores"), 1, "不会为伪造 openid 创建文档");
  }

  // ---- 3. 更好的成绩更新最佳；更差 / 相同误差保留原记录 ----
  {
    const { clock, db, docId, submit } = setup();
    const start = clock.now;

    await submit({ elapsed: 1500 }); // 误差 500
    const createdAt = db.get("scores", docId).createdAt.getTime();
    eq(db.get("scores", docId).error, 500, "首次成绩误差 500");

    clock.now = start + 1000;
    let res = await submit({ elapsed: 1010 }); // 误差 10，更优
    eq(res.ok, true, "更好成绩提交成功");
    eq(res.refreshed, true, "更好成绩刷新最佳");
    eq(res.reason, "improved", "状态为 improved");
    eq(db.get("scores", docId).elapsed, 1010, "最佳用时被更新");
    eq(db.get("scores", docId).error, 10, "最佳误差被更新");
    eq(
      db.get("scores", docId).createdAt.getTime(),
      createdAt,
      "刷新最佳时 createdAt 不变"
    );

    const updatedAt = db.get("scores", docId).updatedAt.getTime();

    clock.now = start + 2000;
    res = await submit({ elapsed: 2000 }); // 误差 1000，更差
    eq(res.ok, true, "较差成绩请求正常返回");
    eq(res.refreshed, false, "较差成绩不刷新最佳");
    eq(res.reason, "kept", "状态为 kept");
    eq(db.get("scores", docId).elapsed, 1010, "较差成绩不覆盖最佳用时");
    eq(
      db.get("scores", docId).updatedAt.getTime(),
      updatedAt,
      "较差成绩不更新 updatedAt"
    );

    clock.now = start + 3000;
    res = await submit({ elapsed: 990 }); // 误差 10，与最佳相同
    eq(res.ok, true, "相同误差请求正常返回");
    eq(res.refreshed, false, "相同误差不刷新最佳");
    eq(db.get("scores", docId).elapsed, 1010, "相同误差保留原成绩");
    eq(
      db.get("scores", docId).createdAt.getTime(),
      createdAt,
      "相同误差保留原 createdAt"
    );
  }

  // ---- 4. 非法输入被拒绝，且不写入 ----
  {
    const { db, submit } = setup();
    const invalidInputs = ["1000", 1000.5, -1, 3001, NaN, Infinity, null, undefined, true];

    for (const value of invalidInputs) {
      const res = await submit({ elapsed: value });
      eq(res.ok, false, `非法输入被拒绝：${String(value)}`);
      eq(res.code, "INVALID_ELAPSED", `非法输入错误码：${String(value)}`);
    }
    eq(db.size("scores"), 0, "非法输入不写入任何文档");

    // 缺少 event 同样拒绝
    const res = await handle({
      event: null,
      getOpenId: () => "user-openid",
      db,
      now: Date.now(),
    });
    eq(res.ok, false, "缺少参数被拒绝");
    eq(db.size("scores"), 0, "缺少参数不写入任何文档");
  }

  // ---- 5. 超过 3000ms 不写入 ----
  {
    const { db, submit } = setup();
    const res = await submit({ elapsed: 3001 });
    eq(res.ok, false, "3001ms 被拒绝");
    eq(res.code, "INVALID_ELAPSED", "3001ms 错误码");
    eq(db.size("scores"), 0, "3001ms 不写入");

    const boundary = await submit({ elapsed: 3000 });
    eq(boundary.ok, true, "3000ms 为有效边界");
  }

  // ---- 5b. 缺少可信身份时不写入 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);
    const res = await handle({
      event: { elapsed: 1000 },
      getOpenId: () => "",
      db,
      now: clock.now,
    });
    eq(res.ok, false, "缺少身份被拒绝");
    eq(res.code, "NO_IDENTITY", "缺少身份错误码");
    eq(db.size("scores"), 0, "缺少身份不写入");
  }

  // ---- 6. 同一用户每秒最多一次提交 ----
  {
    const { clock, db, docId, submit } = setup();

    await submit({ elapsed: 1010 });
    const first = db.get("scores", docId);

    clock.now += 400;
    let res = await submit({ elapsed: 995 });
    eq(res.ok, false, "一秒内连续提交被限流");
    eq(res.code, "RATE_LIMITED", "限流错误码");
    eq(res.retryAfterMs, 600, "返回剩余等待时间");
    eq(db.get("scores", docId).elapsed, 1010, "被限流的请求不写入");

    clock.now = first.lastSubmitAt.getTime() + RATE_LIMIT_MS;
    res = await submit({ elapsed: 995 });
    eq(res.ok, true, "超过一秒后可再次提交");
    eq(res.refreshed, true, "恢复后的更好成绩生效");
    eq(db.get("scores", docId).elapsed, 995, "恢复后最佳被更新");
  }

  // ---- 7. 并发的首次提交：较好的成绩最终胜出 ----
  {
    const { db, docId, submit } = setup();

    const [worse, better] = await Promise.all([
      submit({ elapsed: 1500 }), // 误差 500
      submit({ elapsed: 995 }), // 误差 5
    ]);

    eq(worse.ok, true, "并发较差请求正常返回");
    eq(better.ok, true, "并发较好请求正常返回");
    eq(db.size("scores"), 1, "并发首次提交仍只有一条文档");
    eq(db.get("scores", docId).error, 5, "并发后保留更好的成绩");
    eq(db.get("scores", docId).elapsed, 995, "并发后保留更好的用时");
  }

  // ---- 8. 较好的成绩先写入后，迟到的较差请求不会覆盖 ----
  {
    const { clock, db, docId, submit } = setup();

    await submit({ elapsed: 995 }); // 误差 5
    clock.now += RATE_LIMIT_MS;
    const res = await submit({ elapsed: 1500 }); // 迟到的较差请求

    eq(res.ok, true, "迟到请求正常返回");
    eq(res.refreshed, false, "迟到请求不刷新最佳");
    eq(db.get("scores", docId).error, 5, "迟到请求不覆盖更好成绩");
    eq(db.get("scores", docId).elapsed, 995, "迟到请求不覆盖更好用时");
  }

  console.log(`✓ ${passed} 项断言全部通过`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
