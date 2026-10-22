# 本地字体

页面加载 `fonts.css` 即可使用以下字族；字体文件均为项目本地资源，运行时不会请求 Google Fonts。

| 字族 | 字重/样式 | 用途 |
| --- | --- | --- |
| Inter | 400、500 | 英文名字、英文界面 |
| Instrument Serif | 400 Italic | Why me? 中的 me?、英文短句 |
| JetBrains Mono | 400 | 取景器读数、序号 |
| Noto Sans SC | 400、600 | 中文正文、中文标题 |

西文字体为官方 Google Fonts 提供的 Latin WOFF2 文件。Noto Sans SC 来自本机已安装的 `C:/Windows/Fonts/NotoSansSC-VF.ttf`，使用 fontTools 在本地子集化和固定字重；没有把页面文案发送到外部服务。完整 OFL 许可证位于 `../licenses/`。哈希与公开下载 URL 记录在 `manifest.json`。

更新中文文案之后，在项目目录执行 `python scripts/fetch_fonts.py --local-only`。此命令读取 `index.html`、`src/*.js`、`src/*.css` 的字符并本地更新中文子集，不联网。首次构建字体时需要 Python 的 fontTools 和 Brotli；本次 Brotli 仅安装在 `.cache/font-tools`。

中文每个字重约 54–56 KB，低于设计要求的 150 KB。六个字体文件合计约 197 KB。源文件导入示例：`@import url('/fonts/fonts.css');`。
