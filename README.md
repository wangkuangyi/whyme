# Why me? — 本地网页

独立项目目录：`whyme-web`。本轮开发版本为 v2.3，使用用户提供的 Tripo 动作，保留原人物的脸、几何与贴图。四站改为“走路、点头、环顾、小幅挥手”，并调整四站的摄影角度和距离，使镜头明显区分。原始 `../person.blend` 和 `public/models/person.glb` 保持不变。本轮验收与此前交付版本分开记录。

## 运行

```powershell
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 。也可运行 `启动网页.ps1`。

- 默认展示人物动作与四个镜头；`?angle=1` 至 `?angle=4` 可指定初始角度。
- `?still=1` 展示原人物静止 3D，仍可切换镜头。
- `?static=1` 使用静帧展示；幕后也提供静帧切换入口。
- 系统启用“减少动态”时，人物保留原站姿。

`npm run check` 检查语法，`npm run build` 构建，`npm run preview` 预览构建结果。Node.js 22 已在本机使用。

## 当前版本

- 中文身份信息、联系与简历、节点卡片、左下目录。
- 自托管 Noto Sans SC 400/600；Why me? 使用 Instrument Serif Italic。
- 赤陶、群青、松绿、莓果四种卫衣颜色，直接 OKLCH 过渡。
- 四站动作映射为 `Walk / Nod / LookAround / Wave`：随时出发使用走路，好看也好用使用带抬手的点头，上线只是开始使用新环顾，好队友保留小幅挥手。
- 第三站使用新素材 `look_around.001`，原片段长 15.625 秒，以头部环顾为主。单次播放后回到自然待机，点击人物可重播；本轮已检查动作、待机和重播，环顾在 1.5、4、7.5、11、14 秒的截图取样中未见严重穿模。
- 行走使用动画的真实前进位移，镜头从侧前方跟随；动作结束或切换后保留人物位置，淡入待机。第一站点击只点头回应，不再次走路。
- 四站镜头已按桌面和手机画面检查：走路较远侧前方跟拍、点头较正面特写、环顾略高侧面中景、小挥手另一侧半身。各站角度和距离明显区分，待机收紧到胸部近景，尽量少露手指；动作中保留主要手势。参数以 `src/scene.js` 为准，1440、390、320 px 三种宽度的动作和待机截图已查看。
- 光环、柔光与阴影；键盘、拖动、节点和目录导航。
- 手机版说明区、打印版、幕后详情和静帧降级。
- 人物使用 `public/models/person-animated.glb`，约 2.14 MB，在原模型上添加两份同骨架素材的动画；没有新增眼球或面部动画。

大幅招手 `Greet` 和不合适的 `Box` 均不绑定或播放。它们仍存在于原始动作资产中，不属于当前可用动作。此前撤回的表情和动作实验只保留在被 Git 忽略的 `output/v2/`，不参与运行。

用户已因明显穿模撤回抱臂 `CrossArms`。当前派生 GLB 不包含抱臂片段，管线也不读取 `human+character+3d+model+shuangbi.glb`；抱臂实验的通过记录不能作为本轮环顾验收。

原模型的裤子纹理和材质边界仍有少量瑕疵。行走素材没有自然停止片段，末段近景用于避开脚部收拢；这是取景处理，不代表原动作步态已修复。

## 重新生成动作资产

将两份用户原始导出文件放在 `动作素材/`：

- `human+character+3d+model.glb`：原有六个动作片段。
- `human+character+3d+model+huangu.glb`：单个 `look_around.001` 环顾片段。

然后运行：

```powershell
node scripts/tripo-inspect.mjs
node scripts/tripo-prepare.mjs
node scripts/tripo-prepare.mjs --check
node scripts/tripo-test-motion.mjs
```

准备脚本逐份核对骨架、片段顺序和原资产保留情况，并生成动作 GLB 与 `person-animated-info.json`；元数据记录每份源文件的路径、SHA-256 和每个片段的来源。`--check` 只核验多源可复现性，不写文件。`tripo-inspect.mjs` 默认检查原有六片段素材，准备脚本会验证两份素材。动作模块测试不能替代浏览器中的动作和构图检查。原始导出素材默认不入库，新检出项目只有在重新生成资产时才需要补齐两份文件。

## 文件与版本管理

- `src/content.js`：中文文案、联系方式与日期。
- `src/main.js`、`src/style.css`：页面与交互。
- `src/scene.js`、`src/scene-math.js`：3D 场景、镜头和颜色。
- `src/motion.js`：动作播放、过渡与行走位移。
- `src/dialogs.js`：联系、幕后、更新记录。
- `public/models/`：原人物、动作人物及资产信息。
- `public/images-tripo/`：本轮已重新生成四张桌面、四张手机静帧及位置元数据；`public/images-v2/` 保留原静止版本的静帧。
- `CONTENT_SOURCES.md`：个人经历的来源边界。
- `qa/tripo/look-around.md`：本轮环顾与四站差异化镜头的验收状态。
- `qa/tripo/refined-stations.md`：此前 v2.2 的动作与待机镜头验收，不等同于本轮验收。
- `qa/tripo/requirements.md`：此前 `v2-tripo-motion` 的动作与镜头验收，不等同于本轮验收。
- `qa/v2-requirements.md`：此前恢复原人物版本的历史验收，不等同于本版动画验收。
- `动作素材/`：用户导出的同人物动画；未经筛选的原始素材默认不入库。

Git 在本项目独立初始化。v2.3 使用 `feature/look-around` 分支开发与验收，版本标签为 `v2-look-around`。此前 v2.2 见 `v2-refined-actions`，最初 Tripo 版本见 `v2-tripo-motion`，原人物静止版本见 `v2-restored`。后续按可回退的小改动提交。依赖、构建结果、测试截图、Blender 实验、缓存和未经筛选的原始动作素材不提交。未配置远程仓库，也未推送。

文案改变后运行 `python scripts/fetch_fonts.py --local-only` 更新字体子集。

## 验证状态

本轮已通过两份素材的骨架一致性、原资产保留和 `tripo-prepare.mjs --check` 多源可复现检查。与 Git 中旧派生 GLB 比较，原有六个动画定义、accessor、bufferView 和压缩二进制前缀完全一致；当前输出只新增 LookAround，不含 CrossArms。原人物 SHA-256 仍为 `def0603ec59ac8fac3de5df25e2827b2fbbd11cf0ad7ae5672e9fc3fab4a957f`。

本轮实际 GLB 动作测试 **50/50** 通过；1440、390、320 px 的动作与待机构图检查 **51/51** 通过；生产页面回归 **20/20** 通过，八张静帧已重新生成。`npm run check`、`npm run build` 已通过，构建仅有 Three.js 大 chunk 提示。51 项检查包含头顶完整、待机手指隐藏、动作映射、位置保持和重播，不包含卡片避让的专门断言；截图取样也不等于对每一帧的穿模保证。详情及证据见 `qa/tripo/look-around.md`。

本轮还修复了切站时 CSS 抢写目标颜色、切换中拖拽接管的镜头与颜色锚点、切到静帧后的正确站点颜色。保留原设计的 600 ms 颜色过渡、1000 ms 镜头过渡和 OKLCH 避开黄色区间的路径。最终颜色浏览器检查 **32/32** 通过，包含全部 12 个有向站点对、切换中首次拖拽及随后三帧、快速切站和静帧往返；证据为 `qa/tripo/color-continuity-results.json`。

历史 v2.2 曾通过 38 项动作测试、37 项待机构图检查、13 项浏览器运动流程和 20 项生产页面检查，证据在 `qa/tripo/refined-stations.md`；第三站当时为 Idle，不能证明新环顾及新镜头通过。已撤回的 CrossArms 实验也不提供本轮通过依据。

历史 `v2-tripo-motion` 曾通过 27 项动作模块测试、29 项页面交互、13 项浏览器运动流程和 24 项生产检查，并生成八张静帧；这些检查对应旧映射 `Greet / Nod / Walk / Wave`。历史证据保留在 `qa/tripo/requirements.md`，不证明本轮镜头和映射已通过。
