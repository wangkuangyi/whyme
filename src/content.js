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
  availability: '11月底可到岗',
  // The design confirms late November, not a particular day. This is the
  // display rollover boundary, not a claim of an exact joining date.
  availableFrom: '2026-12-01',
  resume: '/resume.pdf',
  version: 'v2.4.1',
  updatedAt: '2026-10-23',
};

export const advantages = [
  {
    id: '01',
    category: '团队精神',
    title: '好队友',
    claim: '认真配合，善于协作，把任务落实到位。',
    proofs: [
      '网易：前后端协同，优化接口、开发需求',
      'NUS：Embodied Agent 协同开发',
    ],
    link: { label: '看看协作项目', href: '#teamwork' },
  },
  {
    id: '02',
    category: '审美与产品意识',
    title: '好看，也好用',
    claim: '让界面好看，也让使用更顺手。',
    proofs: [
      '从业务界面到 Grafana 看板',
      '从网易产品到个人 Web 开发',
    ],
    link: { label: '看看我的作品', href: '#selected-work' },
  },
  {
    id: '03',
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
    id: '04',
    category: '长期意识',
    title: '上线只是开始',
    claim: '把产品做出来，也把它持续做好。',
    proofs: [
      'Text2SQL：从 Demo 到网易落地，按线上数据持续维护',
      'Benchmark Atlas：从面试任务开始，持续更新至今',
    ],
    link: { label: '看看持续更新的项目', href: '#ongoing-work' },
  },
];

// User-confirmed examples and destinations, grouped to keep the main cards short.
export const evidencePages = {
  'selected-work': {
    title: '好看，也好用',
    lead: '从业务界面到 Grafana 看板，从网易产品到个人 Web 开发。',
    items: [
      { title: '网易产品与开发经历', description: '业务需求开发、接口优化与 Grafana 看板搭建。', href: 'https://wky.wang/projects/netease/index.html' },
      { title: '个人网站', description: '把经历、项目和生活整理成一份个人介绍。', href: 'https://wky.wang/' },
      { title: 'Benchmark Atlas', description: '模型与评测信息的展示站点。', href: 'https://wkybenchmark.online/' },
      { title: '十一情侣旅行站', description: '为两个人的十一旅行制作的行程网站。', href: 'https://together-singapore-oct-wky.wky001126.chatgpt.site/' },
      { title: '摄影作品', description: '用照片记录生活中的光线、空间与瞬间。', href: 'https://wky.wang/personal/index.html' },
    ],
  },
  'ongoing-work': {
    title: '上线只是开始',
    lead: '交付之后，继续跟着真实使用维护和改进。',
    items: [
      { title: 'Text2SQL：从 Demo 到落地', description: '2025 年，我写下最初的 Demo；2026 年回到网易后，将它落地到实际使用，并持续根据线上数据维护和优化。', href: 'https://wky.wang/projects/netease/index.html' },
      { title: 'Benchmark Atlas：持续更新', description: '它始于一次面试后的任务。面试结束后，我仍在持续更新，改动都记录在更新日志里。', href: 'https://wkybenchmark.online/updates' },
    ],
  },
  teamwork: {
    title: '好队友',
    lead: '认真配合，善于协作，把任务落实到位。',
    items: [
      { title: '网易：前后端协作', description: '与前后端同事协同，配合优化接口，完成业务需求开发。', href: 'https://wky.wang/projects/netease/index.html' },
      { title: 'NUS：Embodied Agent', description: '参与团队协同开发，在项目分工中推进实现与验证。', href: 'https://wky.wang/projects/embodied-agent/index.html' },
    ],
  },
};
