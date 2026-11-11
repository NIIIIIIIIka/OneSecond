// 云函数：读取当前用户的云端最佳成绩
const cloud = require("wx-server-sdk");
const { readMyBest } = require("./scoreCore");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  try {
    return await readMyBest({
      db,
      openid: cloud.getWXContext().OPENID,
    });
  } catch (e) {
    // 只记录错误信息，不输出 openid 等敏感数据
    console.error("[getMyScore] 执行失败：", (e && (e.message || e)) || e);
    return { ok: false, code: "INTERNAL_ERROR", hasRecord: false, best: null };
  }
};
