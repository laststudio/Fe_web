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
import CapVerification from './CapVerification'

type Page = '/' | '/history' | '/settings'

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

const REFRESH_TIMESTAMPS_KEY = 'fe-web.refresh-timestamps'
const RATE_LIMIT_WINDOW_MS = 20000
const MAX_REFRESH_PER_WINDOW = 3
const MIN_REFRESH_INTERVAL_MS = 2500

function getRecentRefreshTimestamps(): number[] {
  try {
    const raw = sessionStorage.getItem(REFRESH_TIMESTAMPS_KEY)
    if (!raw) return []
    const now = Date.now()
    const list: number[] = JSON.parse(raw)
    return list.filter((t) => typeof t === 'number' && now - t < RATE_LIMIT_WINDOW_MS)
  } catch {
    return []
  }
}

function recordRefreshTimestamp(): void {
  try {
    const list = getRecentRefreshTimestamps()
    list.push(Date.now())
    sessionStorage.setItem(REFRESH_TIMESTAMPS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

function clearRefreshTimestamps(): void {
  try {
    sessionStorage.removeItem(REFRESH_TIMESTAMPS_KEY)
  } catch {
    // ignore
  }
}

function shouldTriggerCaptchaDefense(): boolean {
  const list = getRecentRefreshTimestamps()
  if (list.length >= MAX_REFRESH_PER_WINDOW) {
    return true
  }
  if (list.length > 0) {
    const last = list[list.length - 1]
    if (Date.now() - last < MIN_REFRESH_INTERVAL_MS) {
      return true
    }
  }
  return false
}

function CaptchaModal({
  onSuccess,
  onCancel,
}: {
  onSuccess: (capToken: string) => void
  onCancel: () => void
}) {
  const [error, setError] = useState('')

  return (
    <div className="risk-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="captcha-modal-title">
      <div className="risk-modal-card fe-captcha-modal-card">
        <div className="fe-captcha-head">
          <div className="risk-icon-wrap">
            <Icon name="verified_user" filled />
          </div>
          <div>
            <h2 id="captcha-modal-title">安全人机验证</h2>
            <p>为保护 ETS 账号安全并防御接口频繁请求，请完成下方人机验证以继续。</p>
          </div>
        </div>

        <div className="fe-cap-modal-body" style={{ padding: '20px 24px' }}>
          <CapVerification
            onError={(msg) => setError(msg)}
            onToken={(token) => {
              if (token) {
                onSuccess(token)
              }
            }}
          />
          {error && (
            <div className="fe-captcha-error" role="alert">
              <Icon name="error" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="risk-modal-actions" style={{ padding: '16px 24px 20px', borderTop: '1px solid var(--control-line)' }}>
          <button className="control-secondary" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

type QuestionGroup = {
  originalText: string | null
  questions: Question[]
}

function groupQuestionsByPassage(questions: Question[]): QuestionGroup[] {
  const groups: QuestionGroup[] = []
  for (const q of questions) {
    const normText = q.originalText?.trim() || null
    const last = groups[groups.length - 1]
    if (normText && last && last.originalText === normText) {
      last.questions.push(q)
    } else {
      groups.push({ originalText: normText, questions: [q] })
    }
  }
  return groups
}

function QuestionCard({
  question,
  showOriginalText = false,
}: {
  question: Question
  showOriginalText?: boolean
}) {
  const isLangDu = Boolean(question.typeName && question.typeName.includes('朗读'))

  return (
    <div className="fe-question-card">
      <div className="fe-question-head">
        <span className="fe-q-badge">Q{question.order}</span>
        <div className="fe-q-title">
          <h4>{question.questionText || question.typeName || `第 ${question.order} 题`}</h4>
          {question.typeName && <span className="fe-q-type">{question.typeName}</span>}
        </div>
      </div>

      {showOriginalText && question.originalText && (
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
          {isLangDu ? '朗读说明 / 答案提示' : '参考答案'}
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
            <p className="no-answer">
              {isLangDu ? '以原文准确朗读发音、连读与语调为准（该题型无需提交文本答案）' : '暂无标准答案'}
            </p>
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
    </div>
  )
}

function MergedQuestionGroup({ group }: { group: QuestionGroup }) {
  const hasPassage = Boolean(group.originalText)

  return (
    <div className={`fe-question-group ${hasPassage ? 'is-merged-passage' : ''}`}>
      {hasPassage && (
        <div className="fe-passage-card">
          <div className="fe-passage-head">
            <Icon name="menu_book" filled />
            <strong>原文 / 听力材料 ({group.questions.length} 题)</strong>
          </div>
          <div className="fe-passage-body">
            <p>{cleanAnswerText(group.originalText!)}</p>
          </div>
        </div>
      )}

      <div className="fe-group-questions">
        {group.questions.map((q) => (
          <QuestionCard question={q} key={q.order} showOriginalText={!hasPassage} />
        ))}
      </div>
    </div>
  )
}

function SectionBlock({ section }: { section: Section }) {
  if (!section.questions || section.questions.length === 0) return null
  const groups = groupQuestionsByPassage(section.questions)

  return (
    <div className="fe-section-block">
      <div className="fe-section-header">
        <div className="fe-section-title">
          <span className="fe-section-bar" />
          <h3>{section.caption || section.typeName || '试题部分'}</h3>
          {section.category && <span className="fe-category-badge">{section.category}</span>}
        </div>
        <span className="fe-section-count">{section.questions.length} 道题目</span>
      </div>

      <div className="fe-section-groups">
        {groups.map((grp, gIdx) => (
          <MergedQuestionGroup group={grp} key={gIdx} />
        ))}
      </div>
    </div>
  )
}

function PaperReaderView({
  homework,
  paper,
  isLoadingPaper,
  isCopyExportEnabled = true,
  copyExportDenyReason,
  isAnswerParserEnabled = true,
  answerParserDenyReason,
  onBack,
  onCopyAnswer,
  onExportAnswer,
  onReParse,
  onManualRead,
}: {
  homework: HomeworkItem
  paper: Paper | null
  isLoadingPaper: boolean
  isCopyExportEnabled?: boolean
  copyExportDenyReason?: string
  isAnswerParserEnabled?: boolean
  answerParserDenyReason?: string
  onBack: () => void
  onCopyAnswer: () => void
  onExportAnswer: () => void
  onReParse: () => void
  onManualRead: () => void
}) {
  return (
    <div className="fe-reader-view">
      <div className="fe-reader-header-card">
        <div className="fe-reader-top-nav">
          <button className="control-secondary fe-back-btn" type="button" onClick={onBack}>
            <Icon name="arrow_back" />
            <span>返回作业列表</span>
          </button>

          <div className="fe-reader-actions">
            {paper && (
              <>
                <button
                  className="control-secondary"
                  type="button"
                  onClick={onCopyAnswer}
                  disabled={!isCopyExportEnabled}
                  title={isCopyExportEnabled ? '复制整套答案文本到剪贴板' : (copyExportDenyReason || '答案导出已停用')}
                >
                  <Icon name="content_copy" />
                  <span>复制答案</span>
                </button>
                <button
                  className="control-secondary"
                  type="button"
                  onClick={onExportAnswer}
                  disabled={!isCopyExportEnabled}
                  title={isCopyExportEnabled ? '导出为本地 TXT 文本' : (copyExportDenyReason || '答案导出已停用')}
                >
                  <Icon name="download" />
                  <span>导出 TXT</span>
                </button>
              </>
            )}
            <button
              className="control-secondary"
              type="button"
              onClick={onReParse}
              disabled={!isAnswerParserEnabled}
              title={isAnswerParserEnabled ? '重新从云端读取或解析试卷' : (answerParserDenyReason || '答案解析已停用')}
            >
              <Icon name="refresh" />
              <span>重新读取</span>
            </button>
          </div>
        </div>

        <div className="fe-reader-title-area">
          <h2>{paper?.title || paper?.paperName || homework.name}</h2>
          <div className="fe-reader-meta-row">
            <span className="fe-subject-tag">{homework.subject_name || '英语'}</span>
            {paper && <span className="admin-pill-badge is-muted">共 {paper.totalQuestions} 题</span>}
            <span className="fe-homework-meta">
              截止时间：{formatTime(homework.end_time || homework.create_time)}
            </span>
          </div>
        </div>
      </div>

      {isLoadingPaper ? (
        <div className="fe-empty-state" style={{ margin: '50px auto' }}>
          <div className="fe-empty-state__icon spinning">
            <Icon name="hourglass_top" />
          </div>
          <h2>正在读取试卷及标准答案...</h2>
          <p style={{ color: 'var(--control-muted)', fontSize: 13 }}>正在从云端安全拉取试卷题目与解析，请稍候...</p>
        </div>
      ) : !paper ? (
        <div className="fe-reader-prompt-card">
          <div className="fe-reader-prompt-icon">
            <Icon name="menu_book" filled />
          </div>
          <h3>试卷答案准备就绪</h3>
          <p>
            为防止接口频繁请求及避免官方客户端被顶号，系统未自动加载答案。请在确认当前无进行中的答题或考试后，手动点击下方按钮读取。
          </p>
          <button
            className="control-primary fe-reader-prompt-action"
            type="button"
            onClick={onManualRead}
            disabled={!isAnswerParserEnabled}
            title={!isAnswerParserEnabled ? (answerParserDenyReason || '答案解析已停用') : undefined}
          >
            <Icon name="visibility" />
            <span>{homework.parsed ? '读取试卷与答案' : '开始解析并读取答案'}</span>
          </button>
        </div>
      ) : (
        <div className="fe-reader-content">
          {paper.sections.map((sec, idx) => (
            <SectionBlock section={sec} key={idx} />
          ))}
        </div>
      )}
    </div>
  )
}

function HomeworkCard({
  item,
  index,
  isParsing,
  parseError,
  isAnswerParserEnabled = true,
  answerParserDenyReason,
  onOpen,
  onTriggerParse,
}: {
  item: HomeworkItem
  index: number
  isParsing: boolean
  parseError?: string | null
  isAnswerParserEnabled?: boolean
  answerParserDenyReason?: string
  onOpen: (hw: HomeworkItem) => void
  onTriggerParse: (hw: HomeworkItem) => void
}) {
  return (
    <div
      className={`fe-homework-card ${isParsing ? 'is-parsing' : ''} ${item.parsed ? 'is-parsed' : ''}`}
      onClick={() => {
        if (item.parsed) {
          onOpen(item)
        } else if (!isParsing) {
          onTriggerParse(item)
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (item.parsed) onOpen(item)
          else if (!isParsing) onTriggerParse(item)
        }
      }}
    >
      <div className="fe-homework-card__left">
        <div className="fe-homework-order">
          {isParsing ? (
            <Icon name="sync" className="status-pill__spin" />
          ) : item.parsed ? (
            <Icon name="check" filled />
          ) : (
            `#${index + 1}`
          )}
        </div>
        <div className="fe-homework-info">
          <div className="fe-homework-title-row">
            <span className="fe-homework-name">{item.name}</span>
            <span className="fe-subject-tag">{item.subject_name || '英语'}</span>
          </div>
          <div className="fe-homework-meta">
            <span>截止: {formatTime(item.end_time || item.create_time)}</span>
            {isParsing ? (
              <span style={{ color: 'var(--control-blue)', fontWeight: 600 }}>正在解析试卷与答案...</span>
            ) : item.parsed ? (
              <span style={{ color: 'var(--control-green)', fontWeight: 600 }}>已就绪 · 点击查看答案</span>
            ) : parseError ? (
              <span style={{ color: '#dc2626', fontWeight: 600 }}>解析失败: {parseError}</span>
            ) : (
              <span>未解析</span>
            )}
          </div>
        </div>
      </div>

      <div className="fe-homework-card__right">
        {isParsing ? (
          <span className="status-pill status-pill--parsing">
            <Icon name="sync" className="status-pill__spin" />
            解析中
          </span>
        ) : item.parsed ? (
          <button
            className="control-primary"
            type="button"
            style={{ padding: '7px 16px', fontSize: 13 }}
            onClick={(e) => {
              e.stopPropagation()
              onOpen(item)
            }}
          >
            <Icon name="visibility" />
            <span>查看答案</span>
          </button>
        ) : parseError ? (
          <button
            className="control-secondary"
            type="button"
            style={{ color: '#dc2626', borderColor: '#fca5a5', padding: '7px 14px', fontSize: 12.5 }}
            onClick={(e) => {
              e.stopPropagation()
              onTriggerParse(item)
            }}
          >
            <Icon name="refresh" />
            <span>重试解析</span>
          </button>
        ) : (
          <button
            className="control-secondary"
            type="button"
            style={{ padding: '7px 14px', fontSize: 12.5 }}
            disabled={!isAnswerParserEnabled}
            title={!isAnswerParserEnabled ? (answerParserDenyReason || '解析功能已停用') : undefined}
            onClick={(e) => {
              e.stopPropagation()
              onTriggerParse(item)
            }}
          >
            <Icon name="bolt" />
            <span>开始解析</span>
          </button>
        )}
      </div>
    </div>
  )
}

function HomeworkListView({
  activeTab,
  hasLoaded,
  accountInfo,
  homeworks,
  historyHomeworks,
  isLoadingHomeworks,
  isLoadingHistory,
  homeworkError,
  parsingId,
  parseErrors,
  isCloudModeEnabled = true,
  cloudModeDenyReason,
  isAnswerParserEnabled = true,
  answerParserDenyReason,
  onRefresh,
  onManualReadList,
  onOpenHomework,
  onTriggerParse,
}: {
  activeTab: 'current' | 'history'
  hasLoaded: boolean
  accountInfo: PlatformAccountInfo | null
  homeworks: HomeworkItem[]
  historyHomeworks: HomeworkItem[]
  isLoadingHomeworks: boolean
  isLoadingHistory: boolean
  homeworkError?: string | null
  parsingId: string | null
  parseErrors: Record<string, string>
  isCloudModeEnabled?: boolean
  cloudModeDenyReason?: string
  isAnswerParserEnabled?: boolean
  answerParserDenyReason?: string
  onRefresh: () => void
  onManualReadList: () => void
  onOpenHomework: (hw: HomeworkItem) => void
  onTriggerParse: (hw: HomeworkItem) => void
}) {
  const [query, setQuery] = useState('')
  const currentList = activeTab === 'current' ? homeworks : historyHomeworks
  const isLoading = activeTab === 'current' ? isLoadingHomeworks : isLoadingHistory

  const filtered = currentList.filter((hw) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      hw.name.toLowerCase().includes(q) ||
      (hw.subject_name && hw.subject_name.toLowerCase().includes(q))
    )
  })

  return (
    <div className="fe-homework-container">
      {/* List Toolbar */}
      <div className="fe-list-toolbar">
        <div className="fe-list-toolbar__left">
          <div className="control-toolbar" style={{ width: '100%', maxWidth: 380 }}>
            <label>
              <Icon name="search" />
              <input
                placeholder={`搜索${activeTab === 'history' ? '历史' : '当前'}作业名称或学科...`}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={!hasLoaded}
              />
            </label>
          </div>
        </div>

        <div className="fe-list-toolbar__right">
          <span className="admin-pill-badge is-muted">
            {accountInfo?.bound
              ? hasLoaded
                ? `${activeTab === 'history' ? '往期归档' : '当前作业'} · 共 ${filtered.length} 份`
                : '待手动读取'
              : '未绑定 ETS100'}
          </span>
          <button
            className={`control-icon-button ${isLoading ? 'fe-spin' : ''}`}
            onClick={hasLoaded ? onRefresh : onManualReadList}
            disabled={isLoading}
            title={hasLoaded ? '重新同步作业列表' : '手动读取作业列表'}
            type="button"
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      {/* Body Area */}
      {!isCloudModeEnabled ? (
        <div className="fe-empty-state">
          <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
            <Icon name="cloud_off" />
          </div>
          <h2>云端模式已停用</h2>
          <p>{cloudModeDenyReason || '管理员已暂停云端作业拉取服务。'}</p>
        </div>
      ) : homeworkError ? (
        <div className="fe-empty-state">
          <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
            <Icon name="error_outline" />
          </div>
          <h2>作业同步失败</h2>
          <p>{homeworkError}</p>
          <button type="button" className="control-primary" onClick={hasLoaded ? onRefresh : onManualReadList}>
            重新尝试
          </button>
        </div>
      ) : !accountInfo?.bound ? (
        <div className="fe-empty-state">
          <div className="fe-empty-state__icon">
            <Icon name="no_accounts" />
          </div>
          <h2>未绑定 ETS100</h2>
          <p>请先前往官网账号中心绑定您的 ETS100 手机号与密码。</p>
          <a
            href="https://lastudio.cc/account"
            target="_blank"
            rel="noreferrer"
            className="control-primary"
            style={{ textDecoration: 'none' }}
          >
            前往账号中心绑定
          </a>
        </div>
      ) : !hasLoaded ? (
        <div className="fe-list-prompt-card">
          <div className="fe-list-prompt-icon">
            <Icon name="cloud_sync" filled />
          </div>
          <div className="fe-list-prompt-account-pill">
            <span className="admin-status-dot is-online" />
            <span>ETS100 账号：{accountInfo.account_display || '已关联'}</span>
          </div>
          <h3>{activeTab === 'current' ? '云端当前作业读取' : '云端历史作业读取'}</h3>
          <p className="fe-list-prompt-desc">
            系统支持从云端拉取{activeTab === 'current' ? '正在进行中的最新作业' : '往期完成及逾期的历史归档作业'}。
          </p>

          <div className="fe-list-prompt-risk-box">
            <div className="fe-list-risk-title">
              <Icon name="warning" filled />
              <span>官方客户端“顶号”风险重要说明</span>
            </div>
            <p>
              使用云端模式直连 E听说 获取作业列表时，可能会导致 E听说 官方客户端被退出登录（“顶号”）。
              为防止影响正常学习与答题，<strong>请务必避开考试、正式答题、录音提交等关键场景</strong>。在确认当前安全后，点击下方按钮手动读取。
            </p>
          </div>

          <button
            type="button"
            className="control-primary fe-list-prompt-action"
            onClick={onManualReadList}
            disabled={!isCloudModeEnabled}
            title={!isCloudModeEnabled ? (cloudModeDenyReason || '云端模式已停用') : undefined}
          >
            <Icon name="download" />
            <span>{activeTab === 'current' ? '确认安全，读取当前作业' : '确认安全，读取历史作业'}</span>
          </button>
        </div>
      ) : isLoading ? (
        <div className="fe-empty-state" style={{ margin: '50px auto' }}>
          <div className="fe-empty-state__icon spinning">
            <Icon name="sync" />
          </div>
          <h2>正在同步{activeTab === 'history' ? '历史' : '当前'}作业列表...</h2>
          <p style={{ color: 'var(--control-muted)', fontSize: 13 }}>正在从 ETS100 云端拉取最新作业，请稍候...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="fe-empty-state" style={{ margin: '50px auto' }}>
          <div className="fe-empty-state__icon">
            <Icon name={activeTab === 'history' ? 'history_toggle_drop' : 'inbox'} />
          </div>
          <h2>暂无{activeTab === 'history' ? '已归档的历史' : '待完成的当前'}作业</h2>
          <p>{activeTab === 'history' ? '往期完成的试卷将归档在此处。' : '当前没有待完成的作业。'}</p>
        </div>
      ) : (
        <div className="fe-homework-list">
          {filtered.map((hw, idx) => (
            <HomeworkCard
              key={hw.id}
              item={hw}
              index={idx}
              isParsing={hw.id === parsingId}
              parseError={parseErrors[hw.id]}
              isAnswerParserEnabled={isAnswerParserEnabled}
              answerParserDenyReason={answerParserDenyReason}
              onOpen={onOpenHomework}
              onTriggerParse={onTriggerParse}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SettingsPage({
  currentUser,
  accountInfo,
  softwareConfig,
  onRefreshSession,
  onOpenAnnouncement,
}: {
  currentUser: User | null
  accountInfo: PlatformAccountInfo | null
  softwareConfig: SoftwareConfig | null
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
  const [headerCompact, setHeaderCompact] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const authorizationStarted = useRef(false)
  const page = currentPage(pathname)

  // Fluid header scroll state
  useEffect(() => {
    const updateHeader = () => setHeaderCompact(window.scrollY > 42)
    updateHeader()
    window.addEventListener('scroll', updateHeader, { passive: true })
    return () => window.removeEventListener('scroll', updateHeader)
  }, [])

  // ETS100 & Homework State
  const [accountInfo, setAccountInfo] = useState<PlatformAccountInfo | null>(null)
  const [homeworks, setHomeworks] = useState<HomeworkItem[]>([])
  const [historyHomeworks, setHistoryHomeworks] = useState<HomeworkItem[]>([])
  const [isLoadingHomeworks, setIsLoadingHomeworks] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [hasLoadedCurrent, setHasLoadedCurrent] = useState(false)
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false)
  const activeTab: 'current' | 'history' = pathname === '/history' ? 'history' : 'current'

  // Viewing Paper State (Full-width reader view)
  const [viewingPaper, setViewingPaper] = useState<{ homework: HomeworkItem; paper: Paper | null } | null>(null)
  const [paperCache, setPaperCache] = useState<Record<string, Paper>>({})
  const [isLoadingPaper, setIsLoadingPaper] = useState(false)

  // Parsing state & error tracking per homework
  const [parsingId, setParsingId] = useState<string | null>(null)
  const [parseErrors, setParseErrors] = useState<Record<string, string>>({})

  // Modals & UI feedback
  const [showRiskModal, setShowRiskModal] = useState<HomeworkItem | null>(null)
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [homeworkError, setHomeworkError] = useState<string | null>(null)

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

  // Fetch platform account info on login (does not call ETS100, safe from kickout)
  useEffect(() => {
    if (!session) return
    let active = true

    getPlatformAccount(session.accessToken)
      .then((account) => {
        if (!active) return
        setAccountInfo(account)
      })
      .catch((err) => {
        if (!active) return
        console.error('Failed to load platform account info:', err)
      })

    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current)
      }
    }
  }, [])

  async function loadPaperDetail(token: string, homework: HomeworkItem): Promise<Paper | null> {
    if (paperCache[homework.id]) {
      return paperCache[homework.id]
    }
    setIsLoadingPaper(true)
    try {
      const detail = await getHomeworkDetail(token, homework.id)
      setPaperCache((prev) => ({ ...prev, [homework.id]: detail }))
      return detail
    } catch (err) {
      console.error('Failed to load paper detail:', err)
      return null
    } finally {
      setIsLoadingPaper(false)
    }
  }

  // Fe user operation flow: click homework -> open answer page. Manual click to read, no auto-reading!
  function handleOpenHomework(item: HomeworkItem) {
    const cached = paperCache[item.id]
    setViewingPaper({ homework: item, paper: cached || null })
  }

  async function handleManualReadPaper(item: HomeworkItem) {
    if (!item.parsed) {
      handleTriggerParse(item)
      return
    }
    if (!session) return
    const detail = await loadPaperDetail(session.accessToken, item)
    if (detail) {
      setViewingPaper((curr) => (curr?.homework.id === item.id ? { homework: item, paper: detail } : curr))
      showToast(`已成功读取《${item.name}》试卷与答案`)
    } else {
      showToast('读取试卷详情失败，请检查网络或稍后重试')
    }
  }

  async function handleReReadPaper(item: HomeworkItem) {
    if (!session) return
    setIsLoadingPaper(true)
    try {
      const detail = await getHomeworkDetail(session.accessToken, item.id)
      setPaperCache((prev) => ({ ...prev, [item.id]: detail }))
      setViewingPaper((curr) => (curr?.homework.id === item.id ? { homework: item, paper: detail } : curr))
      showToast('已重新从云端读取试卷与答案')
    } catch (err) {
      console.error('Failed to re-read paper detail:', err)
      showToast(err instanceof Error ? err.message : '重新读取失败')
    } finally {
      setIsLoadingPaper(false)
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
    setParseErrors((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })

    try {
      const resp = await startParseHomework(session.accessToken, {
        homework_id: item.id,
        homework_name: item.name,
        contents: item.contents,
      })

      if (resp.status === 'COMPLETED' && resp.result) {
        setParsingId(null)
        const paperResult = resp.result
        setPaperCache((prev) => ({ ...prev, [item.id]: paperResult }))
        setHomeworks((prev) =>
          prev.map((h) => (h.id === item.id ? { ...h, parsed: true } : h))
        )
        setHistoryHomeworks((prev) =>
          prev.map((h) => (h.id === item.id ? { ...h, parsed: true } : h))
        )
        showToast(`《${item.name}》答案解析完成！`)
        return
      }

      if (resp.task_id) {
        const taskId = resp.task_id

        if (pollingTimerRef.current) {
          window.clearInterval(pollingTimerRef.current)
        }

        pollingTimerRef.current = window.setInterval(async () => {
          try {
            const task = await getTaskStatus(session.accessToken, taskId)
            if (task.status === 'COMPLETED') {
              if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current)
              setParsingId(null)
              if (task.result) {
                setPaperCache((prev) => ({ ...prev, [item.id]: task.result! }))
              } else {
                void loadPaperDetail(session.accessToken, item)
              }
              setHomeworks((prev) =>
                prev.map((h) => (h.id === item.id ? { ...h, parsed: true } : h))
              )
              setHistoryHomeworks((prev) =>
                prev.map((h) => (h.id === item.id ? { ...h, parsed: true } : h))
              )
              showToast(`《${item.name}》答案解析完成！`)
            } else if (task.status === 'FAILED') {
              if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current)
              setParsingId(null)
              const failMsg = task.error || '解析失败'
              setParseErrors((prev) => ({ ...prev, [item.id]: failMsg }))
              showToast(`解析失败: ${failMsg}`)
            }
          } catch (err) {
            console.error('Task poll error:', err)
          }
        }, 1500)
      }
    } catch (err: unknown) {
      setParsingId(null)
      const errorMsg = err instanceof Error ? err.message : '发起解析失败'
      setParseErrors((prev) => ({ ...prev, [item.id]: errorMsg }))
      showToast(errorMsg)
    }
  }

  async function handleCopyAnswer(paper: Paper) {
    if (!isFeatureEnabled('copy_export')) {
      showToast(getFeatureDenyReason('copy_export', '答案导出功能已停用'))
      return
    }
    const text = formatPaperAsText(paper)
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

  function handleExportAnswer(paper: Paper) {
    if (!isFeatureEnabled('copy_export')) {
      showToast(getFeatureDenyReason('copy_export', '答案导出功能已停用'))
      return
    }
    const text = formatPaperAsText(paper)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${paper.title || paper.paperName || '作业答案'}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('已导出答案 TXT 文件')
  }

  async function doFetchHomeworks(tab: 'current' | 'history', capToken?: string) {
    if (!session) return
    if (!isFeatureEnabled('cloud_mode')) {
      setHomeworkError(getFeatureDenyReason('cloud_mode', '云端模式已暂时停用'))
      return
    }
    setHomeworkError(null)
    if (tab === 'current') {
      setIsLoadingHomeworks(true)
      try {
        const res = await getHomeworkList(session.accessToken, '1', capToken)
        setHomeworks(res.homeworks || [])
        setHasLoadedCurrent(true)
        showToast('已同步当前作业列表')
      } catch (err) {
        if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) {
          pendingRefreshRef.current = (token?: string) => {
            void doFetchHomeworks('current', token)
          }
          setShowCaptchaModal(true)
          return
        }
        const msg = err instanceof Error ? err.message : '获取当前作业列表失败'
        console.error('Failed to load current homework list:', err)
        setHomeworkError(msg)
        showToast(`作业列表同步失败: ${msg}`)
      } finally {
        setIsLoadingHomeworks(false)
      }
    } else {
      setIsLoadingHistory(true)
      try {
        const [res2, res3] = await Promise.all([
          getHomeworkList(session.accessToken, '2', capToken).catch((err) => {
            if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) throw err
            return { homeworks: [] }
          }),
          getHomeworkList(session.accessToken, '3', capToken).catch((err) => {
            if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) throw err
            return { homeworks: [] }
          }),
        ])
        setHistoryHomeworks([...(res2.homeworks || []), ...(res3.homeworks || [])])
        setHasLoadedHistory(true)
        showToast('已同步历史与逾期作业')
      } catch (err) {
        if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) {
          pendingRefreshRef.current = (token?: string) => {
            void doFetchHomeworks('history', token)
          }
          setShowCaptchaModal(true)
          return
        }
        const msg = err instanceof Error ? err.message : '获取历史作业列表失败'
        console.error('Failed to load history homework list:', err)
        setHomeworkError(msg)
        showToast(`历史作业获取失败: ${msg}`)
      } finally {
        setIsLoadingHistory(false)
      }
    }
  }

  async function refreshAccountAndHomeworks(capToken?: string) {
    if (!session) return
    setHomeworkError(null)
    try {
      const account = await getPlatformAccount(session.accessToken)
      setAccountInfo(account)
      if (account.bound) {
        await doFetchHomeworks(activeTab, capToken)
      }
    } catch (err) {
      if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) {
        pendingRefreshRef.current = (token?: string) => {
          void refreshAccountAndHomeworks(token)
        }
        setShowCaptchaModal(true)
        return
      }
      console.error('Failed to refresh data:', err)
      showToast('刷新失败，请稍后重试')
    }
  }

  const [showCaptchaModal, setShowCaptchaModal] = useState(false)
  const pendingRefreshRef = useRef<((token?: string) => void) | null>(null)

  function handleManualReadList() {
    if (shouldTriggerCaptchaDefense()) {
      pendingRefreshRef.current = (token?: string) => {
        void doFetchHomeworks(activeTab, token)
      }
      setShowCaptchaModal(true)
      return
    }
    recordRefreshTimestamp()
    void doFetchHomeworks(activeTab)
  }

  function handleRequestRefresh() {
    if (shouldTriggerCaptchaDefense()) {
      pendingRefreshRef.current = (token?: string) => {
        void refreshAccountAndHomeworks(token)
      }
      setShowCaptchaModal(true)
      return
    }
    recordRefreshTimestamp()
    void refreshAccountAndHomeworks()
  }

  function handleCaptchaSuccess(token: string) {
    setShowCaptchaModal(false)
    clearRefreshTimestamps()
    showToast('安全验证通过，正在同步作业数据...')
    if (pendingRefreshRef.current) {
      const fn = pendingRefreshRef.current
      pendingRefreshRef.current = null
      fn(token)
    } else {
      void refreshAccountAndHomeworks(token)
    }
  }

  function navigate(nextPage: Page) {
    setViewingPaper(null)
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

      {showCaptchaModal && (
        <CaptchaModal
          onSuccess={handleCaptchaSuccess}
          onCancel={() => {
            setShowCaptchaModal(false)
            pendingRefreshRef.current = null
          }}
        />
      )}

      {/* Floating Header Capsule */}
      <header className={`control-site-header ${headerCompact ? 'is-compact' : ''}`}>
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
                    <span className="control-nav-label">
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
              <h1>{viewingPaper ? `试卷阅读 · ${viewingPaper.homework.name}` : meta.title}</h1>
              <span>{viewingPaper ? '查看作业结构、题目解析与标准答案' : meta.caption}</span>
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
          {page === '/settings' ? (
            <SettingsPage
              currentUser={currentUser}
              accountInfo={accountInfo}
              softwareConfig={softwareConfig}
              onRefreshSession={handleRequestRefresh}
              onOpenAnnouncement={() => setShowAnnouncementModal(true)}
            />
          ) : viewingPaper ? (
            <PaperReaderView
              homework={viewingPaper.homework}
              paper={viewingPaper.paper}
              isLoadingPaper={isLoadingPaper}
              isCopyExportEnabled={isFeatureEnabled('copy_export')}
              copyExportDenyReason={getFeatureDenyReason('copy_export')}
              isAnswerParserEnabled={isFeatureEnabled('answer_parser')}
              answerParserDenyReason={getFeatureDenyReason('answer_parser')}
              onBack={() => setViewingPaper(null)}
              onCopyAnswer={() => viewingPaper.paper && handleCopyAnswer(viewingPaper.paper)}
              onExportAnswer={() => viewingPaper.paper && handleExportAnswer(viewingPaper.paper)}
              onReParse={() => handleReReadPaper(viewingPaper.homework)}
              onManualRead={() => handleManualReadPaper(viewingPaper.homework)}
            />
          ) : (
            <HomeworkListView
              activeTab={activeTab}
              hasLoaded={activeTab === 'current' ? hasLoadedCurrent : hasLoadedHistory}
              accountInfo={accountInfo}
              homeworks={homeworks}
              historyHomeworks={historyHomeworks}
              isLoadingHomeworks={isLoadingHomeworks}
              isLoadingHistory={isLoadingHistory}
              homeworkError={homeworkError}
              parsingId={parsingId}
              parseErrors={parseErrors}
              isCloudModeEnabled={isFeatureEnabled('cloud_mode')}
              cloudModeDenyReason={getFeatureDenyReason('cloud_mode')}
              isAnswerParserEnabled={isFeatureEnabled('answer_parser')}
              answerParserDenyReason={getFeatureDenyReason('answer_parser')}
              onRefresh={handleRequestRefresh}
              onManualReadList={handleManualReadList}
              onOpenHomework={handleOpenHomework}
              onTriggerParse={handleTriggerParse}
            />
          )}
        </section>
      </div>
    </main>
  )
}

export default App
