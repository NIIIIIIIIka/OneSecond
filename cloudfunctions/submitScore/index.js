// 云函数：提交个人最佳成绩
const cloud = require("wx-server-sdk");
const { handle } = require("./submitCore");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  try {
    return await handle({
      event,
      // 只信任云函数上下文中的 OPENID
      getOpenId: () => cloud.getWXContext().OPENID,
      db,
    });
  } catch (e) {
    // 只记录错误信息，不输出 openid 等敏感数据
    console.error("[submitScore] 执行失败：", (e && (e.message || e)) || e);
    return { ok: false, code: "INTERNAL_ERROR" };
  }
};
