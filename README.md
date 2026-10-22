# Why me? — 本地网页

独立项目目录：`whyme-web`。v2.2 使用用户提供的 Tripo 动作，保留原人物的脸、几何与贴图。四站为“走路、点头、自然待机、小幅挥手”，移除大幅招手，并收紧待机镜头以减少手指露出。原始 `../person.blend` 和 `public/models/person.glb` 保持不变。本轮验收与此前交付版本分开记录。

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
- 四站动作映射为 `Walk / Nod / Idle / Wave`：随时出发使用走路，好看也好用使用带抬手的点头，上线只是开始暂用自然待机，好队友保留小幅挥手。
- 第三站复用持续待机循环，重复进入不重置相位，点击不额外表演。用户准备生成的简单自然抱臂动作尚未提供和接入。
- 行走使用动画的真实前进位移，镜头从侧前方跟随；动作结束或切换后保留人物位置，淡入待机。第一站点击只点头回应，不再次走路。
- 第二站收紧上半身；所有待机状态平滑收至胸部近景，手指落在画面外；动作中正常展示主要手势。已检查桌面 1440px 与手机 390/320px。
- 光环、柔光与阴影；键盘、拖动、节点和目录导航。
- 手机版说明区、打印版、幕后详情和静帧降级。
- 人物使用 `public/models/person-animated.glb`，约 1.91 MB，在原模型上添加同骨架动画；没有新增眼球或面部动画。

大幅招手 `Greet` 和不合适的 `Box` 均不绑定或播放。它们仍存在于原始动作资产中，不属于当前可用动作。此前撤回的表情和动作实验只保留在被 Git 忽略的 `output/v2/`，不参与运行。

原模型的裤子纹理和材质边界仍有少量瑕疵。行走素材没有自然停止片段，末段近景用于避开脚部收拢；这是取景处理，不代表原动作步态已修复。

## 重新生成动作资产

将用户提供的 `human+character+3d+model.glb` 放在 `动作素材/` 后运行：

```powershell
node scripts/tripo-inspect.mjs
node scripts/tripo-prepare.mjs
node scripts/tripo-prepare.mjs --check
node scripts/tripo-test-motion.mjs
```

准备脚本核对骨架和原资产保留情况，并生成动作 GLB 与 `person-animated-info.json`；`--check` 只核验可复现性，不写文件。动作模块测试检查片段选择、位置连续性、切换及减少动态等行为，不能替代浏览器中的动作和构图检查。原始导出素材默认不入库，新检出项目只有在重新生成资产时才需要补齐该文件。

## 文件与版本管理

- `src/content.js`：中文文案、联系方式与日期。
- `src/main.js`、`src/style.css`：页面与交互。
- `src/scene.js`、`src/scene-math.js`：3D 场景、镜头和颜色。
- `src/motion.js`：动作播放、过渡与行走位移。
- `src/dialogs.js`：联系、幕后、更新记录。
- `public/models/`：原人物、动作人物及资产信息。
- `public/images-tripo/`：按新站点生成的八张待机近景及位置元数据；`public/images-v2/` 保留原静止版本的静帧。
- `CONTENT_SOURCES.md`：个人经历的来源边界。
- `qa/tripo/refined-stations.md`：本轮动作映射与镜头细化的验收状态。
- `qa/tripo/requirements.md`：此前 `v2-tripo-motion` 的动作与镜头验收，不等同于本轮验收。
- `qa/v2-requirements.md`：此前恢复原人物版本的历史验收，不等同于本版动画验收。
- `动作素材/`：用户导出的同人物动画；未经筛选的原始素材默认不入库。

Git 在本项目独立初始化。本轮使用 `feature/refine-station-actions` 分支；此前动作开发使用 `feature/tripo-animations`，交付版本见 `v2-tripo-motion`。`v2-restored` 标签保留原人物静止版本。后续按可回退的小改动提交。依赖、构建结果、测试截图、Blender 实验、缓存和未经筛选的原始动作素材不提交。未配置远程仓库，也未推送。

文案改变后运行 `python scripts/fetch_fonts.py --local-only` 更新字体子集。

## 验证状态

本轮 38 项真实 GLB 动作测试、37 项待机构图检查、13 项浏览器运动流程和 20 项生产页面检查通过；完成桌面和手机截图目视检查、八张静帧更新、字体子集更新、语法检查与生产构建。实际证据与边界见 `qa/tripo/refined-stations.md`。原人物 SHA-256 仍为 `def0603ec59ac8fac3de5df25e2827b2fbbd11cf0ad7ae5672e9fc3fab4a957f`。

历史 `v2-tripo-motion` 曾通过 27 项动作模块测试、29 项页面交互、13 项浏览器运动流程和 24 项生产检查，并生成八张静帧；这些检查对应旧映射 `Greet / Nod / Walk / Wave`。历史证据保留在 `qa/tripo/requirements.md`，不证明本轮镜头和映射已通过。
