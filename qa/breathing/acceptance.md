# 连续呼吸与自然动作归位

2026-10-23，分支 `fix/breathing-and-natural-gesture-settle`。

## 改动与原因

- 待机使用原始直立 Rest 为基底，加入 4.8 秒一轮的轻微胸部起伏。Spine1/Spine2 仅在世界竖向平移 1.6/1.2 mm，总升幅最大 2.8 mm；不弯脊柱、不缩放脸部、双脚不动。相位使用全程累计 presentation 时间，切站和点击不重启。动作中保留 20% 幅度，随归位恢复完整幅度；暂停、拖拽冻结，减少动态为静止。
- 上一版 8° 限幅未充分纠正 Nod/Wave 的含胸。现按原 Rest 的下胸、中胸支撑角分别修正 Spine/Spine1/Spine2/Neck，Head 补偿保持原世界方向。动作胸椎折角约 3°，脚步和手臂局部轨道不改。当前 Walk/LookAround 正常源姿态无需修正。
- 检查还发现：对 Mixer 已混合姿态动态施加门控，会让归位中段再次含胸，Nod/Wave 曾分别回弯到 9.14° / 6.23°。现先以 120 Hz 加全部原关键帧校正源片段，生成仅替换五骨旋转的运行时派生动画，再交给 Mixer 混合；播放时只观察支撑角，不再重复矫正。
- Nod 原完整片段的 2.25–2.65 秒包含收手，旧淡出恰在快速落手中介入。现在保留完整 3 秒，Wave 改取 0.9–4.75 秒，LookAround 改取 1.2–7.4 秒。三者最后 0.4 源秒放慢为 0.8 播放秒，映射 `2u - 2u³ + u⁴` 使速度从原速降到零，首尾加速度为零，同时以五次平滑权重回到呼吸待机；不增加“先停住、再归位”的独立阶段。
- Walk 仍为 3.6 秒原速循环步态，最后 1 秒逐渐减小步幅与摆臂。它的源素材没有独立收步段，本轮采用渐减幅度，不宣称生成了新的真实收步动作。镜头收近从 `settleProgress` 开始渐近，不再等 Idle 后另起一次推镜。

## 验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 实际模型动作、独立呼吸基准、连续相位、自然收尾 | 221/221 | `motion-results.json` |
| 独立支撑校正与先校正后混合 | 21/21 | `correction-results.json` |
| 实际 GLTFLoader、抽绳及新版动作/呼吸组合 | 32/32 | `hoodie-results.json` |
| 桌面与手机四站画质、布局和待机 | 41/41 | `visual-results.json` |
| 正式构建桌面四站、手机、静帧与浏览器错误 | 9/9 | `production-results.json` |

`npm run check` 与 `npm run build` 通过。正式构建为 `scene-C5d6BYsW.js`，仅有 Three.js bundle 大于 500 kB 的体积提示，没有构建错误。

动作检查保留 240 Hz 相邻帧骨位移 <20 mm 阈值，Nod 入场峰值约 17.16 mm。独立比较同呼吸相位的待机：最后 25 ms 内最大位置残差约 0.061 mm、速度残差 8.58 mm/s；完成帧加速度低于 0.09 m/s²，下一帧低于 0.011 m/s²。Nod/Wave 实际归位胸椎折角最大 2.985° / 2.990°，中胸相对 Rest 最大偏差 0.062° / 0.026°，没有旧门控导致的再次含胸。

独立校正测试覆盖 3,706 源帧与 386 归位夹具帧；动作测试另包含 300 秒稳定待机、跨站与点击相位连续、暂停/拖拽冻结、减少动态及快速打断。完整动作阶段世界头部方向误差最大约 7.2e-7 rad；混合阶段按照校正动作与 Rest 的插值验证，不将其错误地当作未经混合的源动作。

抽绳检查沿身体正面方向，将两根绳的 180 个顶点投影到实际变形胸面；覆盖四站动作、混合收尾和每站额外 12.25 秒呼吸，未检测到胸面穿入，最小间距约 1.983 mm。这不等同于全网格任意方向无自交保证。原 GLB、4K 贴图、顶点位置、法线、UV 和 `person.blend` 未修改。

实际截图位于 `output/playwright/breathing-posture/`。已查看桌面/手机点头、挥手及直立待机画面；动作取样记录见 `action-captures.json`。24 张 2× 静帧及元数据同步，待机图片在呼吸接近呼气端点捕获，缓存版本 `breathing-4k`。旧 `qa/posture/` 保留为历史验收。

## 复验

```powershell
npm run check
npm run test:motion
npm run test:posture
npm run test:hoodie
npm run build
```

浏览器配置沿用 `qa/original/browser.config.json`。本目录 `capture-actions.cjs`、`verify-visual.cjs`、`capture-frames.cjs` 使用本地 5173；`verify-production.cjs` 检查 4173 正式构建。
