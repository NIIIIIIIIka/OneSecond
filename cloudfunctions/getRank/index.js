// 云函数：读取排行榜前 100 名
const cloud = require("wx-server-sdk");
const { readRank } = require("./rankCore");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  try {
    return await readRank({
      db,
      openid: cloud.getWXContext().OPENID,
    });
  } catch (e) {
    // 只记录错误信息，不输出 openid 等敏感数据
    console.error("[getRank] 执行失败：", (e && (e.message || e)) || e);
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      list: [],
      total: 0,
      meInTop100: false,
    };
  }
};
