# 一秒不差？· M1.1（纯本地版）

一个“凭感觉计时 1 秒”的微信小程序。点击开始后计时完全隐藏，凭感觉按下停止，看看你的误差有多接近 1000ms。

当前为 **M1.1 纯本地版本**：不接入云开发、排行榜或任何后端服务。

## 运行方式

1. 安装并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 选择「导入项目」，目录选择本仓库根目录（包含 `project.config.json` 的那一层）。
3. AppID：使用自己的小程序 AppID 即可；没有的话可以选「测试号」，或把 `project.config.json` 中的 `appid` 改为 `touristappid` 走游客模式。
4. 编译后直接进入挑战页。

## 目录结构

```text
miniprogram/
  app.js / app.json / app.wxss
  pages/index/           # 唯一页面：挑战页（idle / ready / running / result）
  utils/score.js         # 误差计算、分级、格式化（纯函数）
test/score.test.js       # 成绩逻辑的 Node 测试
test/challenge.test.js   # 页面状态机与计时逻辑测试
project.config.json
```

## 玩法与规则

- 状态流程：待开始 → 准备 → 挑战 → 结果。点击「开始游戏」只进入准备页，点击「开始计时」才真正开始计时。
- 目标时间 1000ms，误差 = |实际用时 − 1000|。
- 有效成绩范围：0–3000ms。超出范围仍展示实际用时与误差，但不计入个人最佳。
- 首次有效挑战自动成为个人最佳；之后只有误差严格更小才刷新。
- 个人最佳保存在本地：`bestError`（误差，兼容旧数据）与 `bestElapsed`（用时，M1.1 新增）。
- 挑战中切换到后台会取消本局，回到准备状态。

## 测试

```bash
node test/score.test.js
node test/challenge.test.js
```

## 说明

- 计时使用 `Date.now()`，依赖设备时钟，毫秒级结果仅供娱乐，不代表硬件校准精度。
