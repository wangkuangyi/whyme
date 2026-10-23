# 原始人物、贴图与视觉修复

2026-10-23，分支 `fix/original-avatar-quality-and-loading`。

## 实际原因与处理

- 历史 `prepare_person.py` 对整个人物细分、重建材质，并将原 4096² JPEG 转为 2048²。旧网站又使用程序布纹替代卫衣原纹理。这些处理不等于直接显示 Tripo 原始资产，现已从运行路径移除。
- 先恢复原始网格后，按整三角面划分衣服仍会在共用皮肤/衣服纹理的领口产生黑色三角。现为单一原始 primitive、原始索引，用额外 4096² 灰度遮罩逐像素换色，不拆分几何或修改原 UV。
- 参考图与独立渲染对照显示，原 albedo 已包含鼻唇、发丝、缝线和布纹明暗。旧棚灯与 tone mapping 重复加深鼻底、唇沟，造成下唇突出观感。最终网页人物直接显示原 albedo（`MeshBasicMaterial`，`toneMapped:false`），只对遮罩范围内衣服换色；地面投影保留。
- 02 近景从低机位改为轻俯视；01 用户确认的走路机位不变，03/04 继续保留各自角度。未雕刻面部、改变口型、增添眼球或修改面部骨骼。

## 数据与验证

- 原始资产：11,922 个 GLB 顶点、10,892 个三角形，原始属性及 JPEG 字节不变；未细分、减面、几何量化、缩图或重编码。`../tripo/original-assets.json` 的 37/37 检查与可复现检查通过。最早静态导出无有效绑定，使用同人物有效动画导出的完整骨架；详见资产来源报告。
- 动作：`../tripo/original-motion.json` 94/94，使用最终 4,693,000 B GLB，SHA-256 `fda0ce34395d895f6d18b39a40b65affd3f622401a2f76b1f2beaf152955a036`。
- 加载：`loading-results.json` 31/31；取消加载及晚到资源释放 `dispose-results.json` 3/3，确认旧 ImageBitmap 释放且新场景保持就绪。
- 最终桌面 1440×1000、手机 390×844 四站集成检查：`visual-results.json` 33/33，未处理浏览器异常为 0。实际截图均已人工查看：头部完整、脸部不再有二次唇沟阴影、衣领无旧大片黑色三角、布纹与缝线可见、正文可读。
- intro / idle / still 各 8 张静帧已重新生成，共 24 张，按 2× 分辨率捕获；所有位置元数据同步。普通 3D 路径不下载这些静帧。
- 语法检查与生产构建通过；构建保留 Three.js chunk 大小提示。
- `production-results.json` 9/9：生产构建实际使用新 GLB / mask，四站导航、2× 静帧与手机正文通过，无未处理浏览器异常。

## 对照与复现

独立诊断截图位于不入库的 `output/playwright/face-diagnosis/`：`02-studio-high.png` 与 `05-unlit-high.png` 使用同一姿态、同一俯视机位；`09-idle-unlit-12.png`、`10-rest-unlit-12.png` 为轻俯视；`11-rest-ambient-12.png` 使用原 PBR + 仅环境光，结果接近无光照原纹理，支持上述原因判断。

最终页面截图在 `output/playwright/original-quality/{desktop,mobile}-0{1,2,3,4}-final.png`。`capture-frames.cjs`、`verify-visual.cjs` 可通过 Playwright CLI 复跑；建议用 `browser.config.json` 的独立 Chrome，防止 Windows 后台窗口节流影响动画计时。该配置不改变网页自身画质策略。

这些是实际采样与数据核验，不代表能够由几张参考图证明 Tripo 查看器的隐藏参数、逐像素一致或任意动画时刻绝无穿模。原始 `person.blend` 和用户导出文件均未覆盖。
