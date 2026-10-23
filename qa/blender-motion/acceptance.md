# Blender 动作重制验收

日期：2026-10-24（Asia/Singapore）。本轮以自然、连续为优先，替代 `qa/breathing/` 中的运行时挺直及上下呼吸方案。

## 实际改动

- 在 Blender 5.1.0 中编辑并烘焙五段独立 Action，正式可编辑副本为 `animation/character-actions.blend`，原 `../person.blend` 与三份动作素材不覆盖。
- Idle：4.8 秒循环，使用原待机后半段真实上身骨骼微动，去掉踏步，双脚稳定。保留肩背、头颈、手臂的自然变化；没有程序性上下平移。
- Walk：4.4 秒，共同放松站姿与原步态衔接；双手经 Blender IK 向外调整，保留手腕朝向。
- Nod：4.15 秒，最初 0.4 秒抬手源动作延展到 0.75 秒，减少起手急跳，主体动作保留。
- Wave：5.2 秒，继续使用小幅挥手；非挥手右臂改为自然下垂并随待机轻动，不再缩进身体。
- LookAround：6.8 秒，保留转头和躯干转动，双臂回到放松姿态，右手留出腰侧间距。
- 四段动作的首帧均与 Idle0 相同，末帧与 Idle 对应时间相同。网页直接续播同相位 Idle，不再追加整个人拉回 Rest 的动画。用户主动切站仍保留 0.35 秒过渡。

## 模型保真

`person-authored-animated.glb`：6,236,244 字节，SHA256 `28ddcb8629174322495add57936bc27e8851dd7a5bb682602a46b728902bfda0`。

只追加动画数据。原始 4,344,360 字节 binary 前缀，以及 nodes、meshes、skins、materials、textures、images 等数据不变。原人物 11,922 顶点、10,892 三角形、法线、UV、4096×4096 JPEG 原字节保留。运行时继续使用既有 180 个抽绳顶点蒙皮修正和 4K 换色遮罩。详见 `asset-preservation.json`、`blender-source.json`。

## 已完成检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 真实 GLTFLoader 骨骼、末端相位、帧间位移、连续打断、暂停、减少动态、五分钟 Idle | 58/58 | `motion-results.json` |
| 抽绳胸面、左右手腰裤区域及最差帧三维复核 | 28/28 | `clothing-results.json` |
| Blender 工程只读核验：5 个真实 Action、关键帧、原网格、4K 贴图、源文件哈希 | 30/30 | `blender-source.json` |
| 合成播放器回归（仅控制器，不代替真实资产） | 22/22 | `player-results.json` |
| 桌面 1440×1000、手机 390×844 的四站渲染与布局 | 41/41 | `visual-results.json` |
| 正式构建、模型 SHA、章节、持续待机画面变化、静帧及手机 | 11/11 | `production-results.json` |

48 张过程截图覆盖四站、桌面/手机、动作 10%/30%/50%/75%/90%/结束，记录在 `sequences.json`。人工查看了四段动作、挥手右臂、步态双手、收尾和桌面/手机待机画面。截图保留在被忽略的 `output/playwright/blender-motion/`。

抽绳检查共 3665 帧，四站各包含至少 10.10 秒待机；180 个抽绳点到胸面的最小间距 2.882 mm。左右手 835/851 个高权重顶点在检查范围内无负间距；每站最差帧的三维最近点和射线复核均位于身体表面外。

intro、idle、still 共 24 张高质量备用图均重新生成；仍使用原静态模型的 still 图像与之前相同。缓存版本为 `blender-actions-1`。`npm run check`、`npm run build` 通过，仅保留 Three.js chunk 大小提示。构建入口为 `index-Dd12FI_8.js`。

部署后使用 `verify-online.cjs` 核验实际入口脚本、模型 SHA 和持续待机，并将在线结果保存在 `output/playwright/blender-motion/online-results.json`，避免把本地通过当成在线完成。

## 检查边界

数值检查不能代替动画观感。碰撞检查针对抽绳胸面和双手腰裤区域，不能证明任意角度、所有网格都没有自交；挥手弯肘处仍有原素材的小片折叠痕迹。关键帧按 60 Hz 烘焙、线性插值，末端速度检查比较同相位 Idle 基线，不声称每个关键帧都具有数学上的连续加速度。

重生成脚本会覆盖可编辑 Blender 副本。手工修改该副本后应另存并重新采样；`motion:pack` 读取采样 JSON，不直接读取 `.blend`。
