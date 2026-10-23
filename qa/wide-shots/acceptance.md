# 01/03 远景与 7 秒等待

基线为 `a878e42`，开发分支 `feature/wide-shot-layout`。最终 GLB SHA-256：`7a4b7bebe8848a88bd10b83a04f50383651dfe039d73708647d0cb7b2de1a4fc`。

- 01 恢复 azimuth +38° 的左下步态，保留俯视全身远景。
- 03 改为人物朝画面右的右前轻仰拍全身远景：azimuth −32°，fill .78，camY .40，lookY .56。手机按 .74 和屏幕比例适配。动作结束后仍保持相同距离。
- 02/04 摄影参数保持近景。桌面、手机、窄屏下均验证 01/03 比 02/04 更远。
- Wait 从 8 秒缩为 7 秒，主体原速，首尾各 1 秒衔接。Blender 中修正新视角暴露的右手：腕/肘 IK 参照左侧镜像的贴腰位置，右四指放松朝下。修正首尾归零，结束续播 Idle 2.2 秒相位。
- 原几何、骨架、UV、4096×4096 贴图与 Idle/Walk/Nod/Wave 四段动画采样字节保持。没有降低精度或更改原素材。

| 验证 | 结果 | 文件 |
| --- | --- | --- |
| 实际动作、保真、首尾及 18 组打断 | 82/82 | `motion-results.json` |
| 独立播放器 | 22/22 | `player-results.json` |
| Blender 源与导出复现 | 30/30、5/5 | `blender-source.json`、`reproducibility.json` |
| 骨骼方向、远近关系、回待机不推近 | 27/27 | `direction-results.json` |
| 三种宽度、四站动作及待机构图 | 86/86 | `framing-results.json` |
| 24 张静帧、元数据及 2× 分辨率 | 24/24 | `static-results.json` |
| 本地生产构建及七秒动画 | 13/13 | `production-results.json` |
| 衣物侧向接触诊断 | 26/34，8 项负间距保留 | `clothing-results.json` |

语法检查、正式构建通过，保留 Three.js chunk 大小提示。正式包为 `index-CdfL1xVd.js` 与 `scene-90tuLe_x.js`，模型与静帧版本为 `wide-shots-1`。

真实绿色页面审阅范围见 `visual-review.md`：新右前视角下，右手袖口、掌背和指尖的可见轮廓连续，未见修改前的断裂肤色碎片。另已查看 01 左下步态、03 全身 Idle 及窄屏远景。静帧用未变的公共 Idle 或原静止模型，未将候选动作帧发布成降级图。

衣物检测仍保留 8 项开放面侧向间距失败，不能写成全网格零穿模；负值主要涉及拇指及原左侧接触，射线未命中也不算通过。抽绳检查全部通过，Wait 最小测试间距约 2.755 mm。右掌与四指在六组切换中已测位置无负侧向值，不能据此证明所有连续时间点和任意视角均无自交。

`qa/waiting/` 的旧结果作为历史保留，复用工具通过参数输出本轮报告。发布后运行 `verify-online.cjs`，核对实际域名 bundle、GLB 指纹、7 秒时长、四站及手机；结果写入被忽略的 `output/playwright/wide-shots/online-results.json`，不在此预先声称线上通过。
