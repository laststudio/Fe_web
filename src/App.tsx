import { useEffect, useId, useRef, useState } from 'react'
import './App.css'
import { ApiError, getCurrentUser, setUnauthorizedHandler, type User } from './api/auth'
import {
  cleanAnswerText,
  formatPaperAsText,
  getHomeworkDetail,
  getHomeworkList,
  getPlatformAccount,
  getSoftwareConfig,
  getSoftwareFeatures,
  getTaskStatus,
  startParseHomework,
  type HomeworkItem,
  type Paper,
  type PlatformAccountInfo,
  type Question,
  type Section,
  type SoftwareConfig,
  type SoftwareFeatureItem,
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
const sidebarCollapsedStorageKey = 'fe-web.sidebar-collapsed'
const skipRiskWarningStorageKey = 'fe-web.skip-risk-warning'

type NavItem = {
  icon: string
  label: string
  caption: string
  page: Page
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: '作业业务',
    items: [
      { icon: 'assignment', label: '当前作业', caption: '作业索引与解析阅读器', page: '/' },
      { icon: 'history', label: '历史作业', caption: '已归档往期作业记录', page: '/history' },
    ],
  },
  {
    label: '系统与服务',
    items: [
      { icon: 'settings', label: '设置与账号', caption: 'ETS 账号与功能设置', page: '/settings' },
    ],
  },
]

const pageMeta: Record<Page, { title: string; caption: string }> = {
  '/': {
    title: '当前作业',
    caption: '获取与查看作业标准答案',
  },
  '/history': {
    title: '历史作业',
    caption: '往期归档试卷与答案速查',
  },
  '/settings': {
    title: '设置与账号',
    caption: '平台账号绑定、系统公告与功能设置',
  },
}

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

function readStoredSidebarCollapsed() {
  return window.localStorage.getItem(sidebarCollapsedStorageKey) === 'true'
}

function readStoredSkipRiskWarning() {
  return window.localStorage.getItem(skipRiskWarningStorageKey) === 'true'
}

function resolveAvatarUrl(avatarUrl?: string | null): string | null {
  if (!avatarUrl) return null
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) return avatarUrl
  return `${oauthConfig.apiUrl}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`
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
        待解析
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

function AnnouncementModal({
  config,
  onClose,
}: {
  config: SoftwareConfig
  onClose: () => void
}) {
  return (
    <div className="risk-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="announcement-modal-title">
      <div className="risk-modal-card" style={{ maxWidth: 540 }}>
        <div className="risk-modal-head" style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
          <div className="risk-icon-wrap" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
            <Icon name="campaign" filled />
          </div>
          <div>
            <h2 id="announcement-modal-title" style={{ color: '#1e40af' }}>
              {config.announcementTitle || '系统公告'}
            </h2>
            {config.announcementUpdatedAt && (
              <p className="risk-modal-subtitle" style={{ color: '#3b82f6' }}>
                更新时间：{config.announcementUpdatedAt}
              </p>
            )}
          </div>
        </div>
        <div className="risk-modal-body">
          <p style={{ whiteSpace: 'pre-line', lineHeight: 1.7, fontSize: 14, color: '#1e293b' }}>
            {config.announcementMessage || '暂无公告内容'}
          </p>
        </div>
        <div className="risk-modal-actions">
          {config.announcementUrl && (
            <a
              href={config.announcementUrl}
              target="_blank"
              rel="noreferrer"
              className="control-secondary"
              style={{ marginRight: 'auto', textDecoration: 'none' }}
            >
              <Icon name="open_in_new" /> 查看详情
            </a>
          )}
          <button className="control-primary" type="button" onClick={onClose}>
            我知道了
          </button>
        </div>
      </div>
    </div>
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
            <h2 id="risk-modal-title">顶号与答题提示</h2>
            <p className="risk-modal-subtitle">作业：{homework.name}</p>
          </div>
        </div>
        <div className="risk-modal-body">
          <p>
            如果您的手机或平板端 ETS100 <strong>当前正在答题或录音</strong>，解析可能导致移动端被挤下线。
          </p>
          <div className="risk-alert-box">
            <strong>建议：</strong>
            <ul>
              <li>建议在<strong>移动端完成作答后</strong>，再在网页端进行作业解析与答案查阅。</li>
              <li>如未在移动端进行考试或答题，可放心继续。</li>
            </ul>
          </div>
          <label className="risk-modal-checkbox" htmlFor={rememberId}>
            <input
              id={rememberId}
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>记住选择（不再弹出此提示）</span>
          </label>
        </div>
        <div className="risk-modal-actions">
          <button className="control-secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="control-primary" type="button" onClick={() => onConfirm(remember)}>
            我已了解，开始解析
          </button>
        </div>
      </div>
    </div>
  )
}

function AssignmentIndexCard({
  accountInfo,
  homeworks,
  selectedId,
  parsingId,
  homeworkError,
  isCloudModeEnabled = true,
  cloudModeDenyReason,
  onRetry,
  onSelectHomework,
}: {
  accountInfo: PlatformAccountInfo | null
  homeworks: HomeworkItem[]
  selectedId: string | null
  parsingId: string | null
  homeworkError?: string | null
  isCloudModeEnabled?: boolean
  cloudModeDenyReason?: string
  onRetry?: () => void
  onSelectHomework: (item: HomeworkItem) => void
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
    <div className="fe-card fe-list-card">
      <div className="fe-list-card__head">
        <div className="fe-list-card__title">
          <strong>作业索引</strong>
          <small>
            {accountInfo?.bound
              ? `账号: ${accountInfo.account_display || '已连接'} · 共 ${homeworks.length} 份`
              : '未绑定 ETS100 账号'}
          </small>
        </div>
        {onRetry && (
          <button
            className="control-icon-button"
            style={{ width: 34, height: 34 }}
            onClick={onRetry}
            title="刷新作业列表"
            type="button"
          >
            <Icon name="refresh" />
          </button>
        )}
      </div>

      <div className="fe-list-card__search">
        <label className="control-toolbar">
          <Icon name="search" />
          <input
            placeholder="搜索作业名称或学科..."
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="fe-list-card__body">
        {!isCloudModeEnabled ? (
          <div className="fe-empty-state" style={{ margin: '30px auto' }}>
            <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
              <Icon name="cloud_off" />
            </div>
            <h2>云端模式已停用</h2>
            <p>{cloudModeDenyReason || '管理员已暂停云端作业拉取服务。'}</p>
          </div>
        ) : homeworkError ? (
          <div className="fe-empty-state" style={{ margin: '30px auto' }}>
            <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
              <Icon name="error_outline" />
            </div>
            <h2>作业同步失败</h2>
            <p>{homeworkError}</p>
            {onRetry && (
              <button type="button" className="control-primary" onClick={onRetry}>
                重新尝试
              </button>
            )}
          </div>
        ) : !accountInfo?.bound ? (
          <div className="fe-empty-state" style={{ margin: '30px auto' }}>
            <div className="fe-empty-state__icon">
              <Icon name="no_accounts" />
            </div>
            <h2>未绑定 ETS100</h2>
            <p>请先前往官网账号中心绑定您的 ETS100 手机号与密码。</p>
            <a href="https://lastudio.cc/account" target="_blank" rel="noreferrer" className="control-primary" style={{ textDecoration: 'none' }}>
              前往账号中心绑定
            </a>
          </div>
        ) : homeworks.length === 0 ? (
          <div className="fe-empty-state" style={{ margin: '30px auto' }}>
            <div className="fe-empty-state__icon">
              <Icon name="inbox" />
            </div>
            <h2>暂无当前作业</h2>
            <p>当前没有待完成的作业。</p>
          </div>
        ) : (
          <>
            {parsingList.length > 0 && (
              <details className="fe-group" open>
                <summary>
                  <span>正在解析 ({parsingList.length})</span>
                  <Icon name="keyboard_arrow_down" />
                </summary>
                <div className="fe-group__items">
                  {parsingList.map((item) => (
                    <button
                      key={item.id}
                      className={`fe-homework-item ${item.id === selectedId ? 'is-selected' : ''}`}
                      type="button"
                      onClick={() => onSelectHomework(item)}
                    >
                      <div className="fe-homework-item__head">
                        <span className="fe-homework-item__title">{item.name}</span>
                        <span className="fe-homework-item__time is-new">
                          {formatTime(item.end_time || item.create_time)}
                        </span>
                      </div>
                      <div className="fe-homework-item__meta">
                        <span>{item.subject_name || '英语'}</span>
                        <StatusPill status="parsing" />
                      </div>
                    </button>
                  ))}
                </div>
              </details>
            )}

            {pendingList.length > 0 && (
              <details className="fe-group" open>
                <summary>
                  <span>待解析作业 ({pendingList.length})</span>
                  <Icon name="keyboard_arrow_down" />
                </summary>
                <div className="fe-group__items">
                  {pendingList.map((item) => (
                    <button
                      key={item.id}
                      className={`fe-homework-item ${item.id === selectedId ? 'is-selected' : ''}`}
                      type="button"
                      onClick={() => onSelectHomework(item)}
                    >
                      <div className="fe-homework-item__head">
                        <span className="fe-homework-item__title">{item.name}</span>
                        <span className="fe-homework-item__time">
                          {formatTime(item.end_time || item.create_time)}
                        </span>
                      </div>
                      <div className="fe-homework-item__meta">
                        <span>{item.subject_name || '英语'}</span>
                        <StatusPill status="unread" />
                      </div>
                    </button>
                  ))}
                </div>
              </details>
            )}

            {parsedList.length > 0 && (
              <details className="fe-group" open>
                <summary>
                  <span>已解析作业 ({parsedList.length})</span>
                  <Icon name="keyboard_arrow_down" />
                </summary>
                <div className="fe-group__items">
                  {parsedList.map((item) => (
                    <button
                      key={item.id}
                      className={`fe-homework-item ${item.id === selectedId ? 'is-selected' : ''}`}
                      type="button"
                      onClick={() => onSelectHomework(item)}
                    >
                      <div className="fe-homework-item__head">
                        <span className="fe-homework-item__title">{item.name}</span>
                        <span className="fe-homework-item__time">
                          {formatTime(item.end_time || item.create_time)}
                        </span>
                      </div>
                      <div className="fe-homework-item__meta">
                        <span>{item.subject_name || '英语'}</span>
                        <StatusPill status="parsed" />
                      </div>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
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
        <span>Fe 核对</span>
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

function HomeworkReaderCard({
  accountInfo,
  selectedHomework,
  paper,
  isLoadingPaper,
  parsingMessage,
  homeworkError,
  parseError,
  isAnswerParserEnabled = true,
  answerParserDenyReason,
  isCopyExportEnabled = true,
  copyExportDenyReason,
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
  parseError?: string | null
  isAnswerParserEnabled?: boolean
  answerParserDenyReason?: string
  isCopyExportEnabled?: boolean
  copyExportDenyReason?: string
  onRequestParse: (hw: HomeworkItem) => void
  onCopyAnswer: () => void
  onExportAnswer: () => void
  onRetry?: () => void
}) {
  return (
    <div className="fe-card fe-reader-card">
      <div className="fe-reader-toolbar">
        <div className="fe-reader-toolbar-group">
          {paper && (
            <>
              <button
                className="control-secondary"
                type="button"
                onClick={onCopyAnswer}
                disabled={!isCopyExportEnabled}
                title={isCopyExportEnabled ? '复制格式化答案文本到剪贴板' : (copyExportDenyReason || '答案导出功能当前不可用')}
              >
                <Icon name="content_copy" />
                <span>复制答案</span>
              </button>
              <button
                className="control-secondary"
                type="button"
                onClick={onExportAnswer}
                disabled={!isCopyExportEnabled}
                title={isCopyExportEnabled ? '导出 TXT 文件到本地' : (copyExportDenyReason || '答案导出功能当前不可用')}
              >
                <Icon name="download" />
                <span>导出 TXT</span>
              </button>
            </>
          )}
        </div>

        <div className="fe-reader-toolbar-group">
          {selectedHomework && (
            <button
              className="control-primary"
              type="button"
              onClick={() => isAnswerParserEnabled && onRequestParse(selectedHomework)}
              disabled={!isAnswerParserEnabled}
              title={isAnswerParserEnabled ? (selectedHomework.parsed ? '重新提取并解析' : '开始解析') : (answerParserDenyReason || '答案解析功能当前不可用')}
            >
              <Icon name={isAnswerParserEnabled ? (selectedHomework.parsed ? 'refresh' : 'bolt') : 'lock'} />
              <span>{isAnswerParserEnabled ? (selectedHomework.parsed ? '重新解析' : '开始解析答案') : (answerParserDenyReason || '答案解析已停用')}</span>
            </button>
          )}
        </div>
      </div>

      <div className="fe-reader-body">
        {!accountInfo?.bound ? (
          <div className="fe-empty-state">
            <div className="fe-empty-state__icon">
              <Icon name="link_off" />
            </div>
            <h2>未绑定 ETS100 账号</h2>
            <p>请先在官网账号中心绑定您的 ETS100 手机号与密码，绑定完成后即可在此快速查看与解析作业。</p>
            <a href="https://lastudio.cc/account" target="_blank" rel="noreferrer" className="control-primary" style={{ textDecoration: 'none' }}>
              <Icon name="open_in_new" /> 前往账号中心绑定
            </a>
          </div>
        ) : parsingMessage ? (
          <div className="fe-empty-state">
            <div className="fe-empty-state__icon spinning">
              <Icon name="sync" />
            </div>
            <h2>正在解析试卷答案</h2>
            <p>{parsingMessage}</p>
            <p style={{ color: 'var(--control-muted)', fontSize: 13 }}>正在同步试卷与答案内容，请稍候...</p>
          </div>
        ) : isLoadingPaper ? (
          <div className="fe-empty-state">
            <div className="fe-empty-state__icon spinning">
              <Icon name="hourglass_top" />
            </div>
            <h2>正在加载试卷详情...</h2>
          </div>
        ) : selectedHomework && !selectedHomework.parsed && !paper ? (
          <div className="fe-empty-state">
            <div className="fe-empty-state__icon">
              <Icon name="description" />
            </div>
            <h2>{selectedHomework.name}</h2>
            <p>
              {selectedHomework.subject_name || '英语'} · 截止：
              {formatTime(selectedHomework.end_time || selectedHomework.create_time)}
            </p>
            {parseError ? (
              <div style={{ margin: '12px auto 16px', padding: '10px 16px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8, color: '#b91c1c', fontSize: 13 }}>
                <span>解析失败：{parseError}</span>
              </div>
            ) : (
              <p style={{ color: 'var(--control-muted)', fontSize: 13.5 }}>点击下方按钮开始解析标准答案。</p>
            )}
            <button
              className="control-primary"
              style={{ padding: '10px 24px', fontSize: 13.5 }}
              type="button"
              disabled={!isAnswerParserEnabled}
              onClick={() => isAnswerParserEnabled && onRequestParse(selectedHomework)}
              title={!isAnswerParserEnabled ? (answerParserDenyReason || '答案解析功能当前不可用') : undefined}
            >
              <Icon name={isAnswerParserEnabled ? 'bolt' : 'lock'} />{' '}
              {isAnswerParserEnabled
                ? (parseError ? '重新重试解析' : '开始解析答案')
                : (answerParserDenyReason || '答案解析功能已停用')}
            </button>
          </div>
        ) : homeworkError && !selectedHomework ? (
          <div className="fe-empty-state">
            <div className="fe-empty-state__icon">
              <Icon name="error_outline" />
            </div>
            <h2>无法获取作业列表</h2>
            <p>{homeworkError}</p>
            <p style={{ color: 'var(--control-muted)', fontSize: 13 }}>请确认在 E听说客户端中是否加入了有效班级，或在设置中点击重新同步。</p>
            {onRetry && (
              <button className="control-primary" type="button" onClick={onRetry}>
                <Icon name="refresh" /> 重新尝试
              </button>
            )}
          </div>
        ) : !paper ? (
          <div className="fe-empty-state">
            <div className="fe-empty-state__icon">
              <Icon name="auto_stories" />
            </div>
            <h2>请选择作业</h2>
            <p>从左侧点击一份作业即可自动解析并查看标准答案。</p>
          </div>
        ) : (
          <article className="answer-paper">
            <header className="answer-paper__head">
              <span className="paper-kicker">共 {paper.totalQuestions} 题</span>
              <h1>{paper.title || paper.paperName}</h1>
            </header>

            <div className="answer-paper__content">
              {paper.sections.map((sec, idx) => (
                <SectionGroup section={sec} key={idx} />
              ))}
            </div>
          </article>
        )}
      </div>
    </div>
  )
}

function HistoryPage({
  historyHomeworks,
  isLoading,
  onSelectHomework,
}: {
  historyHomeworks: HomeworkItem[]
  isLoading: boolean
  onSelectHomework: (item: HomeworkItem) => void
}) {
  const [historyQuery, setHistoryQuery] = useState('')

  const filtered = historyHomeworks.filter((hw) => {
    if (!historyQuery.trim()) return true
    const q = historyQuery.toLowerCase()
    return (
      hw.name.toLowerCase().includes(q) ||
      (hw.subject_name && hw.subject_name.toLowerCase().includes(q))
    )
  })

  return (
    <div className="fe-history-container">
      <div className="fe-history-toolbar">
        <div className="control-toolbar">
          <label>
            <Icon name="search" />
            <input
              placeholder="搜索历史作业名称或学科..."
              type="search"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
          </label>
        </div>
        <span className="admin-pill-badge is-muted">
          共 {filtered.length} 份归档记录
        </span>
      </div>

      <div className="fe-history-list">
        {isLoading ? (
          <div className="fe-empty-state" style={{ margin: '40px auto' }}>
            <div className="fe-empty-state__icon spinning">
              <Icon name="sync" />
            </div>
            <h2>正在拉取历史作业记录...</h2>
          </div>
        ) : filtered.length === 0 ? (
          <div className="fe-empty-state" style={{ margin: '40px auto' }}>
            <div className="fe-empty-state__icon">
              <Icon name="history_toggle_drop" />
            </div>
            <h2>暂无已归档的历史作业</h2>
            <p>完成并归档的试卷将显示在此处以供查阅。</p>
          </div>
        ) : (
          filtered.map((hw) => (
            <button
              key={hw.id}
              className="fe-history-item"
              type="button"
              onClick={() => onSelectHomework(hw)}
            >
              <div>
                <strong>{hw.name}</strong>
                <small>
                  {hw.subject_name || '英语'} · 截止: {formatTime(hw.end_time || hw.create_time)}
                </small>
              </div>
              <div className="fe-history-item__right">
                <StatusPill status={hw.parsed ? 'parsed' : 'unread'} />
                <Icon name="chevron_right" />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function SettingsPage({
  currentUser,
  accountInfo,
  softwareConfig,
  softwareFeatures,
  onRefreshSession,
  onOpenAnnouncement,
}: {
  currentUser: User | null
  accountInfo: PlatformAccountInfo | null
  softwareConfig: SoftwareConfig | null
  softwareFeatures: SoftwareFeatureItem[]
  onRefreshSession: () => void
  onOpenAnnouncement: () => void
}) {
  const [skipRisk, setSkipRisk] = useState(readStoredSkipRiskWarning)

  function toggleSkipRisk() {
    const next = !skipRisk
    setSkipRisk(next)
    window.localStorage.setItem(skipRiskWarningStorageKey, String(next))
  }

  const avatarUrl = resolveAvatarUrl(currentUser?.avatar_url)

  return (
    <div className="fe-settings-container">
      {/* Current User Profile Card */}
      <section className="admin-policy-card">
        <div className="admin-policy-card-head">
          <Icon name="person" />
          <div>
            <h3>当前登录账号</h3>
            <p>LastStudio 统一通行证账号信息</p>
          </div>
        </div>

        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <div className="control-account-avatar" style={{ width: 44, height: 44, borderRadius: 10, fontSize: 16 }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={currentUser?.name || ''} />
              ) : (
                currentUser?.name ? currentUser.name.slice(0, 1).toUpperCase() : <Icon name="person" />
              )}
            </div>
            <div>
              <strong style={{ fontSize: 14 }}>{currentUser?.name || '用户'}</strong>
              <span style={{ display: 'block', color: 'var(--control-muted)', fontSize: 12 }}>
                通行证 ID: #{currentUser?.id || '-'}
              </span>
            </div>
          </div>
          <a
            href="https://lastudio.cc/account"
            target="_blank"
            rel="noreferrer"
            className="control-secondary"
          >
            <Icon name="open_in_new" /> 管理个人资料
          </a>
        </div>
      </section>

      {/* Announcements */}
      {softwareConfig && (softwareConfig.announcementTitle || softwareConfig.announcementMessage) && (
        <section className="admin-policy-card">
          <div className="admin-policy-card-head">
            <Icon name="campaign" />
            <div>
              <h3>系统公告</h3>
              <p>官方最新动态与服务通知</p>
            </div>
          </div>

          <div className="admin-setting-switch-row">
            <div className="admin-setting-switch-info">
              <strong>{softwareConfig.announcementTitle || '公告'}</strong>
              <span style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>{softwareConfig.announcementMessage}</span>
              {softwareConfig.announcementUpdatedAt && (
                <span style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                  更新时间：{softwareConfig.announcementUpdatedAt}
                </span>
              )}
            </div>
            <button className="control-secondary" type="button" onClick={onOpenAnnouncement}>
              <Icon name="visibility" /> 查看公告
            </button>
          </div>
        </section>
      )}

      {/* Software & Feature switches (NO VERSION NUMBERS) */}
      <section className="admin-policy-card">
        <div className="admin-policy-card-head">
          <Icon name="tune" />
          <div>
            <h3>功能状态</h3>
            <p>网页版功能开关与授权细则</p>
          </div>
        </div>

        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info">
            <strong>软件名称</strong>
            <span>网页端在线解析工作台</span>
          </div>
          <span className="admin-pill-badge is-info">Fe Web 网页版</span>
        </div>

        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info">
            <strong>运行状态</strong>
            <span>服务在线与维护状态</span>
          </div>
          <span className={`admin-pill-badge ${softwareConfig?.isKillSwitchOn ? 'is-danger' : 'is-success'}`}>
            {softwareConfig?.isKillSwitchOn ? '维护中 (紧急暂停)' : '正常运行'}
          </span>
        </div>

        {softwareFeatures.map((feat) => {
          const isOk = feat.status === 'enabled' && feat.available_for_version && !softwareConfig?.isKillSwitchOn
          return (
            <div key={feat.feature_key} className="admin-setting-switch-row">
              <div className="admin-setting-switch-info">
                <strong>{feat.name}</strong>
                <span>{feat.description || feat.feature_key}</span>
              </div>
              <span className={`admin-pill-badge ${isOk ? 'is-success' : 'is-danger'}`}>
                {isOk ? '已启用' : (feat.reason || '已停用')}
              </span>
            </div>
          )
        })}
      </section>

      {/* ETS100 Platform Account Binding */}
      <section className="admin-policy-card">
        <div className="admin-policy-card-head">
          <Icon name="account_box" />
          <div>
            <h3>ETS100 平台账号状态</h3>
            <p>拉取作业试卷与答案所依赖的 E听说 平台登录凭据</p>
          </div>
        </div>

        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info">
            <strong>绑定状态</strong>
            <span>是否已在 LastStudio 账号中心绑定 ETS100 账号</span>
          </div>
          <span className={`admin-pill-badge ${accountInfo?.bound ? 'is-success' : 'is-danger'}`}>
            {accountInfo?.bound ? '已绑定' : '未绑定'}
          </span>
        </div>

        {accountInfo?.bound && (
          <>
            <div className="admin-setting-switch-row">
              <div className="admin-setting-switch-info">
                <strong>ETS100 手机号</strong>
                <span>已授权关联的手机号</span>
              </div>
              <strong>{accountInfo.account_display || '未知'}</strong>
            </div>

            {accountInfo.profile && (
              <>
                {(accountInfo.profile as Record<string, unknown>).name ? (
                  <div className="admin-setting-switch-row">
                    <div className="admin-setting-switch-info">
                      <strong>学生姓名</strong>
                      <span>平台注册姓名</span>
                    </div>
                    <span>{String((accountInfo.profile as Record<string, unknown>).name)}</span>
                  </div>
                ) : null}

                {(accountInfo.profile as Record<string, unknown>).school_name ? (
                  <div className="admin-setting-switch-row">
                    <div className="admin-setting-switch-info">
                      <strong>学校 / 班级</strong>
                      <span>所在学校与班级信息</span>
                    </div>
                    <span>
                      {String((accountInfo.profile as Record<string, unknown>).school_name)}{' '}
                      {String((accountInfo.profile as Record<string, unknown>).class_name || '')}
                    </span>
                  </div>
                ) : null}
              </>
            )}

            {accountInfo.last_used_at && (
              <div className="admin-setting-switch-row">
                <div className="admin-setting-switch-info">
                  <strong>上次同步时间</strong>
                  <span>最近一次通信时间</span>
                </div>
                <span>{formatTime(accountInfo.last_used_at)}</span>
              </div>
            )}
          </>
        )}

        <div className="admin-setting-switch-row" style={{ background: '#fafbfc' }}>
          <div className="admin-setting-switch-info">
            <strong>账号管理操作</strong>
            <span>解绑、换绑或重新同步账号信息</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href="https://lastudio.cc/account"
              target="_blank"
              rel="noreferrer"
              className="control-secondary"
            >
              <Icon name="open_in_new" /> 账号中心管理
            </a>
            <button className="control-secondary" type="button" onClick={onRefreshSession}>
              <Icon name="refresh" /> 重新检测绑定
            </button>
          </div>
        </div>
      </section>

      {/* Preferences */}
      <section className="admin-policy-card">
        <div className="admin-policy-card-head">
          <Icon name="tune" />
          <div>
            <h3>工作台偏好设置</h3>
            <p>调整本地操作习惯与界面交互体验</p>
          </div>
        </div>

        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info">
            <strong>跳过顶号风险提示</strong>
            <span>点击作业时直接开始解析，不再弹出警告提示弹窗</span>
          </div>
          <button
            className={`admin-switch ${skipRisk ? 'is-checked' : ''}`}
            onClick={toggleSkipRisk}
            role="switch"
            aria-checked={skipRisk}
            aria-label="跳过顶号风险提示"
            type="button"
          />
        </div>

        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info">
            <strong>智能答案标记</strong>
            <span>选择题选项自动匹配标准答案并进行微绿高亮渲染</span>
          </div>
          <button
            className="admin-switch is-checked"
            role="switch"
            aria-checked={true}
            aria-label="智能答案标记"
            type="button"
          />
        </div>
      </section>
    </div>
  )
}

function currentPage(pathname: string): Page | null {
  if (pathname === '/' || pathname === '/history' || pathname === '/settings') return pathname
  return null
}

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authMessage, setAuthMessage] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
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
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [homeworkError, setHomeworkError] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  // Software Config & Features State
  const [softwareConfig, setSoftwareConfig] = useState<SoftwareConfig | null>(null)
  const [softwareFeatures, setSoftwareFeatures] = useState<SoftwareFeatureItem[]>([])
  const [announcementDismissed, setAnnouncementDismissed] = useState(false)

  const pollingTimerRef = useRef<number | null>(null)

  function toggleSidebarCollapse() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(sidebarCollapsedStorageKey, String(next))
      return next
    })
  }

  // Listen for Ctrl+B keyboard shortcut to toggle sidebar collapse
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebarCollapse()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Load Fe Web software config and feature switches on mount
  useEffect(() => {
    let active = true
    getSoftwareConfig('fe-web')
      .then((cfg) => {
        if (active) setSoftwareConfig(cfg)
      })
      .catch((err) => console.error('Failed to load software config:', err))

    getSoftwareFeatures('fe-web')
      .then((feats) => {
        if (active) setSoftwareFeatures(feats)
      })
      .catch((err) => console.error('Failed to load software features:', err))

    return () => {
      active = false
    }
  }, [])

  // Fetch current user profile whenever session exists
  useEffect(() => {
    if (!session) return
    let active = true
    getCurrentUser(session.accessToken)
      .then((user) => {
        if (active) setCurrentUser(user)
      })
      .catch((err) => {
        if (active) setCurrentUser(null)
        console.error('Failed to load current user profile:', err)
      })

    return () => {
      active = false
    }
  }, [session])

  function isFeatureEnabled(featureKey: string): boolean {
    if (softwareConfig?.isKillSwitchOn) return false
    const feat = softwareFeatures.find((f) => f.feature_key === featureKey)
    if (!feat) return true
    return feat.status === 'enabled' && feat.available_for_version
  }

  function getFeatureDenyReason(featureKey: string, fallback = '该功能已暂时停用'): string {
    if (softwareConfig?.isKillSwitchOn) {
      return softwareConfig.noticeMessage || '系统正在维护，所有云端与解析功能已暂时关闭。'
    }
    const feat = softwareFeatures.find((f) => f.feature_key === featureKey)
    return feat?.reason || fallback
  }

  function showToast(message: string) {
    setToastMessage(message)
    window.setTimeout(() => {
      setToastMessage(null)
    }, 2800)
  }

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
      setCurrentUser(null)
      setAuthMessage('')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => {
      authorizationStarted.current = false
      setSession(null)
      setCurrentUser(null)
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
        setCurrentUser(null)
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

  useEffect(() => {
    if (!session) return
    let active = true

    getPlatformAccount(session.accessToken)
      .then(async (account) => {
        if (!active) return
        setAccountInfo(account)
        if (account.bound) {
          if (!isFeatureEnabled('cloud_mode')) {
            setHomeworkError(getFeatureDenyReason('cloud_mode', '云端模式已暂时停用'))
            return
          }
          try {
            const res = await getHomeworkList(session.accessToken, '1')
            if (!active) return
            setHomeworkError(null)
            setHomeworks(res.homeworks || [])
            if (res.homeworks && res.homeworks.length > 0) {
              const firstParsed = res.homeworks.find((h) => h.parsed)
              const firstHw = firstParsed || res.homeworks[0]
              setSelectedHomework(firstHw)
              if (firstHw.parsed) {
                void loadPaperDetail(session.accessToken, firstHw.id)
              }
            }
          } catch (err) {
            if (!active) return
            const msg = err instanceof Error ? err.message : '获取作业列表失败'
            console.error('Failed to load homework list:', err)
            setHomeworkError(msg)
          }
        }
      })
      .catch((err) => {
        if (!active) return
        console.error('Failed to load platform account info:', err)
      })

    return () => {
      active = false
    }
  }, [session, softwareConfig, softwareFeatures])

  useEffect(() => {
    if (!session || page !== '/history') return
    if (!isFeatureEnabled('cloud_mode')) return
    let active = true

    Promise.all([
      getHomeworkList(session.accessToken, '2').catch(() => ({ homeworks: [] })),
      getHomeworkList(session.accessToken, '3').catch(() => ({ homeworks: [] })),
    ])
      .then(([res2, res3]) => {
        if (!active) return
        setHistoryHomeworks([...(res2.homeworks || []), ...(res3.homeworks || [])])
      })
      .catch((err) => {
        console.error('Failed to load history homeworks:', err)
      })
      .finally(() => {
        if (active) setIsLoadingHistory(false)
      })

    return () => {
      active = false
    }
  }, [session, page, softwareConfig, softwareFeatures])

  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current)
      }
    }
  }, [])

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

  // Fe user operation flow: click homework -> show answers if parsed, or trigger parse if unparsed!
  function handleSelectHomework(item: HomeworkItem) {
    setSelectedHomework(item)
    setParseError(null)
    if (item.parsed) {
      if (session) {
        void loadPaperDetail(session.accessToken, item.id)
      }
      if (page !== '/') {
        navigate('/')
      }
    } else {
      setCurrentPaper(null)
      if (page !== '/') {
        navigate('/')
      }
      handleTriggerParse(item)
    }
  }

  function handleTriggerParse(item: HomeworkItem) {
    if (!isFeatureEnabled('answer_parser')) {
      showToast(getFeatureDenyReason('answer_parser', '答案解析功能已停用'))
      return
    }
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
    setParsingMessage(`正在解析《${item.name}》答案...`)
    setParseError(null)

    try {
      const resp = await startParseHomework(session.accessToken, {
        homework_id: item.id,
        homework_name: item.name,
        contents: item.contents,
      })

      if (resp.status === 'COMPLETED' && resp.result) {
        setParsingId(null)
        setParsingMessage(null)
        setParseError(null)
        setCurrentPaper(resp.result)
        setHomeworks((prev) =>
          prev.map((h) => (h.id === item.id ? { ...h, parsed: true } : h))
        )
        showToast('解析完成！')
        return
      }

      if (resp.task_id) {
        const taskId = resp.task_id
        setParsingMessage('正在解析试卷，请稍候...')

        if (pollingTimerRef.current) {
          window.clearInterval(pollingTimerRef.current)
        }

        pollingTimerRef.current = window.setInterval(async () => {
          try {
            const task = await getTaskStatus(session.accessToken, taskId)
            if (task.status === 'COMPLETED') {
              if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current)
              setParsingId(null)
              setParsingMessage(null)
              setParseError(null)
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
              const failMsg = task.error || '解析失败'
              setParseError(failMsg)
              showToast(`解析失败: ${failMsg}`)
            }
          } catch (err) {
            console.error('Task poll error:', err)
          }
        }, 1500)
      }
    } catch (err: unknown) {
      setParsingId(null)
      setParsingMessage(null)
      const errorMsg = err instanceof Error ? err.message : '发起解析失败'
      setParseError(errorMsg)
      showToast(errorMsg)
    }
  }

  async function handleCopyAnswer() {
    if (!isFeatureEnabled('copy_export')) {
      showToast(getFeatureDenyReason('copy_export', '答案导出功能已停用'))
      return
    }
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
    if (!isFeatureEnabled('copy_export')) {
      showToast(getFeatureDenyReason('copy_export', '答案导出功能已停用'))
      return
    }
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
          if (!isFeatureEnabled('cloud_mode')) {
            setHomeworkError(getFeatureDenyReason('cloud_mode', '云端模式已暂时停用'))
            return
          }
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

  function navigate(nextPage: Page) {
    if (nextPage === '/history') {
      setIsLoadingHistory(true)
    }
    setMobileNavOpen(false)
    if (nextPage === window.location.pathname) {
      return
    }
    transitionRoute(() => {
      window.history.pushState(null, '', nextPage)
      setPathname(nextPage)
    })
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

  const meta = pageMeta[page]
  const avatarUrl = resolveAvatarUrl(currentUser?.avatar_url)

  return (
    <main className={`control-shell ${mobileNavOpen ? 'drawer-open' : ''}`}>
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

      {showAnnouncementModal && softwareConfig && (
        <AnnouncementModal
          config={softwareConfig}
          onClose={() => setShowAnnouncementModal(false)}
        />
      )}

      {/* Floating Header Capsule */}
      <header className="control-site-header">
        <div className="control-header-inner">
          <a className="control-brand" href="/">
            <img src={logoSrc} alt="" />
            <span>
              <strong>Fuck ets100</strong>
              <small>Fe Web · 作业工作台</small>
            </span>
          </a>

          <div className="control-header-actions">
            {softwareConfig && (softwareConfig.announcementTitle || softwareConfig.announcementMessage) && (
              <button
                className="control-header-link"
                onClick={() => setShowAnnouncementModal(true)}
                title="查看系统公告"
                type="button"
              >
                <Icon name="campaign" />
                <span>公告</span>
              </button>
            )}

            <a
              className="control-account"
              href="https://lastudio.cc/account"
              target="_blank"
              rel="noreferrer"
              title="查看与管理账号"
            >
              <span className="control-account-avatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={currentUser?.name || ''} />
                ) : (
                  currentUser?.name ? currentUser.name.slice(0, 1).toUpperCase() : <Icon name="person" />
                )}
              </span>
              <div className="control-account-meta">
                <strong>{currentUser?.name || '我的账号'}</strong>
                <small>
                  {accountInfo?.bound
                    ? (accountInfo.account_display ? `ETS: ${accountInfo.account_display}` : 'ETS 已连接')
                    : 'ETS 未绑定'}
                </small>
              </div>
            </a>

            <a
              className="control-header-link"
              href="https://lastudio.cc/account"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="person" />
              <span>账号中心</span>
            </a>
            <a
              className="control-header-link"
              href="https://lastudio.cc/admin"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="admin_panel_settings" />
              <span>管理中心</span>
            </a>
            <button
              className="control-icon-button"
              onClick={() => transitionTo(oauthConfig.logoutUrl)}
              title="退出登录"
              type="button"
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </header>

      {/* Emergency Kill switch banner */}
      {softwareConfig?.isKillSwitchOn && (
        <div className="system-kill-switch-banner" role="alert">
          <Icon name="block" filled />
          <div className="system-kill-switch-content">
            <strong>服务已被紧急停用或正在维护中</strong>
            <p>{softwareConfig.noticeMessage || '系统正在维护，所有云端与解析功能已暂时关闭。'}</p>
          </div>
        </div>
      )}

      {/* Layout Grid */}
      <div className={`control-layout ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        {/* Collapsible Sidebar */}
        <aside
          className={`control-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}
          id="control-modules"
          aria-label="工作台模块导航"
        >
          <div className="admin-sidebar-head">
            <button
              className="admin-collapse-toggle"
              onClick={toggleSidebarCollapse}
              title={sidebarCollapsed ? '展开侧边栏 (Ctrl+B)' : '收起侧边栏 (Ctrl+B)'}
              type="button"
              aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              <Icon name="keyboard_double_arrow_left" />
            </button>
            <button
              className="admin-drawer-close"
              onClick={() => setMobileNavOpen(false)}
              title="关闭导航抽屉"
              type="button"
              aria-label="关闭导航"
            >
              <Icon name="close" />
            </button>
          </div>

          <nav aria-label="工作台模块">
            {navGroups.map((group) => (
              <section key={group.label}>
                <small>{group.label}</small>
                {group.items.map((item) => (
                  <button
                    key={item.page}
                    className={page === item.page ? 'is-active' : ''}
                    onClick={() => navigate(item.page)}
                    title={sidebarCollapsed ? item.label : undefined}
                    type="button"
                  >
                    <Icon name={item.icon} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.caption}</small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </nav>

          <footer>
            <i style={{ background: accountInfo?.bound ? '#2f7a55' : '#94a3b8' }} />
            <span className="admin-footer-label">
              {accountInfo?.bound ? 'ETS100 已连接' : 'ETS100 未绑定'}
            </span>
          </footer>
        </aside>

        {/* Workspace */}
        <section className="control-workspace">
          {/* Page Heading */}
          <header className="control-page-heading">
            <div>
              <h1>{meta.title}</h1>
              <span>{meta.caption}</span>
            </div>
          </header>

          {/* Announcement Card if present */}
          {softwareConfig && (softwareConfig.announcementTitle || softwareConfig.announcementMessage) && !announcementDismissed && (
            <div className="fe-announcement-card">
              <div className="fe-announcement-icon">
                <Icon name="campaign" filled />
              </div>
              <div className="fe-announcement-content">
                <strong>{softwareConfig.announcementTitle || '系统公告'}</strong>
                <p>{softwareConfig.announcementMessage}</p>
                {softwareConfig.announcementUrl && (
                  <a href={softwareConfig.announcementUrl} target="_blank" rel="noreferrer">
                    查看详情 <Icon name="open_in_new" />
                  </a>
                )}
              </div>
              <button
                className="fe-announcement-close"
                onClick={() => setAnnouncementDismissed(true)}
                title="关闭公告"
                type="button"
                aria-label="关闭公告"
              >
                <Icon name="close" />
              </button>
            </div>
          )}

          {/* Mobile Drawer Trigger & Overlay */}
          <button
            className="control-mobile-navigation"
            onClick={() => setMobileNavOpen(true)}
            type="button"
            aria-label="打开工作台导航"
          >
            <Icon name="menu" />
            <span>
              <small>工作台模块</small>
              <strong>{meta.title}</strong>
            </span>
            <Icon name="chevron_right" />
          </button>

          <button
            className="control-drawer-overlay"
            onClick={() => setMobileNavOpen(false)}
            tabIndex={-1}
            type="button"
            aria-label="关闭工作台导航"
          />

          {/* Page Work area */}
          {page === '/' && (
            <div className="fe-split-workspace">
              <AssignmentIndexCard
                accountInfo={accountInfo}
                homeworks={homeworks}
                selectedId={selectedHomework?.id || null}
                parsingId={parsingId}
                homeworkError={homeworkError}
                isCloudModeEnabled={isFeatureEnabled('cloud_mode')}
                cloudModeDenyReason={getFeatureDenyReason('cloud_mode')}
                onRetry={refreshAccountAndHomeworks}
                onSelectHomework={handleSelectHomework}
              />

              <HomeworkReaderCard
                accountInfo={accountInfo}
                selectedHomework={selectedHomework}
                paper={currentPaper}
                isLoadingPaper={isLoadingPaper}
                parsingMessage={parsingMessage}
                homeworkError={homeworkError}
                parseError={parseError}
                isAnswerParserEnabled={isFeatureEnabled('answer_parser')}
                answerParserDenyReason={getFeatureDenyReason('answer_parser')}
                isCopyExportEnabled={isFeatureEnabled('copy_export')}
                copyExportDenyReason={getFeatureDenyReason('copy_export')}
                onRequestParse={handleTriggerParse}
                onCopyAnswer={handleCopyAnswer}
                onExportAnswer={handleExportAnswer}
                onRetry={refreshAccountAndHomeworks}
              />
            </div>
          )}

          {page === '/history' && (
            <HistoryPage
              historyHomeworks={historyHomeworks}
              isLoading={isLoadingHistory}
              onSelectHomework={handleSelectHomework}
            />
          )}

          {page === '/settings' && (
            <SettingsPage
              currentUser={currentUser}
              accountInfo={accountInfo}
              softwareConfig={softwareConfig}
              softwareFeatures={softwareFeatures}
              onRefreshSession={refreshAccountAndHomeworks}
              onOpenAnnouncement={() => setShowAnnouncementModal(true)}
            />
          )}
        </section>
      </div>
    </main>
  )
}

export default App
