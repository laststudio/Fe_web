import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './components/Icon'
import {
  checkHomeworkCompatibility,
  getAutoCompleteTaskStatus,
  startAutoComplete,
  type AutoCompleteMode,
  type AutoCompleteTaskResponse,
  type AutoCompleteVoiceMode,
  type StartAutoCompletePayload,
} from './api/autoComplete'
import { getVoiceAudioUrl, getVoices, type VoiceProfile } from './api/voice'
import { getHomeworkDetail, type HomeworkItem, type Paper } from './api/homework'

const DISCLAIMER_PHRASE = '作者不为使用此功能造成的一切后果负责'

export type AutoCompletePageProps = {
  homework: HomeworkItem
  paper: Paper | null
  permitToken: string
  accessToken: string
  onBack: () => void
  onRequestPermit?: () => void
  onOpenSettingsVoice?: () => void
  onToast?: (msg: string) => void
}

type QuestionScoreItem = {
  order: number
  typeName: string
  questionText: string
  maxScore: number
  allocatedScore: number
  manualScore: number
}

export function AutoCompletePage({
  homework,
  paper,
  permitToken,
  accessToken,
  onBack,
  onRequestPermit,
  onOpenSettingsVoice,
  onToast,
}: AutoCompletePageProps) {
  // Mode selection
  const [mode, setMode] = useState<AutoCompleteMode>('auto')

  // Voice selection
  const [voiceMode, setVoiceMode] = useState<AutoCompleteVoiceMode>('clone')
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('')
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)

  // Loaded paper state (auto-load if not provided via props)
  const [fetchedPaper, setFetchedPaper] = useState<Paper | null>(null)
  const [isLoadingPaper, setIsLoadingPaper] = useState<boolean>(() => !paper)

  const activePaper = paper || fetchedPaper

  useEffect(() => {
    if (paper || fetchedPaper) {
      return
    }
    if (!homework.id || !accessToken) return
    let active = true
    getHomeworkDetail(accessToken, homework.id)
      .then((res) => {
        if (active && res) {
          setFetchedPaper(res)
        }
      })
      .catch((err) => {
        console.warn('Failed to load paper detail in AutoCompletePage:', err)
      })
      .finally(() => {
        if (active) setIsLoadingPaper(false)
      })
    return () => {
      active = false
    }
  }, [paper, fetchedPaper, homework.id, accessToken])
  const compatibility = useMemo(() => {
    return checkHomeworkCompatibility(homework, activePaper)
  }, [homework, activePaper])

  // Paper & Questions calculation
  const { totalQuestions, paperTotalScore, questions } = useMemo(() => {
    let qList: Array<{ order: number; typeName: string; questionText: string; maxScore: number }> = []

    if (activePaper && Array.isArray(activePaper.sections) && activePaper.sections.length > 0) {
      let count = 0
      for (const sec of activePaper.sections) {
        if (!sec || !Array.isArray(sec.questions)) continue
        for (const q of sec.questions) {
          if (!q) continue
          count++
          qList.push({
            order: q.order || count,
            typeName: q.typeName || sec.typeName || '选择题',
            questionText: q.questionText || q.originalText || `第 ${count} 题`,
            maxScore: 5.0, // default per question point
          })
        }
      }
    }

    if (qList.length === 0) {
      // Fallback if paper structure wasn't fully parsed yet or has no questions
      const count = 10
      for (let i = 1; i <= count; i++) {
        qList.push({
          order: i,
          typeName: '综合题型',
          questionText: `第 ${i} 题`,
          maxScore: 10.0,
        })
      }
    }

    const tQuestions = Math.max(1, qList.length)
    const rawTotal = Number(homework?.total_score)
    const defaultTotal = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 100
    // Proportional base point
    const pointPerQ = Number((defaultTotal / tQuestions).toFixed(2))
    qList = qList.map((q) => ({ ...q, maxScore: pointPerQ }))

    return {
      totalQuestions: tQuestions,
      paperTotalScore: defaultTotal,
      questions: qList,
    }
  }, [homework, activePaper])

  // Suggested time
  const suggestedTimeSeconds = useMemo(() => {
    return Math.max(90, totalQuestions * 25)
  }, [totalQuestions])

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60)
    const s = sec % 60
    return mins > 0 ? `${mins} 分 ${s} 秒` : `${s} 秒`
  }

  // 1. Auto mode target total score state: strictly capped at <= paperTotalScore * 0.95
  const maxAutoScore = useMemo(() => {
    return Number((paperTotalScore * 0.95).toFixed(1))
  }, [paperTotalScore])

  const [customAutoTargetTotal, setCustomAutoTargetTotal] = useState<number | null>(null)
  const defaultAutoTarget = useMemo(() => {
    return Number((paperTotalScore * 0.88).toFixed(1))
  }, [paperTotalScore])

  const autoTargetTotal = useMemo(() => {
    const candidate = customAutoTargetTotal !== null ? customAutoTargetTotal : defaultAutoTarget
    return Math.min(candidate, maxAutoScore)
  }, [customAutoTargetTotal, defaultAutoTarget, maxAutoScore])

  const handleUpdateAutoTargetTotal = (val: number) => {
    if (val > maxAutoScore) {
      setCustomAutoTargetTotal(maxAutoScore)
      onToast?.(`已自动受风控限制截断为最高 95% (${maxAutoScore}分)`)
    } else {
      setCustomAutoTargetTotal(Number(val.toFixed(1)))
    }
  }

  // Manual per-question scores state
  const [customManualScores, setCustomManualScores] = useState<Record<number, number>>({})

  const manualScores = useMemo<Record<number, number>>(() => {
    const scores: Record<number, number> = {}
    questions.forEach((q) => {
      if (customManualScores[q.order] !== undefined) {
        scores[q.order] = customManualScores[q.order]
      } else {
        scores[q.order] = Number((q.maxScore * 0.9).toFixed(1))
      }
    })
    return scores
  }, [questions, customManualScores])

  const handleUpdateManualScore = (order: number, val: number) => {
    setCustomManualScores((prev) => ({
      ...prev,
      [order]: Number(val.toFixed(1)),
    }))
  }

  // Collapsible state for auto mode score breakdown
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false)

  // Compute proportional allocation with zero rounding error:
  // sum(score_i) MUST EQUAL autoTargetTotal exactly!
  const allocatedQuestionScores = useMemo<QuestionScoreItem[]>(() => {
    const totalMax = questions.reduce((sum, q) => sum + q.maxScore, 0)
    let allocatedSum = 0
    const results: QuestionScoreItem[] = []

    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx]
      let allocated: number
      if (idx === questions.length - 1) {
        allocated = Number((autoTargetTotal - allocatedSum).toFixed(1))
      } else {
        const ratio = totalMax > 0 ? q.maxScore / totalMax : 1 / questions.length
        allocated = Number((autoTargetTotal * ratio).toFixed(1))
        allocatedSum = Number((allocatedSum + allocated).toFixed(1))
      }

      results.push({
        order: q.order,
        typeName: q.typeName,
        questionText: q.questionText,
        maxScore: q.maxScore,
        allocatedScore: allocated,
        manualScore: manualScores[q.order] ?? 0,
      })
    }

    return results
  }, [questions, autoTargetTotal, manualScores])

  // Manual mode validations:
  const manualTotalSum = useMemo(() => {
    return Object.values(manualScores).reduce((acc, cur) => acc + (Number(cur) || 0), 0)
  }, [manualScores])

  const manualOverMaxQuestions = useMemo(() => {
    return questions.filter((q) => (manualScores[q.order] || 0) > q.maxScore)
  }, [questions, manualScores])

  const isManualTotalOverMax = manualTotalSum > paperTotalScore

  // Fetch voices
  useEffect(() => {
    if (!accessToken) return
    getVoices(accessToken)
      .then((res) => {
        const list = Array.isArray(res) ? res : []
        setVoices(list)
        const defaultVoice = list.find((v) => v.is_default) || list[0]
        if (defaultVoice) {
          setSelectedVoiceId(defaultVoice.id)
        }
      })
      .catch(() => {
        // Ignore or keep empty
      })
  }, [accessToken])

  // Preview Voice handler
  const handleToggleVoicePreview = () => {
    if (!selectedVoiceId) return
    if (isPlayingPreview) {
      if (audioPreviewRef.current) audioPreviewRef.current.pause()
      setIsPlayingPreview(false)
      return
    }

    if (audioPreviewRef.current) audioPreviewRef.current.pause()
    const url = getVoiceAudioUrl(selectedVoiceId)
    const audio = new Audio(url)
    audioPreviewRef.current = audio
    setIsPlayingPreview(true)
    audio.onended = () => setIsPlayingPreview(false)
    audio.onerror = () => {
      setIsPlayingPreview(false)
      onToast?.('试听声音加载失败')
    }
    audio.play().catch(() => setIsPlayingPreview(false))
  }

  // Risk modal & Countdown state
  const [isRiskModalOpen, setIsRiskModalOpen] = useState(false)
  const [riskStep, setRiskStep] = useState<number>(1) // 1, 2, 3 (for manual mode)
  const [countdown, setCountdown] = useState<number>(10)
  const [typedPhrase, setTypedPhrase] = useState<string>('')
  const [pasteWarning, setPasteWarning] = useState<string | null>(null)
  const [isStartingTask, setIsStartingTask] = useState(false)

  // Execution Board state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<AutoCompleteTaskResponse | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)

  // Countdown timer effect
  useEffect(() => {
    let timer: number | null = null
    if (isRiskModalOpen && countdown > 0) {
      timer = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (timer) clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [isRiskModalOpen, countdown, riskStep])

  // Poll task status effect
  useEffect(() => {
    let pollTimer: number | null = null
    if (activeTaskId && accessToken) {
      const poll = async () => {
        try {
          const res = await getAutoCompleteTaskStatus(accessToken, activeTaskId)
          setTaskStatus(res)
          if (res.status === 'COMPLETED' || res.status === 'FAILED') {
            if (pollTimer) clearInterval(pollTimer)
          }
        } catch {
          // Continue polling
        }
      }

      poll()
      pollTimer = window.setInterval(poll, 1600)
    }
    return () => {
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [activeTaskId, accessToken])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause()
      }
    }
  }, [])

  // Check valid permit token
  if (!permitToken) {
    return (
      <div className="fe-autocomplete-container">
        <div className="fe-empty-state" style={{ margin: '60px auto' }}>
          <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
            <Icon name="gpp_bad" />
          </div>
          <h2>安全授权凭据缺失或已过期</h2>
          <p>进入自动完成页面前必须完成人机安全验证并获取准入令牌 (Permit Token)。</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
            {onRequestPermit && (
              <button type="button" className="control-primary" onClick={onRequestPermit}>
                <Icon name="verified_user" />
                <span>立即进行安全人机验证</span>
              </button>
            )}
            <button type="button" className="control-secondary" onClick={onBack}>
              <Icon name="arrow_back" />
              <span>返回作业列表</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Trigger Risk Modal
  const handleOpenRiskModal = () => {
    setIsRiskModalOpen(true)
    setRiskStep(1)
    setCountdown(10)
    setTypedPhrase('')
    setPasteWarning(null)
  }

  // Step advancement for manual mode
  const handleNextRiskStep = () => {
    if (riskStep < 3) {
      setRiskStep(riskStep + 1)
      setCountdown(10)
    }
  }

  // Submit Auto Complete Task
  const handleConfirmStart = async () => {
    if (typedPhrase.trim() !== DISCLAIMER_PHRASE) {
      onToast?.('免责承诺声明未完全正确输入')
      return
    }

    setIsStartingTask(true)
    try {
      let perQuestionScoresPayload: Record<number, { total: number }> | undefined = undefined

      if (mode === 'manual') {
        perQuestionScoresPayload = {}
        questions.forEach((q) => {
          perQuestionScoresPayload![q.order] = { total: manualScores[q.order] ?? q.maxScore }
        })
      } else {
        perQuestionScoresPayload = {}
        allocatedQuestionScores.forEach((q) => {
          perQuestionScoresPayload![q.order] = { total: q.allocatedScore }
        })
      }

      const payload: StartAutoCompletePayload = {
        homework_id: homework.id,
        homework_name: homework.name,
        mode,
        target_total: mode === 'auto' ? autoTargetTotal : Number(manualTotalSum.toFixed(1)),
        allow_over_max: mode === 'manual' ? isManualTotalOverMax || manualOverMaxQuestions.length > 0 : false,
        use_time: suggestedTimeSeconds,
        voice_mode: voiceMode,
        voice_id: voiceMode === 'clone' ? selectedVoiceId : undefined,
        per_question_scores: perQuestionScoresPayload,
        permit_token: permitToken,
        disclaimer_text: typedPhrase.trim(),
      }

      const res = await startAutoComplete(accessToken, payload)
      setIsRiskModalOpen(false)
      setActiveTaskId(res.task_id)
      setIsMinimized(false)
      onToast?.('自动完成任务已发起，正在为您执行！')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发起任务失败'
      onToast?.(msg)
    } finally {
      setIsStartingTask(false)
    }
  }

  if (isLoadingPaper) {
    return (
      <div className="fe-autocomplete-container" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Icon name="sync" className="fe-spin" style={{ fontSize: 36, color: '#3b82f6', marginBottom: 16 }} />
        <h3 style={{ color: '#1e293b', margin: '0 0 8px' }}>正在拉取作业试卷与题目结构...</h3>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>系统正在核验作业题型适配性与分值参数</p>
      </div>
    )
  }

  return (
    <div className="fe-autocomplete-container">
      {/* Top Breadcrumb & Return Nav */}
      <div className="fe-reader-top-nav" style={{ marginBottom: 16 }}>
        <button className="control-secondary fe-back-btn" type="button" onClick={onBack}>
          <Icon name="arrow_back" />
          <span>放弃并返回</span>
        </button>
        <span className="admin-pill-badge is-muted">
          <Icon name="lock" style={{ fontSize: 14 }} />
          <span>安全准入中 · 令牌已核验</span>
        </span>
      </div>

      {/* Unsupported Question Types Warning Banner */}
      {!compatibility.supported && (
        <div
          className="admin-status-strip is-danger"
          style={{
            margin: '0 0 20px',
            padding: '16px 20px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            background: '#fef2f2',
            border: '1px solid #fca5a5',
          }}
        >
          <Icon name="block" style={{ fontSize: 24, color: '#dc2626', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ color: '#991b1b', fontSize: 15, display: 'block', marginBottom: 4 }}>
              该作业包含当前版本未适配的题型，已禁止自动完成
            </strong>
            <span style={{ color: '#b91c1c', fontSize: 13.5, lineHeight: 1.6 }}>
              {compatibility.reason}
            </span>
          </div>
        </div>
      )}

      {/* 1. Homework Meta Banner */}
      <div className="fe-autocomplete-hero">
        <div className="fe-autocomplete-hero-head">
          <div className="fe-hero-icon-box">
            <Icon name="bolt" filled />
          </div>
          <div>
            <h2>{homework?.name && homework.name !== '作业自动完成' ? homework.name : (activePaper?.title || activePaper?.paperName || homework?.name || '作业自动完成')}</h2>
            <p>高拟真作业自动完成调度工作台 · 请审慎配置分值与声音参数</p>
          </div>
        </div>

        <div className="fe-autocomplete-stats-grid">
          <div className="fe-stat-tile">
            <span className="fe-stat-label">题目数量</span>
            <strong className="fe-stat-value">{totalQuestions} 题</strong>
          </div>
          <div className="fe-stat-tile">
            <span className="fe-stat-label">试卷官方满分</span>
            <strong className="fe-stat-value">{paperTotalScore.toFixed(1)} 分</strong>
          </div>
          <div className="fe-stat-tile">
            <span className="fe-stat-label">建议答题用时</span>
            <strong className="fe-stat-value">{formatSeconds(suggestedTimeSeconds)}</strong>
          </div>
          <div className="fe-stat-tile">
            <span className="fe-stat-label">所属学科</span>
            <strong className="fe-stat-value">{homework.subject_name || '英语'}</strong>
          </div>
        </div>
      </div>

      {/* 2. Mode Selection Tabs */}
      <div className="fe-mode-card">
        <div className="fe-mode-tabs-nav">
          <button
            type="button"
            className={`fe-mode-tab-item ${mode === 'auto' ? 'is-active' : ''}`}
            onClick={() => setMode('auto')}
          >
            <Icon name="auto_mode" filled={mode === 'auto'} />
            <div className="fe-mode-tab-text">
              <strong>一键自动模式 (推荐)</strong>
              <small>总分智能比例平衡 · 严格受控在 95% 满分风控线内</small>
            </div>
          </button>

          <button
            type="button"
            className={`fe-mode-tab-item ${mode === 'manual' ? 'is-active' : ''}`}
            onClick={() => setMode('manual')}
          >
            <Icon name="tune" filled={mode === 'manual'} />
            <div className="fe-mode-tab-text">
              <strong>手动逐题模式 (高级)</strong>
              <small>支持自定义单题分值 · 遇超限题目触发刺眼告警</small>
            </div>
          </button>
        </div>

        <div className="fe-mode-tab-body">
          {mode === 'auto' ? (
            /* AUTO MODE */
            <div className="fe-auto-mode-view">
              <div className="fe-slider-panel">
                <div className="fe-slider-panel-head">
                  <div className="fe-slider-title">
                    <Icon name="speed" />
                    <strong>目标完成总分设定</strong>
                    <span className="admin-pill-badge is-muted">
                      最高上限锁定: {maxAutoScore.toFixed(1)} 分 (95% 保护线)
                    </span>
                  </div>
                  <div className="fe-slider-input-box">
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={maxAutoScore}
                      value={autoTargetTotal}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0
                        handleUpdateAutoTargetTotal(val)
                      }}
                    />
                    <span>/ {paperTotalScore.toFixed(1)} 分</span>
                  </div>
                </div>

                <div className="fe-range-container">
                  <input
                    type="range"
                    className="fe-styled-slider"
                    min={0}
                    max={maxAutoScore}
                    step={0.1}
                    value={autoTargetTotal}
                    onChange={(e) => handleUpdateAutoTargetTotal(parseFloat(e.target.value) || 0)}
                  />
                  <div className="fe-slider-ticks">
                    <span>0 分</span>
                    <span>推荐安全区: {(paperTotalScore * 0.85).toFixed(1)} - {maxAutoScore} 分</span>
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>上限 {maxAutoScore} 分</span>
                  </div>
                </div>
              </div>

              {/* Proportional allocation breakdown accordion */}
              <div className="fe-breakdown-card">
                <button
                  type="button"
                  className="fe-breakdown-header"
                  onClick={() => setIsBreakdownOpen(!isBreakdownOpen)}
                >
                  <div className="fe-breakdown-title">
                    <Icon name="account_tree" />
                    <strong>各小题等比自动分配方案 ({totalQuestions} 题)</strong>
                    <span className="fe-balance-tag">
                      <Icon name="verified" />
                      小题求和与设定总分绝对吻合 ({autoTargetTotal.toFixed(1)} 分)
                    </span>
                  </div>
                  <Icon name={isBreakdownOpen ? 'expand_less' : 'expand_more'} />
                </button>

                {isBreakdownOpen && (
                  <div className="fe-breakdown-list">
                    <div className="fe-breakdown-table-head">
                      <span>题号</span>
                      <span>题型</span>
                      <span>卷面原满分</span>
                      <span>等比平衡得分</span>
                    </div>
                    {allocatedQuestionScores.map((item) => (
                      <div key={item.order} className="fe-breakdown-table-row">
                        <span className="fe-td-order">Q{item.order}</span>
                        <span className="fe-td-type">{item.typeName}</span>
                        <span className="fe-td-max">{item.maxScore.toFixed(1)} 分</span>
                        <span className="fe-td-score">
                          <strong>{item.allocatedScore.toFixed(1)}</strong> 分
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* MANUAL MODE */
            <div className="fe-manual-mode-view">
              {/* Alert banner if total exceeds max */}
              {isManualTotalOverMax && (
                <div className="fe-danger-banner">
                  <Icon name="crisis_alert" filled />
                  <div>
                    <strong>【极度危险】当前设定总分 ({manualTotalSum.toFixed(1)}分) 超过试卷官方真正满分 ({paperTotalScore.toFixed(1)}分)！</strong>
                    <p>提交超满分成绩极易被平台异常判定系统与教师人工审查立刻识破，强烈建议重新调整！</p>
                  </div>
                </div>
              )}

              <div className="fe-manual-toolbar">
                <div className="fe-manual-stat-left">
                  <span>逐题分值规划表</span>
                  <small>填写每道小题的期望得分，支持 0.1 步进</small>
                </div>
                <div className="fe-manual-stat-right">
                  <span>当前设定总分：</span>
                  <strong className={isManualTotalOverMax ? 'fe-text-danger' : 'fe-text-success'}>
                    {manualTotalSum.toFixed(1)}
                  </strong>
                  <span> / {paperTotalScore.toFixed(1)} 分</span>
                </div>
              </div>

              <div className="fe-manual-questions-list">
                {questions.map((q) => {
                  const currentVal = manualScores[q.order] ?? 0
                  const isOver = currentVal > q.maxScore
                  return (
                    <div key={q.order} className={`fe-manual-item ${isOver ? 'is-danger-over' : ''}`}>
                      <div className="fe-manual-item-meta">
                        <span className="fe-manual-order">Q{q.order}</span>
                        <div className="fe-manual-details">
                          <div className="fe-manual-title-row">
                            <span className="fe-manual-type">{q.typeName}</span>
                            <span className="fe-manual-max">官方满分: {q.maxScore.toFixed(1)} 分</span>
                            {isOver && <span className="fe-danger-pill">【危险：单题超满分】</span>}
                          </div>
                          <p className="fe-manual-stem">{q.questionText}</p>
                        </div>
                      </div>

                      <div className="fe-manual-input-box">
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          className={isOver ? 'fe-input-over-max' : ''}
                          value={currentVal}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0
                            handleUpdateManualScore(q.order, val)
                          }}
                        />
                        <span>分</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Voice Selection Section */}
      <div className="admin-policy-card fe-voice-section-card">
        <div className="admin-policy-card-head">
          <div className="fe-section-icon">
            <Icon name="interpreter_mode" />
          </div>
          <div>
            <h3>朗读声音与音色选择</h3>
            <p>选择用于朗读作答和语音口语题的录音音色方案</p>
          </div>
        </div>

        <div className="fe-voice-options-grid">
          {/* Option 1: AI Clone */}
          <div
            className={`fe-voice-option-card ${voiceMode === 'clone' ? 'is-active' : ''}`}
            onClick={() => setVoiceMode('clone')}
          >
            <div className="fe-voice-card-radio">
              <span className={`fe-radio-circle ${voiceMode === 'clone' ? 'is-checked' : ''}`} />
            </div>
            <div className="fe-voice-card-content">
              <div className="fe-voice-card-title">
                <strong>专属声音克隆 (tts.ai)</strong>
                <span className="admin-pill-badge is-success">最高拟真</span>
              </div>
              <p>使用您在录音棚录制的音色特征，通过深度学习生成个人声音。</p>

              {voiceMode === 'clone' && (
                <div className="fe-voice-clone-picker" onClick={(e) => e.stopPropagation()}>
                  {voices.length > 0 ? (
                    <div className="fe-voice-select-row">
                      <select
                        value={selectedVoiceId}
                        onChange={(e) => setSelectedVoiceId(e.target.value)}
                        className="fe-voice-dropdown"
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} {v.is_default ? '（默认音色）' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="control-secondary fe-voice-preview-btn"
                        onClick={handleToggleVoicePreview}
                        title={isPlayingPreview ? '暂停' : '试听选中声音'}
                      >
                        <Icon name={isPlayingPreview ? 'pause' : 'volume_up'} />
                      </button>
                    </div>
                  ) : (
                    <div className="fe-voice-none-box">
                      <Icon name="info" />
                      <span>尚未检测到已录制的声音样本</span>
                      {onOpenSettingsVoice ? (
                        <button
                          type="button"
                          className="control-secondary fe-btn-sm"
                          onClick={onOpenSettingsVoice}
                        >
                          去录制
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Option 2: Edge-TTS */}
          <div
            className={`fe-voice-option-card ${voiceMode === 'edge' ? 'is-active' : ''}`}
            onClick={() => setVoiceMode('edge')}
          >
            <div className="fe-voice-card-radio">
              <span className={`fe-radio-circle ${voiceMode === 'edge' ? 'is-checked' : ''}`} />
            </div>
            <div className="fe-voice-card-content">
              <div className="fe-voice-card-title">
                <strong>Edge-TTS 机读原声</strong>
                <span className="admin-pill-badge is-muted">标准发音</span>
              </div>
              <p>微软云端自然高清晰度神经发音人，适合纯标准英语口音朗读。</p>
            </div>
          </div>

          {/* Option 3: No Voice (Dangerous) */}
          <div
            className={`fe-voice-option-card fe-voice-option-danger ${voiceMode === 'none' ? 'is-active' : ''}`}
            onClick={() => setVoiceMode('none')}
          >
            <div className="fe-voice-card-radio">
              <span className={`fe-radio-circle ${voiceMode === 'none' ? 'is-checked' : ''}`} />
            </div>
            <div className="fe-voice-card-content">
              <div className="fe-voice-card-title">
                <strong style={{ color: '#dc2626' }}>不上传声音 (跳过音频)</strong>
                <span className="admin-pill-badge is-danger">极度危险</span>
              </div>
              <p style={{ color: '#b91c1c' }}>
                【危险：口语题若无音频文件直接上传得分，极容易被官方平台检测判定作弊封号】
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Bottom Action Bar */}
      <div className="fe-autocomplete-footer-bar">
        <div className="fe-footer-summary">
          <span>预计总分：<strong>{mode === 'auto' ? autoTargetTotal.toFixed(1) : manualTotalSum.toFixed(1)}</strong> 分</span>
          <span className="fe-sep">·</span>
          <span>用时：<strong>{formatSeconds(suggestedTimeSeconds)}</strong></span>
          <span className="fe-sep">·</span>
          <span>模式：<strong>{mode === 'auto' ? '一键等比' : '手动控分'}</strong></span>
        </div>

        <button
          type="button"
          className="control-primary fe-start-button"
          disabled={!compatibility.supported}
          style={!compatibility.supported ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          title={!compatibility.supported ? compatibility.reason : '开始自动完成'}
          onClick={() => {
            if (!compatibility.supported) {
              onToast?.(compatibility.reason || '该作业包含未适配题型，暂未开放自动完成')
              return
            }
            handleOpenRiskModal()
          }}
        >
          <Icon name={compatibility.supported ? 'bolt' : 'block'} />
          <span>{compatibility.supported ? '开始自动完成' : '该作业暂不支持自动完成'}</span>
        </button>
      </div>

      {/* 5. CORE RISK MODAL (FULL SCREEN DEFENSE) */}
      {isRiskModalOpen && (
        <div className="fe-risk-fullscreen-overlay" role="dialog" aria-modal="true">
          <div className="fe-risk-fullscreen-card">
            <div className="fe-risk-card-head">
              <div className="fe-risk-icon-pulse">
                <Icon name="security_update_warning" filled />
              </div>
              <div>
                <h2>高风控安全确认与免责誓词</h2>
                <p>
                  {mode === 'auto'
                    ? '一键自动模式安全审核流程 · 强制 10 秒倒计时防呆机制'
                    : `手动自定义模式三重递进确认 · 当前阶段 (${riskStep}/3)`}
                </p>
              </div>
            </div>

            <div className="fe-risk-card-body">
              {mode === 'auto' ? (
                /* Auto mode risk content */
                <div className="fe-risk-step-content">
                  <div className="fe-risk-notice-box">
                    <strong>严正安全声明与风险告知</strong>
                    <p>
                      自动完成功能将模拟真实的作答网络包交互与分值提交。本工具仅供技术研究与个人评测使用，
                      <strong>严禁在任何期中期末正式考试、官方排位认证等关键学业考核中使用</strong>。
                    </p>
                    <p>
                      您当前配置的目标分数为 <strong>{autoTargetTotal.toFixed(1)} 分</strong>（已受 95% 保护线风控拦截），
                      答题预计用时 <strong>{formatSeconds(suggestedTimeSeconds)}</strong>。
                    </p>
                  </div>

                  {countdown > 0 ? (
                    <div className="fe-risk-countdown-box">
                      <div className="fe-countdown-ring">
                        <span className="fe-countdown-digits">{countdown}s</span>
                      </div>
                      <span>请仔细阅读上方风险告知，倒计时结束后方可进行免责确认</span>
                    </div>
                  ) : (
                    <div className="fe-risk-input-section">
                      <div className="fe-disclaimer-instruction">
                        <span>为确保您已完全知晓并自愿承担后果，请在下方输入框中手动键入以下誓词：</span>
                        <blockquote className="fe-target-phrase">
                          {DISCLAIMER_PHRASE}
                        </blockquote>
                      </div>

                      {pasteWarning && (
                        <div className="admin-status-strip is-danger" style={{ marginBottom: 12 }}>
                          <Icon name="block" />
                          <span>{pasteWarning}</span>
                        </div>
                      )}

                      <input
                        type="text"
                        className="fe-phrase-input"
                        placeholder="在此处手打输入上述文本（禁止粘贴）"
                        value={typedPhrase}
                        onChange={(e) => setTypedPhrase(e.target.value)}
                        onPaste={(e) => {
                          e.preventDefault()
                          setPasteWarning('检测到剪贴板粘贴！风控系统已禁止粘贴，必须由您亲手键入以确保充分知情。')
                        }}
                        autoComplete="off"
                        autoCorrect="off"
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* Manual mode 3-step progressive confirmation */
                <div className="fe-risk-step-content">
                  {riskStep === 1 && (
                    <div className="fe-step-1-box">
                      <div className="admin-pill-badge is-danger" style={{ alignSelf: 'flex-start' }}>
                        第一重：知晓平台异常审查风险
                      </div>
                      <div className="fe-risk-notice-box" style={{ marginTop: 12 }}>
                        <strong>手动模式学术诚信与账号安全警告</strong>
                        <p>
                          手动逐题模式允许用户自定义每道题的分数。如果设定的分数与答题用时、题干难度极不匹配，
                          或者多次出现异常满分提交，平台风控模型和任课教师将极易判定为学术作弊，导致账号封禁或通报处理。
                        </p>
                      </div>
                    </div>
                  )}

                  {riskStep === 2 && (
                    <div className="fe-step-2-box">
                      <div className="admin-pill-badge is-danger" style={{ alignSelf: 'flex-start' }}>
                        第二重：再次核对超限与异常题目
                      </div>
                      <div className="fe-risk-notice-box" style={{ marginTop: 12 }}>
                        <strong>当前作业参数核对汇总：</strong>
                        <p>设定总分：<strong>{manualTotalSum.toFixed(1)}</strong> / {paperTotalScore.toFixed(1)} 分</p>
                        {isManualTotalOverMax && (
                          <p style={{ color: '#dc2626', fontWeight: 600 }}>
                            ⚠️ 警告：总分已超出官方卷面满分！
                          </p>
                        )}
                        {manualOverMaxQuestions.length > 0 ? (
                          <div>
                            <p style={{ color: '#dc2626', fontWeight: 600 }}>
                              ⚠️ 检测到以下 {manualOverMaxQuestions.length} 道题目单题超满分：
                            </p>
                            <ul>
                              {manualOverMaxQuestions.map((q) => (
                                <li key={q.order}>
                                  Q{q.order} ({q.typeName})：设定 {manualScores[q.order]} 分 (满分 {q.maxScore.toFixed(1)} 分)
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p style={{ color: 'var(--control-green)' }}>未检测到单题超满分现象。</p>
                        )}
                      </div>
                    </div>
                  )}

                  {riskStep === 3 && (
                    <div className="fe-step-3-box">
                      <div className="admin-pill-badge is-danger" style={{ alignSelf: 'flex-start' }}>
                        第三重：免责誓词输入校验
                      </div>
                      <div className="fe-disclaimer-instruction" style={{ marginTop: 12 }}>
                        <span>最后一步：请在下方输入框完整手打输入免责誓词（禁止粘贴）：</span>
                        <blockquote className="fe-target-phrase">
                          {DISCLAIMER_PHRASE}
                        </blockquote>
                      </div>

                      {pasteWarning && (
                        <div className="admin-status-strip is-danger" style={{ marginBottom: 12 }}>
                          <Icon name="block" />
                          <span>{pasteWarning}</span>
                        </div>
                      )}

                      {countdown === 0 && (
                        <input
                          type="text"
                          className="fe-phrase-input"
                          placeholder="手打输入誓词（严格禁止粘贴）"
                          value={typedPhrase}
                          onChange={(e) => setTypedPhrase(e.target.value)}
                          onPaste={(e) => {
                            e.preventDefault()
                            setPasteWarning('检测到粘贴行为！风控系统已禁止粘贴，必须由您亲手键入。')
                          }}
                          autoComplete="off"
                        />
                      )}
                    </div>
                  )}

                  {countdown > 0 && (
                    <div className="fe-risk-countdown-box">
                      <div className="fe-countdown-ring">
                        <span className="fe-countdown-digits">{countdown}s</span>
                      </div>
                      <span>请强制等待倒计时完成以确保深入理解当前风险 ({countdown} 秒)...</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="fe-risk-card-foot">
              <button
                type="button"
                className="control-secondary"
                onClick={() => setIsRiskModalOpen(false)}
                disabled={isStartingTask}
              >
                取消
              </button>

              {mode === 'auto' ? (
                <button
                  type="button"
                  className={`control-primary fe-confirm-btn ${
                    typedPhrase.trim() === DISCLAIMER_PHRASE ? 'is-ready-green' : ''
                  }`}
                  disabled={countdown > 0 || typedPhrase.trim() !== DISCLAIMER_PHRASE || isStartingTask}
                  onClick={handleConfirmStart}
                >
                  <Icon name={isStartingTask ? 'sync' : 'verified'} className={isStartingTask ? 'fe-spin' : ''} />
                  <span>
                    {isStartingTask
                      ? '正在启动云端做题流水线...'
                      : countdown > 0
                      ? `请等待倒计时 (${countdown}s)`
                      : typedPhrase.trim() !== DISCLAIMER_PHRASE
                      ? '请手打输入完整誓词'
                      : '我已明确风险，立即开始'}
                  </span>
                </button>
              ) : (
                <>
                  {riskStep < 3 ? (
                    <button
                      type="button"
                      className="control-primary"
                      disabled={countdown > 0}
                      onClick={handleNextRiskStep}
                    >
                      <span>
                        {countdown > 0 ? `强制等待确认 (${countdown}s)` : `进入下一步 (${riskStep + 1}/3)`}
                      </span>
                      <Icon name="arrow_forward" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`control-primary fe-confirm-btn ${
                        typedPhrase.trim() === DISCLAIMER_PHRASE ? 'is-ready-green' : ''
                      }`}
                      disabled={countdown > 0 || typedPhrase.trim() !== DISCLAIMER_PHRASE || isStartingTask}
                      onClick={handleConfirmStart}
                    >
                      <Icon name={isStartingTask ? 'sync' : 'verified'} className={isStartingTask ? 'fe-spin' : ''} />
                      <span>
                        {isStartingTask
                          ? '正在分发后台做题任务...'
                          : countdown > 0
                          ? `请等待 (${countdown}s)`
                          : typedPhrase.trim() !== DISCLAIMER_PHRASE
                          ? '请手打输入完整誓词'
                          : '终审通过，正式开始'}
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. EXECUTION BOARD (FULLSCREEN MODAL OR MINIMIZED FLOATING BAR) */}
      {activeTaskId && (
        <>
          {isMinimized ? (
            /* Floating Capsule in bottom-right corner */
            <div className="fe-minimized-floating-capsule" onClick={() => setIsMinimized(false)}>
              <div className="fe-capsule-spinner">
                <Icon
                  name={taskStatus?.status === 'COMPLETED' ? 'check_circle' : 'sync'}
                  className={taskStatus?.status === 'COMPLETED' ? '' : 'fe-spin'}
                />
              </div>
              <div className="fe-capsule-info">
                <strong>
                  {taskStatus?.status === 'COMPLETED'
                    ? '已完成自动做题'
                    : taskStatus?.status === 'FAILED'
                    ? '任务执行中断'
                    : `正在自动完成 (${taskStatus?.progress || 0}%)`}
                </strong>
                <small>{taskStatus?.stage_text || '后台流水线处理中...'}</small>
              </div>
              <button
                type="button"
                className="fe-capsule-expand-btn"
                title="展开执行看板"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsMinimized(false)
                }}
              >
                <Icon name="open_in_full" />
              </button>
            </div>
          ) : (
            /* Full Dashboard Modal */
            <div className="fe-risk-fullscreen-overlay">
              <div className="fe-execution-card">
                <div className="fe-execution-head">
                  <div>
                    <h2>自动完成任务执行看板</h2>
                    <p>正在调度云端双代理与语音引擎，模拟逐题完成与上报</p>
                  </div>
                  <button
                    type="button"
                    className="control-secondary fe-btn-sm"
                    onClick={() => setIsMinimized(true)}
                    title="最小化至右下角后台运行"
                  >
                    <Icon name="close_fullscreen" />
                    <span>最小化至后台</span>
                  </button>
                </div>

                <div className="fe-execution-body">
                  {taskStatus?.status === 'FAILED' ? (
                    <div className="fe-empty-state">
                      <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
                        <Icon name="error" />
                      </div>
                      <h2>任务执行遇到问题</h2>
                      <p>{taskStatus.error || '云端同步或平台通信发生错误，请稍后重试。'}</p>
                      <button
                        type="button"
                        className="control-secondary"
                        onClick={() => setActiveTaskId(null)}
                        style={{ marginTop: 16 }}
                      >
                        关闭看板
                      </button>
                    </div>
                  ) : taskStatus?.status === 'COMPLETED' ? (
                    /* Settlement card */
                    <div className="fe-settlement-card">
                      <div className="fe-settlement-icon-wrap">
                        <Icon name="military_tech" filled />
                      </div>
                      <h3>恭喜，作业已成功自动完成！</h3>
                      <p className="fe-settlement-desc">
                        所有作答数据与评分 XML 已成功上报至 ETS100 云端官方平台。
                      </p>

                      <div className="fe-settlement-stats">
                        <div className="fe-settlement-tile">
                          <small>最终得分</small>
                          <strong>{taskStatus.result?.score ?? (mode === 'auto' ? autoTargetTotal : manualTotalSum)} 分</strong>
                        </div>
                        <div className="fe-settlement-tile">
                          <small>卷面总满分</small>
                          <strong>{paperTotalScore.toFixed(1)} 分</strong>
                        </div>
                        <div className="fe-settlement-tile">
                          <small>做题用时</small>
                          <strong>{formatSeconds(taskStatus.result?.use_time || suggestedTimeSeconds)}</strong>
                        </div>
                      </div>

                      <div className="fe-settlement-actions">
                        <button
                          type="button"
                          className="control-primary"
                          onClick={() => {
                            onToast?.('正在同步云端最新完成状态...')
                            onBack()
                          }}
                        >
                          <Icon name="verified" />
                          <span>一键在云端核对并返回</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* In Progress Dashboard */
                    <div className="fe-execution-active-box">
                      {/* Big Progress Bar */}
                      <div className="fe-exec-progress-track">
                        <div
                          className="fe-exec-progress-bar"
                          style={{ width: `${Math.max(5, taskStatus?.progress || 10)}%` }}
                        />
                      </div>

                      <div className="fe-exec-progress-meta">
                        <span className="fe-exec-stage-text">
                          <Icon name="sync" className="fe-spin" />
                          {taskStatus?.stage_text || '正在连接国内代理节点并初始化做题环境...'}
                        </span>
                        <strong className="fe-exec-percentage">
                          {taskStatus?.progress || 10}%
                        </strong>
                      </div>

                      {/* Question Stem preview with fade in */}
                      <div className="fe-exec-stem-preview">
                        <small>当前处理题干：</small>
                        <p className="fe-stem-text">
                          {taskStatus?.current_question_text || '正在逐题提取作答素材与发音词汇表...'}
                        </p>
                      </div>

                      <div className="fe-exec-details-grid">
                        <div className="fe-exec-tile">
                          <small>代理通道</small>
                          <span>国内双节点轮询容灾</span>
                        </div>
                        <div className="fe-exec-tile">
                          <small>音色模式</small>
                          <span>
                            {voiceMode === 'clone'
                              ? '专属声音克隆 (tts.ai)'
                              : voiceMode === 'edge'
                              ? 'Edge-TTS 机读原声'
                              : '不上传声音'}
                          </span>
                        </div>
                        <div className="fe-exec-tile">
                          <small>目标总分</small>
                          <span>{mode === 'auto' ? autoTargetTotal : manualTotalSum} 分</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AutoCompletePage
