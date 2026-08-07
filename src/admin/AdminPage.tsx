import { useEffect, useEffectEvent, useState, type FormEvent, type ReactNode } from 'react'
import {
  applyForCards,
  changeUserLevel,
  changeUserPassword,
  changeUserRole,
  createUser,
  deleteUser,
  disableCard,
  generateCards,
  getCardRequests,
  getCards,
  getUserRecords,
  getUsers,
  reviewCardRequest,
  type AdminCard,
  type CardBatchInput,
  type CardRequest,
  type UserRecord,
} from '../api/admin'
import { ApiError, type AuthSession, type User } from '../api/auth'
import './AdminPage.css'

type IconProps = { name: string; className?: string }
type AdminTab = 'users' | 'cards' | 'records'
type CardView = 'cards' | 'requests'
type UserAction = 'role' | 'level' | 'password' | 'delete'

const roleLabels: Record<number, string> = {
  0: '超级管理员',
  1: '管理员',
  2: '代理',
  3: '普通用户',
  4: '受限用户',
}

const statusLabels: Record<string, string> = {
  unused: '未使用',
  used: '已使用',
  disabled: '已禁用',
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
}

function Icon({ name, className = '' }: IconProps) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>
}

function formatDate(value?: string | null) {
  if (!value) return '-'
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

function futureLocalDate(days = 30) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

function fetchAdminData(accessToken: string) {
  return Promise.all([
    getUsers(accessToken),
    getCards(accessToken),
    getCardRequests(accessToken),
    getUserRecords(accessToken),
  ])
}

function AdminDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="admin-dialog-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function EmptyState({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="admin-empty">
      <Icon name={icon} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

export default function AdminPage({ session, onOpenMenu, onSessionExpired }: {
  session: AuthSession
  onOpenMenu: () => void
  onSessionExpired: () => void
}) {
  const [activeTab, setActiveTab] = useState<AdminTab>('users')
  const [cardView, setCardView] = useState<CardView>('cards')
  const [users, setUsers] = useState<User[]>([])
  const [cards, setCards] = useState<AdminCard[]>([])
  const [requests, setRequests] = useState<CardRequest[]>([])
  const [records, setRecords] = useState<UserRecord[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [userAction, setUserAction] = useState<UserAction | null>(null)
  const [showCardBatch, setShowCardBatch] = useState(false)

  const role = session.user.role
  const canReviewCards = role === 0 || role === 1
  const filteredUsers = users.filter((user) => `${user.id} ${user.name} ${roleLabels[user.role] || ''}`.toLowerCase().includes(query.toLowerCase()))
  const filteredCards = cards.filter((card) => `${card.id} ${card.code} ${card.owner_id} ${statusLabels[card.status] || card.status}`.toLowerCase().includes(query.toLowerCase()))
  const filteredRequests = requests.filter((request) => `${request.id} ${request.agent_id} ${statusLabels[request.status] || request.status}`.toLowerCase().includes(query.toLowerCase()))
  const filteredRecords = records.filter((record) => `${record.records} ${record.user_name} ${record.admin_name}`.toLowerCase().includes(query.toLowerCase()))
  const handleSessionExpired = useEffectEvent(onSessionExpired)

  async function loadData(showLoading = true) {
    if (showLoading) setIsLoading(true)
    setError('')
    try {
      const [nextUsers, nextCards, nextRequests, nextRecords] = await fetchAdminData(session.accessToken)
      setUsers(nextUsers)
      setCards(nextCards)
      setRequests(nextRequests)
      setRecords(nextRecords)
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        onSessionExpired()
        return
      }
      setError(caughtError instanceof Error ? caughtError.message : '后台数据加载失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true

    fetchAdminData(session.accessToken)
      .then(([nextUsers, nextCards, nextRequests, nextRecords]) => {
        if (!isCurrent) return
        setUsers(nextUsers)
        setCards(nextCards)
        setRequests(nextRequests)
        setRecords(nextRecords)
      })
      .catch((caughtError) => {
        if (!isCurrent) return
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          handleSessionExpired()
          return
        }
        setError(caughtError instanceof Error ? caughtError.message : '后台数据加载失败')
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [session.accessToken])

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setIsSubmitting(true)
    setError('')
    try {
      await action()
      await loadData(false)
      setSelectedUser(null)
      setUserAction(null)
      setShowCreateUser(false)
      setShowCardBatch(false)
      showNotice(successMessage)
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        onSessionExpired()
        return
      }
      setError(caughtError instanceof Error ? caughtError.message : '操作失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  function openUserAction(user: User, action: UserAction) {
    setSelectedUser(user)
    setUserAction(action)
    setError('')
  }

  return (
    <section className="admin-page page-surface-enter" aria-label="后台管理">
      <header className="admin-header">
        <button className="admin-menu-button" type="button" onClick={onOpenMenu} aria-label="打开菜单">
          <Icon name="menu" />
        </button>
        <div>
          <span className="admin-eyebrow">CONTROL DESK</span>
          <h1>后台管理</h1>
          <p>{roleLabels[role]} · {session.user.name}</p>
        </div>
        <button className="admin-refresh" type="button" onClick={() => void loadData()} disabled={isLoading}>
          <Icon name="refresh" className={isLoading ? 'admin-spin' : ''} />
          刷新
        </button>
      </header>

      <div className="admin-stats" aria-label="后台数据概览">
        <div><span>用户</span><strong>{users.length}</strong><small>当前可管理</small></div>
        <div><span>卡密</span><strong>{cards.length}</strong><small>{cards.filter((card) => card.status === 'unused').length} 个未使用</small></div>
        <div><span>待审核</span><strong>{requests.filter((request) => request.status === 'pending').length}</strong><small>卡密申请</small></div>
        <div><span>记录</span><strong>{records.length}</strong><small>管理操作</small></div>
      </div>

      <div className="admin-workbench">
        <nav className="admin-tabs" aria-label="后台模块">
          {([
            ['users', 'group', '用户管理'],
            ['cards', 'confirmation_number', '卡密管理'],
            ['records', 'receipt_long', '操作记录'],
          ] as const).map(([tab, icon, label]) => (
            <button className={activeTab === tab ? 'admin-tab--active' : ''} type="button" onClick={() => {
              setActiveTab(tab)
              setQuery('')
            }} key={tab}>
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>

        <div className="admin-toolbar">
          <label className="admin-search">
            <Icon name="search" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前列表" type="search" />
          </label>
          {activeTab === 'users' && (
            <button className="admin-primary-action" type="button" onClick={() => {
              setError('')
              setShowCreateUser(true)
            }}>
              <Icon name="person_add" />
              创建用户
            </button>
          )}
          {activeTab === 'cards' && (
            <button className="admin-primary-action" type="button" onClick={() => {
              setError('')
              setShowCardBatch(true)
            }}>
              <Icon name={canReviewCards ? 'add_card' : 'outbox'} />
              {canReviewCards ? '生成卡密' : '申请卡密'}
            </button>
          )}
        </div>

        {error && <div className="admin-message admin-message--error" role="alert"><Icon name="error" />{error}</div>}
        {notice && <div className="admin-message admin-message--success" role="status"><Icon name="check_circle" />{notice}</div>}

        <div className="admin-content">
          {isLoading ? (
            <div className="admin-loading"><Icon name="progress_activity" className="admin-spin" />正在加载后台数据</div>
          ) : activeTab === 'users' ? (
            <UsersTable users={filteredUsers} currentUser={session.user} onAction={openUserAction} />
          ) : activeTab === 'cards' ? (
            <CardsArea
              cards={filteredCards}
              requests={filteredRequests}
              view={cardView}
              canReview={canReviewCards}
              isSubmitting={isSubmitting}
              onViewChange={setCardView}
              onCopy={(code) => {
                void navigator.clipboard.writeText(code)
                showNotice('卡密已复制')
              }}
              onDisable={(id) => void runAction(() => disableCard(session.accessToken, id), '卡密已禁用')}
              onReview={(id, approved) => void runAction(
                () => reviewCardRequest(session.accessToken, id, approved),
                approved ? '申请已通过' : '申请已拒绝',
              )}
            />
          ) : (
            <RecordsTable records={filteredRecords} />
          )}
        </div>
      </div>

      {showCreateUser && (
        <CreateUserDialog
          isSubmitting={isSubmitting}
          onClose={() => setShowCreateUser(false)}
          onSubmit={(username, password) => void runAction(
            () => createUser(session.accessToken, username, password),
            `用户 ${username} 已创建`,
          )}
        />
      )}

      {selectedUser && userAction && (
        <UserActionDialog
          action={userAction}
          currentRole={role}
          user={selectedUser}
          isSubmitting={isSubmitting}
          onClose={() => {
            setSelectedUser(null)
            setUserAction(null)
          }}
          onRole={(nextRole) => void runAction(
            () => changeUserRole(session.accessToken, selectedUser.id, nextRole),
            '用户角色已更新',
          )}
          onLevel={(level, expireTime) => void runAction(
            () => changeUserLevel(session.accessToken, selectedUser.id, level, new Date(expireTime).toISOString()),
            '会员等级已更新',
          )}
          onPassword={(password) => void runAction(
            () => changeUserPassword(session.accessToken, selectedUser.id, password),
            '用户密码已重置',
          )}
          onDelete={() => void runAction(
            () => deleteUser(session.accessToken, selectedUser.id),
            `用户 ${selectedUser.name} 已删除`,
          )}
        />
      )}

      {showCardBatch && (
        <CardBatchDialog
          mode={canReviewCards ? 'generate' : 'apply'}
          isSubmitting={isSubmitting}
          onClose={() => setShowCardBatch(false)}
          onSubmit={(input) => void runAction(
            () => canReviewCards ? generateCards(session.accessToken, input) : applyForCards(session.accessToken, input),
            canReviewCards ? '卡密已生成' : '卡密申请已提交',
          )}
        />
      )}
    </section>
  )
}

function UsersTable({ users, currentUser, onAction }: {
  users: User[]
  currentUser: User
  onAction: (user: User, action: UserAction) => void
}) {
  if (users.length === 0) return <EmptyState icon="group_off" title="没有匹配用户" detail="调整搜索条件后重试" />

  function canChangeRole(user: User) {
    if (currentUser.role === 0) return user.role !== 0
    if (currentUser.role === 1) return ![0, 1].includes(user.role)
    return false
  }

  function canManage(user: User) {
    if (user.id === currentUser.id || user.role === 0) return false
    if (currentUser.role === 1 && user.role === 1) return false
    if (currentUser.role === 2) return user.role === 3 && user.created_by === currentUser.id
    return true
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>ID</th><th>用户</th><th>角色</th><th>会员</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td className="admin-mono">#{user.id}</td>
              <td><strong>{user.name}</strong>{user.id === currentUser.id && <small>当前账号</small>}</td>
              <td><span className={`admin-role admin-role--${user.role}`}>{roleLabels[user.role] || `角色 ${user.role}`}</span></td>
              <td><span className="admin-level">L{user.member_level}</span></td>
              <td>{formatDate(user.create_time)}</td>
              <td>
                <div className="admin-row-actions">
                  {canChangeRole(user) && <button type="button" onClick={() => onAction(user, 'role')} title="修改角色"><Icon name="admin_panel_settings" /></button>}
                  {canManage(user) && <button type="button" onClick={() => onAction(user, 'level')} title="修改会员"><Icon name="workspace_premium" /></button>}
                  {canManage(user) && <button type="button" onClick={() => onAction(user, 'password')} title="重置密码"><Icon name="key" /></button>}
                  {canManage(user) && <button className="admin-row-action--danger" type="button" onClick={() => onAction(user, 'delete')} title="删除用户"><Icon name="delete" /></button>}
                  {!canManage(user) && !canChangeRole(user) && <span className="admin-no-action">不可操作</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CardsArea({ cards, requests, view, canReview, isSubmitting, onViewChange, onCopy, onDisable, onReview }: {
  cards: AdminCard[]
  requests: CardRequest[]
  view: CardView
  canReview: boolean
  isSubmitting: boolean
  onViewChange: (view: CardView) => void
  onCopy: (code: string) => void
  onDisable: (id: number) => void
  onReview: (id: number, approved: boolean) => void
}) {
  return (
    <>
      <div className="admin-subtabs">
        <button className={view === 'cards' ? 'admin-subtab--active' : ''} type="button" onClick={() => onViewChange('cards')}>卡密列表 <span>{cards.length}</span></button>
        <button className={view === 'requests' ? 'admin-subtab--active' : ''} type="button" onClick={() => onViewChange('requests')}>申请记录 <span>{requests.length}</span></button>
      </div>
      {view === 'cards' ? (
        cards.length === 0 ? <EmptyState icon="confirmation_number" title="暂无卡密" detail="生成或申请卡密后会显示在这里" /> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>ID</th><th>卡密</th><th>会员</th><th>有效期</th><th>状态</th><th>持有人</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>{cards.map((card) => (
                <tr key={card.id}>
                  <td className="admin-mono">#{card.id}</td>
                  <td><code className="admin-card-code">{card.code}</code></td>
                  <td><span className="admin-level">L{card.member_level}</span></td>
                  <td>{card.valid_days} 天</td>
                  <td><span className={`admin-status admin-status--${card.status}`}>{statusLabels[card.status] || card.status}</span></td>
                  <td className="admin-mono">#{card.owner_id}</td>
                  <td>{formatDate(card.create_time)}</td>
                  <td><div className="admin-row-actions">
                    <button type="button" onClick={() => onCopy(card.code)} title="复制卡密"><Icon name="content_copy" /></button>
                    {canReview && card.status === 'unused' && <button className="admin-row-action--danger" type="button" disabled={isSubmitting} onClick={() => onDisable(card.id)} title="禁用卡密"><Icon name="block" /></button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )
      ) : requests.length === 0 ? <EmptyState icon="inbox" title="暂无申请" detail="代理提交的卡密申请会显示在这里" /> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>ID</th><th>代理</th><th>会员</th><th>有效期</th><th>数量</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead>
            <tbody>{requests.map((request) => (
              <tr key={request.id}>
                <td className="admin-mono">#{request.id}</td>
                <td className="admin-mono">#{request.agent_id}</td>
                <td><span className="admin-level">L{request.member_level}</span></td>
                <td>{request.valid_days} 天</td>
                <td>{request.count}</td>
                <td><span className={`admin-status admin-status--${request.status}`}>{statusLabels[request.status] || request.status}</span></td>
                <td>{formatDate(request.create_time)}</td>
                <td>{canReview && request.status === 'pending' ? <div className="admin-review-actions">
                  <button type="button" disabled={isSubmitting} onClick={() => onReview(request.id, true)}><Icon name="check" />通过</button>
                  <button type="button" disabled={isSubmitting} onClick={() => onReview(request.id, false)}><Icon name="close" />拒绝</button>
                </div> : <span className="admin-no-action">已处理</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  )
}

function RecordsTable({ records }: { records: UserRecord[] }) {
  if (records.length === 0) return <EmptyState icon="receipt_long" title="暂无操作记录" detail="管理操作完成后会记录在这里" />
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-records-table">
        <thead><tr><th>时间</th><th>操作人</th><th>目标用户</th><th>动作</th><th>记录</th></tr></thead>
        <tbody>{records.map((record) => (
          <tr key={record.id}>
            <td>{formatDate(record.time)}</td>
            <td><strong>{record.admin_name}</strong><small className="admin-mono">#{record.admin_id}</small></td>
            <td>{record.user_name}<small className="admin-mono">#{record.target_id}</small></td>
            <td><code>{record.action}</code></td>
            <td>{record.records}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function CreateUserDialog({ isSubmitting, onClose, onSubmit }: {
  isSubmitting: boolean
  onClose: () => void
  onSubmit: (username: string, password: string) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return (
    <AdminDialog title="创建普通用户" onClose={onClose}>
      <form className="admin-form" onSubmit={(event) => {
        event.preventDefault()
        onSubmit(username.trim(), password)
      }}>
        <label><span>用户名</span><input required maxLength={50} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入用户名" /></label>
        <label><span>初始密码</span><input required minLength={10} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="10 至 72 位密码" type="password" /></label>
        <div className="admin-dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="admin-dialog-primary" type="submit" disabled={isSubmitting}>创建用户</button></div>
      </form>
    </AdminDialog>
  )
}

function UserActionDialog({ action, currentRole, user, isSubmitting, onClose, onRole, onLevel, onPassword, onDelete }: {
  action: UserAction
  currentRole: number
  user: User
  isSubmitting: boolean
  onClose: () => void
  onRole: (role: number) => void
  onLevel: (level: number, expireTime: string) => void
  onPassword: (password: string) => void
  onDelete: () => void
}) {
  const [role, setRole] = useState(user.role)
  const [level, setLevel] = useState(user.member_level)
  const [expireTime, setExpireTime] = useState(futureLocalDate())
  const [password, setPassword] = useState('')
  const roleOptions = currentRole === 0 ? [1, 2, 3, 4] : [2, 3, 4]
  const titles: Record<UserAction, string> = { role: '修改用户角色', level: '修改会员等级', password: '重置用户密码', delete: '删除用户' }

  return (
    <AdminDialog title={titles[action]} onClose={onClose}>
      <form className="admin-form" onSubmit={(event: FormEvent) => {
        event.preventDefault()
        if (action === 'role') onRole(role)
        if (action === 'level') onLevel(level, expireTime)
        if (action === 'password') onPassword(password)
        if (action === 'delete') onDelete()
      }}>
        <div className="admin-dialog-subject"><Icon name="person" /><span><strong>{user.name}</strong><small>用户 ID #{user.id}</small></span></div>
        {action === 'role' && <label><span>角色</span><select value={role} onChange={(event) => setRole(Number(event.target.value))}>{roleOptions.map((value) => <option value={value} key={value}>{roleLabels[value]}</option>)}</select></label>}
        {action === 'level' && <><label><span>会员等级</span><input min="0" type="number" value={level} onChange={(event) => setLevel(Number(event.target.value))} /></label><label><span>到期时间</span><input required type="datetime-local" value={expireTime} onChange={(event) => setExpireTime(event.target.value)} /></label></>}
        {action === 'password' && <label><span>新密码</span><input required minLength={10} maxLength={72} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="10 至 72 位密码" /></label>}
        {action === 'delete' && <p className="admin-delete-warning">删除后该用户将无法登录，关联记录会保留用户 ID。此操作不可撤销。</p>}
        <div className="admin-dialog-actions"><button type="button" onClick={onClose}>取消</button><button className={action === 'delete' ? 'admin-dialog-danger' : 'admin-dialog-primary'} type="submit" disabled={isSubmitting}>{action === 'delete' ? '确认删除' : '保存修改'}</button></div>
      </form>
    </AdminDialog>
  )
}

function CardBatchDialog({ mode, isSubmitting, onClose, onSubmit }: {
  mode: 'generate' | 'apply'
  isSubmitting: boolean
  onClose: () => void
  onSubmit: (input: CardBatchInput) => void
}) {
  const [level, setLevel] = useState(1)
  const [days, setDays] = useState(30)
  const [count, setCount] = useState(1)
  return (
    <AdminDialog title={mode === 'generate' ? '生成卡密' : '申请卡密'} onClose={onClose}>
      <form className="admin-form" onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ member_level: level, valid_days: days, count })
      }}>
        <div className="admin-form-grid"><label><span>会员等级</span><input min="1" required type="number" value={level} onChange={(event) => setLevel(Number(event.target.value))} /></label><label><span>有效天数</span><input min="1" max="3650" required type="number" value={days} onChange={(event) => setDays(Number(event.target.value))} /></label><label><span>数量</span><input min="1" max="100" required type="number" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label></div>
        <p className="admin-form-note">单次最多 100 个，有效期最长 3650 天。</p>
        <div className="admin-dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="admin-dialog-primary" type="submit" disabled={isSubmitting}>{mode === 'generate' ? '生成卡密' : '提交申请'}</button></div>
      </form>
    </AdminDialog>
  )
}
