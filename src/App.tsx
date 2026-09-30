import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import { ApiError, getCurrentUser, setUnauthorizedHandler, type User } from './api/auth'
import {
  changyanLogin,
  cleanAnswerText,
  formatPaperAsText,
  getHomeworkDetail,
  getHomeworkList,
  getPlatformAccount,
  getSoftwareConfig,
  getSoftwareFeatures,
  getTaskStatus,
  startParseHomework,
  trackFeatureUsage,
  type ChangyanCredentialPayload,
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
import ChangyanLoginModal from './auth/ChangyanLoginModal'
import { oauthConfig } from './auth/config'
import { refreshOAuthToken, startAuthorization } from './auth/oauth'
import type { AuthSession } from './auth/types'
import { transitionRoute, transitionTo } from './navigation/controller'
import CapVerification from './CapVerification'
import AutoCompletePage from './AutoCompletePage'
import VoiceManager from './components/VoiceManager'
import { ErrorBoundary } from './components/ErrorBoundary'
import {
  checkHomeworkCompatibility,
  getAutoCompletePermit,
  getAutoCompleteTaskStatus,
  getLatestAutoCompleteTask,
  type AutoCompleteTaskResponse,
} from './api/autoComplete'

type Page = '/' | '/history' | '/pk' | '/settings' | '/auto-complete' | string

const logoSrc = '/fe_logo.png'
const sidebarCollapsedStorageKey = 'fe-web.sidebar-collapsed'
const skipRiskWarningStorageKey = 'fe-web.skip-risk-warning'
const legalConsentStorageKey = 'fe-web.legal-consent'
const legalConsentVersion = '2026-09-25'
const STORAGE_KEY_ACTIVE_TASK = 'fe_auto_complete_active_task'
const STORAGE_KEY_AUTO_COMPLETE_RETURN_PAGE = 'fe_auto_complete_return_page'
const SESSION_STORAGE_KEY = 'lastudio.feweb.session'
const SESSION_EXPIRY_MARGIN_MS = 30_000

function readStoredSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession
    if (
      !parsed
      || typeof parsed.accessToken !== 'string'
      || !Number.isFinite(parsed.expiresAt)
    ) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
      return null
    }
    if (parsed.expiresAt <= Date.now() + SESSION_EXPIRY_MARGIN_MS && !parsed.refreshToken) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStoredSession(session: AuthSession | null) {
  try {
    if (session) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  } catch {
    // LocalStorage might be disabled in private mode
  }
}

export type FeatureCheck = {
  enabled: boolean
  status: 'enabled' | 'membership_required' | 'feature_disabled' | 'kill_switch'
  reason: string
  minMemberLevel?: number
  minMemberTier?: string
}


function readStoredActiveTask(): AutoCompleteTaskResponse | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_TASK)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AutoCompleteTaskResponse
    if (parsed && ['COMPLETED', 'FAILED'].includes(parsed.status)) {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_TASK)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

type NavItem = {
  icon: string
  label: string
  caption: string
  page: Page
  badge?: string
  badgeType?: 'running' | 'success' | 'failed'
  isRunning?: boolean
}

export type HomeworkErrorInfo = {
  type: 'membership_required' | 'feature_disabled' | 'kill_switch' | 'network_error' | 'other'
  message: string
  actionUrl?: string
  actionText?: string
}

const pageMeta: Record<string, { title: string; caption: string }> = {
  '/': {
    title: '当前作业',
    caption: '获取与查看作业标准答案',
  },
  '/history': {
    title: '历史作业',
    caption: '往期归档试卷与答案速查',
  },
  '/pk': {
    title: '词汇PK',
    caption: '在线词汇练习',
  },
  '/settings': {
    title: '设置与账号',
    caption: '平台账号绑定与功能设置',
  },
  '/auto-complete': {
    title: '作业自动完成',
    caption: '自动完成任务与进度查看',
  },
}

function friendlyTaskStage(stage: string | null | undefined): string {
  const value = String(stage || '').trim()
  if (!value) return '任务处理中...'
  const cleaned = value
    .replace(/^\[\d+\/\d+\]\s*/, '')
    .replace(/国内代理节点|国内代理/g, '')
    .replace(/出口节点/g, '网络')
    .replace(/后台流水线|流水线/g, '任务')
    .replace(/初始化 ETS 会话/g, '准备登录状态')
    .replace(/初始化做题环境/g, '准备作业')
    .replace(/无需重复配置部署/g, '无需重复配置')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || '任务处理中...'
}

function Icon({ name, className = '', filled = false, style }: { name: string; className?: string; filled?: boolean; style?: CSSProperties }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ ...(filled ? { fontVariationSettings: "'FILL' 1" } : {}), ...style }}
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

function readStoredLegalConsent(): boolean {
  try {
    return window.localStorage.getItem(legalConsentStorageKey) === legalConsentVersion
  } catch {
    return false
  }
}

function writeStoredLegalConsent(): void {
  try {
    window.localStorage.setItem(legalConsentStorageKey, legalConsentVersion)
  } catch {
    // LocalStorage might be disabled in private mode; the in-memory state still gates this session.
  }
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

function LegalConsentModal({ onAccept }: { onAccept: () => void }) {
  const [checked, setChecked] = useState(false)
  const checkboxId = useId()

  return (
    <div className="risk-modal-backdrop legal-consent-backdrop" role="dialog" aria-modal="true" aria-labelledby="legal-consent-title">
      <div className="risk-modal-card legal-consent-card">
        <div className="risk-modal-head legal-consent-head">
          <div className="risk-icon-wrap legal-consent-icon">
            <Icon name="verified_user" filled />
          </div>
          <div>
            <h2 id="legal-consent-title">首次使用前，请阅读服务说明</h2>
            <p className="risk-modal-subtitle">Fe Web · LA Studio 服务</p>
          </div>
        </div>
        <div className="risk-modal-body legal-consent-body">
          <p>
            使用作业同步、解析、语音和第三方账号绑定功能前，请先阅读并理解以下文件。不同意时无法继续使用 Fe Web。
          </p>
          <div className="legal-consent-links" aria-label="服务文件">
            <a href="https://lastudio.cc/terms#section-1" target="_blank" rel="noreferrer">
              <Icon name="description" /> 服务协议
              <Icon name="open_in_new" />
            </a>
            <a href="https://lastudio.cc/terms#section-3" target="_blank" rel="noreferrer">
              <Icon name="lock" /> 隐私政策
              <Icon name="open_in_new" />
            </a>
            <a href="https://lastudio.cc/terms#section-4" target="_blank" rel="noreferrer">
              <Icon name="warning" /> 免责声明
              <Icon name="open_in_new" />
            </a>
          </div>
          <div className="legal-consent-note">
            <strong>重点提示</strong>
            <span>第三方账号凭据、作业内容和语音数据只会在你主动使用对应功能时处理；解析结果仅供课后学习参考，禁止用于考试作弊。</span>
          </div>
          <label className="risk-modal-checkbox legal-consent-checkbox" htmlFor={checkboxId}>
            <input
              id={checkboxId}
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>我已阅读并同意《服务协议》《隐私政策》和《免责声明》</span>
          </label>
        </div>
        <div className="risk-modal-actions legal-consent-actions">
          <span>协议版本：2026-09-25</span>
          <button className="control-primary" type="button" disabled={!checked} onClick={onAccept}>
            同意并继续
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
            如果您的手机或平板端 e听说 <strong>当前正在答题或录音</strong>，解析可能导致移动端被挤下线。
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

/**
 * 会话是否已过期。
 * 抽到模块作用域：React Compiler 的 react-hooks/purity 会把 effect 内的
 * `Date.now()` 误判为渲染期调用，放到模块函数里即可绕开。
 */
function isSessionExpired(expiresAt: number | undefined | null): boolean {
  return typeof expiresAt === 'number' && expiresAt <= Date.now()
}

function CaptchaModal({
  title = '安全人机验证',
  subtitle = '为保护 ETS 账号安全并防御接口频繁请求，请完成下方人机验证以继续。',
  onSuccess,
  onCancel,
}: {
  title?: string
  subtitle?: string
  onSuccess: (capToken: string) => void
  onCancel: () => void
}) {
  const [error, setError] = useState('')
  const handledRef = useRef(false)

  const handleToken = (token: string) => {
    if (!token || handledRef.current) return
    handledRef.current = true
    onSuccess(token)
  }

  return (
    <div className="risk-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="captcha-modal-title">
      <div className="risk-modal-card fe-captcha-modal-card">
        <div className="fe-captcha-head">
          <div className="risk-icon-wrap">
            <Icon name="verified_user" filled />
          </div>
          <div>
            <h2 id="captcha-modal-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>

        <div className="fe-cap-modal-body" style={{ padding: '20px 24px' }}>
          <CapVerification
            onError={(msg) => setError(msg)}
            onToken={handleToken}
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
  copyExportStatus = 'enabled',
  copyExportDenyReason,
  answerParserStatus = 'enabled',
  answerParserDenyReason,
  onBack,
  onCopyAnswer,
  onExportAnswer,
  onReParse,
  onManualRead,
  onAutoComplete,
  activeTask,
}: {
  homework: HomeworkItem
  paper: Paper | null
  isLoadingPaper: boolean
  copyExportStatus?: 'enabled' | 'membership_required' | 'feature_disabled' | 'kill_switch'
  copyExportDenyReason?: string
  answerParserStatus?: 'enabled' | 'membership_required' | 'feature_disabled' | 'kill_switch'
  answerParserDenyReason?: string
  onBack: () => void
  onCopyAnswer: () => void
  onExportAnswer: () => void
  onReParse: () => void
  onManualRead: () => void
  onAutoComplete?: () => void
  activeTask?: AutoCompleteTaskResponse | null
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
                  title={
                    copyExportStatus === 'membership_required'
                      ? (copyExportDenyReason || '复制答案需要会员权限')
                      : copyExportStatus === 'feature_disabled'
                      ? (copyExportDenyReason || '答案导出已停用')
                      : '复制整套答案文本到剪贴板'
                  }
                >
                  <Icon name={copyExportStatus === 'membership_required' ? 'workspace_premium' : 'content_copy'} />
                  <span>{copyExportStatus === 'membership_required' ? '会员复制' : '复制答案'}</span>
                </button>
                <button
                  className="control-secondary"
                  type="button"
                  onClick={onExportAnswer}
                  title={
                    copyExportStatus === 'membership_required'
                      ? (copyExportDenyReason || '导出答案需要会员权限')
                      : copyExportStatus === 'feature_disabled'
                      ? (copyExportDenyReason || '答案导出已停用')
                      : '导出为本地 TXT 文本'
                  }
                >
                  <Icon name={copyExportStatus === 'membership_required' ? 'workspace_premium' : 'download'} />
                  <span>{copyExportStatus === 'membership_required' ? '会员导出' : '导出 TXT'}</span>
                </button>
              </>
            )}
            {onAutoComplete && (() => {
              const compat = checkHomeworkCompatibility(homework, paper)
              const isThisTaskRunning =
                activeTask &&
                String(activeTask.homework_id) === String(homework.id) &&
                !['COMPLETED', 'FAILED'].includes(activeTask.status)

              if (isThisTaskRunning) {
                return (
                  <button
                    className="control-primary fe-btn-auto-complete is-running"
                    type="button"
                    style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      borderColor: '#059669',
                      color: '#ffffff',
                      boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
                    }}
                    onClick={onAutoComplete}
                    title={`该作业正在后台自动答题中（进度 ${activeTask.progress || 0}%），点击查看实时执行看板`}
                  >
                    <Icon name="sync" className="fe-spin" />
                    <span>执行中 ({activeTask.progress || 0}%)</span>
                  </button>
                )
              }

              return (
                <button
                  className={`control-primary fe-btn-auto-complete ${!compat.supported ? 'control-disabled' : ''}`}
                  type="button"
                  style={{
                    opacity: compat.supported ? 1 : 0.45,
                    cursor: compat.supported ? 'pointer' : 'not-allowed',
                  }}
                  onClick={onAutoComplete}
                  title={compat.supported ? '自动完成此试卷' : (compat.reason || '该试卷包含暂不支持的题型')}
                >
                  <Icon name={compat.supported ? 'bolt' : 'block'} />
                  <span>{compat.supported ? '⚡ 自动完成此试卷' : '题型暂不支持'}</span>
                </button>
              )
            })()}
            <button
              className="control-secondary"
              type="button"
              onClick={onReParse}
              title={
                answerParserStatus === 'membership_required'
                  ? (answerParserDenyReason || '重新读取需要会员权限')
                  : answerParserStatus === 'feature_disabled'
                  ? (answerParserDenyReason || '答案解析已停用')
                  : '重新从云端读取或解析试卷'
              }
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
          <div
            className="fe-reader-prompt-icon"
            style={
              answerParserStatus === 'membership_required'
                ? { background: '#fffbeb', color: '#d97706' }
                : answerParserStatus === 'feature_disabled'
                ? { background: '#f1f5f9', color: '#64748b' }
                : undefined
            }
          >
            <Icon
              name={
                answerParserStatus === 'membership_required'
                  ? 'workspace_premium'
                  : answerParserStatus === 'feature_disabled'
                  ? 'block'
                  : 'menu_book'
              }
              filled
            />
          </div>
          <h3>
            {answerParserStatus === 'membership_required'
              ? '答案解析需要会员权限'
              : answerParserStatus === 'feature_disabled'
              ? '答案解析功能已暂停'
              : '试卷答案准备就绪'}
          </h3>
          <p>
            {answerParserStatus === 'membership_required'
              ? (answerParserDenyReason || '该功能需要开通会员权限后方可使用。请前往官网账号中心开通或升级。')
              : answerParserStatus === 'feature_disabled'
              ? (answerParserDenyReason || '管理员已暂停答案解析与试卷读取服务，请留意后续通知。')
              : '为防止接口频繁请求及避免官方客户端被顶号，系统未自动加载答案。请在确认当前无进行中的答题或考试后，手动点击下方按钮读取。'}
          </p>
          {answerParserStatus === 'membership_required' ? (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href="https://lastudio.cc/account"
                target="_blank"
                rel="noreferrer"
                className="control-primary fe-reader-prompt-action"
                style={{ textDecoration: 'none' }}
              >
                <Icon name="open_in_new" />
                <span>前往开通会员</span>
              </a>
              <button
                className="control-secondary fe-reader-prompt-action"
                type="button"
                onClick={onManualRead}
              >
                <Icon name="refresh" />
                <span>重新检测</span>
              </button>
            </div>
          ) : (
            <button
              className="control-primary fe-reader-prompt-action"
              type="button"
              onClick={onManualRead}
              disabled={answerParserStatus === 'feature_disabled'}
              title={answerParserStatus === 'feature_disabled' ? (answerParserDenyReason || '答案解析已停用') : undefined}
            >
              <Icon name={answerParserStatus === 'feature_disabled' ? 'block' : 'visibility'} />
              <span>
                {answerParserStatus === 'feature_disabled'
                  ? '功能已由管理员停用'
                  : homework.parsed
                  ? '读取试卷与答案'
                  : '开始解析并读取答案'}
              </span>
            </button>
          )}
        </div>
      ) : paper.sections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <Icon name="assignment" style={{ fontSize: '48px', opacity: 0.5, marginBottom: '16px' }} />
          <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}>暂无可显示的题目内容</div>
          <div style={{ fontSize: '13px', opacity: 0.8 }}>该作业可能暂未开始或暂无可解析的题目数据</div>
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
  answerParserStatus = 'enabled',
  answerParserDenyReason,
  onOpen,
  onTriggerParse,
  onAutoComplete,
  activeTask,
}: {
  item: HomeworkItem
  index: number
  isParsing: boolean
  parseError?: string | null
  answerParserStatus?: 'enabled' | 'membership_required' | 'feature_disabled' | 'kill_switch'
  answerParserDenyReason?: string
  onOpen: (hw: HomeworkItem) => void
  onTriggerParse: (hw: HomeworkItem) => void
  onAutoComplete?: (hw: HomeworkItem) => void
  activeTask?: AutoCompleteTaskResponse | null
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
            {(item.pk === 1 || item.set_type === 6) && (
              <span
                className="fe-subject-tag fe-subject-tag--pk"
                style={{
                  background: 'var(--amber-light, #fef3c7)',
                  color: 'var(--amber-dark, #b45309)',
                  borderColor: 'var(--amber-border, #fde68a)',
                  fontWeight: 600,
                }}
              >
                词汇PK
              </span>
            )}
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
        {onAutoComplete && (() => {
          const isDone = item.status === 2 || item.status === '2'
          const compat = checkHomeworkCompatibility(item)
          const isThisTaskRunning =
            activeTask &&
            String(activeTask.homework_id) === String(item.id) &&
            !['COMPLETED', 'FAILED'].includes(activeTask.status)

          if (isThisTaskRunning) {
            return (
              <button
                className="control-primary fe-btn-auto-complete is-running"
                type="button"
                style={{
                  padding: '7px 14px',
                  fontSize: 12.5,
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  borderColor: '#059669',
                  color: '#ffffff',
                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onAutoComplete(item)
                }}
                title={`该作业正在后台自动答题中（进度 ${activeTask.progress || 0}%），点击查看实时执行看板`}
              >
                <Icon name="sync" className="fe-spin" />
                <span>执行中 ({activeTask.progress || 0}%)</span>
              </button>
            )
          }

          return (
            <button
              className={`control-secondary fe-btn-auto-complete ${!compat.supported ? 'control-disabled' : ''}`}
              type="button"
              style={{
                padding: '7px 14px',
                fontSize: 12.5,
                opacity: compat.supported ? 1 : 0.45,
                cursor: compat.supported ? 'pointer' : 'not-allowed',
              }}
              onClick={(e) => {
                e.stopPropagation()
                onAutoComplete(item)
              }}
              title={compat.supported ? (isDone ? '重新自动作答并更新此历史作业成绩' : '一键安全自动完成此作业') : (compat.reason || '该作业包含暂不支持的题型')}
            >
              <Icon name={compat.supported ? (isDone ? 'replay' : 'bolt') : 'block'} />
              <span>{compat.supported ? (isDone ? '⚡ 重新作答' : '⚡ 自动完成') : '题型暂不支持'}</span>
            </button>
          )
        })()}
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
        ) : answerParserStatus === 'membership_required' ? (
          <button
            className="control-secondary"
            type="button"
            style={{
              padding: '7px 14px',
              fontSize: 12.5,
              borderColor: '#f59e0b',
              color: '#d97706',
              background: '#fffbeb',
            }}
            title={answerParserDenyReason || '该功能需要开通会员'}
            onClick={(e) => {
              e.stopPropagation()
              onTriggerParse(item)
            }}
          >
            <Icon name="workspace_premium" />
            <span>需要会员</span>
          </button>
        ) : answerParserStatus === 'feature_disabled' ? (
          <button
            className="control-secondary"
            type="button"
            style={{ padding: '7px 14px', fontSize: 12.5, opacity: 0.6 }}
            disabled
            title={answerParserDenyReason || '解析功能已由管理员停用'}
            onClick={(e) => {
              e.stopPropagation()
              onTriggerParse(item)
            }}
          >
            <Icon name="block" />
            <span>已停用</span>
          </button>
        ) : (
          <button
            className="control-secondary"
            type="button"
            style={{ padding: '7px 14px', fontSize: 12.5 }}
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
  cloudModeStatus = 'enabled',
  cloudModeDenyReason,
  answerParserStatus = 'enabled',
  answerParserDenyReason,
  onRefresh,
  onManualReadList,
  onOpenHomework,
  onTriggerParse,
  onAutoComplete,
  onChangyanLogin,
  activeTask,
}: {
  activeTab: 'current' | 'history' | 'pk'
  hasLoaded: boolean
  accountInfo: PlatformAccountInfo | null
  homeworks: HomeworkItem[]
  historyHomeworks: HomeworkItem[]
  isLoadingHomeworks: boolean
  isLoadingHistory: boolean
  homeworkError?: HomeworkErrorInfo | string | null
  parsingId: string | null
  parseErrors: Record<string, string>
  cloudModeStatus?: 'enabled' | 'membership_required' | 'feature_disabled' | 'kill_switch'
  cloudModeDenyReason?: string
  answerParserStatus?: 'enabled' | 'membership_required' | 'feature_disabled' | 'kill_switch'
  answerParserDenyReason?: string
  onRefresh: () => void
  onManualReadList: () => void
  onOpenHomework: (hw: HomeworkItem) => void
  onTriggerParse: (hw: HomeworkItem) => void
  onAutoComplete?: (hw: HomeworkItem) => void
  onChangyanLogin?: () => void
  activeTask?: AutoCompleteTaskResponse | null
}) {
  const [query, setQuery] = useState('')
  // 账号中心绑定与「讯飞登录」都算可用；后者只写入云端会话缓存，没有绑定记录。
  const etsReady = Boolean(accountInfo?.bound || accountInfo?.session_ready)

  const pkHomeworks = useMemo<HomeworkItem[]>(() => {
    const combined = [...homeworks, ...historyHomeworks]
    const seen = new Set<string>()
    return combined.filter((hw: HomeworkItem) => {
      const key = hw.id || hw.name
      if (seen.has(key)) return false
      seen.add(key)
      return hw.pk === 1 || hw.set_type === 6
    })
  }, [homeworks, historyHomeworks])

  const currentList = useMemo<HomeworkItem[]>(() => {
    if (activeTab === 'current') return homeworks
    if (activeTab === 'history') return historyHomeworks
    return pkHomeworks
  }, [activeTab, homeworks, historyHomeworks, pkHomeworks])

  const isLoading = activeTab === 'current'
    ? isLoadingHomeworks
    : activeTab === 'history'
    ? isLoadingHistory
    : (isLoadingHomeworks || isLoadingHistory)

  const categoryMeta = {
    current: {
      title: '当前作业',
      desc: '待完成的课堂与课后练习',
      count: homeworks.length,
    },
    history: {
      title: '历史作业',
      desc: '已完成及逾期的往期归档',
      count: historyHomeworks.length,
    },
    pk: {
      title: '词汇PK',
      desc: '在线词汇练习',
      count: pkHomeworks.length,
    },
  }[activeTab]

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
                placeholder={`搜索${categoryMeta.title}名称或学科...`}
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
            {etsReady
              ? hasLoaded
                ? `${categoryMeta.title} · 共 ${filtered.length} 份`
                : '待手动读取'
              : '未绑定 e听说'}
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
      {cloudModeStatus !== 'enabled' ? (
        (() => {
          if (cloudModeStatus === 'membership_required') {
            return (
              <div className="fe-empty-state">
                <div className="fe-empty-state__icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                  <Icon name="workspace_premium" />
                </div>
                <h2>云端模式需要会员权限</h2>
                <p>{cloudModeDenyReason || '云端同步与作业拉取功能需要开通会员权限后方可使用。'}</p>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <a
                    href="https://lastudio.cc/account"
                    target="_blank"
                    rel="noreferrer"
                    className="control-primary"
                    style={{ textDecoration: 'none' }}
                  >
                    <Icon name="open_in_new" /> 前往账号中心开通
                  </a>
                  <button type="button" className="control-secondary" onClick={onRefresh}>
                    重新检测
                  </button>
                </div>
              </div>
            )
          }
          if (cloudModeStatus === 'kill_switch') {
            return (
              <div className="fe-empty-state">
                <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
                  <Icon name="build_circle" />
                </div>
                <h2>系统正在维护中</h2>
                <p>{cloudModeDenyReason || '服务正在紧急维护，所有云端与解析功能已暂时关闭。'}</p>
                <button type="button" className="control-secondary" onClick={onRefresh}>
                  刷新重试
                </button>
              </div>
            )
          }
          return (
            <div className="fe-empty-state">
              <div className="fe-empty-state__icon" style={{ background: '#f1f5f9', color: '#64748b' }}>
                <Icon name="cloud_off" />
              </div>
              <h2>云端模式已停用</h2>
              <p>{cloudModeDenyReason || '管理员已暂停云端作业拉取服务。'}</p>
              <button type="button" className="control-secondary" onClick={onRefresh}>
                重新检测
              </button>
            </div>
          )
        })()
      ) : (homeworkError && !hasLoaded && currentList.length === 0) ? (
        (() => {
          const errInfo: HomeworkErrorInfo = typeof homeworkError === 'string'
            ? {
                type: homeworkError.includes('会员') || homeworkError.includes('VIP')
                  ? 'membership_required'
                  : homeworkError.includes('网络')
                  ? 'network_error'
                  : homeworkError.includes('维护') || homeworkError.includes('紧急停用')
                  ? 'kill_switch'
                  : homeworkError.includes('停用') || homeworkError.includes('不可用')
                  ? 'feature_disabled'
                  : 'other',
                message: homeworkError,
              }
            : homeworkError

          if (errInfo.type === 'membership_required') {
            return (
              <div className="fe-empty-state">
                <div className="fe-empty-state__icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                  <Icon name="workspace_premium" />
                </div>
                <h2>需要开通会员</h2>
                <p>{errInfo.message || '该功能需要开通会员权限后方可使用。'}</p>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <a
                    href="https://lastudio.cc/account"
                    target="_blank"
                    rel="noreferrer"
                    className="control-primary"
                    style={{ textDecoration: 'none' }}
                  >
                    <Icon name="open_in_new" /> 前往账号中心开通
                  </a>
                  <button type="button" className="control-secondary" onClick={hasLoaded ? onRefresh : onManualReadList}>
                    重新检测
                  </button>
                </div>
              </div>
            )
          }

          if (errInfo.type === 'feature_disabled') {
            return (
              <div className="fe-empty-state">
                <div className="fe-empty-state__icon" style={{ background: '#f1f5f9', color: '#64748b' }}>
                  <Icon name="do_not_disturb_on" />
                </div>
                <h2>功能已暂停使用</h2>
                <p>{errInfo.message || '管理员已暂停此功能，请稍后留意系统公告。'}</p>
                <button type="button" className="control-secondary" onClick={hasLoaded ? onRefresh : onManualReadList}>
                  重新检测
                </button>
              </div>
            )
          }

          if (errInfo.type === 'kill_switch') {
            return (
              <div className="fe-empty-state">
                <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
                  <Icon name="build_circle" />
                </div>
                <h2>系统正在维护中</h2>
                <p>{errInfo.message || '服务正在紧急维护，所有云端与解析功能已暂时关闭。'}</p>
                <button type="button" className="control-secondary" onClick={hasLoaded ? onRefresh : onManualReadList}>
                  刷新重试
                </button>
              </div>
            )
          }

          if (errInfo.type === 'network_error') {
            return (
              <div className="fe-empty-state">
                <div className="fe-empty-state__icon" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                  <Icon name="wifi_off" />
                </div>
                <h2>网络连接异常</h2>
                <p>{errInfo.message || '无法连接到服务器，请检查网络连接。'}</p>
                <button type="button" className="control-primary" onClick={hasLoaded ? onRefresh : onManualReadList}>
                  检查网络并重试
                </button>
              </div>
            )
          }

          return (
            <div className="fe-empty-state">
              <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                <Icon name="error_outline" />
              </div>
              <h2>作业同步失败</h2>
              <p>{errInfo.message}</p>
              <button type="button" className="control-primary" onClick={hasLoaded ? onRefresh : onManualReadList}>
                重新尝试
              </button>
            </div>
          )
        })()
      ) : !(accountInfo?.bound || accountInfo?.session_ready) ? (
        <div className="fe-empty-state">
          <div className="fe-empty-state__icon">
            <Icon name="no_accounts" />
          </div>
          <h2>未绑定 e听说</h2>
          <p>手机号 + 密码，或讯飞登录，二选一即可绑定。</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="control-ghost"
              onClick={onChangyanLogin}
              disabled={!onChangyanLogin}
            >
              讯飞登录
            </button>
            <a
              href="https://lastudio.cc/account"
              target="_blank"
              rel="noreferrer"
              className="control-primary"
              style={{ textDecoration: 'none' }}
            >
              手机号绑定
            </a>
          </div>
        </div>
      ) : !hasLoaded ? (
        <div className="fe-list-prompt-card">
          <div className="fe-list-prompt-icon">
            <Icon name="cloud_sync" filled />
          </div>
          <div className="fe-list-prompt-account-pill">
            <span className="admin-status-dot is-online" />
            <span>e听说账号：{accountInfo.account_display || '已关联'}</span>
          </div>
          <h3>
            {activeTab === 'current'
              ? '云端当前作业读取'
              : activeTab === 'history'
              ? '云端历史作业读取'
              : '云端词汇PK作业读取'}
          </h3>
          <p className="fe-list-prompt-desc">
            {activeTab === 'pk'
              ? '读取当前词汇 PK 作业。'
              : activeTab === 'current' ? '读取当前作业。' : '读取历史作业。'}
          </p>

          <div className="fe-list-prompt-risk-box">
            <div className="fe-list-risk-title">
              <Icon name="warning" filled />
              <span>官方客户端“顶号”风险重要说明</span>
            </div>
            <p>
              读取作业时，手机端可能被退出登录。<strong>请先完成手机端作答，再使用网页读取。</strong>
            </p>
          </div>

          <button
            type="button"
            className="control-primary fe-list-prompt-action"
            onClick={onManualReadList}
            disabled={isLoading}
          >
            <Icon name={isLoading ? 'sync' : 'download'} className={isLoading ? 'status-pill__spin' : ''} />
            <span>
              {isLoading
                ? '正在同步作业列表中...'
                : activeTab === 'current'
                ? '确认安全，读取当前作业'
                : activeTab === 'history'
                ? '确认安全，读取历史作业'
                : '确认安全，读取词汇PK'}
            </span>
          </button>
        </div>
      ) : isLoading && currentList.length === 0 ? (
        <div className="fe-empty-state" style={{ margin: '50px auto' }}>
          <div className="fe-empty-state__icon spinning">
            <Icon name="sync" />
          </div>
          <h2>正在同步{categoryMeta.title}列表...</h2>
          <p style={{ color: 'var(--control-muted)', fontSize: 13 }}>正在从 e听说云端拉取最新作业，请稍候...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="fe-empty-state" style={{ margin: '50px auto' }}>
          <div
            className="fe-empty-state__icon"
            style={activeTab === 'pk' ? { background: '#f3e8ff', color: '#9333ea' } : undefined}
          >
            <Icon
              name={
                activeTab === 'history'
                  ? 'history_toggle_drop'
                  : activeTab === 'pk'
                  ? 'sports_esports'
                  : 'inbox'
              }
            />
          </div>
          <h2>
            {activeTab === 'history'
              ? '暂无已归档的历史作业'
              : activeTab === 'pk'
              ? '暂无词汇PK题目'
              : '暂无待完成的当前作业'}
          </h2>
          <p>
            {activeTab === 'history'
              ? '往期完成的试卷将归档在此处。'
              : activeTab === 'pk'
              ? '当前列表中暂未发现词汇PK挑战或竞赛任务。可尝试刷新同步最新作业。'
              : '当前没有待完成的作业。'}
          </p>
        </div>
      ) : (
        <div className="fe-homework-list">
          {homeworkError && (
            <div className="admin-status-strip is-danger" style={{ marginBottom: 16 }}>
              <Icon name="error" />
              <span>{typeof homeworkError === 'string' ? homeworkError : homeworkError.message}</span>
            </div>
          )}
          {filtered.map((hw, idx) => (
            <HomeworkCard
              key={hw.id}
              item={hw}
              index={idx}
              isParsing={hw.id === parsingId}
              parseError={parseErrors[hw.id]}
              answerParserStatus={answerParserStatus}
              answerParserDenyReason={answerParserDenyReason}
              onOpen={onOpenHomework}
              onTriggerParse={onTriggerParse}
              onAutoComplete={onAutoComplete}
              activeTask={activeTask}
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
  accessToken,
  onToast,
  onRefreshSession,
  onChangyanLogin,
  getFeatureStatus,
}: {
  currentUser: User | null
  accountInfo: PlatformAccountInfo | null
  accessToken: string
  onToast?: (msg: string) => void
  onRefreshSession: () => void
  onChangyanLogin?: () => void
  getFeatureStatus?: (featureKey: string, defaultName?: string) => FeatureCheck
}) {
  const [skipRisk, setSkipRisk] = useState(readStoredSkipRiskWarning)
  // 账号中心绑定与「讯飞登录」都视为已连接 e听说。
  const etsReady = Boolean(accountInfo?.bound || accountInfo?.session_ready)
  // 后端 source：phone（手机号体系绑定）/ changyan（讯飞·畅言体系绑定）
  const etsSource = etsReady ? accountInfo?.source || '' : ''

  function toggleSkipRisk() {
    const next = !skipRisk
    setSkipRisk(next)
    window.localStorage.setItem(skipRiskWarningStorageKey, String(next))
  }

  const avatarUrl = resolveAvatarUrl(currentUser?.avatar_url)

  return (
    <div className="fe-settings-container">
      {/* Voice Clone & Online Studio Management */}
      <VoiceManager accessToken={accessToken} onToast={onToast} getFeatureStatus={getFeatureStatus} />

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

      {/* e听说 Platform Account Binding */}
      <section className="admin-policy-card">
        <div className="admin-policy-card-head">
          <Icon name="account_box" />
          <div>
            <h3>e听说平台账号状态</h3>
            <p>用于读取作业的 e听说账号</p>
          </div>
        </div>

        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info">
            <strong>绑定状态</strong>
            <span>
              {etsReady
                ? '已在 LastStudio 账号中心完成绑定'
                : '手机号 + 密码，或讯飞登录，二选一即可绑定'}
            </span>
          </div>
          <span className={`admin-pill-badge ${etsReady ? 'is-success' : 'is-danger'}`}>
            {etsSource === 'changyan' ? '讯飞登录' : etsSource === 'phone' ? '已绑定' : etsReady ? '已连接' : '未绑定'}
          </span>
        </div>

        {accountInfo && etsReady && (
          <>
            <div className="admin-setting-switch-row">
              <div className="admin-setting-switch-info">
                <strong>e听说账号</strong>
                <span>已授权关联的账号</span>
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
            <span>
              {etsReady
                ? '在账号中心解绑或换绑，也可直接用讯飞登录换绑'
                : '两种登录方式任选其一：手机号 + 密码，或讯飞登录'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {onChangyanLogin && (
              <button className="control-secondary" type="button" onClick={onChangyanLogin}>
                <Icon name="login" /> 讯飞登录
              </button>
            )}
            <a
              href="https://lastudio.cc/account"
              target="_blank"
              rel="noreferrer"
              className={etsReady ? 'control-secondary' : 'control-primary'}
              style={{ textDecoration: 'none' }}
            >
              <Icon name="open_in_new" /> {etsReady ? '管理绑定' : '手机号绑定'}
            </a>
            <button className="control-secondary" type="button" onClick={onRefreshSession}>
              <Icon name="refresh" /> 重新检测
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

      <section className="admin-policy-card">
        <div className="admin-policy-card-head">
          <Icon name="gavel" />
          <div>
            <h3>服务协议与隐私</h3>
            <p>查看当前生效的服务协议、隐私政策和免责声明</p>
          </div>
        </div>
        <div className="admin-setting-switch-row">
          <div className="admin-setting-switch-info">
            <strong>LA Studio 法务与合规说明</strong>
            <span>协议更新时会在首次启动时再次请求确认</span>
          </div>
          <a
            className="control-secondary"
            href="https://lastudio.cc/terms"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="open_in_new" /> 查看完整文本
          </a>
        </div>
      </section>
    </div>
  )
}

function isAutoCompletePath(path: string): boolean {
  return /^\/homework\/[^/]+\/auto-complete\/?$/.test(path) || path === '/auto-complete'
}

function currentPage(pathname: string): Page | null {
  if (pathname === '/' || pathname === '/history' || pathname === '/pk' || pathname === '/settings') return pathname
  if (isAutoCompletePath(pathname)) return pathname
  return null
}

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [legalConsentAccepted, setLegalConsentAccepted] = useState(readStoredLegalConsent)
  const [session, setSessionState] = useState<AuthSession | null>(readStoredSession)
  const [currentUser, setCurrentUser] = useState<User | null>(() => readStoredSession()?.user ?? null)
  const [authMessage, setAuthMessage] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed)
  const [headerCompact, setHeaderCompact] = useState(() => window.scrollY > 56)
  const headerCompactRef = useRef(headerCompact)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const authorizationStarted = useRef(false)
  const sessionRef = useRef(session)
  // 保持 sessionRef 为最新值供回调读取：渲染期直接写 ref 会触发 react-hooks/refs，
  // 而两处读取（refreshSession / 401 处理器）都在回调里，effect 同步足够。
  useEffect(() => {
    sessionRef.current = session
  }, [session])
  const refreshingPromise = useRef<Promise<AuthSession | null> | null>(null)
  const sessionAccessToken = session?.accessToken
  const sessionExpiresAt = session?.expiresAt
  const page = currentPage(pathname)

  // Keep the compact threshold stable while mobile browsers rubber-band around the boundary.
  useEffect(() => {
    let frame = 0
    const updateHeader = () => {
      frame = 0
      const scrollY = window.scrollY
      const next = headerCompactRef.current ? scrollY > 24 : scrollY > 56
      if (next === headerCompactRef.current) return
      headerCompactRef.current = next
      setHeaderCompact(next)
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateHeader)
    }
    updateHeader()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Active Auto Complete Task State (persisted to localStorage)
  const [activeTask, setActiveTask] = useState<AutoCompleteTaskResponse | null>(readStoredActiveTask)

  const updateActiveTask = (task: AutoCompleteTaskResponse | null) => {
    setActiveTask(task)
    try {
      if (task && !['COMPLETED', 'FAILED'].includes(task.status)) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_TASK, JSON.stringify(task))
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_TASK)
      }
    } catch {
      // ignore
    }
  }

  // e听说 & Homework State
  const [accountInfo, setAccountInfo] = useState<PlatformAccountInfo | null>(null)
  // 畅言网页登录（讯飞登录）
  const [changyanOpen, setChangyanOpen] = useState(false)
  const [changyanBusy, setChangyanBusy] = useState(false)
  const [changyanError, setChangyanError] = useState<string | null>(null)
  // 账号中心绑定或「讯飞登录」任一来源，e听说都算可用。
  const etsReady = Boolean(accountInfo?.bound || accountInfo?.session_ready)
  const [homeworks, setHomeworks] = useState<HomeworkItem[]>([])
  const [historyHomeworks, setHistoryHomeworks] = useState<HomeworkItem[]>([])
  const [isLoadingHomeworks, setIsLoadingHomeworks] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [hasLoadedCurrent, setHasLoadedCurrent] = useState(false)
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false)
  const activeTab: 'current' | 'history' | 'pk' = pathname === '/history' ? 'history' : pathname === '/pk' ? 'pk' : 'current'

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
  const [toastMessage, setToastMessage] = useState<{ text: string; isError: boolean } | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const [homeworkError, setHomeworkError] = useState<HomeworkErrorInfo | string | null>(null)

  // User Profile Dropdown Popover state
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!userMenuOpen) return

    function handleOutsideClick(e: MouseEvent | TouchEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('touchstart', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('touchstart', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [userMenuOpen])

  const updateSession = useCallback((next: AuthSession | null) => {
    setSessionState(next)
    writeStoredSession(next)
  }, [])

  const clearSession = useCallback(() => {
    authorizationStarted.current = false
    updateSession(null)
    setCurrentUser(null)
    setAuthMessage('')
  }, [updateSession])

  const refreshSession = useCallback(async (): Promise<AuthSession | null> => {
    const current = sessionRef.current
    if (!current?.refreshToken) {
      clearSession()
      return null
    }
    if (refreshingPromise.current) return refreshingPromise.current

    const task = (async () => {
      try {
        const token = await refreshOAuthToken(current.refreshToken!)
        const nextSession: AuthSession = {
          ...current,
          accessToken: token.access_token,
          tokenType: token.token_type,
          expiresAt: Date.now() + token.expires_in * 1000,
          scope: token.scope || current.scope,
          refreshToken: token.refresh_token || current.refreshToken,
        }
        updateSession(nextSession)
        return nextSession
      } catch (err) {
        console.error('Failed to refresh session token:', err)
        if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
          clearSession()
        } else if (current.expiresAt <= Date.now()) {
          clearSession()
        }
        return null
      } finally {
        refreshingPromise.current = null
      }
    })()

    refreshingPromise.current = task
    return task
  }, [clearSession, updateSession])

  const signOut = useCallback(() => {
    setUserMenuOpen(false)
    clearSession()
    transitionTo(oauthConfig.logoutUrl)
  }, [clearSession])

  // Software Config & Features State
  const [softwareConfig, setSoftwareConfig] = useState<SoftwareConfig | null>(null)
  const [softwareFeatures, setSoftwareFeatures] = useState<SoftwareFeatureItem[]>([])

  const pollingTimerRef = useRef<number | null>(null)
  const isFetchingHomeworksRef = useRef(false)

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
    if (!sessionAccessToken || (sessionExpiresAt !== undefined && sessionExpiresAt <= Date.now())) return
    let active = true
    getCurrentUser(sessionAccessToken)
      .then((user) => {
        if (active) {
          setCurrentUser(user)
          setSessionState((prev) => {
            if (!prev) return prev
            const next = { ...prev, user }
            writeStoredSession(next)
            return next
          })
        }
      })
      .catch((err) => {
        console.error('Failed to load current user profile:', err)
      })

    return () => {
      active = false
    }
  }, [sessionAccessToken, sessionExpiresAt])

  function getFeatureStatus(featureKey: string, defaultName = '该功能'): FeatureCheck {
    if (softwareConfig?.isKillSwitchOn) {
      return {
        enabled: false,
        status: 'kill_switch',
        reason: softwareConfig.noticeMessage || '系统正在维护，所有云端与解析功能已暂时关闭。',
      }
    }
    // 管理员与系统管理员拥有全部功能最高权限
    if (currentUser?.role === 0 || currentUser?.role === 1) {
      return { enabled: true, status: 'enabled', reason: '' }
    }
    const feat = softwareFeatures.find((f) => f.feature_key === featureKey)
    if (!feat) {
      return { enabled: true, status: 'enabled', reason: '' }
    }
    if (feat.status !== 'enabled' || !feat.available_for_version) {
      return {
        enabled: false,
        status: 'feature_disabled',
        reason: feat.deny_message || feat.reason || `${defaultName}已由管理员停用`,
      }
    }
    if (feat.requires_membership && (currentUser?.member_level ?? 0) < feat.min_member_level) {
      return {
        enabled: false,
        status: 'membership_required',
        reason: feat.deny_message || `${defaultName}需要开通 ${feat.min_member_tier || 'VIP'} 会员权限`,
        minMemberLevel: feat.min_member_level,
        minMemberTier: feat.min_member_tier,
      }
    }
    return { enabled: true, status: 'enabled', reason: '' }
  }

  function getFeatureDenyReason(featureKey: string, fallback = '该功能已暂时停用'): string {
    const res = getFeatureStatus(featureKey, fallback)
    return res.reason || fallback
  }

  function showToast(message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    const isError = /失败|错误|异常|中断|无法|未能|不可用|不支持|超时|拒绝|失效|未就绪|过期|error|failed/i.test(message)
    setToastMessage({ text: message, isError })
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null)
      toastTimerRef.current = null
    }, isError ? 10000 : 4000)
  }

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      setUserMenuOpen(false)
      const nextPathname = window.location.pathname
      transitionRoute(() => setPathname(nextPathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const current = sessionRef.current
      if (current?.refreshToken) {
        void refreshSession()
      } else {
        clearSession()
      }
    })
    return () => setUnauthorizedHandler(null)
  }, [clearSession, refreshSession])

  // Proactive background refresh timer: silently renew token 5 min before expiry
  useEffect(() => {
    if (!session) return
    const timeUntilRefresh = session.expiresAt - Date.now() - 5 * 60 * 1000
    if (timeUntilRefresh <= 0) {
      const immediateTimer = window.setTimeout(() => {
        if (session.refreshToken) {
          void refreshSession()
        } else {
          clearSession()
        }
      }, 0)
      return () => window.clearTimeout(immediateTimer)
    }
    const timeout = window.setTimeout(() => {
      if (session.refreshToken) {
        void refreshSession()
      } else {
        clearSession()
      }
    }, timeUntilRefresh)
    return () => window.clearTimeout(timeout)
  }, [clearSession, refreshSession, session])

  // Sync session state across tabs
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_STORAGE_KEY) return
      const nextSession = readStoredSession()
      setSessionState(nextSession)
      if (nextSession?.user) {
        setCurrentUser(nextSession.user)
      } else if (!nextSession) {
        setCurrentUser(null)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!legalConsentAccepted || !page || session || authMessage || authorizationStarted.current || pathname === '/auth/callback') return
    authorizationStarted.current = true
    void startAuthorization(page).catch((error: unknown) => {
      authorizationStarted.current = false
      setAuthMessage(error instanceof Error ? error.message : '无法连接统一认证，请稍后重试。')
    })
  }, [authMessage, legalConsentAccepted, page, pathname, session])

  // Fetch platform account info on login (does not call e听说, safe from kickout)
  useEffect(() => {
    if (!sessionAccessToken || (sessionExpiresAt !== undefined && sessionExpiresAt <= Date.now())) return
    let active = true

    getPlatformAccount(sessionAccessToken)
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
  }, [sessionAccessToken, sessionExpiresAt])

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
    const parseStatus = getFeatureStatus('answer_parser', '答案解析')
    if (!parseStatus.enabled) {
      if (parseStatus.status === 'membership_required') {
        showToast(`${parseStatus.reason}，请前往账号中心开通`)
      } else {
        showToast(parseStatus.reason || '答案解析功能已停用')
      }
      return
    }
    setIsLoadingPaper(true)
    try {
      const detail = await getHomeworkDetail(session.accessToken, item.id)
      setPaperCache((prev) => ({ ...prev, [item.id]: detail }))
      setViewingPaper((curr) => (curr?.homework.id === item.id ? { homework: item, paper: detail } : curr))
      showToast(`已成功读取《${item.name}》试卷与答案`)
    } catch (err) {
      console.error('Failed to load paper detail:', err)
      if (err instanceof ApiError) {
        if (err.isNetworkError) {
          showToast('网络连接失败，请检查您的网络连接是否正常')
        } else if (err.reason === 'membership_required' || err.message.includes('会员') || err.message.includes('VIP')) {
          showToast(`读取失败: ${err.message || '查看试卷答案需要开通会员'}`)
        } else if (err.reason === 'feature_disabled' || err.status === 403) {
          showToast(`读取失败: ${err.message || '答案解析功能已停用'}`)
        } else if (err.reason === 'kill_switch' || err.status === 503) {
          showToast(`读取失败: ${err.message || '服务维护中，请稍后重试'}`)
        } else {
          showToast(`读取失败: ${err.message}`)
        }
      } else {
        showToast(err instanceof Error ? err.message : '读取试卷详情失败')
      }
    } finally {
      setIsLoadingPaper(false)
    }
  }

  async function handleReReadPaper(item: HomeworkItem) {
    if (!session) return
    const parseStatus = getFeatureStatus('answer_parser', '答案解析')
    if (!parseStatus.enabled) {
      if (parseStatus.status === 'membership_required') {
        showToast(`${parseStatus.reason}，请前往账号中心开通`)
      } else {
        showToast(parseStatus.reason || '答案解析功能已停用')
      }
      return
    }
    setIsLoadingPaper(true)
    try {
      const detail = await getHomeworkDetail(session.accessToken, item.id)
      setPaperCache((prev) => ({ ...prev, [item.id]: detail }))
      setViewingPaper((curr) => (curr?.homework.id === item.id ? { homework: item, paper: detail } : curr))
      showToast('已重新从云端读取试卷与答案')
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        showToast('试卷解析缓存已过期，正在重新向云端解析...')
        void executeParse(item)
        return
      }
      console.error('Failed to re-read paper detail:', err)
      if (err instanceof ApiError) {
        if (err.isNetworkError) {
          showToast('网络连接失败，请检查网络连接')
        } else if (err.reason === 'membership_required' || err.message.includes('会员') || err.message.includes('VIP')) {
          showToast(`重新读取失败: ${err.message || '该功能需要开通会员'}`)
        } else if (err.reason === 'feature_disabled' || err.status === 403) {
          showToast(`重新读取失败: ${err.message || '答案解析功能已停用'}`)
        } else if (err.reason === 'kill_switch' || err.status === 503) {
          showToast(`重新读取失败: ${err.message || '服务维护中'}`)
        } else {
          showToast(`重新读取失败: ${err.message}`)
        }
      } else {
        showToast(err instanceof Error ? err.message : '重新读取失败')
      }
    } finally {
      setIsLoadingPaper(false)
    }
  }

  function handleTriggerParse(item: HomeworkItem) {
    const parseStatus = getFeatureStatus('answer_parser', '答案解析')
    if (!parseStatus.enabled) {
      if (parseStatus.status === 'membership_required') {
        showToast(`${parseStatus.reason}，请前往账号中心开通`)
      } else {
        showToast(parseStatus.reason || '答案解析功能已停用')
      }
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
        resource_id: item.resource_id,
        pk: item.pk,
        set_type: item.set_type,
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
      if (err instanceof ApiError) {
        if (err.isNetworkError) {
          const errorMsg = '网络连接失败，请检查网络连接'
          setParseErrors((prev) => ({ ...prev, [item.id]: errorMsg }))
          showToast(errorMsg)
        } else if (err.reason === 'membership_required' || err.message.includes('会员') || err.message.includes('VIP')) {
          const errorMsg = err.message || '答案解析需要开通会员'
          setParseErrors((prev) => ({ ...prev, [item.id]: errorMsg }))
          showToast(`${errorMsg}，请前往官网开通会员`)
        } else if (err.reason === 'feature_disabled' || err.status === 403) {
          const errorMsg = err.message || '答案解析功能已被停用'
          setParseErrors((prev) => ({ ...prev, [item.id]: errorMsg }))
          showToast(errorMsg)
        } else if (err.reason === 'kill_switch' || err.status === 503) {
          const errorMsg = err.message || '服务维护中，解析已暂停'
          setParseErrors((prev) => ({ ...prev, [item.id]: errorMsg }))
          showToast(errorMsg)
        } else {
          const errorMsg = err.message || '发起解析失败'
          setParseErrors((prev) => ({ ...prev, [item.id]: errorMsg }))
          showToast(errorMsg)
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : '发起解析失败'
        setParseErrors((prev) => ({ ...prev, [item.id]: errorMsg }))
        showToast(errorMsg)
      }
    }
  }

  async function handleCopyAnswer(paper: Paper) {
    const copyStatus = getFeatureStatus('copy_export', '答案导出')
    if (!copyStatus.enabled) {
      if (copyStatus.status === 'membership_required') {
        showToast(`${copyStatus.reason}，请前往账号中心开通`)
      } else {
        showToast(copyStatus.reason || '答案导出功能已停用')
      }
      return
    }
    if (session?.accessToken) {
      void trackFeatureUsage(session.accessToken, 'copy_export', 'copy', {
        paper_id: paper.paperId,
        title: paper.title || paper.paperName,
      })
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
    const copyStatus = getFeatureStatus('copy_export', '答案导出')
    if (!copyStatus.enabled) {
      if (copyStatus.status === 'membership_required') {
        showToast(`${copyStatus.reason}，请前往账号中心开通`)
      } else {
        showToast(copyStatus.reason || '答案导出功能已停用')
      }
      return
    }
    if (session?.accessToken) {
      void trackFeatureUsage(session.accessToken, 'copy_export', 'export', {
        paper_id: paper.paperId,
        title: paper.title || paper.paperName,
      })
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

  function isTokenExpiredError(err: unknown): boolean {
    if (!(err instanceof ApiError)) return false
    if (err.status === 401) return true
    const msg = (err.message || '').toLowerCase()
    const codes = ['30004', '30005', '30014', '40001', '40002', '40003', '40004', '40020', '10001']
    if (codes.some((c) => msg.includes(c))) return true
    const keywords = ['token', '登录', '凭证', '过期', '失效', '重新登录', '未登录', 'auth']
    return keywords.some((kw) => msg.includes(kw))
  }

  /** 畅言网页登录成功后：后端兑换 e听说会话 → 刷新账号状态与作业列表。 */
  async function handleChangyanCredential(credential: ChangyanCredentialPayload) {
    const accessToken = session?.accessToken
    if (!accessToken) {
      setChangyanError('登录状态已失效，请重新登录统一账号')
      return
    }
    setChangyanBusy(true)
    setChangyanError(null)
    try {
      const result = await changyanLogin(accessToken, credential)
      const account = await getPlatformAccount(accessToken)
      setAccountInfo(account)
      setChangyanOpen(false)
      console.info('讯飞登录成功，e听说账号：', result.account_display)
      // 注意：不能带 forceRefresh —— 那会清掉刚写入的畅言会话，
      // 而未绑定账号中心的用户无法用密码重建会话。
      await doFetchHomeworks(activeTab)
    } catch (err) {
      setChangyanError(err instanceof Error ? err.message : '讯飞登录失败，请重试')
    } finally {
      setChangyanBusy(false)
    }
  }

  async function doFetchHomeworks(
    tab: 'current' | 'history' | 'pk' = activeTab,
    capToken?: string,
    forceRefresh?: boolean
  ) {
    if (!session) return
    if (isFetchingHomeworksRef.current) return
    isFetchingHomeworksRef.current = true

    const cloudStatus = getFeatureStatus('cloud_mode', '云端模式')
    if (!cloudStatus.enabled) {
      isFetchingHomeworksRef.current = false
      setHomeworkError({
        type:
          cloudStatus.status === 'membership_required'
            ? 'membership_required'
            : cloudStatus.status === 'kill_switch'
            ? 'kill_switch'
            : 'feature_disabled',
        message: cloudStatus.reason || '云端模式已暂时停用',
      })
      return
    }

    const targetTab = tab === 'pk' ? 'current' : tab
    const hasLoaded = targetTab === 'current' ? hasLoadedCurrent : hasLoadedHistory
    const existingList = targetTab === 'current' ? homeworks : historyHomeworks
    const hasData = hasLoaded && existingList.length > 0

    if (!hasData) {
      setHomeworkError(null)
    }

    if (targetTab === 'current') {
      setIsLoadingHomeworks(true)
      try {
        const res = await getHomeworkList(session.accessToken, '1', capToken, forceRefresh)
        setHomeworks(res.homeworks || [])
        setHasLoadedCurrent(true)
        setHomeworkError(null)
        showToast(tab === 'pk' ? '已同步作业与词汇PK' : '已同步当前作业列表')
      } catch (err) {
        if (isTokenExpiredError(err) && !forceRefresh) {
          console.warn('ETS token expired or invalid, auto-refreshing session and retrying...')
          setIsLoadingHomeworks(false)
          isFetchingHomeworksRef.current = false
          return doFetchHomeworks(tab, capToken, true)
        }
        if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) {
          pendingRefreshRef.current = (token?: string) => {
            void doFetchHomeworks(tab, token, forceRefresh)
          }
          setShowCaptchaModal(true)
          return
        }
        console.error('Failed to load current homework list:', err)
        if (err instanceof ApiError) {
          let errType: HomeworkErrorInfo['type'] = 'other'
          let errMsg = err.message || '作业列表同步失败'
          if (err.isNetworkError) {
            errType = 'network_error'
            errMsg = '网络连接失败，请检查网络连接。'
          } else if (err.reason === 'membership_required' || err.message.includes('会员') || err.message.includes('VIP')) {
            errType = 'membership_required'
            errMsg = err.message || '作业列表同步需要开通会员。'
          } else if (err.reason === 'feature_disabled' || err.status === 403) {
            errType = 'feature_disabled'
            errMsg = err.message || '作业列表功能已停用。'
          } else if (err.reason === 'kill_switch' || err.status === 503) {
            errType = 'kill_switch'
            errMsg = err.message || '服务正在紧急维护中。'
          }
          showToast(errMsg)
          if (!hasData) {
            setHomeworkError({ type: errType, message: errMsg })
          }
        } else {
          const msg = err instanceof Error ? err.message : '获取当前作业列表失败'
          showToast(`作业列表同步失败: ${msg}`)
          if (!hasData) {
            setHomeworkError({ type: 'other', message: msg })
          }
        }
      } finally {
        setIsLoadingHomeworks(false)
        isFetchingHomeworksRef.current = false
      }
    } else {
      setIsLoadingHistory(true)
      try {
        const res2 = await getHomeworkList(session.accessToken, '2', capToken, forceRefresh)
        const res3 = await getHomeworkList(session.accessToken, '3', undefined, forceRefresh)
        setHistoryHomeworks([...(res2.homeworks || []), ...(res3.homeworks || [])])
        setHasLoadedHistory(true)
        setHomeworkError(null)
        showToast('已同步历史与逾期作业')
      } catch (err) {
        if (isTokenExpiredError(err) && !forceRefresh) {
          console.warn('ETS token expired or invalid, auto-refreshing session and retrying...')
          setIsLoadingHistory(false)
          isFetchingHomeworksRef.current = false
          return doFetchHomeworks('history', capToken, true)
        }
        if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) {
          pendingRefreshRef.current = (token?: string) => {
            void doFetchHomeworks('history', token, forceRefresh)
          }
          setShowCaptchaModal(true)
          return
        }
        console.error('Failed to load history homework list:', err)
        if (err instanceof ApiError) {
          let errType: HomeworkErrorInfo['type'] = 'other'
          let errMsg = err.message || '历史作业获取失败'
          if (err.isNetworkError) {
            errType = 'network_error'
            errMsg = '网络连接失败，请检查网络连接。'
          } else if (err.reason === 'membership_required' || err.message.includes('会员') || err.message.includes('VIP')) {
            errType = 'membership_required'
            errMsg = err.message || '历史作业获取需要开通会员。'
          } else if (err.reason === 'feature_disabled' || err.status === 403) {
            errType = 'feature_disabled'
            errMsg = err.message || '历史作业功能已停用。'
          } else if (err.reason === 'kill_switch' || err.status === 503) {
            errType = 'kill_switch'
            errMsg = err.message || '服务正在维护中。'
          }
          showToast(errMsg)
          if (!hasData) {
            setHomeworkError({ type: errType, message: errMsg })
          }
        } else {
          const msg = err instanceof Error ? err.message : '获取历史作业列表失败'
          showToast(`历史作业获取失败: ${msg}`)
          if (!hasData) {
            setHomeworkError({ type: 'other', message: msg })
          }
        }
      } finally {
        setIsLoadingHistory(false)
        isFetchingHomeworksRef.current = false
      }
    }
  }

  // 普通手动刷新使用缓存友好的读取；只有令牌失效重试等明确场景才传 forceRefresh=true。
  async function refreshAccountAndHomeworks(capToken?: string, forceRefresh: boolean = false) {
    if (!session) return
    setHomeworkError(null)
    try {
      const account = await getPlatformAccount(session.accessToken, forceRefresh)
      setAccountInfo(account)
      if (account.bound) {
        await doFetchHomeworks(activeTab, capToken, forceRefresh)
      }
    } catch (err) {
      if (err instanceof ApiError && (err.captchaRequired || err.status === 429)) {
        pendingRefreshRef.current = (token?: string) => {
          void refreshAccountAndHomeworks(token, forceRefresh)
        }
        setShowCaptchaModal(true)
        return
      }
      console.error('Failed to refresh data:', err)
      if (err instanceof ApiError) {
        if (err.isNetworkError) {
          setHomeworkError({
            type: 'network_error',
            message: '无法连接到服务器，请检查网络连接。',
          })
          showToast('网络连接失败，请检查您的网络设置')
        } else if (err.reason === 'membership_required' || err.message.includes('会员') || err.message.includes('VIP')) {
          setHomeworkError({
            type: 'membership_required',
            message: err.message || '云端作业功能需要开通会员，请前往账号中心开通。',
          })
          showToast(err.message || '云端作业功能需要开通会员')
        } else if (err.reason === 'feature_disabled' || err.status === 403) {
          setHomeworkError({
            type: 'feature_disabled',
            message: err.message || '云端同步功能当前已被管理员暂停使用。',
          })
          showToast(err.message || '云端功能已被停用')
        } else if (err.reason === 'kill_switch' || err.status === 503) {
          setHomeworkError({
            type: 'kill_switch',
            message: err.message || '服务正在紧急维护，所有云端与解析功能已暂时关闭。',
          })
          showToast(err.message || '服务正在维护中')
        } else {
          setHomeworkError({
            type: 'other',
            message: err.message,
          })
          showToast(`刷新失败: ${err.message}`)
        }
      } else {
        showToast(err instanceof Error ? err.message : '刷新失败，请稍后重试')
      }
    }
  }

  const [showCaptchaModal, setShowCaptchaModal] = useState(false)
  const pendingRefreshRef = useRef<((token?: string) => void) | null>(null)

  // Auto Complete states
  const [autoCompleteModalHw, setAutoCompleteModalHw] = useState<HomeworkItem | null>(null)
  const [autoCompletePermitToken, setAutoCompletePermitToken] = useState<string>('')
  const [autoCompleteTargetHw, setAutoCompleteTargetHw] = useState<HomeworkItem | null>(null)
  const [autoCompleteReturnPage, setAutoCompleteReturnPage] = useState<'/' | '/history' | '/pk'>(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY_AUTO_COMPLETE_RETURN_PAGE)
      return stored === '/history' || stored === '/pk' ? stored : '/'
    } catch {
      return '/'
    }
  })

  const autoCompleteReturnLabel = autoCompleteReturnPage === '/history'
    ? '历史作业'
    : autoCompleteReturnPage === '/pk'
    ? '词汇 PK'
    : '当前作业'

  function rememberAutoCompleteReturnPage() {
    const returnPage = activeTab === 'history' ? '/history' : activeTab === 'pk' ? '/pk' : '/'
    setAutoCompleteReturnPage(returnPage)
    try {
      window.sessionStorage.setItem(STORAGE_KEY_AUTO_COMPLETE_RETURN_PAGE, returnPage)
    } catch {
      // Ignore session storage failures (private mode or blocked storage).
    }
  }

  function handleTriggerAutoComplete(hw: HomeworkItem) {
    rememberAutoCompleteReturnPage()
    // If this exact homework is already running in background, jump directly to execution dashboard
    if (
      activeTask &&
      String(activeTask.homework_id) === String(hw.id) &&
      !['COMPLETED', 'FAILED'].includes(activeTask.status)
    ) {
      showToast(`正在打开「${hw.name}」的实时执行看板（当前进度 ${activeTask.progress || 0}%）...`)
      setAutoCompleteTargetHw(hw)
      navigate('/auto-complete')
      return
    }

    // If another homework is already running, prevent overriding it and guide user
    if (
      activeTask &&
      !['COMPLETED', 'FAILED'].includes(activeTask.status) &&
      String(activeTask.homework_id) !== String(hw.id)
    ) {
      showToast(`已有任务「${activeTask.homework_name || '其他作业'}」正在后台执行中，请先等待完成或前往看板查看`)
      navigate('/auto-complete')
      return
    }

    // If activeTask belongs to another homework or is already finished, reset it
    if (
      activeTask &&
      ['COMPLETED', 'FAILED'].includes(activeTask.status)
    ) {
      updateActiveTask(null)
    }

    const cachedPaper = paperCache[hw.id] || (viewingPaper?.homework.id === hw.id ? viewingPaper.paper : null)
    const compat = checkHomeworkCompatibility(hw, cachedPaper)
    if (!compat.supported) {
      showToast(compat.reason || '该作业包含暂不支持自动完成的题型，暂未开放')
      return
    }
    setAutoCompleteModalHw(hw)
  }

  async function handleAutoCompleteCaptchaSuccess(capToken: string) {
    const hw = autoCompleteModalHw
    setAutoCompleteModalHw(null)
    if (!hw || !session) return

    // Ensure finished or different active task is cleared before entering auto complete
    if (
      activeTask &&
      (['COMPLETED', 'FAILED'].includes(activeTask.status) || String(activeTask.homework_id) !== String(hw.id))
    ) {
      updateActiveTask(null)
    }

    showToast('安全人机验证通过，正在申请自动完成准入令牌...')
    try {
      const res = await getAutoCompletePermit(session.accessToken, hw.id, capToken)
      setAutoCompletePermitToken(res.permit_token)
      setAutoCompleteTargetHw(hw)
      const nextPath = `/homework/${hw.id}/auto-complete`
      transitionRoute(() => {
        window.history.pushState(null, '', nextPath)
        setPathname(nextPath)
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '申请自动完成准入令牌失败'
      showToast(msg)
    }
  }

  const navigate = useCallback((nextPage: Page) => {
    setUserMenuOpen(false)
    setViewingPaper(null)
    setMobileNavOpen(false)
    if (nextPage === '/auto-complete') {
      setAutoCompletePermitToken('')
      setAutoCompleteTargetHw(null)
    }
    if (nextPage === window.location.pathname) {
      return
    }
    transitionRoute(() => {
      window.history.pushState(null, '', nextPage)
      setPathname(nextPage)
    })
  }, [])

  // 交给 React Compiler 自行记忆化：手写 useCallback 依赖 activeTab/navigate，
  // 编译器无法保留（react-hooks/preserve-manual-memoization）。
  function handleAutoCompleteBack() {
    setAutoCompletePermitToken('')
    navigate(autoCompleteReturnPage)
  }

  const handleAutoCompleteCompleted = useCallback((res: AutoCompleteTaskResponse['result'] | undefined, hwId: string) => {
    const s = Number(res?.final_score ?? res?.score ?? 0)
    const ut = Number(res?.use_time ?? 0)
    const updateItem = (h: HomeworkItem) => {
      if (h.id === hwId) {
        return {
          ...h,
          status: 2,
          point: s,
          score: s,
          use_time: ut,
          completed_at: typeof res?.completed_at === 'string' ? res.completed_at : undefined,
        }
      }
      return h
    }
    setHomeworks((prev) => prev.map(updateItem))
    setHistoryHomeworks((prev) => prev.map(updateItem))
  }, [])

  function handleManualReadList() {
    if (isFetchingHomeworksRef.current) return
    void doFetchHomeworks(activeTab)
  }

  function handleRequestRefresh() {
    if (isFetchingHomeworksRef.current) return
    void refreshAccountAndHomeworks()
  }

  function handleCaptchaSuccess(token: string) {
    setShowCaptchaModal(false)
    showToast('安全验证通过，正在同步作业数据...')
    if (pendingRefreshRef.current) {
      const fn = pendingRefreshRef.current
      pendingRefreshRef.current = null
      fn(token)
    } else {
      void doFetchHomeworks(activeTab, token)
    }
  }

  // Restore latest active auto-complete task on session init
  useEffect(() => {
    if (!session?.accessToken || session.expiresAt <= Date.now()) return
    let active = true
    getLatestAutoCompleteTask(session.accessToken)
      .then((res) => {
        if (!active) return
        if (res.task && !['COMPLETED', 'FAILED'].includes(res.task.status)) {
          setActiveTask(res.task)
          try {
            localStorage.setItem(STORAGE_KEY_ACTIVE_TASK, JSON.stringify(res.task))
          } catch (e) {
            console.warn('Failed to cache active task', e)
          }
        } else if (res.task && ['COMPLETED', 'FAILED'].includes(res.task.status)) {
          setActiveTask(null)
          try {
            localStorage.removeItem(STORAGE_KEY_ACTIVE_TASK)
          } catch (e) {
            console.warn('Failed to clear active task', e)
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch latest auto-complete task:', err)
      })
    return () => {
      active = false
    }
  }, [session?.accessToken, session?.expiresAt])

  // Global background polling for active task
  useEffect(() => {
    if (!session?.accessToken || isSessionExpired(session.expiresAt) || !activeTask?.task_id) return
    if (activeTask.status === 'COMPLETED' || activeTask.status === 'FAILED') return

    const taskId = activeTask.task_id
    const pollTimer = setInterval(async () => {
      try {
        const updated = await getAutoCompleteTaskStatus(session.accessToken, taskId)
        updateActiveTask(updated)
        if (updated.status === 'COMPLETED') {
          showToast('🎉 后台自动完成任务已圆满完成！')
          setHasLoadedCurrent(false)
          setHasLoadedHistory(false)
          // 作业完成后的列表同步不应被标记为高风险强制刷新。
          void doFetchHomeworks(activeTab)
        } else if (updated.status === 'FAILED') {
          showToast(`❌ 自动完成任务执行失败: ${updated.error || '未知错误'}`)
        }
      } catch (err) {
        console.warn('Global task polling error:', err)
      }
    }, 1800)

    return () => clearInterval(pollTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, activeTask?.task_id, activeTask?.status])

  // Dynamic sidebar navigation groups with live background task status
  const computedNavGroups = useMemo<{ label: string; items: NavItem[] }[]>(() => {
    let caption = '自动完成任务与进度查看'
    let badge: string | undefined
    let badgeType: 'running' | 'success' | 'failed' | undefined
    let isRunning = false

    if (activeTask) {
      if (activeTask.status === 'COMPLETED') {
        caption = activeTask.homework_name ? `${activeTask.homework_name} · 已完成` : '任务已顺利完成'
        badge = '已完成'
        badgeType = 'success'
      } else if (activeTask.status === 'FAILED') {
        caption = activeTask.error ? `失败: ${activeTask.error}` : '任务执行失败中断'
        badge = '失败'
        badgeType = 'failed'
      } else {
        caption = friendlyTaskStage(activeTask.stage_label || activeTask.stage_text)
        badge = `${activeTask.progress || 0}%`
        badgeType = 'running'
        isRunning = true
      }
    }

    const taskPage = '/auto-complete'

    const homeworkItems: NavItem[] = [
      { icon: 'assignment', label: '当前作业', caption: '作业索引与解析阅读器', page: '/' },
      { icon: 'history', label: '历史作业', caption: '已归档往期作业记录', page: '/history' },
      { icon: 'sports_esports', label: '词汇PK', caption: '在线词汇竞技与专练', page: '/pk' },
      {
        icon: 'auto_awesome',
        label: '自动完成',
        caption,
        page: taskPage,
        badge,
        badgeType,
        isRunning,
      },
    ]

    return [
      {
        label: '作业业务',
        items: homeworkItems,
      },
      {
        label: '系统与服务',
        items: [
          { icon: 'settings', label: '设置与账号', caption: 'ETS 账号与功能设置', page: '/settings' },
        ],
      },
    ]
  }, [activeTask])


  function beginAuthentication() {
    setAuthMessage('')
    authorizationStarted.current = true
    void startAuthorization(page || '/').catch((error: unknown) => {
      authorizationStarted.current = false
      setAuthMessage(error instanceof Error ? error.message : '无法连接统一认证，请稍后重试。')
    })
  }

  function acceptLegalConsent() {
    writeStoredLegalConsent()
    setLegalConsentAccepted(true)
  }

  if (!legalConsentAccepted) {
    return <LegalConsentModal onAccept={acceptLegalConsent} />
  }

  if (pathname === '/auth/callback') {
    return (
      <Callback
        onAuthenticated={(nextSession, returnTo) => {
          updateSession(nextSession)
          if (nextSession.user) setCurrentUser(nextSession.user)
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

  const isAutoCompleteRoute = isAutoCompletePath(pathname)
  const meta = pageMeta[page] || (isAutoCompleteRoute
    ? {
        title: '作业自动完成',
        caption: '自动完成任务与进度查看',
      }
    : {
        title: '作业工作台',
        caption: '获取与查看作业标准答案',
      })
  const avatarUrl = resolveAvatarUrl(currentUser?.avatar_url)

  return (
    <main className={`control-shell ${mobileNavOpen ? 'drawer-open' : ''}`}>
      {toastMessage && createPortal(
        <div className={`toast-notification ${toastMessage.isError ? 'is-error' : ''}`} role={toastMessage.isError ? 'alert' : 'status'}>
          <Icon name={toastMessage.isError ? 'error' : 'check_circle'} filled />
          <span>{toastMessage.text}</span>
          <button
            className="toast-notification-close"
            type="button"
            onClick={() => {
              if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
              toastTimerRef.current = null
              setToastMessage(null)
            }}
            aria-label="关闭通知"
          >
            <Icon name="close" />
          </button>
        </div>,
        document.body
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

      {autoCompleteModalHw && (
        <CaptchaModal
          title="自动完成 · 安全人机验证"
          subtitle={`为防止滥用与保护账号，开启「${autoCompleteModalHw.name}」自动完成前需完成安全人机验证`}
          onSuccess={handleAutoCompleteCaptchaSuccess}
          onCancel={() => setAutoCompleteModalHw(null)}
        />
      )}

      {/* Floating Header Capsule */}
      <header className={`control-site-header ${headerCompact ? 'is-compact' : ''}`}>
        <div className="control-header-inner">
          <a className="control-brand" href="/">
            <img src={logoSrc} alt="" />
            <span>
              <strong>e听说</strong>
              <small>Fe Web · 作业工作台</small>
            </span>
          </a>

          <div className="control-header-actions">
            {softwareConfig && (softwareConfig.announcementTitle || softwareConfig.announcementMessage) && (
              <button
                className="control-header-link control-announcement-link"
                onClick={() => setShowAnnouncementModal(true)}
                title="查看系统公告"
                aria-label="查看系统公告"
                type="button"
              >
                <Icon name="campaign" />
                <span>公告</span>
              </button>
            )}

            {/* User Account / Profile Dropdown */}
            <div className="control-account-wrapper" ref={userMenuRef}>
              <button
                className={`control-account ${userMenuOpen ? 'is-open' : ''}`}
                onClick={() => setUserMenuOpen((prev) => !prev)}
                title="查看个人中心与快捷操作"
                type="button"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
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
                    {etsReady
                      ? (accountInfo?.account_display ? `ETS: ${accountInfo.account_display}` : 'ETS 已连接')
                      : 'ETS 未绑定'}
                  </small>
                </div>
                <Icon name="expand_more" className={`control-account-caret ${userMenuOpen ? 'is-open' : ''}`} />
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="control-user-dropdown-backdrop"
                    onClick={() => setUserMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="control-user-dropdown" role="menu">
                    <div className="control-user-dropdown-header">
                      <div className="control-user-dropdown-avatar">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt={currentUser?.name || ''} />
                        ) : (
                          currentUser?.name ? currentUser.name.slice(0, 1).toUpperCase() : <Icon name="person" />
                        )}
                      </div>
                      <div className="control-user-dropdown-info">
                        <div className="control-user-dropdown-name-row">
                          <strong className="control-user-dropdown-name">{currentUser?.name || '我的通行证'}</strong>
                          {currentUser?.member_level ? (
                            <span className="control-user-badge vip">VIP {currentUser.member_level}</span>
                          ) : (
                            <span className="control-user-badge">普通会员</span>
                          )}
                        </div>
                        <div className="control-user-dropdown-uid">UID #{currentUser?.id || '-'}</div>
                        <div className={`control-user-dropdown-ets ${etsReady ? 'is-bound' : 'is-unbound'}`}>
                          <span className="control-user-ets-dot" />
                          <span>
                            {etsReady
                              ? (accountInfo?.account_display ? `ETS: ${accountInfo.account_display}` : 'ETS 已连接')
                              : 'ETS 未绑定'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="control-user-dropdown-menu">
                      <button
                        className={`control-user-dropdown-item as-button ${page === '/settings' ? 'is-current' : ''}`}
                        onClick={() => {
                          setUserMenuOpen(false)
                          navigate('/settings')
                        }}
                        type="button"
                        role="menuitem"
                      >
                        <div className="control-user-dropdown-icon">
                          <Icon name="tune" />
                        </div>
                        <div className="control-user-dropdown-text">
                          <strong>工作台设置</strong>
                          <small>ETS 账号连接与功能偏好</small>
                        </div>
                        <Icon name="chevron_right" className="control-user-dropdown-arrow" />
                      </button>

                      <a
                        className="control-user-dropdown-item"
                        href="https://lastudio.cc/account"
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setUserMenuOpen(false)}
                        role="menuitem"
                      >
                        <div className="control-user-dropdown-icon">
                          <Icon name="manage_accounts" />
                        </div>
                        <div className="control-user-dropdown-text">
                          <strong>通行证中心</strong>
                          <small>个人信息、ETS 绑定与安全管理</small>
                        </div>
                        <Icon name="open_in_new" className="control-user-dropdown-arrow" />
                      </a>

                      <a
                        className="control-user-dropdown-item"
                        href="https://lastudio.cc/admin"
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setUserMenuOpen(false)}
                        role="menuitem"
                      >
                        <div className="control-user-dropdown-icon">
                          <Icon name="admin_panel_settings" />
                        </div>
                        <div className="control-user-dropdown-text">
                          <strong>管理中心</strong>
                          <small>LaStudio 控制台后台</small>
                        </div>
                        <Icon name="open_in_new" className="control-user-dropdown-arrow" />
                      </a>

                    </div>

                    <div className="control-user-dropdown-divider" />

                    <div className="control-user-dropdown-footer">
                      <button
                        className="control-user-dropdown-logout"
                        onClick={signOut}
                        type="button"
                        role="menuitem"
                      >
                        <div className="control-user-dropdown-logout-icon">
                          <Icon name="logout" />
                        </div>
                        <span>退出登录</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              className="control-icon-button control-header-logout-button"
              onClick={signOut}
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
            {computedNavGroups.map((group) => (
              <section key={group.label}>
                <small>{group.label}</small>
                {group.items.map((item) => {
                  const isActive = page === item.page || (item.label === '自动完成' && isAutoCompleteRoute)
                  return (
                    <button
                      key={item.page}
                      className={isActive ? 'is-active' : ''}
                      onClick={() => navigate(item.page)}
                      title={sidebarCollapsed ? (item.badge ? `${item.label} (${item.badge})` : item.label) : undefined}
                      type="button"
                    >
                      <Icon name={item.icon} />
                      <span className="control-nav-label">
                        <span className="fe-nav-title-row">
                          <strong>{item.label}</strong>
                          {item.badge && (
                            <span className={`fe-nav-badge ${item.badgeType || ''}`}>
                              {item.badge}
                            </span>
                          )}
                        </span>
                        <small>{item.caption}</small>
                      </span>
                    </button>
                  )
                })}
              </section>
            ))}
          </nav>

          <footer>
            <i style={{ background: etsReady ? '#2f7a55' : '#94a3b8' }} />
            <span className="admin-footer-label">
              {etsReady ? 'e听说已连接' : 'e听说未绑定'}
            </span>
          </footer>
        </aside>

        {/* Workspace */}
        <section className="control-workspace">
          {/* Page Heading */}
          <header className="control-page-heading">
            <div>
              <h1>
                {isAutoCompleteRoute
                  ? (activeTask && !['COMPLETED', 'FAILED'].includes(activeTask.status)
                      ? '作业自动完成 · 实时执行看板'
                      : pathname === '/auto-complete'
                      ? '作业自动完成 · 任务看板与历史'
                      : `作业自动完成 · ${autoCompleteTargetHw?.name || '任务部署工作台'}`)
                  : viewingPaper
                  ? `试卷阅读 · ${viewingPaper.homework.name}`
                  : meta.title}
              </h1>
              <span>
                {isAutoCompleteRoute
                  ? (activeTask && !['COMPLETED', 'FAILED'].includes(activeTask.status)
                      ? `正在实时执行「${activeTask.homework_name || '作业'}」· 当前进度 ${activeTask.progress || 0}%`
                      : pathname === '/auto-complete'
                      ? '查看任务进度和历史记录'
                      : '配置目标分数、作答用时和声音')
                  : viewingPaper
                  ? '查看作业结构、题目解析与标准答案'
                  : meta.caption}
              </span>
            </div>
          </header>

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
          {isAutoCompleteRoute ? (
            <ErrorBoundary
              fallbackTitle="自动完成模块加载遇到问题"
              onReset={() => {
                setAutoCompletePermitToken('')
                navigate('/')
              }}
            >
              {(() => {
                const targetHwId =
                  autoCompleteTargetHw?.id ||
                  pathname.replace('/homework/', '').replace('/auto-complete', '').replace(/\//g, '')
                const effectiveTask =
                  pathname === '/auto-complete'
                    ? activeTask
                    : activeTask && String(activeTask.homework_id) === String(targetHwId)
                    ? activeTask
                    : null
                return (
                  <AutoCompletePage
                    key={pathname}
                    homework={
                      autoCompleteTargetHw ||
                      homeworks.find((h) => pathname.includes(h.id)) ||
                      historyHomeworks.find((h) => pathname.includes(h.id)) ||
                      (effectiveTask?.homework_id
                        ? {
                            id: effectiveTask.homework_id,
                            name: effectiveTask.homework_name || '作业自动完成',
                            contents: [],
                          }
                        : {
                            id: targetHwId,
                            name: '作业自动完成',
                            contents: [],
                          })
                    }
                    paper={
                      (autoCompleteTargetHw && paperCache[autoCompleteTargetHw.id]) ||
                      (effectiveTask?.homework_id && paperCache[effectiveTask.homework_id]) ||
                      (viewingPaper && viewingPaper.homework.id === (autoCompleteTargetHw?.id || effectiveTask?.homework_id)
                        ? viewingPaper.paper
                        : null)
                    }
                    permitToken={autoCompletePermitToken}
                    accessToken={session.accessToken}
                    activeTask={effectiveTask}
                    returnLabel={autoCompleteReturnLabel}
                    onTaskChange={updateActiveTask}
                    onBack={handleAutoCompleteBack}
                    onCompleted={handleAutoCompleteCompleted}
                    onRequestPermit={() => {
                      const targetHw =
                        autoCompleteTargetHw ||
                        homeworks.find((h) => pathname.includes(h.id)) ||
                        historyHomeworks.find((h) => pathname.includes(h.id)) ||
                        (effectiveTask?.homework_id
                          ? homeworks.find((h) => h.id === effectiveTask.homework_id) ||
                            historyHomeworks.find((h) => h.id === effectiveTask.homework_id)
                          : null)
                      if (targetHw) {
                        handleTriggerAutoComplete(targetHw)
                      } else {
                        navigate('/')
                      }
                    }}
                    onOpenSettingsVoice={() => {
                      navigate('/settings')
                    }}
                    isHubRoute={pathname === '/auto-complete'}
                    getFeatureStatus={getFeatureStatus}
                    onToast={showToast}
                  />
                )
              })()}
            </ErrorBoundary>
          ) : page === '/settings' ? (
            <SettingsPage
              currentUser={currentUser}
              accountInfo={accountInfo}
              accessToken={session.accessToken}
              onToast={showToast}
              onRefreshSession={handleRequestRefresh}
              onChangyanLogin={() => {
                setChangyanError(null)
                setChangyanOpen(true)
              }}
              getFeatureStatus={getFeatureStatus}
            />
          ) : viewingPaper ? (
            <PaperReaderView
              homework={viewingPaper.homework}
              paper={viewingPaper.paper}
              isLoadingPaper={isLoadingPaper}
              copyExportStatus={getFeatureStatus('copy_export', '答案导出').status}
              copyExportDenyReason={getFeatureDenyReason('copy_export')}
              answerParserStatus={getFeatureStatus('answer_parser', '答案解析').status}
              answerParserDenyReason={getFeatureDenyReason('answer_parser')}
              onBack={() => setViewingPaper(null)}
              onAutoComplete={() => handleTriggerAutoComplete(viewingPaper.homework)}
              onCopyAnswer={() => viewingPaper.paper && handleCopyAnswer(viewingPaper.paper)}
              onExportAnswer={() => viewingPaper.paper && handleExportAnswer(viewingPaper.paper)}
              onReParse={() => handleReReadPaper(viewingPaper.homework)}
              onManualRead={() => handleManualReadPaper(viewingPaper.homework)}
              activeTask={activeTask}
            />
          ) : (
            <HomeworkListView
              activeTab={activeTab}
              hasLoaded={
                activeTab === 'current'
                  ? hasLoadedCurrent
                  : activeTab === 'history'
                  ? hasLoadedHistory
                  : (hasLoadedCurrent || hasLoadedHistory)
              }
              accountInfo={accountInfo}
              homeworks={homeworks}
              historyHomeworks={historyHomeworks}
              isLoadingHomeworks={isLoadingHomeworks}
              isLoadingHistory={isLoadingHistory}
              homeworkError={homeworkError}
              parsingId={parsingId}
              parseErrors={parseErrors}
              cloudModeStatus={getFeatureStatus('cloud_mode', '云端模式').status}
              cloudModeDenyReason={getFeatureDenyReason('cloud_mode')}
              answerParserStatus={getFeatureStatus('answer_parser', '答案解析').status}
              answerParserDenyReason={getFeatureDenyReason('answer_parser')}
              onRefresh={handleRequestRefresh}
              onManualReadList={handleManualReadList}
              onOpenHomework={handleOpenHomework}
              onTriggerParse={handleTriggerParse}
              onAutoComplete={handleTriggerAutoComplete}
              onChangyanLogin={() => {
                setChangyanError(null)
                setChangyanOpen(true)
              }}
              activeTask={activeTask}
            />
          )}
        </section>
      </div>

      {changyanOpen && (
        <ChangyanLoginModal
          busy={changyanBusy}
          error={changyanError}
          onClose={() => {
            if (changyanBusy) return
            setChangyanOpen(false)
            setChangyanError(null)
          }}
          onCredential={handleChangyanCredential}
        />
      )}
    </main>
  )
}

export default App
