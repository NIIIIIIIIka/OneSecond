// M3 排名规则测试：node test/ranking.test.js
const assert = require("assert");

const {
  readRank,
  scoreDocId: rankDocId,
  displayName,
} = require("../cloudfunctions/getRank/rankCore");
const {
  readMyRank,
  scoreDocId: myRankDocId,
  computePercentile,
} = require("../cloudfunctions/getMyRank/rankCore");
const {
  scoreDocId: submitDocId,
} = require("../cloudfunctions/submitScore/submitCore");
const {
  formatRank,
  formatPercent,
  formatGap,
  buildRankFeedback,
} = require("../miniprogram/utils/ranking");
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
function ok(actual, label) {
  assert.ok(actual, label);
  passed += 1;
}

function makeScore(openid, options) {
  const opts = options || {};
  const elapsed = opts.elapsed;
  const createdAt =
    opts.createdAt instanceof Date
      ? opts.createdAt
      : new Date(opts.createdAt === undefined ? 1700000000000 : opts.createdAt);
  return {
    _id: opts.docId || myRankDocId(openid),
    openid,
    elapsed,
    error: Math.abs(elapsed - 1000),
    createdAt,
    updatedAt: createdAt,
    lastSubmitAt: createdAt,
  };
}

function seed(db, docs) {
  db.seed("scores", docs);
}

async function main() {
  // ---- 0. 三个云函数使用同一套确定性文档 ID ----
  eq(
    rankDocId("openid-example"),
    submitDocId("openid-example"),
    "getRank 与 submitScore 文档 ID 一致"
  );
  eq(
    myRankDocId("openid-example"),
    submitDocId("openid-example"),
    "getMyRank 与 submitScore 文档 ID 一致"
  );

  // ---- 0b. 匿名名稳定、可区分且不泄露完整 ID ----
  {
    const docId = "best_" + "a".repeat(64);
    const name = displayName(docId);
    eq(name, "挑战者·" + "A".repeat(10), "匿名名取哈希前缀");
    eq(name.indexOf("best_"), -1, "匿名名不包含文档 ID 前缀");
    eq(name.indexOf("a".repeat(64)), -1, "匿名名不包含完整哈希");
    ok(
      displayName("best_" + "b".repeat(64)) !== name,
      "不同用户匿名名不同"
    );
    eq(displayName(""), "挑战者", "空文档 ID 使用通用匿名名");
    eq(
      displayName("openid-raw-value").indexOf("openid"),
      -1,
      "非标准文档 ID 不直接暴露原始前缀"
    );
  }

  // ---- 1. 空排行榜：不返回虚构名次 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);

    const rankRes = await readRank({ db, openid: "user-a" });
    eq(rankRes.ok, true, "空榜查询成功");
    eq(rankRes.list.length, 0, "空榜列表为空");
    eq(rankRes.total, 0, "空榜总人数为 0");
    eq(rankRes.meInTop100, false, "空榜用户不在前 100");

    const myRes = await readMyRank({ db, openid: "user-a" });
    eq(myRes.ok, true, "无云端成绩查询成功");
    eq(myRes.hasRecord, false, "无云端成绩标记");
    eq(myRes.best, null, "无云端成绩返回 null");
    eq(myRes.rank, null, "无云端成绩不返回名次");
    eq(myRes.total, null, "无云端成绩不返回总人数");
    eq(myRes.percentile, null, "无云端成绩不返回超越百分比");
    eq(myRes.previousError, null, "无云端成绩不返回上一名");
    eq(myRes.gap, null, "无云端成绩不返回差距");
    eq(myRes.isFirst, false, "无云端成绩不是第一名");
  }

  // ---- 2. 单用户：第一名、100%、没有上一名 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);
    const user = "user-solo";
    const docId = myRankDocId(user);
    seed(db, [makeScore(user, { elapsed: 1010, createdAt: clock.now })]);

    const rankRes = await readRank({ db, openid: user });
    eq(rankRes.list.length, 1, "单用户榜单有 1 条");
    eq(rankRes.total, 1, "单用户总人数 1");
    eq(rankRes.meInTop100, true, "单用户在前 100");
    eq(rankRes.list[0].rank, 1, "单用户排名 1");
    eq(rankRes.list[0].name, displayName(docId), "榜单展示稳定匿名名");
    eq(rankRes.list[0].error, 10, "榜单展示误差");
    eq(rankRes.list[0].isMe, true, "本人行标记");
    eq(rankRes.list[0].openid, undefined, "榜单不返回 openid");
    eq(rankRes.list[0]._id, undefined, "榜单不返回完整 _id");
    eq(rankRes.list[0].createdAt, undefined, "榜单不返回时间戳");

    const myRes = await readMyRank({ db, openid: user });
    eq(myRes.ok, true, "单用户排名查询成功");
    eq(myRes.hasRecord, true, "单用户有云端成绩");
    eq(myRes.best.elapsed, 1010, "单用户返回最佳用时");
    eq(myRes.best.error, 10, "单用户返回最佳误差");
    eq(myRes.best.openid, undefined, "排名结果不返回 openid");
    eq(myRes.best._id, undefined, "排名结果不返回 _id");
    eq(myRes.rank, 1, "单用户排名 1");
    eq(myRes.total, 1, "单用户总人数 1");
    eq(myRes.percentile, 100, "单用户超越百分比 100");
    eq(myRes.previousError, null, "第一名没有上一名误差");
    eq(myRes.gap, null, "第一名没有差距");
    eq(myRes.isFirst, true, "单用户是第一名");
  }

  // ---- 3. 多用户不同误差：error 升序 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);
    seed(db, [
      makeScore("user-a", { elapsed: 1010, createdAt: clock.now + 1000 }), // 10
      makeScore("user-b", { elapsed: 995, createdAt: clock.now + 2000 }), // 5
      makeScore("user-c", { elapsed: 1030, createdAt: clock.now + 3000 }), // 30
    ]);

    const rankRes = await readRank({ db, openid: "user-a" });
    eq(rankRes.list.length, 3, "三人榜单长度");
    eq(
      rankRes.list.map((item) => item.error).join(","),
      "5,10,30",
      "按误差升序排列"
    );
    eq(rankRes.list[0].rank, 1, "榜单第一名名次");
    eq(rankRes.list[2].rank, 3, "榜单第三名名次");
    eq(rankRes.list[1].isMe, true, "榜单高亮本人");
    eq(rankRes.list[0].isMe, false, "榜单不高亮他人");

    const a = await readMyRank({ db, openid: "user-a" });
    eq(a.rank, 2, "user-a 排名 2");
    eq(a.total, 3, "user-a 总人数 3");
    eq(a.percentile, 50, "user-a 超越 50.0%");
    eq(a.previousError, 5, "user-a 上一名误差 5");
    eq(a.gap, 5, "user-a 差距 5ms");
    eq(a.isFirst, false, "user-a 不是第一名");

    const b = await readMyRank({ db, openid: "user-b" });
    eq(b.rank, 1, "user-b 排名 1");
    eq(b.percentile, 100, "user-b 超越 100%");
    eq(b.previousError, null, "user-b 没有上一名");
    eq(b.gap, null, "user-b 没有差距");
    eq(b.isFirst, true, "user-b 是第一名");

    const c = await readMyRank({ db, openid: "user-c" });
    eq(c.rank, 3, "user-c 排名 3");
    eq(c.percentile, 0, "user-c 超越 0.0%");
    eq(c.previousError, 10, "user-c 上一名误差 10");
    eq(c.gap, 20, "user-c 差距 20ms");
  }

  // ---- 4. 相同误差、不同提交时间：先提交者排名更高 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);
    seed(db, [
      makeScore("tie-time-1", { elapsed: 1010, createdAt: clock.now + 1000 }),
      makeScore("tie-time-2", { elapsed: 990, createdAt: clock.now + 2000 }),
      makeScore("tie-time-3", { elapsed: 1010, createdAt: clock.now + 3000 }),
    ]);

    const rankRes = await readRank({ db, openid: "tie-time-2" });
    eq(
      rankRes.list.map((item) => item.name).length,
      3,
      "相同误差榜单长度"
    );
    eq(rankRes.list[0].isMe, false, "更早提交者排第一");
    eq(rankRes.list[1].isMe, true, "较晚提交者排第二");

    const first = await readMyRank({ db, openid: "tie-time-1" });
    const second = await readMyRank({ db, openid: "tie-time-2" });
    const third = await readMyRank({ db, openid: "tie-time-3" });
    eq(first.rank, 1, "相同误差最早提交排名 1");
    eq(second.rank, 2, "相同误差第二次提交排名 2");
    eq(third.rank, 3, "相同误差第三次提交排名 3");
    eq(second.previousError, 10, "相同误差上一名误差相同");
    eq(second.gap, 0, "相同误差差距为 0");
    eq(second.isFirst, false, "相同误差不是第一名");
  }

  // ---- 5. 相同误差、相同时间：按 _id 稳定排序 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);
    const users = ["stable-a", "stable-b", "stable-c"];
    const docs = users
      .map((user) =>
        makeScore(user, {
          elapsed: 1010,
          createdAt: clock.now + 5000,
        })
      )
      .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    seed(db, docs);

    const rankRes = await readRank({ db, openid: users[0] });
    eq(
      rankRes.list.map((item) => item.name).join(","),
      docs.map((doc) => displayName(doc._id)).join(","),
      "完全相同误差/时间时按 _id 升序"
    );

    for (let i = 0; i < docs.length; i += 1) {
      const user = docs[i].openid;
      const res = await readMyRank({ db, openid: user });
      eq(res.rank, i + 1, `_id 排序后第 ${i + 1} 名`);
      eq(res.previousError, i === 0 ? null : 10, "同误差上一名误差");
      eq(res.gap, i === 0 ? null : 0, "同误差/同时间差距 0");
    }
  }

  // ---- 6/7. 超过 100 名：截取前 100，第 101 名仍可正确计算 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);
    const docs = [];
    for (let i = 1; i <= 105; i += 1) {
      docs.push(
        makeScore("many-" + String(i).padStart(3, "0"), {
          elapsed: 1000 + i,
          createdAt: clock.now + i * 1000,
        })
      );
    }
    seed(db, docs);

    const top = await readRank({ db, openid: "many-100" });
    eq(top.ok, true, "大榜单查询成功");
    eq(top.list.length, 100, "榜单只返回前 100 名");
    eq(top.total, 105, "榜单返回总人数 105");
    eq(top.list[0].rank, 1, "大榜单第一名");
    eq(top.list[0].error, 1, "大榜单第一名误差 1");
    eq(top.list[99].rank, 100, "大榜单第 100 名");
    eq(top.list[99].error, 100, "大榜单第 100 名误差 100");
    eq(top.meInTop100, true, "第 100 名在前 100");

    const outside = await readRank({ db, openid: "many-101" });
    eq(outside.meInTop100, false, "第 101 名不在前 100");

    const my101 = await readMyRank({ db, openid: "many-101" });
    eq(my101.rank, 101, "第 101 名个人排名 101");
    eq(my101.total, 105, "第 101 名总人数 105");
    eq(my101.percentile, 3.8, "第 101 名超越 3.8%");
    eq(my101.previousError, 100, "第 101 名上一名误差 100");
    eq(my101.gap, 1, "第 101 名差距 1ms");
    eq(my101.isFirst, false, "第 101 名不是第一名");

    const my105 = await readMyRank({ db, openid: "many-105" });
    eq(my105.rank, 105, "最后一名排名 105");
    eq(my105.percentile, 0, "最后一名超越 0.0%");
    eq(my105.previousError, 104, "最后一名上一名误差 104");
    eq(my105.gap, 1, "最后一名差距 1ms");

    const my1 = await readMyRank({ db, openid: "many-001" });
    eq(my1.rank, 1, "大榜单第一名个人排名 1");
    eq(my1.percentile, 100, "大榜单第一名超越 100%");
    eq(my1.previousError, null, "大榜单第一名没有上一名");
    eq(my1.gap, null, "大榜单第一名没有差距");
  }

  // ---- 8. 百分比边界与一位小数 ----
  {
    eq(computePercentile(1, 1), 100, "N=1 时 100%");
    eq(computePercentile(1, 2), 100, "第一名 100%");
    eq(computePercentile(2, 2), 0, "最后一名 0%");
    eq(computePercentile(2, 3), 50, "中间名次 50%");
    eq(computePercentile(1, 10), 100, "十人榜第一名 100%");
    eq(computePercentile(10, 10), 0, "十人榜最后一名 0%");
    eq(computePercentile(2, 7), 83.3, "百分比保留一位小数（向上）");
    eq(computePercentile(3, 7), 66.7, "百分比保留一位小数（向下）");
    eq(computePercentile(1, 0), null, "总人数 0 不返回百分比");
    eq(computePercentile(0, 5), null, "非法名次不返回百分比");
    eq(computePercentile(1.5, 5), null, "非整数名次不返回百分比");
    eq(computePercentile(2, 1), null, "名次超过总人数不返回百分比");
  }

  // ---- 9. 缺失身份 / 数据库故障 ----
  {
    const clock = { now: 1700000000000 };
    const db = createFakeDb(clock);
    const noIdentity = await readMyRank({ db, openid: "" });
    eq(noIdentity.ok, false, "缺少身份时排名失败");
    eq(noIdentity.code, "NO_IDENTITY", "缺少身份错误码");
    eq(noIdentity.rank, null, "缺少身份不返回名次");
    eq(noIdentity.hasRecord, false, "缺少身份不返回记录");

    const publicRank = await readRank({ db, openid: "" });
    eq(publicRank.ok, true, "缺少身份仍可查看公开榜");
    eq(publicRank.meInTop100, false, "缺少身份不高亮本人");

    const brokenDb = {
      collection() {
        throw new Error("DB_DOWN");
      },
      command: {
        lt(value) {
          return { __op: "lt", value };
        },
      },
    };
    await assert.rejects(
      () => readRank({ db: brokenDb, openid: "user-a" }),
      /DB_DOWN/,
      "getRank 数据库故障应抛错"
    );
    passed += 1;
    await assert.rejects(
      () => readMyRank({ db: brokenDb, openid: "user-a" }),
      /DB_DOWN/,
      "getMyRank 数据库故障应抛错"
    );
    passed += 1;
  }

  // ---- 10. 客户端文案：第一名 / gap=0 / gap>0 / 百分比 ----
  {
    eq(formatRank(1), "第 1 名", "名次文案");
    eq(formatRank(0), "", "非法名次不生成文案");
    eq(formatPercent(100, 1), "超越 100%", "单人榜百分比文案");
    eq(formatPercent(50, 3), "超越 50.0%", "普通百分比保留一位小数");
    eq(formatPercent(3.8, 105), "超越 3.8%", "低百分比保留一位小数");
    eq(
      formatGap({ isFirst: true, gap: null }),
      "你就是第一名",
      "第一名差距文案"
    );
    eq(
      formatGap({ isFirst: false, gap: 0 }),
      "与上一名误差相同，提交时间稍晚",
      "同误差差距文案"
    );
    eq(
      formatGap({ isFirst: false, gap: 3 }),
      "距离上一名只差 3 ms",
      "正差距文案"
    );
    eq(
      formatGap({ isFirst: false, gap: null }),
      "上一名数据更新中",
      "缺失上一名数据时的降级文案"
    );
    eq(formatGap(null), "上一名数据更新中", "空结果不冒充第一名");

    const feedback = buildRankFeedback(
      {
        ok: true,
        hasRecord: true,
        rank: 2,
        total: 3,
        percentile: 50,
        previousError: 5,
        gap: 5,
        isFirst: false,
        best: { elapsed: 1010, error: 10 },
      },
      { isNewBest: true }
    );
    eq(feedback.rankText, "第 2 名", "排名反馈名次");
    eq(feedback.percentText, "超越 50.0%", "排名反馈百分比");
    eq(feedback.gapText, "距离上一名只差 5 ms", "排名反馈差距");
    eq(feedback.bestText, "本局刷新个人最佳", "排名反馈个人最佳");
    eq(feedback.onlyOne, false, "多人榜不显示单人提示");

    const firstFeedback = buildRankFeedback(
      {
        ok: true,
        hasRecord: true,
        rank: 1,
        total: 1,
        percentile: 100,
        previousError: null,
        gap: null,
        isFirst: true,
      },
      { isNewBest: false }
    );
    eq(firstFeedback.gapText, "你就是第一名", "单人榜第一名文案");
    eq(firstFeedback.percentText, "超越 100%", "单人榜百分比文案");
    eq(firstFeedback.onlyOne, true, "单人榜提示");
    eq(firstFeedback.bestText, "本局未刷新个人最佳", "未刷新最佳文案");

    const rankFirst = buildRankFeedback(
      {
        ok: true,
        hasRecord: true,
        rank: 1,
        total: 2,
        percentile: 100,
        gap: 0,
        isFirst: false,
      },
      {}
    );
    eq(rankFirst.gapText, "你就是第一名", "第一名按名次派生文案");
    const rankSecond = buildRankFeedback(
      {
        ok: true,
        hasRecord: true,
        rank: 2,
        total: 2,
        percentile: 0,
        gap: 3,
        isFirst: true,
      },
      {}
    );
    eq(
      rankSecond.gapText,
      "距离上一名只差 3 ms",
      "非第一名不使用第一名文案"
    );

    eq(buildRankFeedback(null, {}), null, "无响应不生成排名反馈");
    eq(
      buildRankFeedback({ ok: true, hasRecord: false }, {}),
      null,
      "无成绩不生成排名反馈"
    );
    eq(
      buildRankFeedback(
        { ok: true, hasRecord: true, rank: 1, total: 0 },
        {}
      ),
      null,
      "非法总人数不生成排名反馈"
    );
    eq(
      buildRankFeedback(
        { ok: true, hasRecord: true, rank: 5, total: 3 },
        {}
      ),
      null,
      "名次超过总人数不生成排名反馈"
    );
  }

  console.log(`✓ ${passed} 项断言全部通过`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
