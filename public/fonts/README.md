# 本地字体

页面加载 `fonts.css` 即可使用以下字族；字体文件均为项目本地资源，运行时不会请求 Google Fonts。

| 字族 | 字重/样式 | 用途 |
| --- | --- | --- |
| Noto Sans SC | 400、600 | 全部中英文、数字、正文、标题及 Why me? 字标 |

Noto Sans SC 来自本机已安装的 `C:/Windows/Fonts/NotoSansSC-VF.ttf`，使用 fontTools 在本地子集化和固定字重，中英文共用同一字族；没有把页面文案发送到外部服务。完整 OFL 许可证位于 `../licenses/`。文件哈希与来源记录在 `manifest.json`。

更新中文文案之后，在项目目录执行 `python scripts/fetch_fonts.py --local-only`。此命令读取 `index.html`、`src/*.js`、`src/*.css` 的字符并本地更新中文子集，不联网。首次构建字体时需要 Python 的 fontTools 和 Brotli；本次 Brotli 仅安装在 `.cache/font-tools`。

当前只加载两个字体文件，具体大小见 `manifest.json`。旧版 Instrument Serif、Inter、JetBrains Mono 文件保留但未加载。源文件导入示例：`@import url('/fonts/fonts.css');`。
