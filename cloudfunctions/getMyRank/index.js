// 云函数：读取当前用户的个人最佳与完整排名
const cloud = require("wx-server-sdk");
const { readMyRank } = require("./rankCore");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  try {
    return await readMyRank({
      db,
      openid: cloud.getWXContext().OPENID,
    });
  } catch (e) {
    // 只记录错误信息，不输出 openid 等敏感数据
    console.error("[getMyRank] 执行失败：", (e && (e.message || e)) || e);
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      hasRecord: false,
      best: null,
      rank: null,
      total: null,
      percentile: null,
      previousError: null,
      gap: null,
      isFirst: false,
    };
  }
};
