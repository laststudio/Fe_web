import { useCallback, useEffect, useEffectEvent, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import './App.css'
import {
  ApiError,
  changeMyPassword,
  createCaptcha,
  getCurrentUser,
  getMembership,
  login,
  redeemCard,
  register,
  type AuthSession,
  type CaptchaChallenge,
  type Membership,
} from './api/auth'
import AdminPage from './admin/AdminPage'
import { clearAuthSession, readAuthSession, saveAuthSession, updateAuthSession } from './utils/auth-session'

type IconProps = {
  name: string
  className?: string
  filled?: boolean
}

type Page = 'current' | 'history' | 'settings' | 'account' | 'admin'
type Status = 'parsed' | 'parsing' | 'unread'
type TransitionKind = 'page' | 'auth-mode' | 'shell'
type ViewTransition = {
  finished: Promise<void>
}
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransition
}

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

const baseNavItems: { icon: string; label: string; page: Page }[] = [
  { icon: 'assignment', label: '当前作业', page: 'current' },
  { icon: 'history', label: '历史作业', page: 'history' },
  { icon: 'settings', label: '业务设置', page: 'settings' },
]
const adminNavItem: { icon: string; label: string; page: Page } = { icon: 'admin_panel_settings', label: '后台管理', page: 'admin' }
const accountRoleLabels: Record<number, string> = {
  0: '超级管理员',
  1: '管理员',
  2: '代理',
  3: '普通用户',
  4: '受限用户',
}

const answerSteps = ['2x + 5 = 15', '2x = 15 - 5', '2x = 10', 'x = 10 / 2', 'x = 5']
const logoSrc = '/fe_logo.png'
const officialWebsiteUrl = 'https://lastudio.cc'
const assignmentPanelStorageKey = 'fe-web.assignment-panel-open'
const usernamePattern = /^[a-zA-Z0-9_]+$/

function passwordFitsBackendLimit(password: string) {
  return password.length >= 10 && password.length <= 72 && new TextEncoder().encode(password).length <= 72
}

function formatCardCode(value: string) {
  const characters = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
  return characters.match(/.{1,4}/g)?.join('-') ?? ''
}

function runPageTransition(update: () => void, kind: TransitionKind = 'page') {
  const transitionDocument = document as ViewTransitionDocument

  if (!transitionDocument.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }

  document.documentElement.dataset.viewTransition = kind
  const transition = transitionDocument.startViewTransition(() => {
    flushSync(update)
  })
  void transition.finished.finally(() => {
    delete document.documentElement.dataset.viewTransition
  })
}

function readStoredAssignmentPanelState() {
  if (typeof window === 'undefined') {
    return true
  }

  const storedState = window.localStorage.getItem(assignmentPanelStorageKey)

  if (storedState !== null) {
    return storedState !== 'false'
  }

  return !window.matchMedia('(max-width: 760px)').matches
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
  username,
  memberLevel,
  showAdmin,
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
  username?: string
  memberLevel?: number
  showAdmin: boolean
  menuOnly?: boolean
  onClose: () => void
  onLogin: () => void
  onLogout: () => void
  onNavigate: (page: Page) => void
  onToggle: () => void
}) {
  const navigationItems = showAdmin ? [...baseNavItems, adminNavItem] : baseNavItems

  return (
    <>
      <section
        className={`assignment-panel ${menuOnly ? 'assignment-panel--menu-only' : ''} ${
          isOpen ? 'assignment-panel--open' : 'assignment-panel--closed'
        }`}
        aria-label="作业列表"
      >
        <div className="assignment-panel__head">
          <span className="assignment-panel__title">
            <strong>作业索引</strong>
            <small>3 份作业</small>
          </span>
          <button className="icon-button assignment-collapse" type="button" onClick={onToggle} aria-label="折叠作业列表">
            <Icon name="keyboard_double_arrow_left" />
          </button>
          <button className="icon-button assignment-close" type="button" onClick={onClose} aria-label="关闭作业列表">
            <Icon name="close" />
          </button>
        </div>

        <div className="mobile-drawer-menu">
          <nav className="mobile-drawer-menu__nav" aria-label="移动端主导航">
            {navigationItems.map((item) => (
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
            <a className="side-link side-link--external" href={officialWebsiteUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="language" />
              <span>访问官网</span>
              <Icon name="open_in_new" className="side-link__external-icon" />
            </a>
          </nav>
          <div className="mobile-drawer-menu__account">
            {isLoggedIn ? (
              <>
                <button className={`mobile-account-link ${activePage === 'account' ? 'mobile-account-link--active' : ''}`} type="button" onClick={() => onNavigate('account')}>
                  <span className="mobile-account-link__avatar">{(username || 'U').slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{username || '当前账号'}</strong>
                    <small>L{memberLevel ?? 0} · 查看个人中心</small>
                  </span>
                  <Icon name="chevron_right" />
                </button>
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
        <header className="answer-paper__head">
          <span className="paper-kicker">已解析 · 20 题</span>
          <h1>数学周测 #4</h1>
          <div className="paper-meta">
            <span>提交于 10 分钟前</span>
            <span>八年级数学</span>
          </div>
        </header>
        <section className="question-block">
          <div className="question-heading">
            <span className="question-number">01</span>
            <h2>求解 2x + 5 = 15 中的 x</h2>
            <span className="score-mark" aria-label="本题得分 5 分">5 / 5</span>
          </div>
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
          <div className="review-stamp" aria-hidden="true">
            <Icon name="done_all" />
            <span>已核对</span>
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

function formatAccountDate(value: string | null) {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatMembershipExpiry(membership: Membership | null) {
  if (!membership?.expire_time) return '未设置'
  const formatted = formatAccountDate(membership.expire_time)
  return membership.member_level === 0 && Date.parse(membership.expire_time) <= Date.now()
    ? `已于 ${formatted} 到期`
    : formatted
}

function AccountPage({ session, onOpenMenu, onSessionUpdated, onSessionExpired }: {
  session: AuthSession
  onOpenMenu: () => void
  onSessionUpdated: (session: AuthSession) => void
  onSessionExpired: () => void
}) {
  const [profile, setProfile] = useState(session.user)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [cardCode, setCardCode] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const expireSession = useEffectEvent(onSessionExpired)
  const updateSession = useEffectEvent(onSessionUpdated)

  useEffect(() => {
    let isCurrent = true

    Promise.all([getCurrentUser(session.accessToken), getMembership(session.accessToken)])
      .then(([nextProfile, nextMembership]) => {
        if (!isCurrent) return
        setProfile(nextProfile)
        setMembership(nextMembership)
        updateSession({ ...session, user: nextProfile })
      })
      .catch((caughtError) => {
        if (!isCurrent) return
        if (caughtError instanceof ApiError && [401, 404].includes(caughtError.status)) {
          expireSession()
          return
        }
        setError(caughtError instanceof Error ? caughtError.message : '账号信息加载失败')
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [session.accessToken])

  async function handleRedeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedCode = cardCode.trim().toUpperCase()
    if (normalizedCode.length !== 19) {
      setError('卡密需要为 19 位，格式为 XXXX-XXXX-XXXX-XXXX')
      return
    }

    setIsSubmitting(true)
    setError('')
    setMessage('')
    try {
      const result = await redeemCard(session.accessToken, normalizedCode)
      const nextMembership = {
        user_id: session.user.id,
        member_level: result.member_level,
        expire_time: result.expire_time,
      }
      setMembership(nextMembership)
      setCardCode('')
      onSessionUpdated({
        ...session,
        user: { ...session.user, member_level: result.member_level },
      })
      setMessage(result.message)
    } catch (caughtError) {
      if (caughtError instanceof ApiError && [401, 404].includes(caughtError.status) && caughtError.message.includes('用户')) {
        onSessionExpired()
        return
      }
      setError(caughtError instanceof Error ? caughtError.message : '卡密兑换失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!passwordFitsBackendLimit(newPassword)) {
      setError('新密码需要为 10 至 72 位，且编码后不超过 72 字节')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    setIsSubmitting(true)
    setError('')
    setMessage('')
    try {
      await changeMyPassword(session.accessToken, oldPassword, newPassword, confirmPassword)
      onSessionExpired()
    } catch (caughtError) {
      if (caughtError instanceof ApiError && [401, 404].includes(caughtError.status)) {
        onSessionExpired()
        return
      }
      setError(caughtError instanceof Error ? caughtError.message : '密码修改失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="account-page page-surface-enter" aria-label="个人中心">
      <div className="page-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenMenu} aria-label="打开菜单">
          <Icon name="menu" />
        </button>
      </div>
      <div className="account-page__inner">
        <header className="account-hero">
          <div className="account-avatar" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</div>
          <div className="account-hero__identity">
            <span className="account-eyebrow">PERSONAL CENTER</span>
            <h1>{profile.name}</h1>
            <p>管理你的身份、会员权益和账号连接。</p>
          </div>
          <div className="account-hero__meta">
            <span><small>用户 ID</small><strong>#{profile.id}</strong></span>
            <span><small>账号角色</small><strong>{accountRoleLabels[profile.role] || `角色 ${profile.role}`}</strong></span>
            <span><small>创建来源</small><strong>{profile.created_by ? `管理员 #${profile.created_by}` : '自主注册'}</strong></span>
            <span><small>创建时间</small><strong>{formatAccountDate(profile.create_time ?? null)}</strong></span>
          </div>
        </header>
        {(error || message) && (
          <div className={`account-message ${error ? 'account-message--error' : ''}`} role={error ? 'alert' : 'status'}>
            <Icon name={error ? 'error' : 'check_circle'} />
            {error || message}
          </div>
        )}
        <div className="account-layout">
          <div className="account-layout__main">
            <section className="account-section" aria-labelledby="membership-title">
              <header>
                <span className="account-section__icon"><Icon name="workspace_premium" /></span>
                <span><small>MEMBERSHIP</small><h2 id="membership-title">会员权益</h2></span>
                <strong className="membership-level">L{membership?.member_level ?? profile.member_level}</strong>
              </header>
              <dl className="membership-details">
                <div><dt>当前状态</dt><dd>{(membership?.member_level ?? profile.member_level) > 0 ? '会员有效' : '普通账户'}</dd></div>
                <div><dt>会员到期</dt><dd>{isLoading ? '正在读取' : formatMembershipExpiry(membership)}</dd></div>
              </dl>
              <form className="account-form account-form--inline" onSubmit={handleRedeem}>
                <label><span>兑换卡密</span><input value={cardCode} onChange={(event) => {
                  setCardCode(formatCardCode(event.target.value))
                  setError('')
                  setMessage('')
                }} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" disabled={isSubmitting} /></label>
                <button type="submit" disabled={isSubmitting || isLoading}><Icon name="redeem" />兑换卡密</button>
              </form>
            </section>
            <section className="account-section" aria-labelledby="security-title">
              <header>
                <span className="account-section__icon"><Icon name="shield_lock" /></span>
                <span><small>SECURITY</small><h2 id="security-title">登录与安全</h2></span>
              </header>
              <form className="account-form" onSubmit={handlePasswordChange}>
                <label><span>当前密码</span><input required type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => {
                  setOldPassword(event.target.value)
                  setError('')
                  setMessage('')
                }} /></label>
                <div className="account-form__grid">
                  <label><span>新密码</span><input required minLength={10} maxLength={72} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => {
                    setNewPassword(event.target.value)
                    setError('')
                    setMessage('')
                  }} placeholder="10 至 72 位" /></label>
                  <label><span>确认新密码</span><input required maxLength={72} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => {
                    setConfirmPassword(event.target.value)
                    setError('')
                    setMessage('')
                  }} /></label>
                </div>
                <button type="submit" disabled={isSubmitting}><Icon name="key" />修改密码并重新登录</button>
              </form>
            </section>
          </div>
          <aside className="account-connections" aria-labelledby="connections-title">
            <header><small>CONNECTIONS</small><h2 id="connections-title">账号连接</h2></header>
            <div className="account-connection">
              <span className="account-connection__icon"><Icon name="mail" /></span>
              <span><strong>邮箱账号</strong><small>用于找回密码和接收通知</small></span>
              <em>未绑定</em>
            </div>
            <div className="account-connection">
              <span className="account-connection__icon"><Icon name="school" /></span>
              <span><strong>ETS 账号</strong><small>用于同步课程和作业身份</small></span>
              <em>未绑定</em>
            </div>
            <p>账号连接将在后端开放对应接口后启用。</p>
          </aside>
        </div>
      </div>
    </section>
  )
}

function SettingsPage({ onOpenAssignments }: { onOpenAssignments: () => void }) {
  return (
    <section className="page-panel page-surface-enter" aria-label="设置">
      <div className="page-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开菜单"><Icon name="menu" /></button>
      </div>
      <div className="page-panel__inner">
        <h1>业务设置</h1>
        <div className="settings-list">
          <label><span><strong>自动解析</strong><small>新作业出现后自动进入解析队列</small></span><input type="checkbox" defaultChecked /></label>
          <label><span><strong>答案高亮</strong><small>阅读答案时突出显示标准答案</small></span><input type="checkbox" defaultChecked /></label>
        </div>
      </div>
    </section>
  )
}

function LoginPage({ canReturnToWorkspace, onBack, onAuthenticated }: {
  canReturnToWorkspace: boolean
  onBack: () => void
  onAuthenticated: (session: AuthSession, remember: boolean) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>(() => window.location.hash === '#register' ? 'register' : 'login')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberLogin, setRememberLogin] = useState(true)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaPurpose, setCaptchaPurpose] = useState<'login' | 'register' | null>(null)
  const [loginCaptchaRequired, setLoginCaptchaRequired] = useState(false)
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(false)

  const loadCaptcha = useCallback(async (purpose: 'login' | 'register') => {
    setIsCaptchaLoading(true)
    setCaptchaPurpose(purpose)
    setCaptchaAnswer('')
    try {
      const nextCaptcha = await createCaptcha(purpose)
      setCaptcha(nextCaptcha)
    } catch (caughtError) {
      setCaptcha(null)
      setError(caughtError instanceof ApiError ? caughtError.message : '验证码加载失败，请稍后重试')
    } finally {
      setIsCaptchaLoading(false)
    }
  }, [])

  useEffect(() => {
    const requiredPurpose = mode === 'register' ? 'register' : loginCaptchaRequired ? 'login' : null
    if (requiredPurpose && captchaPurpose !== requiredPurpose && !isCaptchaLoading) {
      void loadCaptcha(requiredPurpose)
    }
  }, [mode, loginCaptchaRequired, captchaPurpose, isCaptchaLoading, loadCaptcha])

  useEffect(() => {
    function syncModeWithHash() {
      setMode(window.location.hash === '#register' ? 'register' : 'login')
    }

    window.addEventListener('hashchange', syncModeWithHash)
    return () => window.removeEventListener('hashchange', syncModeWithHash)
  }, [])

  function changeMode(nextMode: 'login' | 'register') {
    if (nextMode === mode) {
      return
    }

    runPageTransition(() => {
      setMode(nextMode)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${nextMode}`)
      setPassword('')
      setConfirmPassword('')
      setShowPassword(false)
      setCaptcha(null)
      setCaptchaAnswer('')
      setCaptchaPurpose(null)
      setError('')
    }, 'auth-mode')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const username = account.trim()

    if (!username || !password) {
      setError('请输入账号和密码')
      return
    }

    if (mode === 'register') {
      if (username.length < 3 || username.length > 50 || !usernamePattern.test(username)) {
        setError('用户名需要为 3 至 50 位字母、数字或下划线')
        return
      }
      if (!passwordFitsBackendLimit(password)) {
        setError('密码需要为 10 至 72 位，且编码后不超过 72 字节')
        return
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致')
        return
      }
    }

    const requiredCaptchaPurpose = mode === 'register' ? 'register' : loginCaptchaRequired ? 'login' : null
    if (requiredCaptchaPurpose && (!captcha || captchaPurpose !== requiredCaptchaPurpose || captchaAnswer.trim().length !== 5)) {
      setError('请输入 5 位验证码')
      return
    }
    if (captcha && Date.parse(captcha.expiresAt) <= Date.now()) {
      setError('验证码已过期，请输入新验证码')
      await loadCaptcha(requiredCaptchaPurpose || mode)
      return
    }

    setError('')
    setIsSubmitting(true)

    try {
      if (mode === 'register') {
        await register(username, password, confirmPassword, {
          id: captcha!.captchaId,
          answer: captchaAnswer.trim(),
        })
      }
      const session = await login(
        username,
        password,
        loginCaptchaRequired && captcha ? { id: captcha.captchaId, answer: captchaAnswer.trim() } : undefined,
      )
      onAuthenticated(session, rememberLogin)
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setError(caughtError.message)
        if (mode === 'login' && (caughtError.captchaRequired || caughtError.message.includes('验证码'))) {
          setLoginCaptchaRequired(true)
          await loadCaptcha('login')
        } else if (mode === 'register' || loginCaptchaRequired) {
          await loadCaptcha(mode === 'register' ? 'register' : 'login')
        }
      } else {
        setError('认证失败，请稍后重试')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-context" aria-label="账号说明">
        {canReturnToWorkspace && (
          <button className="login-back" type="button" onClick={onBack}>
            <Icon name="arrow_back" />
            返回工作台
          </button>
        )}

        <div className="login-brand">
          <img src={logoSrc} alt="" aria-hidden="true" />
          <span>
            <strong>Fuck ets100</strong>
            <small>答案工作台</small>
          </span>
        </div>

        <div className="login-context__copy">
          <span className="login-context__index">{mode === 'login' ? 'STUDENT ACCESS / 01' : 'CREATE ACCOUNT / 02'}</span>
          <h1>把作业答案，<br />整理成能读懂的批注。</h1>
          <p>同步作业、查看解析，并在同一处完成答案核对。</p>
          <a className="login-site-link" href={officialWebsiteUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="language" />
            访问 LA Studio 官网
            <Icon name="open_in_new" />
          </a>
        </div>

        <div className="login-proof" aria-label="工作台状态">
          <span>
            <strong>20</strong>
            <small>本周解析</small>
          </span>
          <span>
            <strong>JWT</strong>
            <small>会话校验</small>
          </span>
          <span>
            <strong>LIVE</strong>
            <small>云端同步</small>
          </span>
        </div>
      </section>

      <section className="login-entry" aria-label={mode === 'login' ? '账号登录' : '账号注册'}>
        <div className="login-form-wrap">
          <div className="auth-mode-switch" aria-label="选择账号操作">
            <button className={mode === 'login' ? 'auth-mode-switch__active' : ''} type="button" onClick={() => changeMode('login')}>
              登录
            </button>
            <button className={mode === 'register' ? 'auth-mode-switch__active' : ''} type="button" onClick={() => changeMode('register')}>
              注册
            </button>
          </div>

          <header className="login-form-head">
            <span className="login-form-head__mark">{mode === 'login' ? '账号验证' : '创建账号'}</span>
            <h2>{mode === 'login' ? '登录工作台' : '注册工作台'}</h2>
            <p>{mode === 'login' ? '使用你的账号继续。' : '创建账号后将自动登录工作台。'}</p>
          </header>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <label className="login-field">
              <span>账号</span>
              <span className="login-field__control">
                <Icon name="person" />
                <input
                  autoComplete="username"
                  inputMode="text"
                  placeholder="输入用户名"
                  value={account}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setAccount(event.target.value)
                    setError('')
                  }}
                />
              </span>
            </label>

            <label className="login-field">
              <span>密码</span>
              <span className="login-field__control">
                <Icon name="lock" />
                <input
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'login' ? '输入登录密码' : '10 至 72 位密码'}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError('')
                  }}
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  disabled={isSubmitting}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
                </button>
              </span>
            </label>

            {mode === 'register' && (
              <label className="login-field auth-field-enter">
                <span>确认密码</span>
                <span className="login-field__control">
                  <Icon name="lock_reset" />
                  <input
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value)
                      setError('')
                    }}
                  />
                </span>
              </label>
            )}

            {(mode === 'register' || loginCaptchaRequired) && (
              <label className="login-field auth-field-enter">
                <span>验证码</span>
                <span className="captcha-control">
                  <span className="login-field__control captcha-input">
                    <Icon name="verified_user" />
                    <input
                      autoComplete="off"
                      inputMode="text"
                      maxLength={5}
                      placeholder="5 位字符"
                      value={captchaAnswer}
                      disabled={isSubmitting || isCaptchaLoading}
                      onChange={(event) => {
                        setCaptchaAnswer(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))
                        setError('')
                      }}
                    />
                  </span>
                  <button
                    className="captcha-image"
                    type="button"
                    onClick={() => void loadCaptcha(mode === 'register' ? 'register' : 'login')}
                    disabled={isSubmitting || isCaptchaLoading}
                    aria-label="刷新验证码"
                    title="点击刷新验证码"
                  >
                    {captcha && !isCaptchaLoading ? (
                      <img src={captcha.imageUrl} alt="验证码" />
                    ) : (
                      <Icon name="refresh" className={isCaptchaLoading ? 'auth-submit-spin' : ''} />
                    )}
                  </button>
                </span>
              </label>
            )}

            <div className="login-options">
              <label>
                <input
                  type="checkbox"
                  checked={rememberLogin}
                  onChange={(event) => setRememberLogin(event.target.checked)}
                  disabled={isSubmitting}
                />
                <span>记住登录状态</span>
              </label>
              {mode === 'login' ? (
                <button type="button" onClick={() => setError('请联系老师或管理员重置密码')}>忘记密码</button>
              ) : (
                <small>用户名仅支持字母、数字和下划线</small>
              )}
            </div>

            <div className={`login-error ${error ? 'login-error--visible' : ''}`} role="alert">
              {error || '账号验证信息完整'}
            </div>

            <button className="login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  {mode === 'login' ? '正在登录' : '正在注册'}
                  <Icon name="progress_activity" className="auth-submit-spin" />
                </>
              ) : (
                <>
                  {mode === 'login' ? '登录' : '注册并登录'}
                  <Icon name="arrow_forward" />
                </>
              )}
            </button>
          </form>

          <footer className="login-form-foot">
            <span>
              <Icon name="shield_lock" />
              登录信息仅用于连接作业服务
            </span>
            <a href={officialWebsiteUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="language" />
              访问官网
              <Icon name="open_in_new" />
            </a>
          </footer>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [activePage, setActivePage] = useState<Page>('current')
  const [authSession, setAuthSession] = useState<AuthSession | null>(readAuthSession)
  const [isAssignmentPanelOpen, setIsAssignmentPanelOpen] = useState(readStoredAssignmentPanelState)
  const [isLoginPageOpen, setIsLoginPageOpen] = useState(() => ['#login', '#register'].includes(window.location.hash))
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)

  useEffect(() => {
    function syncLoginPageWithHash() {
      if (!authSession) {
        if (!['#login', '#register'].includes(window.location.hash)) {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#login`)
        }
        setIsLoginPageOpen(true)
        return
      }

      setIsLoginPageOpen(['#login', '#register'].includes(window.location.hash))
    }

    syncLoginPageWithHash()
    window.addEventListener('hashchange', syncLoginPageWithHash)
    return () => window.removeEventListener('hashchange', syncLoginPageWithHash)
  }, [authSession])

  useEffect(() => {
    if (!isLogoutConfirmOpen) {
      return
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsLogoutConfirmOpen(false)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isLogoutConfirmOpen])

  useEffect(() => {
    const accessToken = authSession?.accessToken

    if (!accessToken) {
      return
    }

    let isCurrent = true

    getCurrentUser(accessToken)
      .then((user) => {
        if (!isCurrent) {
          return
        }
        setAuthSession((currentSession) => currentSession ? { ...currentSession, user } : null)
      })
      .catch((caughtError) => {
        if (!isCurrent || !(caughtError instanceof ApiError) || ![401, 404].includes(caughtError.status)) {
          return
        }
        clearAuthSession()
        runPageTransition(() => {
          setAuthSession(null)
          setActivePage('current')
          setIsLoginPageOpen(true)
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#login`)
        }, 'shell')
      })

    return () => {
      isCurrent = false
    }
  }, [authSession?.accessToken])

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

  function openLoginPage() {
    if (isLoginPageOpen) {
      return
    }

    runPageTransition(() => {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#login`)
      setIsLoginPageOpen(true)
    }, 'shell')
  }

  function closeLoginPage() {
    if (!authSession) {
      return
    }

    runPageTransition(() => {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      setIsLoginPageOpen(false)
    }, 'shell')
  }

  function clearSessionAndOpenLogin() {
    clearAuthSession()
    runPageTransition(() => {
      setAuthSession(null)
      setActivePage('current')
      setIsAssignmentPanelOpen(false)
      setIsLogoutConfirmOpen(false)
      setIsLoginPageOpen(true)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#login`)
    }, 'shell')
  }

  function requestLogout() {
    setIsLogoutConfirmOpen(true)
  }

  function navigateToPage(page: Page, closeAssignmentPanel = false) {
    if (page === activePage) {
      if (closeAssignmentPanel) {
        setAssignmentPanelOpen(false)
      }
      return
    }

    runPageTransition(() => {
      setActivePage(page)
      if (closeAssignmentPanel) {
        setAssignmentPanelOpen(false)
      }
    })
  }

  const hasAdminAccess = authSession ? [0, 1, 2].includes(authSession.user.role) : false
  const navigationItems = hasAdminAccess ? [...baseNavItems, adminNavItem] : baseNavItems

  if (!authSession || isLoginPageOpen) {
    return (
      <LoginPage
        canReturnToWorkspace={Boolean(authSession)}
        onBack={closeLoginPage}
        onAuthenticated={(session, remember) => {
          saveAuthSession(session, remember)
          runPageTransition(() => {
            setAuthSession(session)
            setIsLoginPageOpen(false)
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
          }, 'shell')
        }}
      />
    )
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src={logoSrc} alt="" aria-hidden="true" />
          <span className="brand-copy">
            <strong>Fuck ets100</strong>
            <small>答案工作台</small>
          </span>
        </div>
        <button
          className={`account-trigger ${activePage === 'account' ? 'account-trigger--active' : ''}`}
          type="button"
          onClick={() => navigateToPage('account')}
          aria-label={`打开 ${authSession.user.name} 的个人中心`}
          title="个人中心"
        >
          <span className="account-trigger__avatar">{authSession.user.name.slice(0, 1).toUpperCase()}</span>
          <span className="account-trigger__copy">
            <small>个人中心</small>
            <strong>{authSession.user.name}</strong>
          </span>
          <span className="account-trigger__level">L{authSession.user.member_level}</span>
          <Icon name="chevron_right" />
        </button>
      </header>

      <div className="workspace-body">
        <aside className="side-nav">
          <nav className="side-nav__links" aria-label="主导航">
            {navigationItems.map((item) => (
              <button
                className={`side-link ${activePage === item.page ? 'side-link--active' : ''}`}
                type="button"
                onClick={() => navigateToPage(item.page)}
                key={item.page}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-nav__footer">
            <a className="official-site-link" href={officialWebsiteUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="language" />
              <span>
                访问官网
                <small>lastudio.cc</small>
              </span>
              <Icon name="open_in_new" className="official-site-link__external" />
            </a>
            <button className="side-logout-button" type="button" onClick={requestLogout}>
              <Icon name="logout" />
              退出登录
            </button>
          </div>
        </aside>

        {(pageUsesAssignmentPanel || mobileMenuIsAvailable) && (
          <>
            <AssignmentPanel
              isOpen={isAssignmentPanelOpen}
              activePage={activePage}
              isLoggedIn={Boolean(authSession)}
              username={authSession?.user.name}
              memberLevel={authSession?.user.member_level}
              showAdmin={hasAdminAccess}
              menuOnly={!pageUsesAssignmentPanel}
              onClose={() => setAssignmentPanelOpen(false)}
              onLogin={openLoginPage}
              onLogout={requestLogout}
              onNavigate={(page) => navigateToPage(page, true)}
              onToggle={toggleAssignmentPanel}
            />
            {isAssignmentPanelOpen && (
              <button className="drawer-scrim" type="button" aria-label="关闭作业列表" onClick={() => setAssignmentPanelOpen(false)} />
            )}
          </>
        )}

        {activePage === 'current' && <CurrentAssignmentPage key="current" onOpenAssignments={() => setAssignmentPanelOpen(true)} />}
        {activePage === 'history' && <HistoryPage key="history" onOpenAssignments={() => setAssignmentPanelOpen(true)} />}
        {activePage === 'settings' && (
          <SettingsPage key="settings" onOpenAssignments={() => setAssignmentPanelOpen(true)} />
        )}
        {activePage === 'account' && (
          <AccountPage
            key="account"
            session={authSession}
            onOpenMenu={() => setAssignmentPanelOpen(true)}
            onSessionUpdated={(session) => {
              setAuthSession(session)
              updateAuthSession(session)
            }}
            onSessionExpired={clearSessionAndOpenLogin}
          />
        )}
        {activePage === 'admin' && authSession && hasAdminAccess && (
          <AdminPage
            key="admin"
            session={authSession}
            onOpenMenu={() => setAssignmentPanelOpen(true)}
            onSessionExpired={clearSessionAndOpenLogin}
          />
        )}
      </div>

      {isLogoutConfirmOpen && (
        <div
          className="logout-dialog-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsLogoutConfirmOpen(false)
            }
          }}
        >
          <section className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title">
            <span className="logout-dialog__icon"><Icon name="logout" /></span>
            <div>
              <h2 id="logout-dialog-title">退出当前账号？</h2>
              <p>退出后需要重新登录才能继续访问工作台。</p>
            </div>
            <div className="logout-dialog__actions">
              <button type="button" onClick={() => setIsLogoutConfirmOpen(false)}>取消</button>
              <button className="logout-dialog__confirm" type="button" onClick={clearSessionAndOpenLogin}>确认退出</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
