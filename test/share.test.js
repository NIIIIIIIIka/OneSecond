// 分享标题与路径规则测试：node test/share.test.js
const assert = require("assert");
const {
  SHARE_PATH,
  DEFAULT_RESULT_TITLE,
  RANKING_TITLE,
  buildResultShare,
  buildRankingShare,
} = require("../miniprogram/utils/share");

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

// ---- 1. 有真实误差、排名未确认：只展示误差 ----
{
  const result = buildResultShare({
    valid: true,
    error: 10,
    rankConfirmed: false,
    rank: 12,
  });
  includes(result.title, "10ms", "分享标题包含真实误差");
  excludes(result.title, "第 12 名", "排名未确认时不包含排名");
  excludes(result.title, "undefined", "标题不出现 undefined");
  eq(result.path, SHARE_PATH, "结果分享路径为首页");
}

// ---- 2. 误差为 0 的文案 ----
{
  const result = buildResultShare({ valid: true, error: 0 });
  includes(result.title, "误差只有 0ms", "0ms 误差文案");
  eq(result.path, "/pages/index/index", "路径指向有效首页");
}

// ---- 3. 排名已确认：使用已确认名次 ----
{
  const result = buildResultShare({
    valid: true,
    error: 10,
    rankConfirmed: true,
    rank: 12,
  });
  includes(result.title, "第 12 名", "分享标题包含确认排名");
  eq(result.path, SHARE_PATH, "带排名分享仍进入首页");
}

// ---- 4. 排名值非法：退回真实误差，不伪造排名 ----
{
  const result = buildResultShare({
    valid: true,
    error: 26,
    rankConfirmed: true,
    rank: 0,
  });
  includes(result.title, "26ms", "非法排名退回误差");
  excludes(result.title, "第 0 名", "不生成非法名次");
}

// ---- 5. 无效成绩：不描述为有效记录 ----
{
  const result = buildResultShare({
    valid: false,
    error: 2001,
    rankConfirmed: true,
    rank: 3,
  });
  includes(result.title, "超出有效范围", "无效成绩明确标识");
  excludes(result.title, "只差", "无效成绩不展示“只差”");
  excludes(result.title, "第 3 名", "无效成绩不携带排名");
  eq(result.path, SHARE_PATH, "无效成绩分享路径仍有效");
}

// ---- 6. 缺少成绩字段：使用通用文案 ----
{
  const result = buildResultShare({ valid: true });
  eq(result.title, DEFAULT_RESULT_TITLE, "缺少误差时使用通用标题");
  eq(result.path, SHARE_PATH, "通用分享路径");
}

// ---- 7. 排行榜分享：无排名时通用文案 ----
{
  const result = buildRankingShare({ rankConfirmed: false, rank: 12 });
  eq(result.title, RANKING_TITLE, "排行榜通用分享标题");
  excludes(result.title, "第 12 名", "未确认排名不写入排行榜标题");
  eq(result.path, SHARE_PATH, "排行榜分享进入首页");
}

// ---- 8. 排行榜分享：有确认排名时包含名次 ----
{
  const result = buildRankingShare({ rankConfirmed: true, rank: 12 });
  includes(result.title, "第 12 名", "排行榜分享包含确认名次");
  eq(result.path, SHARE_PATH, "排行榜分享路径正确");
}

// ---- 9. 排行榜分享：非法排名退回通用文案 ----
{
  const result = buildRankingShare({ rankConfirmed: true, rank: 0 });
  eq(result.title, RANKING_TITLE, "非法排名使用通用标题");
}

// ---- 10. 分享内容不包含敏感字段 ----
{
  const texts = [
    buildResultShare({ valid: true, error: 10 }).title,
    buildResultShare({ valid: true, error: 10, rankConfirmed: true, rank: 2 })
      .title,
    buildRankingShare({ rankConfirmed: true, rank: 2 }).title,
  ].join(" ");
  excludes(texts, "openid", "分享不包含 openid");
  excludes(texts, "_id", "分享不包含数据库 _id");
  excludes(texts, "secret", "分享不包含测试敏感信息");
}

console.log(`✓ ${passed} 项断言全部通过`);
