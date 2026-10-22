# Why me? — 本地网页

独立项目目录：`whyme-web`。v2.1 使用用户提供的 Tripo 动作，保留原人物的脸、几何与贴图。招手、点头和挥手采用上半身近景，走路采用侧前方跟拍。原始 `../person.blend` 和 `public/models/person.glb` 保持不变。

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
- 四个镜头分别配合招手、带抬手的点头、走路和挥手；其余时间轻微待机。
- 行走使用动画的真实前进位移，镜头从侧前方持续跟随；结束前平滑推至腰上近景，动作结束或切换后保留人物位置，淡入待机。
- 光环、柔光与阴影；键盘、拖动、节点和目录导航。
- 手机版说明区、打印版、幕后详情和静帧降级。
- 人物使用 `public/models/person-animated.glb`，约 1.91 MB，在原模型上添加同骨架动画；没有新增眼球或面部动画。

不合适的 Box 动作未接入播放。此前撤回的表情和动作实验只保留在被 Git 忽略的 `output/v2/`，不参与运行。

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
- `public/images-tripo/`：本版降级静帧；`public/images-v2/` 保留原静止版本的静帧。
- `CONTENT_SOURCES.md`：个人经历的来源边界。
- `qa/tripo/requirements.md`：本版动作与镜头验收状态。
- `qa/v2-requirements.md`：此前恢复原人物版本的历史验收，不等同于本版动画验收。
- `动作素材/`：用户导出的同人物动画；未经筛选的原始素材默认不入库。

Git 在本项目独立初始化。动作开发使用 `feature/tripo-animations` 分支，检查后合并 `main`；`v2-restored` 标签保留原人物静止版本。后续按可回退的小改动提交。依赖、构建结果、测试截图、Blender 实验、缓存和未经筛选的原始动作素材不提交。未配置远程仓库，也未推送。

文案改变后运行 `python scripts/fetch_fonts.py --local-only` 更新字体子集。

## 验证状态

27 项真实 GLB 动作测试、资产可复现检查、语法检查与生产构建通过，字体已更新。独立复查确认行走末段推近连续，320/390px 的招手与挥手完整可见；八张新版静帧已生成并接入。Vite 仍提示 Three 场景 chunk 约 901kB（gzip 274.71kB）。

本版页面交互 29/29、浏览器运动流程 13/13 通过。生产常规与性能降级检查 24/24 通过；手机切站初段的挥手裁剪问题已调整取景并重新生成静帧。最终视觉证据、限制与交付标签见 `qa/tripo/requirements.md`。
