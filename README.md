# Why me? — 个人展示

独立项目目录：`whyme-web`。页面版本标识为 v2.4.1，当前保留 Tripo 原始表面与 4K 贴图；本轮在 Blender 中编辑五个独立动画：自然待机、走路、点头、小幅挥手和环顾。使用统一放松站姿，重点修正非挥手右臂内缩与动作间的姿态跳变。抽绳修正继续保留。白色加载页完成后再淡入网站。站点顺序为“迅速到岗、审美与产品意识、团队精神、长期意识”，对应 Walk2 原地步态、点头、小幅挥手和环顾，默认展示迅速到岗。

静态使用 `public/models/person-original.glb`，动态使用 `person-authored-animated.glb`；`person-original-animated.glb` 保留为原动画备份。新动态文件只追加 Blender 编辑的动画，完整保留原 binary 前缀及 nodes、meshes、skins、materials、textures、images 等模型数据。它们保留 Tripo 的 11,922 个 GLB 顶点、10,892 个三角形、原法线、UV、蒙皮与原始 4096×4096 JPEG 字节，不做细分、减面、几何量化、缩图或贴图重编码。旧 `person.glb` / `person-animated.glb` 曾做细分、材质重建与 2K 处理，是历史网站基线，不是未经处理的 Tripo 原模型；它们与用户的 `../person.blend` 均保留。下文旧版本记录中的“原模型”指当时的网站基线，不能作为当前原始保真程度的证明。

正式域名：[whywky.website](https://whywky.website/)。代码仓库：[wangkuangyi/whyme](https://github.com/wangkuangyi/whyme)。原始 Pages 地址为 `https://wangkuangyi.github.io/whyme/`，绑定域名后由 GitHub 跳转至正式域名。

## 运行

```powershell
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 。也可运行 `启动网页.ps1`。

- 默认进入 01“随时出发”，首屏使用 Walk2 原地步态；`?angle=1` 至 `?angle=4` 可指定初始角度。
- `?still=1` 展示原人物静止 3D，仍可切换镜头。
- `?static=1` 使用静帧展示；幕后也提供静帧切换入口。
- 系统启用“减少动态”时，人物定格独立 Idle 首帧。

`npm run check` 检查语法，`npm run build` 构建，`npm run preview` 预览构建结果。Node.js 22 已在本机使用。

## GitHub Pages 发布

`.github/workflows/deploy.yml` 在推送 `main` 或手动运行时，执行 `npm ci`、语法检查、生产构建，再将 `dist` 发布到 GitHub Pages。CI 使用 Node.js 22；部署 Actions 固定到已核对的提交。仓库 Pages 的发布来源为 GitHub Actions。

构建从 Pages 配置读取 `base_path`，因此图片、字体、模型、简历和页面图标同时适配 `/whyme/` 子路径与独立域名根路径。当前 Pages 自定义域名为 `whywky.website`，部署使用根路径；本地 `npm run dev` 也使用根路径。

域名 DNS 使用 `dns31.hichina.com` / `dns32.hichina.com`，`@` 的四条 A 记录为 `185.199.108.153` 至 `185.199.111.153`，`www` 的 CNAME 为 `wangkuangyi.github.io`。GitHub 自动申请并管理 HTTPS 证书。若日后更换域名，在 Pages 中修改域名并配置 DNS 后重新运行工作流即可；当前使用 Actions 发布，不需要额外的 CNAME 文件。

如需在本机复验项目子路径：

```powershell
npm run build -- --base /whyme/
npm run preview -- --port 4174 --base /whyme/
```

打开 `http://127.0.0.1:4174/whyme/`。发布只上传构建目录；依赖、原始动作素材、Blender 源文件和测试输出不进入发布产物。

## 当前版本

站点顺序、配色和动作如下；镜头与配色随内容身份保留。当前原始资产检查见 `qa/tripo/original-assets.json`，本轮独立待机、动作和衣服检查见 `qa/blender-motion/`，加载与揭幕检查见 `qa/original/loading-results.json`。此前 `qa/tripo/walk-entry-*`、`walk-idle-*` 和 `walk2-*` 是历史证据，不替代本轮资产、渲染与加载检查。

| 站点 | 主题 | 动作 | 卫衣颜色 |
| --- | --- | --- | --- |
| 01（默认） | 迅速到岗 · 随时出发 | 原地步态 `Walk`，来源为 Walk2 | 暖灰褐 `#82756E` |
| 02 | 审美与产品意识 · 好看，也好用 | 点头 `Nod` | 群青 `#3755A6` |
| 03 | 团队精神 · 好队友 | 小幅挥手 `Wave` | 莓果 `#A44C76` |
| 04 | 长期意识 · 上线只是开始 | 环顾 `LookAround` | 松绿 `#327B60` |

- 桌面 01“随时出发”在白色加载页淡出后即可阅读介绍，与步态同时呈现，不必等待动作结束；动作期间持续更新卡片位置与连接线。01 的动作与待机都保持斜俯视小全身，不再末段推近。
- 手机优点栏从首屏起持续可读，切站立即更新；人物走路、转镜头或静帧切换时不隐藏正文，也不再重复播放文字入场动画。动作期间可以切换优点、展开证明和打开作品详情。
- 光环节点的遮挡同时检查圆点和右上数字；被人物遮住时立即隐藏，非当前节点稳定露出后再显示（通常 250 ms，稳定步态播放期间 650 ms），避免数字反复浮到胸前或从身体边缘闪出。
- 根据用户确认的经历更新审美、长期投入和团队协作三站。主卡保持短句，作品、Text2SQL 时间线、Benchmark Atlas 更新日志与协作项目集中在对应详情窗口；NUS 使用用户确认的个人站介绍页。到岗信息当前为“11月底可到岗”，事实来源见 `CONTENT_SOURCES.md`。
- 首次打开只有白色背景和居中的“正在加载王匡义的形象…”。完整 3D 首帧与字体就绪后，网站用约 450 ms 淡入；等待实际 CSS 过渡完成才解除人物暂停，避免加载期间消耗走路动作。普通启动不请求旧 intro PNG，也不先闪出姓名或按钮。字体最多等待 2 秒；模型 45 秒超时/失败后尝试静帧，静帧解码最多 12 秒，若图片也失败仍显示正文和重试入口。减少动态模式立即展示就绪画面。
- 动态蒙皮包围体与精确三角形遮挡；桌面镜头就位便展开卡片，行走期间跟随更新位置。影子浓度 0.10、主光高度 6、远端羽化，地面颜色减半。
- 拖动提示先淡出，再显示目录；静帧先用 120ms 淡到空白，再用 200ms 显示下一张。手机说明区随正文增高，降级提示位于说明区顶部。

- 中文身份信息、联系与简历、节点卡片、左下目录。
- 自托管 Noto Sans SC 400/600；WHY ME? 使用全大写自绘几何字标，统一顶线、底线和直切笔画，与姓名等宽。姓名下显示“11月底可到岗”小字；页面不显示镜头参数。左下目录与内容展示框共用直角半透明底色。
- 暖灰褐、群青、莓果、松绿四种卫衣颜色，直接 OKLCH 过渡。01 使用低饱和暖灰褐 `#82756E`，袖口为 `#6B5E58`、地面为 `#F8F5F3`；首帧和降级静帧需与新顺序及配色同步。
- 四站动作映射为 `Walk / Nod / Wave / LookAround`。站点判断通过动作名称定位，避免顺序改变后把 Walk 的行为套到其他站。
- 五段 Blender 动画时长：Idle 4.8 秒、Walk 4.4 秒、Nod 4.15 秒、Wave 5.2 秒、LookAround 6.8 秒。点头只对起手最初 0.4 源秒减速到 0.75 秒，主体手势保留。
- Idle 是独立循环的骨骼动画，取原 Idle 3.25–5 秒的稳定上身微动，脚保持落地，肩背、头部和手臂有细微变化。所有动作围绕同一放松站姿编辑，首帧匹配 Idle0、末帧匹配对应 Idle 相位，结束后直接续播 Idle；不再程序性上下浮动或强行回 bind/rest。
- 四站保持不同摄影角度和距离：01 斜俯视小全身、02 点头较正面特写、03 小幅挥手为另一侧半身、04 环顾略高侧面中景。01 动作与 Idle 均保持全身；02、03、04 待机继续收近，尽量少露手指。当前参数以 `src/scene.js` 为准，`qa/tripo/walk-idle-visual.json` 只记录旧资产对应的镜头验收。
- 光环、柔光与阴影；键盘、拖动、节点和目录导航。
- 手机版说明区、打印版、幕后详情和静帧降级。
- 人物使用 `public/models/person-authored-animated.glb`，精确文件体积和 SHA-256 见 `qa/blender-motion/asset-preservation.json`。使用三份同骨架素材，Walk 来自 Walk2，没有新增眼球或面部动画。衣服通过额外的 4K 灰度遮罩限定换色区域，同时保留原纹理；不使用程序生成布纹或合成法线替代原纹理。当前不因帧率自动降低画质，仅在失败或主动选择时切换高质量静帧。
- 原始贴图已包含鼻唇等部位的烘焙明暗。运行时人物采用 `MeshBasicMaterial`、`toneMapped:false`，直接呈现原 4K 纹理，避免棚灯再次塑形导致嘴唇明暗被放大；地面的投影仍保留。GLB 文件保留原 PBR 参数（roughness 约 0.9）用于数据互换，但网站人物不再受棚灯二次照明。02 的镜头增加轻微俯视，具体参数以 `src/scene.js` 为准。

大幅招手 `Greet` 和不合适的 `Box` 均不绑定或播放。它们仍存在于原始动作资产中，不属于当前可用动作。此前撤回的表情和动作实验只保留在被 Git 忽略的 `output/v2/`，不参与运行。

用户已因明显穿模撤回抱臂 `CrossArms`。当前派生 GLB 不包含抱臂片段，管线也不读取 `human+character+3d+model+shuangbi.glb`；抱臂实验的通过记录不能作为本轮环顾验收。

动画编辑源为 `animation/character-actions.blend`，包含五个 `Edited_*` Actions。Wave 的右臂改为自然下垂；Walk 双手及 LookAround 右手在 Blender 里通过 IK 留出腰侧间距。网页只播放烘焙后的动画，已取消运行时肩背校正和胸部上下平移。抽绳仍使用原先 180 个顶点的蒙皮权重修正。验收与限制见 `qa/blender-motion/acceptance.md`。

## 编辑当前 Blender 动作

```powershell
& "D:\APP\blender\blender.exe" --background --python-exit-code 1 --python scripts/blender_edit_motion.py
npm run motion:pack
npm run test:motion
npm run test:hoodie
```

上述命令从原始 GLB 重新生成并覆盖 `animation/character-actions.blend`；修改过该副本时请先另存。五段 Actions 均可在 Blender 中编辑。打包器读取 `output/blender-motion/authored-animations.json`，不会直接读取手工改过的 `.blend`，手工编辑后需要重新采样。采样中间数据被 Git 忽略。打包器不重新导出网格，只追加骨骼动画数据。修改后需重新截图、生成 24 张静帧并运行正式构建。

## 重新生成原始动作基线

将三份用户原始导出文件放在 `动作素材/`：

- `human+character+3d+model.glb`：原有六个动作片段，其中旧 Walk 不再采用。
- `human+character+3d+model+huangu.glb`：单个 `look_around.001` 环顾片段。
- `human+character+3d+model+walk2.glb`：单个 `walk.001` 原地步态片段，替换派生资产中的 Walk。

另外保留最早的 `../human character 3d model.glb`，用于核对原始 4K JPEG 与材质参数。其静态骨架绑定数据不完整，运行资产使用同人物动画导出的有效骨架，细节见生成的来源报告。然后运行：

```powershell
node scripts/original-prepare.mjs
node scripts/original-prepare.mjs --check
```

准备脚本核对骨架、原网格属性、4K JPEG 字节和各动作采样，生成 `person-original.glb`、`person-original-animated.glb`、`hoodie-mask.png` 及 `person-original-info.json`；元数据记录源路径、SHA-256 和片段来源。`--check` 只核验可复现性，不写文件。资产报告写入 `qa/tripo/original-assets.json`；它只更新原始基线，之后需按上节在 Blender 编辑、打包并运行 `npm run test:motion`，当前动作报告写入 `qa/blender-motion/motion-results.json`。数值报告不能替代浏览器中的材质、动作和构图检查。每次改动导出或遮罩后重新生成报告，并核对动作报告的资产 SHA-256。原始素材默认不入库，新检出项目只有重新生成资产时才需补齐源文件。旧 `prepare_person.py` 与 `tripo-prepare.mjs` 仅用于历史管线，不用于当前原始保真资产。

## 文件与版本管理

v2.4.1 的文案与作品入口使用 `feature/content-evidence` 分支，标签为 `v2.4.1`。

- `src/content.js`：中文文案、联系方式、日期及作品详情数据 `evidencePages`。
- `src/main.js`、`src/style.css`：页面与交互。
- `src/scene.js`、`src/scene-math.js`：3D 场景、镜头和颜色。
- `src/motion.js`：动作播放、过渡与行走位移。
- `src/dialogs.js`：联系、幕后、更新记录。
- `public/models/`：当前 `person-original*`、衣服换色遮罩、来源报告，以及保留的历史模型。
- `public/images-intro/`：透明人物与相机配准元数据，用于截图验收和资料保留，普通 3D 首屏不下载这些图片。仅开发模式的 `?holdIntro=1` 暂停模型用于捕获，白色遮罩保持显示；通过 scene.capture() 导出人物，浏览器截图若需隐藏遮罩只在测试中处理。
- `public/images-tripo/`：四张桌面、四张手机待机静帧及位置元数据；`public/images-v2/` 为静止 3D 的静帧。改变资产、镜头或灯光后须重生成这两组及 intro 共 24 张，并同步元数据。当前静帧缓存版本为 `blender-actions-1`。
- `CONTENT_SOURCES.md`：个人经历的来源边界。
- `qa/tripo/original-assets.json`：原始资产保留检查；`qa/tripo/original-motion.json` 为此前待机行为的历史检查。
- `qa/blender-motion/acceptance.md`：本轮 Blender 独立待机、四动作、衔接与衣服检查；`qa/breathing/` 和 `qa/posture/` 保留被替代方案的历史结果。
- `qa/original/loading.md`、`qa/original/loading-results.json`：白色加载页、错误恢复、静帧解码、字体等待与揭幕时序检查。
- `qa/tripo/walk2-assets.json`：历史 Walk2 替换检查，不替代当前原始保真资产检查。
- `qa/tripo/walk-idle-motion.json`、`qa/tripo/walk-idle-visual.json`：此前新顺序、稳站与旧资产的检查。
- `qa/tripo/walk2-motion-tests.json`、`qa/tripo/walk2.md`：此前 Walk2 与团队默认入口的历史验收，不代表当前新顺序已通过。
- `qa/tripo/v24.md`：此前 v2.4 第二次优化的验收记录；机器检查汇总为 `qa/tripo/v24-results.json`。
- `qa/tripo/look-around.md`：此前 v2.3 环顾与四站差异化镜头的验收状态。
- `qa/tripo/refined-stations.md`：此前 v2.2 的动作与待机镜头验收，不等同于本轮验收。
- `qa/tripo/requirements.md`：此前 `v2-tripo-motion` 的动作与镜头验收，不等同于本轮验收。
- `qa/v2-requirements.md`：此前恢复原人物版本的历史验收，不等同于本版动画验收。
- `动作素材/`：用户导出的同人物动画；未经筛选的原始素材默认不入库。

Git 在本项目独立初始化。v2.4.0 使用 `feature/v2.4-polish` 分支落实第二轮优化，版本标签为 `v2.4.0`。v2.3.3 使用 `feature/angular-wordmark` 分支设计全大写几何字标，版本标签为 `v2.3.3`。v2.3.2 使用 `feature/wide-wordmark` 分支调整字标与框体，版本标签为 `v2.3.2`。v2.3.1 的界面改进使用 `feature/clearer-interface` 分支，版本标签为 `v2.3.1`。v2.3 使用 `feature/look-around` 分支开发与验收，版本标签为 `v2-look-around`。此前 v2.2 见 `v2-refined-actions`，最初 Tripo 版本见 `v2-tripo-motion`，原人物静止版本见 `v2-restored`。后续按可回退的小改动提交。依赖、构建结果、测试截图、Blender 实验、缓存和未经筛选的原始动作素材不提交。远程仓库为 `https://github.com/wangkuangyi/whyme.git`，网站通过 GitHub Pages 发布。

文案改变后运行 `python scripts/fetch_fonts.py --local-only` 更新字体子集。

## 验证状态

最终原始材质与镜头检查见 `qa/original/rendering.md`：桌面/手机四站 33/33、取消加载资源释放 3/3、生产构建 9/9，24 张 2× 静帧及元数据已更新；这些结果与下面的历史交付记录分开。画面已实际查看，但不将参考截图的接近程度表述为逐像素一致。

此前原始外观恢复的资产保留检查 37/37、旧待机动作检查 94/94、加载与揭幕流程检查 31/31 通过，分别记录在 `qa/tripo/original-assets.json`、`qa/tripo/original-motion.json`、`qa/original/loading-results.json`。加载检查包含 1440 px 桌面和 390 px 手机、2 秒模型挂起、失败静帧与重试、静帧解码期间改变尺寸、字体不返回、减少动态，以及真实淡入结束前动作保持暂停。模型/遮罩/镜头仍发生调整时必须更新相应报告与静帧后再发布；这些检查不证明与 Tripo 截图逐像素一致，也不代替最终构图和材质的人工审阅。

此前调整默认入口与顺序、为 Walk 选择稳站的版本曾通过动作 77/77、视觉摘要 10/10、页面回归 47/47，记录在 `qa/tripo/walk-idle-*`；它使用旧资产和旧静图交接流程。下列历史记录均不作为当前原始保真人物和白色加载页的通过依据。

v2.4.1 已通过语法检查和生产构建；内容与详情交互检查 57/57，通过 4173 生产详情冒烟。已查看 1440、390、320 px 的三张实际 3D 卡片、手机展开、5/2/2 个作品链接的详情窗口和打印页，没有新增内容溢出或遮脸；Escape 关闭和焦点返回正常，NUS 入口已改为用户确认的个人站。结果与截图在 `output/playwright/content-v241/`。本轮没有修改场景、动作或图片资产，不重复引用 v2.4 的动画专项作为新的检查。

v2.4.0 已通过语法检查和生产构建；动作模块 54/54、环顾浏览器检查 31/31、场景遮挡与光影 23/23、界面 40/40、开场快速操作 12/12、颜色连续性 32/32、生产页面 20/20、最终生产文件的静帧层级 11/11。已查看桌面、390 px 和 320 px 的相关动作与布局截图，以及打印版。首帧与待机各八张图片已更新，人物原模型未改动。具体覆盖、复验方式和取样限制见 `qa/tripo/v24.md`；以下旧版本记录仅用于历史对照。

v2.3.3 已通过语法检查和构建，查看了 1440、1000、390、320 px 与打印截图。全大写几何字标与姓名等宽，没有横向溢出或遮挡联系入口；SVG 点击、键盘打开幕后及关闭后的焦点返回正常。截图与测量位于 `output/playwright/angular-wordmark/`。

v2.3.2 已通过语法检查和构建，并查看 1440、1000、390、320 px 与打印画面；字标布局宽度分别随姓名为 180、168、108、108 px，桌面目录与内容框的底色、直角和无滤镜样式一致。SVG 点击、键盘打开幕后和关闭归还焦点均正常，截图及测量在 `output/playwright/wordmark/`。

v2.3.1 已通过语法检查、构建及现有页面交互回归 29/29；已查看 1440、1000、390、320 px 的实际截图，确认标题字体、目录玻璃底和移除镜头参数后的画面。截图与回归输出分别位于 `output/playwright/interface/`、`output/playwright/tripo/flows.json`。

以下为 v2.3 动作与镜头版本的验收记录；v2.3.1 没有改动人物和镜头代码。

本轮已通过两份素材的骨架一致性、原资产保留和 `tripo-prepare.mjs --check` 多源可复现检查。与 Git 中旧派生 GLB 比较，原有六个动画定义、accessor、bufferView 和压缩二进制前缀完全一致；当前输出只新增 LookAround，不含 CrossArms。原人物 SHA-256 仍为 `def0603ec59ac8fac3de5df25e2827b2fbbd11cf0ad7ae5672e9fc3fab4a957f`。

本轮实际 GLB 动作测试 **50/50** 通过；1440、390、320 px 的动作与待机构图检查 **51/51** 通过；生产页面回归 **20/20** 通过，八张静帧已重新生成。`npm run check`、`npm run build` 已通过，构建仅有 Three.js 大 chunk 提示。51 项检查包含头顶完整、待机手指隐藏、动作映射、位置保持和重播，不包含卡片避让的专门断言；截图取样也不等于对每一帧的穿模保证。详情及证据见 `qa/tripo/look-around.md`。

本轮还修复了切站时 CSS 抢写目标颜色、切换中拖拽接管的镜头与颜色锚点、切到静帧后的正确站点颜色。保留原设计的 600 ms 颜色过渡、1000 ms 镜头过渡和 OKLCH 避开黄色区间的路径。最终颜色浏览器检查 **32/32** 通过，包含全部 12 个有向站点对、切换中首次拖拽及随后三帧、快速切站和静帧往返；证据为 `qa/tripo/color-continuity-results.json`。

历史 v2.2 曾通过 38 项动作测试、37 项待机构图检查、13 项浏览器运动流程和 20 项生产页面检查，证据在 `qa/tripo/refined-stations.md`；第三站当时为 Idle，不能证明新环顾及新镜头通过。已撤回的 CrossArms 实验也不提供本轮通过依据。

历史 `v2-tripo-motion` 曾通过 27 项动作模块测试、29 项页面交互、13 项浏览器运动流程和 24 项生产检查，并生成八张静帧；这些检查对应旧映射 `Greet / Nod / Walk / Wave`。历史证据保留在 `qa/tripo/requirements.md`，不证明本轮镜头和映射已通过。
