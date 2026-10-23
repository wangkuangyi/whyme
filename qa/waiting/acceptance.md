# 等待动作与两站机位验收

本轮以 `feature/waiting-motion` 开发，替换前基线为 `abfcd4d`。正式资产 SHA-256 为 `dbcc30a95bcc6a96e94708822bf4a960fa93ecbe594aac22b2ef2c0e906ed922`；被撤回的手腕前推、拇指外展及 E 等实验不属于交付版本。

## 实际改动

- 03「上线只是开始」从 LookAround 改为用户 dengdai 素材编辑的 Wait。Blender 内保留原躯干、髋腿重心、手腕和拇指关系，仅局部修正左食指、中指掌指关节的方向。主体保持原速，8 秒片段首尾各用 1 秒接入和离开共同 Idle。
- 03 从人物自身左前方拍摄，轻仰拍中景：azimuth +35°、camY .40、lookY .64。01 保留俯视小全身，azimuth 改为 −38°，人物前方投影朝屏幕右下。
- Wait 相关切站混合为 .45 秒，Wait → Walk 为 .35 秒；自然结束直接续播同相位独立 Idle。网页没有新增姿态修正、假呼吸平移或面部动画。
- Idle、Walk、Nod、Wave 四段动画 sampler 字节保持。原 binary 前 4,344,360 字节、网格、法线、UV、骨架、材质元数据及 4096×4096 JPEG 原字节保持。原素材与 `../person.blend` 不变。
- 更新 01/03 机位相关静帧和元数据，缓存版本为 `waiting-1`。其余机位、四站顺序和配色保持。

## 已完成验证

| 项目 | 结果 | 记录 |
| --- | --- | --- |
| 实际 GLB 骨骼、首尾相位、速度、切站连续性及原数据 | 81/81 | `motion-results.json` |
| 独立播放器回归 | 22/22 | `player-results.json` |
| 可编辑 Blender 源检查 | 30/30 | `blender-source.json` |
| 完整重跑导出采样一致性 | 5/5 | `reproducibility.json` |
| 实际骨骼方向与镜头 | 7/7 | `direction-results.json` |
| 桌面、手机、窄屏四站动作/待机构图 | 68/68 | `framing-results.json` |
| 24 张 intro/idle/still 静帧、颜色、尺寸、机位 | 24/24 | `static-results.json` |
| 本地生产构建、真实模型指纹、四站、Idle、手机和静帧 | 12/12 | `production-results.json` |
| 衣物与手部接触探针 | 26/34，8 项未通过 | `clothing-results.json` |

`npm run check` 和 `npm run build` 通过。构建仍有 Three.js chunk 大小提示。生产入口为 `index-Bj23Q_mG.js`，3D 包为 `scene-CRjfSosv.js`。

## 视觉审阅与接触检查边界

已审阅真实绿衣桌面/手机完整动作多个时点、起手及回 Idle，另补拍约 .70、1.42、2.17、7.25 秒的接触风险时点。指定左前镜头下未见实验版悬在腰前的手掌，也未见明显新增的截指。原素材左袖与腰间的背景窄缝在原始姿态对照中同样存在。具体截图和目检范围见 `visual-review.md` 与 `contact-samples.json`；截图保存在被 Git 忽略的 `output/playwright/waiting/`。

手部零负侧向间距的 8 项断言没有全部通过：Wait 左右手各一项，以及六个含 Wait 的切换窗口。测试使用开放的腰/上腿三角面子集，负侧投影或最近面法线有符号距离不能直接解释成闭合实体的穿透深度；切换窗口包含原扶髋接触，也不等同六种新的过渡错误。抽绳所有测试通过，Wait 抽绳最小测试间距约 2.755 mm。

保留这些失败与原素材被遮挡手指的接触风险，不宣称全网格、任意视角无自交，也不以把整只手推出腰部的方式换取全部探针为正。详见 `clothing-results.json` 及接触说明。原四段动作和独立 Idle 没有因本轮等待替换而重新修改。

## 发布核验

`verify-online.cjs` 检查实际线上 bundle、GLB SHA-256、Wait/Idle、四站文案颜色及手机布局；运行结果写入 `output/playwright/waiting/online-results.json`，只有该次线上运行成功后才能报告部署验证完成。此文件不预先声称线上通过。
