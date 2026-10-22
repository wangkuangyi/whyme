# 网页文案事实依据（v2）

核对日期：2026-10-23。公开页面文案来自已有设计、简历及个人站源文件；没有加入未确认的效率数字、开发用时、推荐人评价或入职城市。

| 字段或内容 | 核对来源 | 边界 |
| --- | --- | --- |
| 王匡义、邮箱、新加坡国立大学计算机工程 | 父工作区 `D:/Code/autumn work` 内的 `wky/cv/cv raw files/overleaf/main.tex`、`wky/cv/简历_中文_纯文本.md` | 姓名与联系方式沿用原件 |
| AI 系统 / Agent / 平台开发 | `wky/cv/cv web project/index.html` 招聘方向及网易平台开发经历 | 对已有求职方向的简短归纳 |
| 11 月底可到岗 | `whyme/DESIGN.md` §3.2、§12 | 未提供具体日；代码的 2026-12-01 仅作为文案自动切换边界 |
| GitHub | `wky/cv/cv web project/.git/config`，origin 为 `https://github.com/wangkuangyi/wky-cv-web.git` | 账号来自已有站点仓库配置 |
| Text2SQL Demo → 内部 MCP Tool；维护、重构、自动化测评 | 现有通用简历 `main.tex` 及 `cv web project/projects/netease/index.html` | 不增加上线时长、规模、效率指标 |
| Grafana 看板 | 同上 | 不声称独立承担站点全部设计或 3D 制作 |
| 配合上下游改进接口 | `cv web project/projects/netease/index.html`，“接口优化”条目 | 未引用不存在的同事评价 |
| NUS 仿真、记忆模块与评测 | `main.tex`、`cv web project/projects/embodied-agent/index.html` | 不把个人负责范围扩张成项目全权负责人 |
| 四角度互动、版本更新记录 | 本地网页实现、`IMPROVEMENTS.md` | 仅描述实际发布的版本；不虚构既往迭代历史 |
| 01「用已有经验尽快上手」 | `main.tex` 的 Text2SQL 工程化、需求开发和维护；网易项目页的 MCP / Agent Eval / 平台接口工作 | 已有技术栈与目标方向重合，因此表述为尽快上手；不承诺入职当天即可接手未知项目 |
| 04「能调动气氛」 | 用户提供的 `DESIGN.md` §4.2、§12 及 `IMPROVEMENTS.md` §10 | 个人自述，不写成第三方评价。当前 CV、网易/NUS 项目页及个人展示页未提供活动组织或带新人事例；用户本轮已明确“暂时先不用”具体例子，因此不补造故事，也不把例子作为本版交付门槛 |
| 04 两条协作证据 | 网易项目页「配合上下游使用场景改进平台体验」；NUS 项目页仿真、Memory、评测的负责范围 | 两条证明具体协作与项目分工，不声称它们已证明「调动气氛」 |

`public/resume.pdf` 是现有通用简历 `D:/Code/autumn work/wky/cv/output/pdf/简历-王匡义.pdf` 的原样副本。已核对两页正文、姓名、邮箱及 Text2SQL / Agent 经历；本次未修改简历内容。

城市与远程偏好没有可靠确认，因此不显示求职城市。简历中的杭州属于工作经历地点，NUS 属于就读背景，不能直接当成求职城市承诺。

v2 删除四条重复中文标题含义的英文短句；常规文案使用中文，保留 Agent、MCP、Text2SQL、Grafana、NUS 等技术或机构名称。无衬线统一使用本机安装的 Noto Sans SC，拉丁字母、数字与中文都包含在 400 / 600 子集内；Instrument Serif Italic 仅用于 `Why me?`。授权原文保留于 `public/licenses/`，生成来源与文件校验值位于 `public/fonts/manifest.json`。
