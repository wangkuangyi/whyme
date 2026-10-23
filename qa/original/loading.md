# 白色加载页与揭幕检查

检查日期：2026-10-23。开发服务器 `http://127.0.0.1:5173`，桌面 1440×900、手机 390×844。

当前结果为 **31/31**，汇总见 `loading-results.json`。未处理浏览器异常为 0。故意中止模型或图片请求产生的网络错误是测试输入，不作为产品异常忽略不计。

## 实现范围

- HTML 首次绘制即为白底，中央显示“正在加载王匡义的形象…”，正文没有先行闪出。`#page-loader` 使用 polite status live region，`#app` 在加载与淡入期间保持 inert / aria-busy。
- 3D 完整首帧就绪并等待字体后，网站进行约 450 ms 淡入。使用实际 CSS transition.finished 确认完成，避免首次 GPU 工作较重时固定计时器先走完、页面仍透明却已经开始动作。
- 淡入全程 `presentationPaused=true`，Walk 时间保持 0；页面完全可见后解除暂停。默认 Walk 的正文同时可见，不等走路完成。
- 普通 3D 加载没有任何旧 intro 或静帧 PNG 请求。`?static=1` 或 3D 失败时只等当前静帧解码后显示。
- 模型等待最多 45 秒；失败后尝试静帧，静帧布局元数据最多 3 秒、图片解码最多 12 秒。字体最多等待 2 秒，随后使用后备字体。模型与图片均失败仍显示正文与重试按钮。
- 减少动态模式跳过淡入；重试立即回白底。加载期间不能用键盘切站，避免动作、图片和卡片错位。

## 实际覆盖

`verify-loading.cjs`：12 项。模型网络挂起 2 秒后白屏与文字、普通路径零 PNG 请求、加载期键盘隔离、模型失败静帧解码后展示、重试、主动静帧解码等待、静帧加载中改变桌面/手机尺寸、模型和图片均失败、减少动态及手机正文。

`verify-reveal.cjs`：19 项。真实新 4K GLB 在桌面和手机的就绪/淡入/解冻时序，淡入期间 Walk 时间 0，解冻前整页透明度 1，正文与步态同时出现，字体阻塞后使用后备字体，以及减少动态的真实 3D 入口。

通过 Playwright CLI 的独立浏览器会话执行：

```powershell
npx --yes --package @playwright/cli playwright-cli -s=original-loading open http://127.0.0.1:5173 --headed
npx --yes --package @playwright/cli playwright-cli -s=original-loading run-code --filename qa/original/verify-loading.cjs
npx --yes --package @playwright/cli playwright-cli -s=original-loading run-code --filename qa/original/verify-reveal.cjs
```

完整 trace 与截图位于被 Git 忽略的 `output/playwright/original-loading/`。已人工查看桌面/手机纯白加载页、真实 3D 揭幕后页面；白底加载文字居中，正文没有在加载遮罩前泄露。

本记录只证明加载与交互时序。静帧机制检查使用执行当时目录中的图片；最终高质量静帧的材质、镜头与构图需在重生成后另行检查。这里不声称画面与 Tripo 参考逐像素匹配，也不声称逐帧无穿模。
