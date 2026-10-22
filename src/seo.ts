const SITE_ORIGIN = 'https://fe-web.lastudio.cc'
const DEFAULT_IMAGE = `${SITE_ORIGIN}/fe_logo.png`

const keywords = [
  'e听说网页版',
  'e听说在线',
  'e听说答案',
  '讯飞e听说',
  '科大讯飞e听说',
  'e听说中学',
  '易听说',
  'e听说自动完成',
  'Fuck_ets100',
  'Fe',
  'ets100',
  'LastStudio',
]

function normalizePath(pathname: string) {
  if (!pathname || pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

function absoluteUrl(pathname: string) {
  return new URL(pathname || '/', SITE_ORIGIN).toString()
}

function upsertMeta(selector: string, attributes: Record<string, string>, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    Object.entries(attributes).forEach(([key, value]) => element?.setAttribute(key, value))
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function setCanonical(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.rel = 'canonical'
    document.head.appendChild(element)
  }
  element.href = url
}

function setJsonLd(value: Record<string, unknown>) {
  let element = document.head.querySelector<HTMLScriptElement>('#fe-web-seo-jsonld')
  if (!element) {
    element = document.createElement('script')
    element.id = 'fe-web-seo-jsonld'
    element.type = 'application/ld+json'
    document.head.appendChild(element)
  }
  element.textContent = JSON.stringify(value)
}

export function applySeo(pathname: string) {
  const path = normalizePath(pathname)
  const isPrivate =
    path === '/app' ||
    path === '/history' ||
    path === '/pk' ||
    path === '/settings' ||
    path === '/auto-complete' ||
    path.startsWith('/homework/') ||
    path === '/auth/callback'

  const isLanding = path === '/'
  const title = isLanding
    ? 'Fe Web · 科大讯飞 e听说网页版在线答案提取与作业辅助平台 | LastStudio'
    : path === '/history'
      ? '历史作业 · Fe Web'
      : path === '/pk'
        ? '词汇PK · Fe Web'
        : path === '/settings'
          ? '设置与账号 · Fe Web'
          : path.includes('auto-complete')
            ? '作业自动完成 · Fe Web'
            : 'Fe Web 工作台 | LastStudio'
  const description = isLanding
    ? 'Fe Web（Fuck_ets100 网页版）是专为科大讯飞 e听说（ETS100）打造的现代化在线作业辅助与答案提取平台，无需安装 App 即可在浏览器中查看作业、试卷和答案解析。'
    : 'Fe Web 登录后的作业工作台页面。'
  const canonical = absoluteUrl(isLanding ? '/' : path)
  const robots = isPrivate ? 'noindex, nofollow, noarchive' : 'index, follow, max-image-preview:large'

  document.title = title
  upsertMeta('meta[name="description"]', { name: 'description' }, description)
  upsertMeta('meta[name="keywords"]', { name: 'keywords' }, keywords.join(', '))
  upsertMeta('meta[name="robots"]', { name: 'robots' }, robots)
  upsertMeta('meta[property="og:type"]', { property: 'og:type' }, 'website')
  upsertMeta('meta[property="og:url"]', { property: 'og:url' }, canonical)
  upsertMeta('meta[property="og:title"]', { property: 'og:title' }, title)
  upsertMeta('meta[property="og:description"]', { property: 'og:description' }, description)
  upsertMeta('meta[property="og:image"]', { property: 'og:image' }, DEFAULT_IMAGE)
  upsertMeta('meta[property="og:image:alt"]', { property: 'og:image:alt' }, 'Fe Web e听说作业辅助平台')
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image')
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, title)
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, description)
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, DEFAULT_IMAGE)
  setCanonical(canonical)
  setJsonLd(isLanding ? {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${SITE_ORIGIN}/#webapplication`,
    name: 'Fe Web',
    alternateName: ['e听说网页版', 'Fuck_ets100 在线版', 'e听说在线答案提取'],
    url: `${SITE_ORIGIN}/`,
    image: DEFAULT_IMAGE,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'All Web Browsers',
    browserRequirements: 'Requires JavaScript and a modern web browser',
    featureList: ['e听说作业查看', '试卷结构阅读', '答案解析辅助参考', '作业自动完成任务管理'],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    description,
    publisher: { '@type': 'Organization', name: 'LastStudio', url: 'https://lastudio.cc/' },
    keywords: keywords.join(', '),
  } : {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${canonical}#webpage`,
    url: canonical,
    name: title,
    description,
    isPartOf: { '@id': `${SITE_ORIGIN}/#webapplication` },
  })
}
