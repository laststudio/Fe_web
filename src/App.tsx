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
              title={isAnswerParserEnabled ? '重新从云端解析试卷' : (answerParserDenyReason || '答案解析已停用')}
            >
              <Icon name="refresh" />
              <span>重新解析</span>
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
          <h2>正在加载试卷及标准答案...</h2>
          <p style={{ color: 'var(--control-muted)', fontSize: 13 }}>正在读取试卷题目与解析内容，请稍候...</p>
        </div>
      ) : !paper ? (
        <div className="fe-empty-state" style={{ margin: '50px auto' }}>
          <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
            <Icon name="error_outline" />
          </div>
          <h2>未能加载试卷详情</h2>
          <p>可能由于网络超时或解析数据丢失。</p>
          <button className="control-primary" type="button" onClick={onReParse}>
            <Icon name="refresh" /> 重新解析
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
  onTabChange,
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
  onOpenHomework,
  onTriggerParse,
}: {
  activeTab: 'current' | 'history'
  onTabChange: (tab: 'current' | 'history') => void
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
      {/* List Toolbar with Segmented Switch */}
      <div className="fe-list-toolbar">
        <div className="fe-list-toolbar__left">
          <div className="fe-segmented-control" role="tablist">
            <button
              className={activeTab === 'current' ? 'is-active' : ''}
              onClick={() => onTabChange('current')}
              type="button"
              role="tab"
              aria-selected={activeTab === 'current'}
            >
              <Icon name="assignment" />
              <span>当前作业 ({homeworks.length})</span>
            </button>
            <button
              className={activeTab === 'history' ? 'is-active' : ''}
              onClick={() => onTabChange('history')}
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
            >
              <Icon name="history" />
              <span>历史作业 ({historyHomeworks.length})</span>
            </button>
          </div>

          <div className="control-toolbar" style={{ width: 'auto', minWidth: 240 }}>
            <label>
              <Icon name="search" />
              <input
                placeholder={`搜索${activeTab === 'history' ? '历史' : '当前'}作业名称或学科...`}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="fe-list-toolbar__right">
          <span className="admin-pill-badge is-muted">
            {accountInfo?.bound ? `已连接 · 共 ${filtered.length} 份` : '未绑定 ETS100'}
          </span>
          <button
            className="control-icon-button"
            onClick={onRefresh}
            title="重新同步作业列表"
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
          <button type="button" className="control-primary" onClick={onRefresh}>
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
  const [isLoadingHomeworks, setIsLoadingHomeworks] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [activeTab, setActiveTab] = useState<'current' | 'history'>(() => pathname === '/history' ? 'history' : 'current')

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

  useEffect(() => {
    if (pathname === '/history') {
      setActiveTab('history')
    } else if (pathname === '/') {
      setActiveTab('current')
    }
  }, [pathname])

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
            setIsLoadingHomeworks(true)
            const res = await getHomeworkList(session.accessToken, '1')
            if (!active) return
            setHomeworkError(null)
            setHomeworks(res.homeworks || [])
          } catch (err) {
            if (!active) return
            const msg = err instanceof Error ? err.message : '获取作业列表失败'
            console.error('Failed to load homework list:', err)
            setHomeworkError(msg)
          } finally {
            if (active) setIsLoadingHomeworks(false)
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
    if (!session || (page !== '/history' && activeTab !== 'history')) return
    if (!isFeatureEnabled('cloud_mode')) return
    if (historyHomeworks.length > 0) return
    let active = true
    setIsLoadingHistory(true)

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
  }, [session, page, activeTab, historyHomeworks.length, softwareConfig, softwareFeatures])

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

  // Fe user operation flow: click homework -> show answers if parsed, or trigger parse if unparsed!
  async function handleOpenHomework(item: HomeworkItem) {
    if (!item.parsed) {
      handleTriggerParse(item)
      return
    }
    const cached = paperCache[item.id]
    if (cached) {
      setViewingPaper({ homework: item, paper: cached })
      return
    }
    setViewingPaper({ homework: item, paper: null })
    if (session) {
      const detail = await loadPaperDetail(session.accessToken, item)
      setViewingPaper((curr) => (curr?.homework.id === item.id ? { homework: item, paper: detail } : curr))
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
            setIsLoadingHomeworks(true)
            const res = await getHomeworkList(session.accessToken, '1')
            setHomeworkError(null)
            setHomeworks(res.homeworks || [])
            if (activeTab === 'history') {
              setIsLoadingHistory(true)
              const [res2, res3] = await Promise.all([
                getHomeworkList(session.accessToken, '2').catch(() => ({ homeworks: [] })),
                getHomeworkList(session.accessToken, '3').catch(() => ({ homeworks: [] })),
              ])
              setHistoryHomeworks([...(res2.homeworks || []), ...(res3.homeworks || [])])
              setIsLoadingHistory(false)
            }
            showToast('已重新同步作业列表')
          } catch (err) {
            const msg = err instanceof Error ? err.message : '获取作业列表失败'
            console.error('Failed to refresh homework data:', err)
            setHomeworkError(msg)
            showToast(`作业列表同步失败: ${msg}`)
          } finally {
            setIsLoadingHomeworks(false)
          }
        }
      })
      .catch((err) => {
        console.error('Failed to refresh data:', err)
        showToast('刷新失败，请稍后重试')
      })
  }

  function handleTabChange(tab: 'current' | 'history') {
    setActiveTab(tab)
    setViewingPaper(null)
    const targetPage = tab === 'history' ? '/history' : '/'
    if (pathname !== targetPage) {
      navigate(targetPage)
    }
  }

  function navigate(nextPage: Page) {
    setViewingPaper(null)
    if (nextPage === '/history') {
      setActiveTab('history')
    } else if (nextPage === '/') {
      setActiveTab('current')
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
              softwareFeatures={softwareFeatures}
              onRefreshSession={refreshAccountAndHomeworks}
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
              onReParse={() => handleTriggerParse(viewingPaper.homework)}
            />
          ) : (
            <HomeworkListView
              activeTab={activeTab}
              onTabChange={handleTabChange}
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
              onRefresh={refreshAccountAndHomeworks}
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
