import { useEffect, useId, useRef, useState } from 'react'
import './App.css'
import { ApiError, getCurrentUser, setUnauthorizedHandler } from './api/auth'
import {
  cleanAnswerText,
  formatPaperAsText,
  getHomeworkDetail,
  getHomeworkList,
  getPlatformAccount,
  getTaskStatus,
  startParseHomework,
  type HomeworkItem,
  type Paper,
  type PlatformAccountInfo,
  type Question,
  type Section,
} from './api/homework'
import AuthGate from './auth/AuthGate'
import Callback from './auth/Callback'
import { oauthConfig } from './auth/config'
import { startAuthorization } from './auth/oauth'
import type { AuthSession } from './auth/types'
import { transitionRoute, transitionTo } from './navigation/controller'

type Page = '/' | '/history' | '/settings'
type Status = 'parsed' | 'parsing' | 'unread'

const logoSrc = '/fe_logo.png'
const assignmentPanelStorageKey = 'fe-web.assignment-panel-open'
const skipRiskWarningStorageKey = 'fe-web.skip-risk-warning'

const navigationItems: { icon: string; label: string; page: Page }[] = [
  { icon: 'assignment', label: '当前作业', page: '/' },
  { icon: 'history', label: '历史作业', page: '/history' },
  { icon: 'settings', label: '设置', page: '/settings' },
]

function Icon({ name, className = '', filled = false }: { name: string; className?: string; filled?: boolean }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}

function readStoredAssignmentPanelState() {
  const stored = window.localStorage.getItem(assignmentPanelStorageKey)
  return stored === null ? !window.matchMedia('(max-width: 760px)').matches : stored !== 'false'
}

function readStoredSkipRiskWarning() {
  return window.localStorage.getItem(skipRiskWarningStorageKey) === 'true'
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return dateStr
  }
}

function isMatchingOption(option: string, answers: string[]): boolean {
  if (!answers || answers.length === 0) return false
  const trimmedOpt = option.trim()
  const optLetter = trimmedOpt.match(/^([A-Za-z])[.\s]/)?.[1]?.toUpperCase()

  for (const ans of answers) {
    const trimmedAns = cleanAnswerText(ans).trim()
    const ansLetter = trimmedAns.match(/^([A-Za-z])[.\s]?/)?.[1]?.toUpperCase()

    if (ansLetter && optLetter && ansLetter === optLetter) return true
    if (trimmedAns.length === 1 && optLetter && trimmedAns.toUpperCase() === optLetter) return true
    if (trimmedAns && (trimmedOpt === trimmedAns || trimmedOpt.includes(trimmedAns) || trimmedAns.includes(trimmedOpt))) {
      return true
    }
  }
  return false
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
        未解析
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

function RiskWarningModal({
  homework,
  onConfirm,
  onCancel,
}: {
  homework: HomeworkItem
  onConfirm: (rememberSkip: boolean) => void
  onCancel: () => void
}) {
  const [remember, setRemember] = useState(false)
  const rememberId = useId()

  return (
    <div className="risk-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="risk-modal-title">
      <div className="risk-modal-card">
        <div className="risk-modal-head">
          <div className="risk-icon-wrap">
            <Icon name="warning" filled />
          </div>
          <div>
            <h2 id="risk-modal-title">顶号与作业解析风险提示</h2>
            <p className="risk-modal-subtitle">作业：{homework.name}</p>
          </div>
        </div>
        <div className="risk-modal-body">
          <p>
            由于 ETS100 平台的单点在线机制，当网页端通过大陆节点下载作业资源包时，
            系统会使用您的 ETS100 登录会话与云端交互。
          </p>
          <div className="risk-alert-box">
            <strong>⚠️ 注意事项：</strong>
            <ul>
              <li>如果您的手机或平板端 ETS100 <strong>当前正在答题、录音或考试中</strong>，解析可能导致移动端被挤下线（顶号）。</li>
              <li>建议您在<strong>完成移动端作答后</strong>再在网页端进行作业解析与答案查看。</li>
              <li>如无正在进行的移动端考试，可放心继续。</li>
            </ul>
          </div>
          <label className="risk-modal-checkbox" htmlFor={rememberId}>
            <input
              id={rememberId}
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>记住选择（本次浏览器环境不再弹出此提示）</span>
          </label>
        </div>
        <div className="risk-modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={() => onConfirm(remember)}>
            我已知晓，开始解析
          </button>
        </div>
      </div>
    </div>
  )
}

function AssignmentPanel({
  isOpen,
  activePage,
  accountInfo,
  homeworks,
  selectedId,
  parsingId,
  homeworkError,
  onClose,
  onNavigate,
  onToggle,
  onSelectHomework,
  onRetry,
}: {
  isOpen: boolean
  activePage: Page
  accountInfo: PlatformAccountInfo | null
  homeworks: HomeworkItem[]
  selectedId: string | null
  parsingId: string | null
  homeworkError?: string | null
  onClose: () => void
  onNavigate: (page: Page, closePanel?: boolean) => void
  onToggle: () => void
  onSelectHomework: (item: HomeworkItem) => void
  onRetry?: () => void
}) {
  const [query, setQuery] = useState('')

  const filtered = homeworks.filter((hw) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      hw.name.toLowerCase().includes(q) ||
      (hw.subject_name && hw.subject_name.toLowerCase().includes(q))
    )
  })

  const pendingList = filtered.filter((h) => !h.parsed && h.id !== parsingId)
  const parsingList = filtered.filter((h) => h.id === parsingId)
  const parsedList = filtered.filter((h) => h.parsed && h.id !== parsingId)

  return (
    <>
      <section
        className={`assignment-panel ${isOpen ? 'assignment-panel--open' : 'assignment-panel--closed'}`}
        aria-label="作业列表"
      >
        <div className="assignment-panel__head">
          <div className="assignment-panel__title">
            <strong>作业索引</strong>
            <small>
              {accountInfo?.bound
                ? `账号: ${accountInfo.account_display || '已连接'} · 共 ${homeworks.length} 份`
                : '未绑定 ETS100 账号'}
            </small>
          </div>
          <button className="icon-button assignment-collapse" type="button" onClick={onToggle} aria-label="折叠作业列表">
            <Icon name="keyboard_double_arrow_left" />
          </button>
          <button className="icon-button assignment-close" type="button" onClick={onClose} aria-label="关闭作业列表">
            <Icon name="close" />
          </button>
        </div>
        <div className="search-row">
          <label className="search-box">
            <Icon name="search" />
            <input
              placeholder="搜索作业名称或学科..."
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="assignment-list">
          {homeworkError ? (
            <div className="panel-empty-alert panel-empty-alert--error">
              <Icon name="error_outline" />
              <p>{homeworkError}</p>
              {onRetry && (
                <button type="button" className="panel-action-btn" onClick={onRetry}>
                  重新加载
                </button>
              )}
            </div>
          ) : !accountInfo?.bound ? (
            <div className="panel-empty-alert">
              <Icon name="no_accounts" />
              <p>尚未绑定 ETS100 账号</p>
              <a href="https://lastudio.cc/account" target="_blank" rel="noreferrer" className="panel-action-btn">
                前往账号中心绑定
              </a>
            </div>
          ) : homeworks.length === 0 ? (
            <div className="panel-empty-alert">
              <Icon name="inbox" />
              <p>暂无当前作业</p>
            </div>
          ) : (
            <>
              {parsingList.length > 0 && (
                <details className="assignment-group" open>
                  <summary>
                    <span>正在解析 ({parsingList.length})</span>
                    <Icon name="keyboard_arrow_down" />
                  </summary>
                  <div className="assignment-group__items">
                    {parsingList.map((item) => (
                      <button
                        className={`assignment-card ${item.id === selectedId ? 'assignment-card--selected' : ''}`}
                        type="button"
                        onClick={() => {
                          onSelectHomework(item)
                          onClose()
                        }}
                        key={item.id}
                      >
                        <span className="assignment-card__rail" />
                        <span className="assignment-card__head">
                          <span className="assignment-card__title">{item.name}</span>
                          <span className="assignment-card__time assignment-card__time--new">
                            {formatTime(item.end_time || item.create_time)}
                          </span>
                        </span>
                        <span className="assignment-card__meta">
                          <span>{item.subject_name || '英语'}</span>
                          <StatusPill status="parsing" />
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              )}

              {pendingList.length > 0 && (
                <details className="assignment-group" open>
                  <summary>
                    <span>待解析作业 ({pendingList.length})</span>
                    <Icon name="keyboard_arrow_down" />
                  </summary>
                  <div className="assignment-group__items">
                    {pendingList.map((item) => (
                      <button
                        className={`assignment-card ${item.id === selectedId ? 'assignment-card--selected' : ''}`}
                        type="button"
                        onClick={() => {
                          onSelectHomework(item)
                          onClose()
                        }}
                        key={item.id}
                      >
                        <span className="assignment-card__rail" />
                        <span className="assignment-card__head">
                          <span className="assignment-card__title">{item.name}</span>
                          <span className="assignment-card__time">
                            {formatTime(item.end_time || item.create_time)}
                          </span>
                        </span>
                        <span className="assignment-card__meta">
                          <span>{item.subject_name || '英语'}</span>
                          <StatusPill status="unread" />
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              )}

              {parsedList.length > 0 && (
                <details className="assignment-group" open>
                  <summary>
                    <span>已解析作业 ({parsedList.length})</span>
                    <Icon name="keyboard_arrow_down" />
                  </summary>
                  <div className="assignment-group__items">
                    {parsedList.map((item) => (
                      <button
                        className={`assignment-card ${item.id === selectedId ? 'assignment-card--selected' : ''}`}
                        type="button"
                        onClick={() => {
                          onSelectHomework(item)
                          onClose()
                        }}
                        key={item.id}
                      >
                        <span className="assignment-card__rail" />
                        <span className="assignment-card__head">
                          <span className="assignment-card__title">{item.name}</span>
                          <span className="assignment-card__time">
                            {formatTime(item.end_time || item.create_time)}
                          </span>
                        </span>
                        <span className="assignment-card__meta">
                          <span>{item.subject_name || '英语'}</span>
                          <StatusPill status="parsed" />
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
        <nav className="mobile-drawer-menu" aria-label="移动端主导航">
          {navigationItems.map((item) => (
            <button
              className={`side-link ${activePage === item.page ? 'side-link--active' : ''}`}
              type="button"
              onClick={() => onNavigate(item.page, true)}
              key={item.page}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
      </section>
      {!isOpen && (
        <button className="assignment-rail" type="button" onClick={onToggle} aria-label="展开作业列表">
          <Icon name="keyboard_double_arrow_right" />
          <span>作业</span>
        </button>
      )}
    </>
  )
}

function QuestionItem({ question }: { question: Question }) {
  return (
    <section className="question-block">
      <div className="question-heading">
        <span className="question-number">{String(question.order).padStart(2, '0')}</span>
        <h2>{question.questionText || question.typeName || `第 ${question.order} 题`}</h2>
        <span className="type-mark">{question.typeName}</span>
      </div>

      {question.originalText && (
        <div className="reading-passage">
          <div className="reading-passage__title">
            <Icon name="menu_book" /> 原文 / 听力材料
          </div>
          <p>{cleanAnswerText(question.originalText)}</p>
        </div>
      )}

      {question.options && question.options.length > 0 && (
        <div className="options">
          {question.options.map((option, idx) => {
            const isCorrect = isMatchingOption(option, question.answers)
            return (
              <div
                className={`option ${isCorrect ? 'option--correct' : ''}`}
                key={`${question.order}-opt-${idx}`}
              >
                <span className="option__indicator">
                  {isCorrect ? <Icon name="check_circle" filled /> : <span className="option__dot" />}
                </span>
                <span className="option__text">{option}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="answer-box">
        <h3>
          <Icon name="check_circle" filled />
          参考答案
        </h3>
        <div className="answer-box__content">
          {question.answers && question.answers.length > 0 ? (
            question.answers.map((ans, aIdx) => (
              <div className="answer-line" key={aIdx}>
                {question.answers.length > 1 && <span className="answer-index">({aIdx + 1})</span>}
                <span className="answer-text">{cleanAnswerText(ans)}</span>
              </div>
            ))
          ) : (
            <p className="no-answer">暂无标准文本答案</p>
          )}

          {question.important && question.important.length > 0 && (
            <div className="keywords-box">
              <span className="keywords-label">得分关键词:</span>
              <div className="keywords-tags">
                {question.important.map((kw, kwIdx) => (
                  <span className="keyword-tag" key={kwIdx}>
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="review-stamp" aria-hidden="true">
        <Icon name="verified" />
        <span>Fe 解析核对</span>
      </div>
    </section>
  )
}

function SectionGroup({ section }: { section: Section }) {
  if (!section.questions || section.questions.length === 0) return null
  return (
    <div className="section-group">
      <div className="section-header">
        <h3>{section.caption || section.typeName || '试题部分'}</h3>
        <span className="section-count">{section.questions.length} 题</span>
      </div>
      <div className="section-questions">
        {section.questions.map((q) => (
          <QuestionItem question={q} key={q.order} />
        ))}
      </div>
    </div>
  )
}

function CurrentAssignmentPage({
  accountInfo,
  selectedHomework,
  paper,
  isLoadingPaper,
  parsingMessage,
  homeworkError,
  onOpenAssignments,
  onRequestParse,
  onCopyAnswer,
  onExportAnswer,
  onRetry,
}: {
  accountInfo: PlatformAccountInfo | null
  selectedHomework: HomeworkItem | null
  paper: Paper | null
  isLoadingPaper: boolean
  parsingMessage: string | null
  homeworkError?: string | null
  onOpenAssignments: () => void
  onRequestParse: (hw: HomeworkItem) => void
  onCopyAnswer: () => void
  onExportAnswer: () => void
  onRetry?: () => void
}) {
  if (!accountInfo?.bound) {
    return (
      <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
        <div className="reader-toolbar">
          <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
            <Icon name="menu" />
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="link_off" />
          </div>
          <h2>未绑定 ETS100 账号</h2>
          <p>请先在官网账号中心绑定您的 ETS100 手机号与密码，绑定完成后即可在此快速查看与解析作业。</p>
          <a href="https://lastudio.cc/account" target="_blank" rel="noreferrer" className="primary-button-link">
            <Icon name="open_in_new" /> 前往账号中心绑定
          </a>
        </div>
      </section>
    )
  }

  if (parsingMessage) {
    return (
      <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
        <div className="reader-toolbar">
          <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
            <Icon name="menu" />
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon spinning">
            <Icon name="sync" />
          </div>
          <h2>正在解析作业</h2>
          <p>{parsingMessage}</p>
          <div className="parse-progress-steps">
            <span className="step-item step-item--active">
              <Icon name="cloud_download" /> 大陆节点下载资源包
            </span>
            <span className="step-divider">→</span>
            <span className="step-item step-item--active">
              <Icon name="code" /> 提取加密 JSON
            </span>
            <span className="step-divider">→</span>
            <span className="step-item step-item--active">
              <Icon name="memory" /> Rust 核心解析引擎
            </span>
          </div>
        </div>
      </section>
    )
  }

  if (isLoadingPaper) {
    return (
      <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
        <div className="reader-toolbar">
          <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
            <Icon name="menu" />
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon spinning">
            <Icon name="hourglass_top" />
          </div>
          <h2>正在加载试卷详情...</h2>
        </div>
      </section>
    )
  }

  if (selectedHomework && !selectedHomework.parsed && !paper) {
    return (
      <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
        <div className="reader-toolbar">
          <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
            <Icon name="menu" />
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="description" />
          </div>
          <h2>{selectedHomework.name}</h2>
          <p>
            学科：{selectedHomework.subject_name || '英语'} · 截止：
            {formatTime(selectedHomework.end_time || selectedHomework.create_time)}
          </p>
          <p className="empty-state__hint">该作业尚未解析答案，点击下方按钮开始云端快速解析。</p>
          <button
            className="primary-button parse-action-btn"
            type="button"
            onClick={() => onRequestParse(selectedHomework)}
          >
            <Icon name="bolt" /> 发起云端解析
          </button>
        </div>
      </section>
    )
  }

  if (homeworkError && !selectedHomework) {
    return (
      <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
        <div className="reader-toolbar">
          <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
            <Icon name="menu" />
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="error_outline" />
          </div>
          <h2>无法获取作业列表</h2>
          <p>{homeworkError}</p>
          <p className="empty-state__hint">请确认在 E听说客户端中是否加入了有效班级，或在设置中点击重新同步。</p>
          {onRetry && (
            <button className="primary-button" type="button" onClick={onRetry}>
              <Icon name="refresh" /> 重新尝试
            </button>
          )}
        </div>
      </section>
    )
  }

  if (!paper) {
    return (
      <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
        <div className="reader-toolbar">
          <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
            <Icon name="menu" />
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="auto_stories" />
          </div>
          <h2>请选择作业</h2>
          <p>从左侧“作业索引”中点击一份作业以查看或解析答案。</p>
          <button className="secondary-button" type="button" onClick={onOpenAssignments}>
            <Icon name="list" /> 查看作业索引
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="reader-panel page-surface-enter" aria-label="答案阅读器">
      <div className="reader-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
          <Icon name="menu" />
        </button>
        <button type="button" onClick={onCopyAnswer} title="复制格式化答案文本到剪贴板">
          <Icon name="content_copy" />
          复制答案
        </button>
        <button type="button" onClick={onExportAnswer} title="导出 TXT 文件到本地">
          <Icon name="download" />
          导出 TXT
        </button>
        {selectedHomework && (
          <button
            type="button"
            onClick={() => onRequestParse(selectedHomework)}
            title="强制重新从大陆节点提取并解析"
          >
            <Icon name="refresh" />
            重新解析
          </button>
        )}
      </div>
      <article className="answer-paper">
        <header className="answer-paper__head">
          <span className="paper-kicker">已解析 · 共 {paper.totalQuestions} 题</span>
          <h1>{paper.title || paper.paperName}</h1>
          <div className="paper-meta">
            <span>地区 / 模式: {paper.regionLabel || '云端解析'}</span>
            <span>题目数: {paper.totalQuestions} 题</span>
          </div>
        </header>

        <div className="answer-paper__content">
          {paper.sections.map((section, idx) => (
            <SectionGroup section={section} key={idx} />
          ))}
        </div>
      </article>
    </section>
  )
}

function HistoryPage({
  historyHomeworks,
  isLoading,
  onOpenAssignments,
  onSelectHomework,
}: {
  historyHomeworks: HomeworkItem[]
  isLoading: boolean
  onOpenAssignments: () => void
  onSelectHomework: (item: HomeworkItem) => void
}) {
  return (
    <section className="page-panel page-surface-enter" aria-label="历史作业">
      <div className="page-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
          <Icon name="menu" />
        </button>
      </div>
      <div className="page-panel__inner">
        <div className="page-head-row">
          <h1>历史作业</h1>
          <span className="page-head-badge">{historyHomeworks.length} 份记录</span>
        </div>
        {isLoading ? (
          <div className="history-empty">正在拉取历史作业记录...</div>
        ) : historyHomeworks.length === 0 ? (
          <div className="history-empty">暂无已归档的历史作业</div>
        ) : (
          <div className="history-list">
            {historyHomeworks.map((hw) => (
              <button
                className="history-item"
                type="button"
                onClick={() => onSelectHomework(hw)}
                key={hw.id}
              >
                <span>
                  <strong>{hw.name}</strong>
                  <small>
                    {hw.subject_name || '英语'} · 截止: {formatTime(hw.end_time || hw.create_time)}
                  </small>
                </span>
                <div className="history-item__right">
                  <StatusPill status={hw.parsed ? 'parsed' : 'unread'} />
                  <Icon name="chevron_right" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function SettingsPage({
  accountInfo,
  onOpenAssignments,
  onRefreshSession,
}: {
  accountInfo: PlatformAccountInfo | null
  onOpenAssignments: () => void
  onRefreshSession: () => void
}) {
  const [skipRisk, setSkipRisk] = useState(readStoredSkipRiskWarning)

  function toggleSkipRisk() {
    const next = !skipRisk
    setSkipRisk(next)
    window.localStorage.setItem(skipRiskWarningStorageKey, String(next))
  }

  return (
    <section className="page-panel page-surface-enter" aria-label="设置">
      <div className="page-toolbar">
        <button className="mobile-assignment-toggle" type="button" onClick={onOpenAssignments} aria-label="打开作业列表">
          <Icon name="menu" />
        </button>
      </div>
      <div className="page-panel__inner">
        <h1>设置与账号</h1>

        <div className="settings-section">
          <h2>ETS100 账号状态</h2>
          <div className="account-info-card">
            <div className="account-info-card__row">
              <span className="account-label">绑定状态</span>
              <span className={`account-status-badge ${accountInfo?.bound ? 'account-status-badge--ok' : 'account-status-badge--none'}`}>
                {accountInfo?.bound ? '已绑定' : '未绑定'}
              </span>
            </div>
            {accountInfo?.bound && (
              <>
                <div className="account-info-card__row">
                  <span className="account-label">ETS100 手机号</span>
                  <strong>{accountInfo.account_display || '未知'}</strong>
                </div>
                {accountInfo.profile && (
                  <>
                    {(accountInfo.profile as Record<string, unknown>).name ? (
                      <div className="account-info-card__row">
                        <span className="account-label">学生姓名</span>
                        <span>{String((accountInfo.profile as Record<string, unknown>).name)}</span>
                      </div>
                    ) : null}
                    {(accountInfo.profile as Record<string, unknown>).school_name ? (
                      <div className="account-info-card__row">
                        <span className="account-label">学校</span>
                        <span>{String((accountInfo.profile as Record<string, unknown>).school_name)}</span>
                      </div>
                    ) : null}
                    {(accountInfo.profile as Record<string, unknown>).class_name ? (
                      <div className="account-info-card__row">
                        <span className="account-label">班级</span>
                        <span>{String((accountInfo.profile as Record<string, unknown>).class_name)}</span>
                      </div>
                    ) : null}
                    {(accountInfo.profile as Record<string, unknown>).grade ? (
                      <div className="account-info-card__row">
                        <span className="account-label">年级</span>
                        <span>{String((accountInfo.profile as Record<string, unknown>).grade)}</span>
                      </div>
                    ) : null}
                  </>
                )}
                {accountInfo.last_used_at && (
                  <div className="account-info-card__row">
                    <span className="account-label">上次使用时间</span>
                    <span>{formatTime(accountInfo.last_used_at)}</span>
                  </div>
                )}
              </>
            )}
            <div className="account-info-card__actions">
              <a href="https://lastudio.cc/account" target="_blank" rel="noreferrer" className="secondary-button-link">
                前往官网账号中心管理
              </a>
              <button className="secondary-button" type="button" onClick={onRefreshSession}>
                重新检测绑定
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h2>偏好设置</h2>
          <div className="settings-list">
            <label>
              <span>
                <strong>跳过顶号风险提示</strong>
                <small>发起作业解析时直接开始，不再弹出防顶号警告弹窗</small>
              </span>
              <input type="checkbox" checked={skipRisk} onChange={toggleSkipRisk} />
            </label>
            <label>
              <span>
                <strong>答案高亮</strong>
                <small>选择题选项自动标记标准答案并高亮显示</small>
              </span>
              <input type="checkbox" defaultChecked />
            </label>
          </div>
        </div>
      </div>
    </section>
  )
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

  // ETS100 & Homework State
  const [accountInfo, setAccountInfo] = useState<PlatformAccountInfo | null>(null)
  const [homeworks, setHomeworks] = useState<HomeworkItem[]>([])
  const [historyHomeworks, setHistoryHomeworks] = useState<HomeworkItem[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [selectedHomework, setSelectedHomework] = useState<HomeworkItem | null>(null)
  const [currentPaper, setCurrentPaper] = useState<Paper | null>(null)
  const [isLoadingPaper, setIsLoadingPaper] = useState(false)
  const [parsingId, setParsingId] = useState<string | null>(null)
  const [parsingMessage, setParsingMessage] = useState<string | null>(null)
  const [showRiskModal, setShowRiskModal] = useState<HomeworkItem | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [homeworkError, setHomeworkError] = useState<string | null>(null)

  const pollingTimerRef = useRef<number | null>(null)

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
    return () => {
      active = false
    }
  }, [page, session])

  useEffect(() => {
    if (!page || session || authMessage || authorizationStarted.current || pathname === '/auth/callback') return
    authorizationStarted.current = true
    void startAuthorization(page).catch((error: unknown) => {
      authorizationStarted.current = false
      setAuthMessage(error instanceof Error ? error.message : '无法连接统一认证，请稍后重试。')
    })
  }, [authMessage, page, pathname, session])

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current)
      }
    }
  }, [])

  // Auto hide toast after 3 seconds
  useEffect(() => {
    if (!toastMessage) return
    const timer = window.setTimeout(() => {
      setToastMessage(null)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  // Fetch account status & homeworks once authenticated
  useEffect(() => {
    if (!session) return
    let active = true

    getPlatformAccount(session.accessToken)
      .then(async (account) => {
        if (!active) return
        setAccountInfo(account)

        if (account.bound) {
          try {
            const res = await getHomeworkList(session.accessToken, '1')
            if (!active) return
            setHomeworkError(null)
            setHomeworks(res.homeworks || [])
            const parsedFirst = res.homeworks.find((h) => h.parsed)
            if (parsedFirst) {
              setSelectedHomework(parsedFirst)
              const detail = await getHomeworkDetail(session.accessToken, parsedFirst.id)
              if (!active) return
              setCurrentPaper(detail)
            }
          } catch (err) {
            if (!active) return
            const msg = err instanceof Error ? err.message : '获取作业列表失败'
            console.error('Failed to load homework data:', err)
            setHomeworkError(msg)
          }
        }
      })
      .catch((err) => {
        if (!active) return
        console.error('Failed to load account data:', err)
        setHomeworkError(err instanceof Error ? err.message : '加载账号信息失败')
      })

    return () => {
      active = false
    }
  }, [session])

  // Fetch history assignments when opening /history
  useEffect(() => {
    if (!session || page !== '/history') return
    let active = true

    Promise.all([
      getHomeworkList(session.accessToken, '2').catch(() => ({ homeworks: [] })),
      getHomeworkList(session.accessToken, '3').catch(() => ({ homeworks: [] })),
    ])
      .then(([res2, res3]) => {
        if (!active) return
        setHistoryHomeworks([...(res2.homeworks || []), ...(res3.homeworks || [])])
      })
      .finally(() => {
        if (!active) return
        setIsLoadingHistory(false)
      })

    return () => {
      active = false
    }
  }, [page, session])

  function showToast(msg: string) {
    setToastMessage(msg)
  }

  async function loadPaperDetail(token: string, homeworkId: string) {
    setIsLoadingPaper(true)
    try {
      const detail = await getHomeworkDetail(token, homeworkId)
      setCurrentPaper(detail)
    } catch (err) {
      console.error('Failed to load paper detail:', err)
      setCurrentPaper(null)
    } finally {
      setIsLoadingPaper(false)
    }
  }

  function handleSelectHomework(item: HomeworkItem) {
    setSelectedHomework(item)
    if (item.parsed && session) {
      void loadPaperDetail(session.accessToken, item.id)
      if (page !== '/') {
        navigate('/')
      }
    } else {
      setCurrentPaper(null)
      if (page !== '/') {
        navigate('/')
      }
    }
  }

  function handleTriggerParse(item: HomeworkItem) {
    if (readStoredSkipRiskWarning()) {
      void executeParse(item)
    } else {
      setShowRiskModal(item)
    }
  }

  function handleRiskModalConfirm(rememberSkip: boolean) {
    if (rememberSkip) {
      window.localStorage.setItem(skipRiskWarningStorageKey, 'true')
    }
    const target = showRiskModal
    setShowRiskModal(null)
    if (target) {
      void executeParse(target)
    }
  }

  async function executeParse(item: HomeworkItem) {
    if (!session) return
    setParsingId(item.id)
    setParsingMessage('正在启动云端解析任务...')

    try {
      const resp = await startParseHomework(session.accessToken, {
        homework_id: item.id,
        homework_name: item.name,
        contents: item.contents,
      })

      if (resp.status === 'COMPLETED' && resp.result) {
        setParsingId(null)
        setParsingMessage(null)
        setCurrentPaper(resp.result)
        setHomeworks((prev) =>
          prev.map((h) => (h.id === item.id ? { ...h, parsed: true } : h))
        )
        showToast('解析完成！')
        return
      }

      if (resp.task_id) {
        const taskId = resp.task_id
        setParsingMessage('大陆节点正在提取加密数据...')

        if (pollingTimerRef.current) {
          window.clearInterval(pollingTimerRef.current)
        }

        pollingTimerRef.current = window.setInterval(async () => {
          try {
            const task = await getTaskStatus(session.accessToken, taskId)
            if (task.status === 'EXTRACTING') {
              setParsingMessage('大陆节点正在提取试卷资源包...')
            } else if (task.status === 'RESOLVING') {
              setParsingMessage('Rust 核心解析引擎正在解析答案...')
            } else if (task.status === 'COMPLETED') {
              if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current)
              setParsingId(null)
              setParsingMessage(null)
              if (task.result) {
                setCurrentPaper(task.result)
              } else {
                void loadPaperDetail(session.accessToken, item.id)
              }
              setHomeworks((prev) =>
                prev.map((h) => (h.id === item.id ? { ...h, parsed: true } : h))
              )
              showToast('解析完成！')
            } else if (task.status === 'FAILED') {
              if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current)
              setParsingId(null)
              setParsingMessage(null)
              showToast(`解析失败: ${task.error || '未知错误'}`)
            }
          } catch (err) {
            console.error('Task poll error:', err)
          }
        }, 1500)
      }
    } catch (err: unknown) {
      setParsingId(null)
      setParsingMessage(null)
      showToast(err instanceof Error ? err.message : '发起解析请求失败')
    }
  }

  async function handleCopyAnswer() {
    if (!currentPaper) return
    const text = formatPaperAsText(currentPaper)
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制格式化答案至剪贴板！')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      showToast('已复制格式化答案至剪贴板！')
    }
  }

  function handleExportAnswer() {
    if (!currentPaper) return
    const text = formatPaperAsText(currentPaper)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentPaper.title || currentPaper.paperName || '作业答案'}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('已导出答案 TXT 文件')
  }

  function refreshAccountAndHomeworks() {
    if (!session) return
    setHomeworkError(null)
    getPlatformAccount(session.accessToken)
      .then(async (account) => {
        setAccountInfo(account)
        if (account.bound) {
          try {
            const res = await getHomeworkList(session.accessToken, '1')
            setHomeworkError(null)
            setHomeworks(res.homeworks || [])
            showToast('已重新同步作业列表')
          } catch (err) {
            const msg = err instanceof Error ? err.message : '获取作业列表失败'
            console.error('Failed to refresh homework data:', err)
            setHomeworkError(msg)
            showToast(`作业列表同步失败: ${msg}`)
          }
        }
      })
      .catch((err) => {
        console.error('Failed to refresh data:', err)
        showToast('刷新失败，请稍后重试')
      })
  }

  function navigate(nextPage: Page, closePanel = false) {
    if (nextPage === '/history') {
      setIsLoadingHistory(true)
    }
    if (nextPage === window.location.pathname) {
      if (closePanel) setPanelOpen(false)
      return
    }
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
    return (
      <Callback
        onAuthenticated={(nextSession, returnTo) => {
          setSession(nextSession)
          transitionRoute(() => {
            window.history.replaceState(null, '', returnTo)
            setPathname(returnTo)
          })
        }}
        onFailure={(message) => {
          setAuthMessage(message)
          window.history.replaceState(null, '', '/')
          setPathname('/')
        }}
      />
    )
  }

  if (!page) {
    window.history.replaceState(null, '', '/')
    return <AuthGate message="页面不存在，请从作业工作台重新开始。" onAuthenticate={beginAuthentication} />
  }

  if (!session) {
    return authMessage ? (
      <AuthGate message={authMessage} onAuthenticate={beginAuthentication} />
    ) : (
      <main className="auth-callback">
        <p role="status">正在连接统一认证...</p>
      </main>
    )
  }

  return (
    <main className="workspace-shell">
      {toastMessage && (
        <div className="toast-notification" role="status">
          <Icon name="check_circle" filled />
          <span>{toastMessage}</span>
        </div>
      )}

      {showRiskModal && (
        <RiskWarningModal
          homework={showRiskModal}
          onConfirm={handleRiskModalConfirm}
          onCancel={() => setShowRiskModal(null)}
        />
      )}

      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src={logoSrc} alt="" aria-hidden="true" />
          <span>
            <strong>Fuck ets100</strong>
            <small>作业答案解析工作台</small>
          </span>
        </div>
        <div className="topbar__links">
          {accountInfo?.bound && (
            <span className="topbar-account-pill">
              <Icon name="account_circle" />
              {accountInfo.account_display}
            </span>
          )}
          <a href="https://lastudio.cc/account" target="_blank" rel="noreferrer">
            账号中心
            <Icon name="person" />
          </a>
          <a href="https://lastudio.cc/admin" target="_blank" rel="noreferrer">
            管理中心
            <Icon name="admin_panel_settings" />
          </a>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="side-nav">
          <nav className="side-nav__links" aria-label="主导航">
            {navigationItems.map((item) => (
              <button
                className={`side-link ${page === item.page ? 'side-link--active' : ''}`}
                type="button"
                onClick={() => navigate(item.page)}
                key={item.page}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-nav__footer">
            <button className="side-link" type="button" onClick={() => transitionTo(oauthConfig.logoutUrl)}>
              <Icon name="logout" />
              <span>退出登录</span>
            </button>
          </div>
        </aside>

        <AssignmentPanel
          isOpen={isAssignmentPanelOpen}
          activePage={page}
          accountInfo={accountInfo}
          homeworks={homeworks}
          selectedId={selectedHomework?.id || null}
          parsingId={parsingId}
          homeworkError={homeworkError}
          onClose={() => setPanelOpen(false)}
          onNavigate={navigate}
          onToggle={() => setPanelOpen(!isAssignmentPanelOpen)}
          onRetry={refreshAccountAndHomeworks}
          onSelectHomework={(item) => {
            handleSelectHomework(item)
            if (!item.parsed) {
              handleTriggerParse(item)
            }
          }}
        />

        {page === '/' && (
          <CurrentAssignmentPage
            accountInfo={accountInfo}
            selectedHomework={selectedHomework}
            paper={currentPaper}
            isLoadingPaper={isLoadingPaper}
            parsingMessage={parsingMessage}
            homeworkError={homeworkError}
            onOpenAssignments={() => setPanelOpen(true)}
            onRequestParse={handleTriggerParse}
            onCopyAnswer={handleCopyAnswer}
            onExportAnswer={handleExportAnswer}
            onRetry={refreshAccountAndHomeworks}
          />
        )}

        {page === '/history' && (
          <HistoryPage
            historyHomeworks={historyHomeworks}
            isLoading={isLoadingHistory}
            onOpenAssignments={() => setPanelOpen(true)}
            onSelectHomework={(item) => {
              handleSelectHomework(item)
              if (!item.parsed) {
                handleTriggerParse(item)
              }
            }}
          />
        )}

        {page === '/settings' && (
          <SettingsPage
            accountInfo={accountInfo}
            onOpenAssignments={() => setPanelOpen(true)}
            onRefreshSession={refreshAccountAndHomeworks}
          />
        )}
      </div>
    </main>
  )
}

export default App
