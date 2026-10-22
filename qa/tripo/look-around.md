# v2.3 环顾与四站镜头验收

日期：2026-10-23。工作分支：`feature/look-around`。交付标签：`v2-look-around`。

用户明确撤回严重穿模的抱臂动作，改用 `动作素材/human+character+3d+model+huangu.glb`；同时要求四站摄影角度和距离明显区分。第三站改为 LookAround，旧抱臂 CrossArms 不作为当前方案或验收依据。

## 当前方案

| 站点 | 内容 | 动作 | 已检查的镜头 |
| --- | --- | --- | --- |
| 01 | 随时出发 | Walk；结束后待机，点击仅点头 | 较远侧前方跟拍 |
| 02 | 好看，也好用 | Nod | 较正面特写 |
| 03 | 上线只是开始 | LookAround；单次结束后待机，点击可重播 | 略高侧面中景 |
| 04 | 好队友 | Wave，小幅挥手 | 另一侧半身 |

主代理已查看桌面 1440 px、手机 390 px 与 320 px 的动作和待机截图，四站角度与距离已明显区分。待机收到胸部近景，尽量少露手指；动作中允许正常展示主要手势，头部保持完整。减少动态模式保持原站姿，行走位置与切站连续性沿用既有要求。卡片避让没有包含在本轮 51 项专门断言中，不能据此声称已全面验收。

当前动作镜头的角度与构图参数如下，来源为 `src/scene.js`。`fill` 为构图参数，不是人物实际身高；大于 1 表示近景裁切。手机近景值按表中标注，乘以根据舞台宽高计算的 `gestureScale`。

| 站点 | 动作方位角 | 桌面动作 fill | 桌面待机 fill | 手机动作 fill | 手机待机 fill |
| --- | --- | --- | --- | --- | --- |
| 01 | 62°，行走收尾到 48° | 0.80，收尾到近景 | 1.88 | 按舞台高度计算，最高 0.67 | 1.50 × gestureScale |
| 02 | 8° | 2.45 | 2.45 | 1.85 × gestureScale | 1.85 × gestureScale |
| 03 | −48° | 1.70 | 1.90 | 1.45 × gestureScale | 1.60 × gestureScale |
| 04 | 30° | 1.52 | 2.10 | 0.98 × gestureScale | 1.72 × gestureScale |

已查看 `output/playwright/look-around/` 中三种宽度的动作、待机截图；环顾另在 1.5、4、7.5、11、14 秒取样，未见此前抱臂的严重穿模。此结论限于这些实际取样。

## 素材与资产核验

- 原动作源：`动作素材/human+character+3d+model.glb`，保留 Idle、Greet、Box、Walk、Nod、Wave 六个原始片段。网页继续禁止绑定或播放 Greet、Box。
- 新环顾源：`动作素材/human+character+3d+model+huangu.glb`，仅有 `look_around.001`，源索引 0，15.625 秒、195 个通道；输出名 LookAround。
- 新素材有 65 骨骼，与基线同名同层级；最外层 rig 名称为 Armature，基线为 PersonRig，不影响骨骼映射。最大 rest 差为平移 `2.09e-7`、四元数分量 `1.20e-5`、缩放 `4.89e-6`。
- 初步数值检查：Head 相对首帧最大转动约 39.15°，Spine2 约 5.62°，以头部环顾为主；这不是视觉质量验收。
- 当前派生 `public/models/person-animated.glb` 为 2,135,360 bytes，包含旧六片段与 LookAround，**不含 CrossArms**。管线不再读取被撤回的抱臂源文件。
- 原六动画定义、accessor、bufferView 和对应压缩二进制前缀，与 Git 中上一版派生 GLB 完全一致。原基线的脸、几何、骨架、材质、贴图二进制及场景定义保持不变，无新增眼球或面部形变。
- `node scripts/tripo-prepare.mjs --check` 已通过，可从两份源文件逐字节复现本轮 GLB 与元数据；两个用户源文件、原 `person.glb` 和 `person.blend` 未被改写。

SHA-256：

| 资产 | SHA-256 |
| --- | --- |
| 原人物基线 | `def0603ec59ac8fac3de5df25e2827b2fbbd11cf0ad7ae5672e9fc3fab4a957f` |
| 原六动作源 | `489f55375ca109e670396da16a45f35b94f18a7247a2ff26bb35bbaaa2e6f9e8` |
| 新环顾源 | `a5b3fd132e9a46d98d508f5a52e7371503995d424b7ef849c580039024672988` |
| 本轮派生 GLB | `30c9fe726248feaf64d84b4d54623fc0059dff5d59d0f0c6d13aaf1551491bdd` |

## 本轮检查状态

| 项目 | 直接证据 | 状态 |
| --- | --- | --- |
| 两份源骨架兼容，原人物与原六片段保留 | 多源管线校验及与 Git 旧 GLB 的字节比较 | 通过 |
| 输出不含 CrossArms | 输出动画列表与管线源列表检查 | 通过 |
| 两份源文件可复现生成同一派生资产 | `tripo-prepare.mjs --check` | 通过 |
| 实际 GLB 动作映射、单次收尾、点击行为、位移与中断 | `qa/tripo/motion-tests.json` | 50/50 通过 |
| 三种宽度的动作映射、待机手指隐藏、头顶完整、行走后切换环顾保持位置、点击重播 | `qa/tripo/look-around-results.json` | 51/51 通过 |
| 四站角度、距离区分及桌面、手机动作与待机构图 | 主代理查看 `output/playwright/look-around/` 的 1440、390、320 px 截图 | 已检查 |
| 环顾动作视觉取样 | 1.5、4、7.5、11、14 秒截图 | 取样未见严重穿模 |
| 八张降级静帧与位置元数据 | `public/images-tripo/angle-01.png` 至 `angle-04.png`、`mobile-01.png` 至 `mobile-04.png`、`frames.json` | 全部重生成 |
| 语法与生产构建 | 主代理执行 `npm run check`、`npm run build` | 通过；仅 Three.js 大 chunk 提示 |
| 生产页面、模式入口、移动横滑、资源与脚本错误 | `qa/tripo/look-around-production.json`；原记录在 `output/playwright/tripo/production.json` | 20/20 通过 |
| 最终颜色连续性浏览器回归 | `qa/tripo/verify-color-continuity.cjs`、`qa/tripo/color-continuity-results.json` | 32/32 通过 |
| 卡片避让专项断言 | 本轮 51 项结果不含此项 | 未作专项验收 |

## 本轮颜色修复

- 切换站点时，页面不再提前将 CSS 强调色写成目标色，再被场景渐变回写；节点颜色跟随已显示的卫衣颜色。
- 在切站过程中开始拖拽时，同时以当前镜头进度和已显示的颜色建立锚点，避免跳到目标站或退回按镜头进度推算的旧颜色。
- 切到静帧模式时，立即恢复当前站点的准确颜色，避免停留在未完成渐变的中间色。

保留原设计的 600 ms 颜色过渡、1000 ms 镜头过渡，以及 OKLCH 的明度和色度线性变化、避开 60–100° 黄色区间、03↔04 绕蓝紫的色相路径。最终颜色浏览器检查已读取结果，32/32 通过：覆盖全部 12 个有向站点对的卫衣色、CSS 强调色、节点背景同步及终点颜色；还验证了切换中首次拖拽确实发生在镜头尚未到达时、接管后连续三帧的明度/色度/色相、快速切站与静帧往返。

## 验收边界

此前 `qa/tripo/refined-stations.md` 对应 v2.2 的第三站 Idle，`qa/tripo/requirements.md` 对应更早的 Tripo 映射。它们都是历史记录，不能证明本轮环顾与新镜头通过。已撤回的抱臂实验及其模块、浏览器结果也不能引用为本轮通过结论。

本轮模块测试使用实际 GLB 动画数据，但不验证渲染画面；51 项浏览器断言与截图取样也不等于所有时间点、所有屏幕尺寸均无问题。卡片避让未做专项断言，不能计入已通过范围。颜色检查验证颜色状态及节点样式同步，不要求受灯光影响的卫衣像素与纯色节点逐像素一致。可通过 Git 标签 `v2-look-around` 定位本轮实现。
