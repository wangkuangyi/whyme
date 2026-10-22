# Why me? — 本地网页

独立项目目录：`whyme-web`。当前是第二版页面布局，人物已按用户反馈恢复为原始模型、原面部和原站姿，关闭新增眼球、表情与身体动画。原始 `../person.blend` 未修改。

## 运行

```powershell
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 。也可运行 `启动网页.ps1`。

`npm run check` 检查语法，`npm run build` 构建，`npm run preview` 预览构建结果。Node.js 22 已在本机使用。

## 当前版本

- 中文身份信息、联系与简历、节点卡片、左下目录。
- 自托管 Noto Sans SC 400/600；Why me? 使用 Instrument Serif Italic。
- 赤陶、群青、松绿、莓果四种卫衣颜色，直接 OKLCH 过渡。
- 四机位、光环、柔光与阴影；键盘、拖动、节点和目录导航。
- 手机版说明区、打印版、幕后详情和静帧降级。
- 人物使用 `public/models/person.glb`，约 1.25 MB。保持原始脸和手，当前没有面部或身体动画。

用户反馈后撤回的表情和动作实验只保留在被 Git 忽略的 `output/v2/`，不参与网页运行。原模型的裤子纹理和材质边界仍有少量瑕疵，未将候选新资产冒充已通过验收的版本。

## 文件与版本管理

- `src/content.js`：中文文案、联系方式与日期。
- `src/main.js`、`src/style.css`：页面与交互。
- `src/scene.js`、`src/scene-math.js`：3D 场景、机位和颜色。
- `src/dialogs.js`：联系、幕后、更新记录。
- `public/`：网页自托管资源。
- `CONTENT_SOURCES.md`：个人经历的来源边界。
- `qa/v2-requirements.md`：第二版逐项验收状态；待验项目不代表通过。
- `动作素材/`：预留给用户导出的同人物 GLB/FBX 动画；未审核素材默认不入库。

Git 在本项目独立初始化，使用 `main` 分支。后续按可回退的小改动提交；模型和动作试验先在分支验证，再合并到可用版本。依赖、构建结果、测试截图、Blender 实验和缓存不提交。未配置远程仓库，也未推送。

文案改变后运行 `python scripts/fetch_fonts.py --local-only` 更新字体子集。

## 本轮验证

原人物恢复后，语法检查与生产构建通过；29项浏览器交互检查通过。1280、1024、768、320px四站布局已复查，桌面卡片不遮脸和手，手机首屏信息可见。八张降级静帧已由恢复后的原模型重新生成。详见 `qa/v2-requirements.md`，原改进方案中的人物表演和部分材质实验按用户反馈撤回，不声明全部实现。
