// Personal claims are sourced from the supplied design and the existing CV/portfolio.
// See CONTENT_SOURCES.md. Unknown job location and remote preferences are omitted.
export const profile = {
  name: '王匡义',
  nameEn: 'Kuangyi Wang',
  role: 'AI 系统 · Agent · 平台开发',
  email: 'kuangyi001126@outlook.com',
  github: 'https://github.com/wangkuangyi',
  website: 'https://wky.wang/',
  education: '新加坡国立大学 · 计算机工程',
  availability: '11 月底可到岗',
  // The design confirms late November, not a particular day. This is the
  // display rollover boundary, not a claim of an exact joining date.
  availableFrom: '2026-12-01',
  resume: '/resume.pdf',
  version: 'v2.0',
  updatedAt: '2026-10-23',
};

export const advantages = [
  {
    id: '01',
    category: '迅速到岗',
    title: '随时出发',
    claim: '11 月底即可到岗，用已有经验尽快上手。',
    proofs: [
      'Agent / MCP 工具开发与评测',
      '平台需求开发与上下游接口协作',
    ],
    link: { label: '约个时间聊', href: 'mailto:kuangyi001126@outlook.com?subject=关于工作机会' },
  },
  {
    id: '02',
    category: '审美与产品意识',
    title: '好看，也好用',
    claim: '你正在看的这个网站，就是证据。',
    proofs: [
      '四个角度，让自我介绍成为探索',
      '从业务界面到 Grafana 看板',
    ],
    link: { label: '这个网站是怎么做的', href: '#behind-the-scenes' },
  },
  {
    id: '03',
    category: '长期意识',
    title: '上线只是开始',
    claim: '把产品做出来，也把它持续做好。',
    proofs: [
      'Text2SQL 维护、重构与评测',
      '持续迭代本站，记录每次改进',
    ],
    link: { label: '更新日志', href: '#changelog' },
  },
  {
    id: '04',
    category: '团队精神',
    title: '好队友',
    claim: '认真配合，也能调动气氛，让合作轻松一点。',
    proofs: [
      '配合上下游，改进平台接口',
      'NUS 团队：仿真、记忆与评测',
    ],
    link: { label: '看看一起做过的事', href: 'https://wky.wang/projects/netease/' },
  },
];
