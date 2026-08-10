import { useEffect, useRef, useState } from 'react'
import './App.css'
import { ApiError, getCurrentUser, setUnauthorizedHandler } from './api/auth'
import AuthGate from './auth/AuthGate'
import Callback from './auth/Callback'
import { oauthConfig } from './auth/config'
import { startAuthorization } from './auth/oauth'
import type { AuthSession } from './auth/types'
import { transitionRoute, transitionTo } from './navigation/controller'

type Page = '/' | '/history' | '/settings'
type Status = 'parsed' | 'parsing' | 'unread'
type Assignment = { title: string; time: string; count: string; status: Status; selected?: boolean }

const logoSrc = '/fe_logo.png'
const assignmentPanelStorageKey = 'fe-web.assignment-panel-open'
const groups: { label: string; items: Assignment[] }[] = [
  { label: '今天', items: [
    { title: '数学周测 #4', time: '10 分钟前', count: '20 题', status: 'parsed', selected: true },
    { title: '英语词汇集', time: '刚刚', count: '50 题', status: 'parsing' },
  ] },
  { label: '昨天', items: [{ title: '物理第三章复习', time: '1 小时前', count: '15 题', status: 'unread' }] },
]
const answerSteps = ['2x + 5 = 15', '2x = 15 - 5', '2x = 10', 'x = 10 / 2', 'x = 5']
const navigationItems: { icon: string; label: string; page: Page }[] = [
  { icon: 'assignment', label: '当前作业', page: '/' },
  { icon: 'history', label: '历史作业', page: '/history' },
  { icon: 'settings', label: '设置', page: '/settings' },
]

function Icon({ name, className = '', filled = false }: { name: string; className?: string; filled?: boolean }) {
  return <span className={`material-symbols-outlined ${className}`} style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined} aria-hidden="true">{name}</span>
}

function readStoredAssignmentPanelState() {
  const stored = window.localStorage.getItem(assignmentPanelStorageKey)
  return stored === null ? !window.matchMedia('(max-width: 760px)').matches : stored !== 'false'
}

function StatusPill({ status }: { status: Status }) {
  if (status === 'parsing') return <span className="status-pill status-pill--parsing"><Icon name="sync" className="status-pill__spin" />解析中</span>
  if (status === 'unread') return <span className="status-pill status-pill--unread"><span className="status-dot" />未读</span>
  return <span className="status-pill status-pill--parsed"><span className="status-dot" />已解析</span>
}

function AssignmentPanel({ isOpen, activePage, onClose, onNavigate, onToggle }: {
  isOpen: boolean
  activePage: Page
  onClose: () => void
  onNavigate: (page: Page, closePanel?: boolean) => void
  onToggle: () => void
}) {
  return (
    <>
      <section className={`assignment-panel ${isOpen ? 'assignment-panel--open' : 'assignment-panel--closed'}`} aria-label="作业列表">
        <div className="assignment-panel__head">
          <span className="assignment-panel__title"><strong>作业索引</strong><small>3 份作业</small></span>
          <button className="icon-button assignment-collapse" type="button" onClick={onToggle} aria-label="折叠作业列表"><Icon name="keyboard_double_arrow_left" /></button>
          <button className="icon-button assignment-close" type="button" onClick={onClose} aria-label="关闭作业列表"><Icon name="close" /></button>
        </div>
        <div className="search-row">
          <label className="search-box"><Icon name="search" /><input placeholder="搜索作业..." type="search" /></label>
          <button className="square-button" type="button" aria-label="筛选"><Icon name="filter_list" /></button>
        </div>
        <div className="assignment-list">
          {groups.map((group) => (
            <details className="assignment-group" open key={group.label}>
              <summary><span>{group.label}</span><Icon name="keyboard_arrow_down" /></summary>
              <div className="assignment-group__items">
                {group.items.map((item) => (
                  <button className={`assignment-card ${item.selected ? 'assignment-card--selected' : ''}`} type="button" onClick={onClose} key={item.title}>
                    <span className="assignment-card__rail" />
                    <span className="assignment-card__head"><span className="assignment-card__title">{item.title}</span><span className={`assignment-card__time ${item.status === 'unread' ? 'assignment-card__time--new' : ''}`}>{item.time}</span></span>
                    <span className="assignment-card__meta"><span>{item.count}</span><StatusPill status={item.status} /></span>
                  </button>
                ))}
              </div>
            </details>
          ))}
        </div>
        <nav className="mobile-drawer-menu" aria-label="移动端主导航">
          {navigationItems.map((item) => <button className={`side-link ${activePage === item.page ? 'side-link--active' : ''}`} type="button" onClick={() => onNavigate(item.page, true)} key={item.page}><Icon name={item.icon} />{item.label}</button>)}
        </nav>
      </section>
      {!isOpen && <button className="assignment-rail" type="button" onClick={onToggle} aria-label="展开作业列表"><Icon name="keyboard_double_arrow_right" /><span>作业</span></button>}
    </>
  )
}

function CurrentAssignmentPage({ onOpenAssignments }: { onOpenAssignments: () => void }) {
  return <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
    <div className="reader-toolbar"><button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表"><Icon name="menu" /></button><button type="button"><Icon name="content_copy" />复制</button><button type="button"><Icon name="download" />导出</button></div>
    <article className="answer-paper">
      <header className="answer-paper__head"><span className="paper-kicker">已解析 · 20 题</span><h1>数学周测 #4</h1><div className="paper-meta"><span>提交于 10 分钟前</span><span>八年级数学</span></div></header>
      <section className="question-block">
        <div className="question-heading"><span className="question-number">01</span><h2>求解 2x + 5 = 15 中的 x</h2><span className="score-mark" aria-label="本题得分 5 分">5 / 5</span></div>
        <div className="options">{['A. 3', 'B. 5', 'C. 10', 'D. 15'].map((option) => <label className={`option ${option === 'B. 5' ? 'option--selected' : ''}`} key={option}><input name="q1" type="radio" defaultChecked={option === 'B. 5'} /><span>{option}</span></label>)}</div>
        <div className="answer-box"><h3><Icon name="check_circle" filled />标准答案: B. 5</h3><div className="answer-box__content"><p>为了求解 x，我们需要将变量隔离在等式的一侧。</p><pre><code>{answerSteps.join('\n')}</code></pre><p>因此，正确的选项是 B。</p></div></div>
        <div className="review-stamp" aria-hidden="true"><Icon name="done_all" /><span>已核对</span></div>
      </section>
    </article>
  </section>
}

function HistoryPage({ onOpenAssignments }: { onOpenAssignments: () => void }) {
  return <section className="page-panel page-surface-enter" aria-label="历史作业"><div className="page-toolbar"><button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表"><Icon name="menu" /></button></div><div className="page-panel__inner"><h1>历史作业</h1><div className="history-list">{['物理第三章复习', '英语词汇集', '数学周测 #3'].map((title, index) => <button className="history-item" type="button" key={title}><span><strong>{title}</strong><small>{index + 1} 天前 · 已归档</small></span><Icon name="chevron_right" /></button>)}</div></div></section>
}

function SettingsPage({ onOpenAssignments }: { onOpenAssignments: () => void }) {
  return <section className="page-panel page-surface-enter" aria-label="设置"><div className="page-toolbar"><button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表"><Icon name="menu" /></button></div><div className="page-panel__inner"><h1>设置</h1><div className="settings-list"><label><span><strong>自动解析</strong><small>新作业出现后自动进入解析队列</small></span><input type="checkbox" defaultChecked /></label><label><span><strong>答案高亮</strong><small>阅读答案时突出显示标准答案</small></span><input type="checkbox" defaultChecked /></label></div></div></section>
}

function currentPage(pathname: string): Page | null {
  if (pathname === '/' || pathname === '/history' || pathname === '/settings') return pathname
  return null
}

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authMessage, setAuthMessage] = useState('')
  const [isAssignmentPanelOpen, setIsAssignmentPanelOpen] = useState(readStoredAssignmentPanelState)
  const authorizationStarted = useRef(false)
  const page = currentPage(pathname)

  useEffect(() => {
    const onPopState = () => {
      const nextPathname = window.location.pathname
      transitionRoute(() => setPathname(nextPathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      authorizationStarted.current = false
      setSession(null)
      setAuthMessage('')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => {
      authorizationStarted.current = false
      setSession(null)
      setAuthMessage('')
    }, Math.max(0, session.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session])

  useEffect(() => {
    if (!session || !page) return
    let active = true
    void getCurrentUser(session.accessToken).catch((error: unknown) => {
      if (active && error instanceof ApiError && error.status === 401) {
        authorizationStarted.current = false
        setSession(null)
        setAuthMessage('')
      }
    })
    return () => { active = false }
  }, [page, session])

  useEffect(() => {
    if (!page || session || authMessage || authorizationStarted.current || pathname === '/auth/callback') return
    authorizationStarted.current = true
    void startAuthorization(page).catch((error: unknown) => {
      authorizationStarted.current = false
      setAuthMessage(error instanceof Error ? error.message : '无法连接统一认证，请稍后重试。')
    })
  }, [authMessage, page, pathname, session])

  function navigate(nextPage: Page, closePanel = false) {
    if (nextPage === window.location.pathname) { if (closePanel) setPanelOpen(false); return }
    transitionRoute(() => {
      window.history.pushState(null, '', nextPage)
      setPathname(nextPage)
      if (closePanel) setPanelOpen(false)
    })
  }

  function setPanelOpen(nextOpen: boolean) {
    setIsAssignmentPanelOpen(nextOpen)
    window.localStorage.setItem(assignmentPanelStorageKey, String(nextOpen))
  }

  function beginAuthentication() {
    setAuthMessage('')
    authorizationStarted.current = true
    void startAuthorization(page || '/').catch((error: unknown) => {
      authorizationStarted.current = false
      setAuthMessage(error instanceof Error ? error.message : '无法连接统一认证，请稍后重试。')
    })
  }

  if (pathname === '/auth/callback') {
    return <Callback onAuthenticated={(nextSession, returnTo) => {
      setSession(nextSession)
      transitionRoute(() => {
        window.history.replaceState(null, '', returnTo)
        setPathname(returnTo)
      })
    }} onFailure={(message) => {
      setAuthMessage(message)
      window.history.replaceState(null, '', '/')
      setPathname('/')
    }} />
  }

  if (!page) {
    window.history.replaceState(null, '', '/')
    return <AuthGate message="页面不存在，请从作业工作台重新开始。" onAuthenticate={beginAuthentication} />
  }

  if (!session) return authMessage
    ? <AuthGate message={authMessage} onAuthenticate={beginAuthentication} />
    : <main className="auth-callback"><p role="status">正在连接统一认证...</p></main>

  return <main className="workspace-shell">
    <header className="topbar"><div className="brand-lockup"><img className="brand-logo" src={logoSrc} alt="" aria-hidden="true" /><span><strong>Fuck ets100</strong><small>答案工作台</small></span></div><div className="topbar__links"><a href="https://lastudio.cc/account">账号管理<Icon name="person" /></a><a href="https://lastudio.cc/admin">后台管理<Icon name="admin_panel_settings" /></a></div></header>
    <div className="workspace-body">
      <aside className="side-nav"><nav className="side-nav__links" aria-label="主导航">{navigationItems.map((item) => <button className={`side-link ${page === item.page ? 'side-link--active' : ''}`} type="button" onClick={() => navigate(item.page)} key={item.page}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav><div className="side-nav__footer"><button className="side-link" type="button" onClick={() => transitionTo(oauthConfig.logoutUrl)}><Icon name="logout" /><span>退出并返回官网</span></button></div></aside>
      <AssignmentPanel isOpen={isAssignmentPanelOpen} activePage={page} onClose={() => setPanelOpen(false)} onNavigate={navigate} onToggle={() => setPanelOpen(!isAssignmentPanelOpen)} />
      {page === '/' && <CurrentAssignmentPage onOpenAssignments={() => setPanelOpen(true)} />}
      {page === '/history' && <HistoryPage onOpenAssignments={() => setPanelOpen(true)} />}
      {page === '/settings' && <SettingsPage onOpenAssignments={() => setPanelOpen(true)} />}
    </div>
  </main>
}

export default App
