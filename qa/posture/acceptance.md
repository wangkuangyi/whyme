# 直立待机与抽绳修正

2026-10-23，分支 `fix/upright-idle-and-hoodie-cords`。

## 实际改动

- 四站结束后回到模型完整原始 bind/rest 站姿。01 加载首帧也使用此姿态，双脚并列；取消旧 Idle 循环的含胸、肩前卷和脚步变化。原走路 3.6 秒、0.5 秒进入和 0.55 秒退出过渡保留。
- 动作中的过度胸椎折角由 `src/posture.js` 限幅修正，只改变 Spine1、Spine2 和用于补偿头部世界朝向的 Head 局部旋转。原点头、环顾方向和四肢局部动作保留；环顾整段无需修正，走路最大仅 0.56°，点头最多 8°、挥手最多 4.68°。每帧撤销前次修正后再采样，避免累积。
- 抽绳穿模来自自动蒙皮把下端分配给肩和上臂。`src/hoodie-skinning.js` 将两根下段共 180 个导出顶点的权重按胸面插值转移，锚点处平滑回原权重。只克隆两个蒙皮属性；原 positions、normals、UV、拓扑、纹理和 GLB 均不改写。
- 静帧缓存版本为 `upright-4k`，24 张桌面/手机 intro、idle、still 图片及三份元数据重新捕获。正常加载仍直接使用原始 4K 模型，保留白色加载页和揭幕时序。

## 验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 实际模型动作、首帧、待机、快速切换及校正集成 | 122/122 | `motion-results.json` |
| 独立姿态校正，240 Hz 共 3,430 帧 | 13/13 | `correction-results.json` |
| 抽绳蒙皮、真实 GLTFLoader、原始文件与组合动作 | 23/23 | `hoodie-results.json` |
| 桌面 1440 px / 手机 390 px 四站待机、4K 与页面 | 41/41 | `visual-results.json` |
| 生产构建模型、四站交互、静帧与手机布局 | 9/9 | `production-results.json` |
| 语法检查、Vite 生产构建 | 通过 | `npm run check` / `npm run build` |

原有连续性阈值保持为 240 Hz 相邻帧骨骼位移小于 20 mm；01 进入、结束、步态接缝分别约 12.03、13.24、13.74 mm。其余三动作也检查进入与结束。单独校正造成的相邻帧偏移变化最大约 1.35 mm；原头部世界朝向与下半身保持。

抽绳按 60 Hz 检查 861 个源动作帧和 1,270 个实际运行时帧，覆盖进入、动作、淡出和 Rest；180 个抽绳顶点对所检测的变形胸面均没有穿入，实际运行时最小间距约 1.937 mm。这是沿身体正面方向的胸面深度检测，不宣称任意网格、任意方向绝对没有自交。

人工查看原站姿与旧 Idle 的同镜头正侧面对比、动作校正前后对比、实际页面桌面/手机四站画面。截图位于忽略的 `output/playwright/upright-posture/`；动作取样记录见 `action-captures.json`。截图取样不等于逐帧视觉保证。

原动画 GLB SHA-256：`fda0ce34395d895f6d18b39a40b65affd3f622401a2f76b1f2beaf152955a036`。
原 `person.blend` SHA-256：`51363cd344cf3538e1b82a26b1e6921d52e3bbd734b5b78375844c679bd0f16d`。两者与修改前一致。

## 复验

```powershell
npm run check
npm run test:motion
npm run test:posture
npm run test:hoodie
node scripts/hoodie-prepare.mjs --check
npm run build
```

浏览器使用 `qa/original/browser.config.json` 的原生 2× DPR 设置。`capture-frames.cjs` 导出正式图片；`verify-visual.cjs` 检查本地 5173；`capture-actions.cjs` 捕获实际动作中间帧；`verify-production.cjs` 检查构建预览 4173。原始外观修复的 `qa/original/` 与历史动作报告保留，不覆盖。
