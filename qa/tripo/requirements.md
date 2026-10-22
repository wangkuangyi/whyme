# v2.1 Tripo 动作与镜头验收

依据：用户于 2026-10-23 提供 `动作素材/human+character+3d+model.glb`，要求试用合适动作、走路采用跟拍，并允许上半身近景和更丰富的镜头。此前“恢复原人物且静止”是 `v2-restored` 的范围；本轮允许使用新提供的动作，但继续保留原脸，不恢复已撤回的眼球、表情或手工骨骼表演。

检查日期：2026-10-23。下表只记录本轮直接证据；待验项目不沿用静止版本结果。

| ID | 要求 | 证据 | 状态 |
| --- | --- | --- | --- |
| ASSET-01 | 保留原人物资产、脸、几何、贴图和骨架 | `prepare --check` 逐字节可复现；原 GLB 哈希一致 | 通过；原 Blender 文件未写入 |
| ASSET-02 | 用户同骨架动画，无新增眼球或面部形变 | 资产比较、原动画数组保留测试、面部近景 | 通过 |
| ACT-01 | Greet / Nod / Walk / Wave 四站，Box 不播放 | 真实 GLB 模块测试、四站截图 | 通过 |
| ACT-02 | 近景头部和主要手势完整 | 桌面四站及 320/390px Greet、Wave 连续帧 | 已检查构图通过 |
| ACT-03 | 真实前进位移，侧前方镜头跟随 | 模块位移约 7.20m；独立走路复查 | 通过；13 项运动浏览器流程通过 |
| ACT-04 | 淡入待机，无位置重置或待机漂移 | 27 项模块测试含中断、5 分钟待机及 20–120fps 收尾 | 模块与浏览器切换流程通过 |
| ACT-05 | 拖动、快速切换和点击反应连续 | 模块测试通过；专门运动流程 | 13 项运动浏览器流程通过 |
| ACT-06 | 保持原脸，不暴露明显异常变形 | 四站截图与独立动作复查；末段腿部问题见限制 | 已检查画面通过，不宣称全素材步态修复 |
| CAM-01 | 动作取景与跟拍时灯光、阴影、光环协调 | 四站及行走前中后截图 | 已检查画面通过 |
| CAM-02 | 行走末段平滑推近，提前避开收腿 | 272 帧头部采样与 `final-contact-walk.jpg` | 通过，详见下文 |
| LAYOUT-01 | 桌面卡片避开脸和手，节点距离合适 | 1440/1280/1024 宽四站截图；手指骨骼加 2.5cm 保护范围 | 通过；末轮 168 个 Walk 采样无保护区交叠 |
| LAYOUT-02 | 窄屏头部、手势和说明区可见 | 768/390/320 宽四站画面；320/390 手势连续帧 | 已检查构图通过 |
| MODE-01 | 默认新动作、`?still=1` 原静止 3D、`?static=1` 新静帧 | 三条资源路径已接入 | 动态、still 与 static 入口通过 |
| MODE-02 | 减少动态保留原站姿，导航内容完整 | 真实 GLB 还原站姿测试 | 模块与浏览器回归通过 |
| FALLBACK-01 | 八张本版静帧及降级可用 | `public/images-tripo/` 八张图与 `frames.json` 已生成、接入 | 通过；生产检查验证自动/手动降级及图片加载 |
| FLOW-01 | 导航、简历、联系、幕后与打印入口可用 | 本版 29 项浏览器回归 | 29/29 通过 |
| COPY-01 | 中文文案准确，个人经历不扩写 | v2.1 幕后与记录；字体已重新子集化 | 通过 |
| BUILD-01 | 语法、动作测试和生产构建 | `npm run check`、27 项动作测试、`npm run build` | 通过；构建体积提示见下文 |
| GIT-01 | 分支检查后提交，原基线可回退 | `feature/tripo-animations`、`v2-restored` | 资产已提交；页面交付以 v2-tripo-motion 标签定位 |

## 资产与方法记录

- 原始基线 SHA-256：`def0603ec59ac8fac3de5df25e2827b2fbbd11cf0ad7ae5672e9fc3fab4a957f`。
- 用户动作源 SHA-256：`489f55375ca109e670396da16a45f35b94f18a7247a2ff26bb35bbaaa2e6f9e8`。
- 生成资产信息：`public/models/person-animated-info.json`；重建和只读验证命令见 README。
- `node scripts/tripo-prepare.mjs --check` 通过，生成资产逐字节可复现；原 GLB 哈希一致。
- `qa/tripo/motion-tests.json`：27 项真实 GLB 测试通过，覆盖过渡权重、位移、中断、长时间待机、减少动态与不同帧率收尾。
- 独立视觉证据在 `output/playwright/tripo-independent/`：`final-contact-walk.jpg`、`final-contact-mobile320-angle1.jpg`、`final-contact-mobile320-angle4.jpg`、`final-framing-samples.json` 及 `REVIEW.md`。
- Walk 3.3–4.7 秒共 272 帧中，头部相邻帧 top 最大变化 4.72px，跨景别阈值约 1px，未见镜头突跳；约 4.0 秒脚部出画，4.45–5.6 秒保持大腿以上。320/390px 招手与挥手的主要手势完整。
- 1440/1280/1024/768/320 宽四站截图已查看。原 20cm 手部保护框产生的假阳性改为实际手指骨骼加 2.5cm 边距；Walk 最终在 1440/1280/1024 宽共 168 个采样中，无脸部或手部保护区与卡片交叠。
- `npm run check`、`npm run build` 通过，字体已子集化。Vite 提示 Three 场景 chunk 约 901kB，gzip 274.71kB；属于体积提示，不是构建失败。未据此声称所有低端设备的性能已验证。

## 已知限制

原模型的裤子贴图和材质边界仍有少量瑕疵。行走素材没有自然停止片段，末段近景避开脚部收拢；这是镜头裁剪，不代表原动作步态已修复。检查覆盖列出的浏览器画面与采样，不代表全部设备上都已验证。

## 最终检查记录

- 页面交互：`output/playwright/tripo/flows.json`，29/29 通过。首次固定等待比 CSS 淡出结束提前约 50ms，测试改为等待读数实际消失后复查通过。
- 运动流程：`output/playwright/tripo/motion-flows.json`，13/13 通过，包含真实前进与跟拍、拖动冻结、收尾推近、点击点头、快速切站、原静止入口与减少动态。
- Walk 卡片避让：`output/playwright/tripo/walk-layout-final.json`，三种桌面尺寸共 168 个采样无交叠。其余三站末轮动态保护区采样无交叠。
- Git 动作资产提交：`7842a1f`；页面提交 `2ffc09e`，最终修正与验收由 `v2-tripo-motion` 标签定位。

- 生产逻辑：`output/playwright/tripo/production.json`，常规 20 项与低帧率降级 4 项通过；模拟持续低帧率在 8.779 秒后切换到已加载的静帧。
- 生产视觉复查发现手机从点头切挥手初段手掌越界；已按整个手势的最大展开与屏幕宽高比调整取景，并移除手机推近跨 fill=1 时的限高跳变。`mobile-gestures.json` 在 320/390 宽连续切换共 641 个采样中，可见手部保护区未越过左右边界。新版八张静帧已重新生成。

- 最终生产视觉：28 张逐帧/静帧已查看，手机点头→挥手初段手部完整，跟拍推近连续。发现的编号叠脸已修复；`production-face-clear-320.png` 与 `production-face-clear-390.png` 实看通过，当前节点仍可操作。
- 汇总验收记录：`qa/tripo/browser-results.json`。本轮在 `feature/tripo-animations` 验证，交付合并到 `main` 并标记 `v2-tripo-motion`；原静止版 `v2-restored` 保留。
