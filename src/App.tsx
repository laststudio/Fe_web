import { useState } from 'react'
import './App.css'

type IconProps = {
  name: string
  className?: string
  filled?: boolean
}

type Page = 'current' | 'history' | 'settings'
type Status = 'parsed' | 'parsing' | 'unread'

type Assignment = {
  title: string
  time: string
  count: string
  status: Status
  selected?: boolean
}

const groups: { label: string; items: Assignment[] }[] = [
  {
    label: '今天',
    items: [
      {
        title: '数学周测 #4',
        time: '10 分钟前',
        count: '20 题',
        status: 'parsed',
        selected: true,
      },
      {
        title: '英语词汇集',
        time: '刚刚',
        count: '50 题',
        status: 'parsing',
      },
    ],
  },
  {
    label: '昨天',
    items: [
      {
        title: '物理第三章复习',
        time: '1 小时前',
        count: '15 题',
        status: 'unread',
      },
    ],
  },
]

const navItems: { icon: string; label: string; page: Page }[] = [
  { icon: 'assignment', label: '当前作业', page: 'current' },
  { icon: 'history', label: '历史作业', page: 'history' },
  { icon: 'settings', label: '设置', page: 'settings' },
]

const answerSteps = ['2x + 5 = 15', '2x = 15 - 5', '2x = 10', 'x = 10 / 2', 'x = 5']
const logoSrc = '/fe_logo.png'
const assignmentPanelStorageKey = 'fe-web.assignment-panel-open'

function readStoredAssignmentPanelState() {
  if (typeof window === 'undefined') {
    return true
  }

  return window.localStorage.getItem(assignmentPanelStorageKey) !== 'false'
}

function Icon({ name, className = '', filled = false }: IconProps) {
  const style = filled ? { fontVariationSettings: "'FILL' 1" } : undefined

  return (
    <span className={`material-symbols-outlined ${className}`} style={style} aria-hidden="true">
      {name}
    </span>
  )
}

function StatusPill({ status }: { status: Status }) {
  if (status === 'parsing') {
    return (
      <span className="status-pill status-pill--parsing">
        <Icon name="sync" className="status-pill__spin" />
        解析中
      </span>
    )
  }

  if (status === 'unread') {
    return (
      <span className="status-pill status-pill--unread">
        <span className="status-dot" />
        未读
      </span>
    )
  }

  return (
    <span className="status-pill status-pill--parsed">
      <span className="status-dot" />
      已解析
    </span>
  )
}

function AssignmentCard({ item, onSelect }: { item: Assignment; onSelect: () => void }) {
  return (
    <button className={`assignment-card ${item.selected ? 'assignment-card--selected' : ''}`} type="button" onClick={onSelect}>
      <span className="assignment-card__rail" />
      <span className="assignment-card__head">
        <span className="assignment-card__title">{item.title}</span>
        <span className={`assignment-card__time ${item.status === 'unread' ? 'assignment-card__time--new' : ''}`}>
          {item.time}
        </span>
      </span>
      <span className="assignment-card__meta">
        <span>{item.count}</span>
        <StatusPill status={item.status} />
      </span>
    </button>
  )
}

function AssignmentPanel({
  isOpen,
  activePage,
  isLoggedIn,
  menuOnly = false,
  onClose,
  onLogin,
  onLogout,
  onNavigate,
  onToggle,
}: {
  isOpen: boolean
  activePage: Page
  isLoggedIn: boolean
  menuOnly?: boolean
  onClose: () => void
  onLogin: () => void
  onLogout: () => void
  onNavigate: (page: Page) => void
  onToggle: () => void
}) {
  return (
    <>
      <section
        className={`assignment-panel ${menuOnly ? 'assignment-panel--menu-only' : ''} ${
          isOpen ? 'assignment-panel--open' : 'assignment-panel--closed'
        }`}
        aria-label="作业列表"
      >
        <div className="assignment-panel__head">
          <strong>作业列表</strong>
          <button className="icon-button assignment-collapse" type="button" onClick={onToggle} aria-label="折叠作业列表">
            <Icon name="keyboard_double_arrow_left" />
          </button>
          <button className="icon-button assignment-close" type="button" onClick={onClose} aria-label="关闭作业列表">
            <Icon name="close" />
          </button>
        </div>

        <div className="mobile-drawer-menu">
          <nav className="mobile-drawer-menu__nav" aria-label="移动端主导航">
            {navItems.map((item) => (
              <button
                className={`side-link ${activePage === item.page ? 'side-link--active' : ''}`}
                type="button"
                onClick={() => onNavigate(item.page)}
                key={item.page}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="mobile-drawer-menu__account">
            {isLoggedIn ? (
              <>
                <div className="login-state" role="status">
                  <Icon name="check_circle" filled />
                  登录成功
                </div>
                <button className="side-logout-button" type="button" onClick={onLogout}>
                  <Icon name="logout" />
                  退出
                </button>
              </>
            ) : (
              <button className="side-login-button" type="button" onClick={onLogin}>
                <Icon name="login" />
                登录
              </button>
            )}
          </div>
        </div>

        <div className="search-row">
          <label className="search-box">
            <Icon name="search" />
            <input placeholder="搜索作业..." type="search" />
          </label>
          <button className="square-button" type="button" aria-label="筛选">
            <Icon name="filter_list" />
          </button>
        </div>

        <div className="assignment-list">
          {groups.map((group) => (
            <details className="assignment-group" open key={group.label}>
              <summary>
                <span>{group.label}</span>
                <Icon name="keyboard_arrow_down" />
              </summary>
              <div className="assignment-group__items">
                {group.items.map((item) => (
                  <AssignmentCard item={item} key={item.title} onSelect={onClose} />
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      {!isOpen && !menuOnly && (
        <button className="assignment-rail" type="button" onClick={onToggle} aria-label="展开作业列表">
          <Icon name="keyboard_double_arrow_right" />
          <span>作业</span>
        </button>
      )}
    </>
  )
}

function CurrentAssignmentPage({ onOpenAssignments }: { onOpenAssignments: () => void }) {
  return (
    <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
      <div className="reader-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
          <Icon name="menu" />
        </button>
        <button type="button">
          <Icon name="content_copy" />
          复制
        </button>
        <button type="button">
          <Icon name="download" />
          导出
        </button>
      </div>

      <article className="answer-paper">
        <h1>数学周测 #4</h1>
        <section className="question-block">
          <h2>问题 1：求解 2x + 5 = 15 中的 x</h2>
          <div className="options">
            {['A. 3', 'B. 5', 'C. 10', 'D. 15'].map((option) => (
              <label className={`option ${option === 'B. 5' ? 'option--selected' : ''}`} key={option}>
                <input name="q1" type="radio" defaultChecked={option === 'B. 5'} />
                <span>{option}</span>
              </label>
            ))}
          </div>

          <div className="answer-box">
            <h3>
              <Icon name="check_circle" filled />
              标准答案: B. 5
            </h3>
            <div className="answer-box__content">
              <p>为了求解 x，我们需要将变量隔离在等式的一侧。</p>
              <pre>
                <code>{answerSteps.join('\n')}</code>
              </pre>
              <p>因此，正确的选项是 B。</p>
            </div>
          </div>
        </section>
      </article>
    </section>
  )
}

function HistoryPage({ onOpenAssignments }: { onOpenAssignments: () => void }) {
  return (
    <section className="page-panel page-surface-enter" aria-label="历史作业">
      <div className="page-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
          <Icon name="menu" />
        </button>
      </div>
      <div className="page-panel__inner">
        <h1>历史作业</h1>
        <div className="history-list">
          {['物理第三章复习', '英语词汇集', '数学周测 #3'].map((title, index) => (
            <button className="history-item" type="button" key={title}>
              <span>
                <strong>{title}</strong>
                <small>{index + 1} 天前 · 已归档</small>
              </span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function SettingsPage({ onOpenAssignments }: { onOpenAssignments: () => void }) {
  return (
    <section className="page-panel page-surface-enter" aria-label="设置">
      <div className="page-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开菜单">
          <Icon name="menu" />
        </button>
      </div>
      <div className="page-panel__inner">
        <h1>设置</h1>
        <div className="settings-list">
          <label>
            <span>
              <strong>自动解析</strong>
              <small>新作业出现后自动进入解析队列</small>
            </span>
            <input type="checkbox" defaultChecked />
          </label>
          <label>
            <span>
              <strong>答案高亮</strong>
              <small>阅读答案时突出显示标准答案</small>
            </span>
            <input type="checkbox" defaultChecked />
          </label>
        </div>
      </div>
    </section>
  )
}

function App() {
  const [activePage, setActivePage] = useState<Page>('current')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isAssignmentPanelOpen, setIsAssignmentPanelOpen] = useState(readStoredAssignmentPanelState)

  function setAssignmentPanelOpen(nextOpen: boolean) {
    setIsAssignmentPanelOpen(nextOpen)
    window.localStorage.setItem(assignmentPanelStorageKey, String(nextOpen))
  }

  function toggleAssignmentPanel() {
    setIsAssignmentPanelOpen((currentOpen) => {
      const nextOpen = !currentOpen
      window.localStorage.setItem(assignmentPanelStorageKey, String(nextOpen))
      return nextOpen
    })
  }

  const pageUsesAssignmentPanel = activePage === 'current' || activePage === 'history'
  const mobileMenuIsAvailable = true

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src={logoSrc} alt="" aria-hidden="true" />
          <strong>Fuck ets100</strong>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="side-nav">
          <nav className="side-nav__links" aria-label="主导航">
            {navItems.map((item) => (
              <button
                className={`side-link ${activePage === item.page ? 'side-link--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage(item.page)
                }}
                key={item.page}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-nav__footer">
            <strong>Fuck ets100</strong>
            <a href="https://lastudio.cc" target="_blank" rel="noreferrer">
              lastudio.cc
            </a>
            {isLoggedIn ? (
              <>
                <div className="login-state" role="status">
                  <Icon name="check_circle" filled />
                  登录成功
                </div>
                <button className="side-logout-button" type="button" onClick={() => setIsLoggedIn(false)}>
                  <Icon name="logout" />
                  退出
                </button>
              </>
            ) : (
              <button className="side-login-button" type="button" onClick={() => setIsLoggedIn(true)}>
                <Icon name="login" />
                登录
              </button>
            )}
          </div>
        </aside>

        {(pageUsesAssignmentPanel || mobileMenuIsAvailable) && (
          <>
            <AssignmentPanel
              isOpen={isAssignmentPanelOpen}
              activePage={activePage}
              isLoggedIn={isLoggedIn}
              menuOnly={!pageUsesAssignmentPanel}
              onClose={() => setAssignmentPanelOpen(false)}
              onLogin={() => setIsLoggedIn(true)}
              onLogout={() => setIsLoggedIn(false)}
              onNavigate={(page) => {
                setActivePage(page)
                setAssignmentPanelOpen(false)
              }}
              onToggle={toggleAssignmentPanel}
            />
            {isAssignmentPanelOpen && (
              <button className="drawer-scrim" type="button" aria-label="关闭作业列表" onClick={() => setAssignmentPanelOpen(false)} />
            )}
          </>
        )}

        {activePage === 'current' && <CurrentAssignmentPage key="current" onOpenAssignments={() => setAssignmentPanelOpen(true)} />}
        {activePage === 'history' && <HistoryPage key="history" onOpenAssignments={() => setAssignmentPanelOpen(true)} />}
        {activePage === 'settings' && <SettingsPage key="settings" onOpenAssignments={() => setAssignmentPanelOpen(true)} />}
      </div>
    </main>
  )
}

export default App
