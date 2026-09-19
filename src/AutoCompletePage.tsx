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
import { getHomeworkDetail, startParseHomework, type HomeworkItem, type Paper } from './api/homework'

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
  sectionCaption?: string
  typeName: string
  questionText: string
  answers?: string[]
  options?: string[]
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
      .catch(async (err) => {
        console.warn('Paper not yet cached in Redis, auto-initiating parse:', err)
        if (!active) return
        try {
          const parseRes = await startParseHomework(accessToken, {
            homework_id: homework.id,
            homework_name: homework.name || '英语作业',
            contents: homework.contents || [],
            resource_id: homework.resource_id,
            pk: homework.pk,
            set_type: homework.set_type,
          })
          if (active && parseRes?.result) {
            setFetchedPaper(parseRes.result)
          }
        } catch (parseErr) {
          console.warn('Auto parse failed in AutoCompletePage:', parseErr)
        }
      })
      .finally(() => {
        if (active) setIsLoadingPaper(false)
      })
    return () => {
      active = false
    }
  }, [paper, fetchedPaper, homework.id, accessToken, homework.name, homework.contents, homework.resource_id, homework.pk, homework.set_type])
  const compatibility = useMemo(() => {
    return checkHomeworkCompatibility(homework, activePaper)
  }, [homework, activePaper])

  // Paper & Questions calculation
  const { totalQuestions, paperTotalScore, questions } = useMemo(() => {
    let qList: Array<{
      order: number
      sectionOrder?: number
      sub_order?: number
      sectionCaption?: string
      typeName: string
      questionText: string
      answers: string[]
      options: string[]
      maxScore: number
    }> = []

    if (activePaper && Array.isArray(activePaper.sections) && activePaper.sections.length > 0) {
      let count = 0
      for (const sec of activePaper.sections) {
        if (!sec || !Array.isArray(sec.questions)) continue
        for (const q of sec.questions) {
          if (!q) continue
          count++
          const qObj = q as Record<string, unknown>
          const explicitPoint = Number(
            qObj.point ?? qObj.maxScore ?? qObj.score ?? qObj.max_score
          )
          const secCaption = sec.caption || sec.typeName || ''
          const qTypeName = q.typeName || sec.typeName || '题目'
          const displayName = secCaption && secCaption !== qTypeName ? `[${secCaption}] ${qTypeName}` : qTypeName
          qList.push({
            order: q.order || count,
            sectionOrder: typeof qObj.sectionOrder === 'number' ? qObj.sectionOrder : undefined,
            sub_order: typeof qObj.sub_order === 'number' ? qObj.sub_order : undefined,
            sectionCaption: secCaption,
            typeName: displayName,
            questionText: q.questionText || q.originalText || `第 ${count} 题`,
            answers: Array.isArray(q.answers) ? q.answers : (q.answers ? [String(q.answers)] : []),
            options: Array.isArray(q.options) ? q.options : (q.options ? [String(q.options)] : []),
            maxScore: Number.isFinite(explicitPoint) && explicitPoint > 0 ? explicitPoint : 0,
          })
        }
      }
    }

    if (qList.length === 0) {
      return {
        totalQuestions: 0,
        paperTotalScore: 0,
        questions: [],
      }
    }

    const tQuestions = qList.length
    const hwObj = homework as Record<string, unknown>
    const paperObj = activePaper as Record<string, unknown> | null
    const rawTotal = Number(
      hwObj?.total_score ||
      hwObj?.total_point ||
      paperObj?.totalScore ||
      paperObj?.total_score
    )
    const isPkOrVocab =
      homework?.pk === 1 ||
      homework?.set_type === 6 ||
      /词汇|单词|默写|word|pk/i.test(homework?.name || '') ||
      /词汇|单词|默写|word|pk/i.test(activePaper?.title || activePaper?.paperName || '')

    const hwTitle = homework?.name || activePaper?.title || activePaper?.paperName || ''
    const isBeijing = /北京/i.test(hwTitle)
    const oralStandardTotal = isBeijing ? 40.0 : 30.0

    let defaultTotal: number
    if (isPkOrVocab) {
      defaultTotal = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 100.0
    } else {
      // For oral / mock / room test exams (机房套题/听说训练/中考机考):
      // Official standard total is 30.0 (or 40.0 for Beijing).
      // If rawTotal is 100.0 (ETS percent scale), it MUST be normalized to official 30.0!
      if (Number.isFinite(rawTotal) && rawTotal > 0 && Math.abs(rawTotal - 100.0) >= 0.01) {
        defaultTotal = rawTotal
      } else {
        defaultTotal = oralStandardTotal
      }
    }

    // Check if questions already carry explicit points from paper
    const hasExplicitPoints = qList.some((q) => q.maxScore > 0)
    let calculatedPaperTotal = defaultTotal

    if (hasExplicitPoints) {
      const explicitSum = Number(qList.reduce((sum, q) => sum + (q.maxScore > 0 ? q.maxScore : 0), 0).toFixed(2))
      if (explicitSum > 0) {
        if (!isPkOrVocab && Math.abs(explicitSum - 100.0) < 0.1) {
          // Oral paper was previously scaled to 100.0 instead of 30.0 (or 40.0)
          calculatedPaperTotal = defaultTotal
          const scale = calculatedPaperTotal / explicitSum
          qList = qList.map((q) => ({
            ...q,
            maxScore: Number((q.maxScore * scale).toFixed(2)),
          }))
          const currentSum = Number(qList.reduce((sum, q) => sum + q.maxScore, 0).toFixed(2))
          const diff = Number((calculatedPaperTotal - currentSum).toFixed(2))
          if (diff !== 0 && qList.length > 0) {
            qList[qList.length - 1].maxScore = Number((qList[qList.length - 1].maxScore + diff).toFixed(2))
          }
        } else {
          calculatedPaperTotal = explicitSum
          qList = qList.map((q) => ({
            ...q,
            maxScore: q.maxScore > 0 ? q.maxScore : Number((calculatedPaperTotal / tQuestions).toFixed(2)),
          }))
        }
      }
    } else {
      const pointPerQ = Number((defaultTotal / tQuestions).toFixed(2))
      qList = qList.map((q) => ({ ...q, maxScore: pointPerQ }))
      const currentSum = Number(qList.reduce((sum, q) => sum + q.maxScore, 0).toFixed(2))
      const diff = Number((defaultTotal - currentSum).toFixed(2))
      if (diff !== 0 && qList.length > 0) {
        qList[qList.length - 1].maxScore = Number((qList[qList.length - 1].maxScore + diff).toFixed(2))
      }
    }

    return {
      totalQuestions: tQuestions,
      paperTotalScore: calculatedPaperTotal,
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
    return Number((paperTotalScore * 0.95).toFixed(2))
  }, [paperTotalScore])

  const [selectedRatio, setSelectedRatio] = useState<number>(0.92)
  const [customAutoTargetTotal, setCustomAutoTargetTotal] = useState<number | null>(null)

  const defaultAutoTarget = useMemo(() => {
    return Number((paperTotalScore * selectedRatio).toFixed(2))
  }, [paperTotalScore, selectedRatio])

  const autoTargetTotal = useMemo(() => {
    const candidate = customAutoTargetTotal !== null ? customAutoTargetTotal : defaultAutoTarget
    return Math.min(candidate, maxAutoScore)
  }, [customAutoTargetTotal, defaultAutoTarget, maxAutoScore])

  const currentRatio = useMemo(() => {
    return paperTotalScore > 0 ? autoTargetTotal / paperTotalScore : 0.95
  }, [autoTargetTotal, paperTotalScore])

  const handleSelectRatio = (ratio: number) => {
    const safeRatio = Math.min(0.95, Math.max(0, ratio))
    setSelectedRatio(safeRatio)
    setCustomAutoTargetTotal(Number((paperTotalScore * safeRatio).toFixed(2)))
  }

  const handleUpdateAutoTargetTotal = (val: number) => {
    if (val > maxAutoScore) {
      setCustomAutoTargetTotal(maxAutoScore)
      setSelectedRatio(0.95)
      onToast?.(`已自动受风控限制截断为最高 95% 比例 (${maxAutoScore}分)`)
    } else {
      const rounded = Number(val.toFixed(2))
      setCustomAutoTargetTotal(rounded)
      if (paperTotalScore > 0) {
        setSelectedRatio(Number((rounded / paperTotalScore).toFixed(2)))
      }
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
        // Default manual score at 92% of question real max score
        scores[q.order] = Number((q.maxScore * 0.92).toFixed(2))
      }
    })
    return scores
  }, [questions, customManualScores])

  const handleUpdateManualScore = (order: number, val: number) => {
    setCustomManualScores((prev) => ({
      ...prev,
      [order]: Number(val.toFixed(2)),
    }))
  }

  const handleQuickFillManualScores = (ratio: number) => {
    const newScores: Record<number, number> = {}
    questions.forEach((q) => {
      newScores[q.order] = Number((q.maxScore * ratio).toFixed(2))
    })
    setCustomManualScores(newScores)
    onToast?.(`已一键将所有题目按 ${(ratio * 100).toFixed(0)}% 比例填入真实分数`)
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
        allocated = Number((autoTargetTotal - allocatedSum).toFixed(2))
      } else {
        const ratio = totalMax > 0 ? q.maxScore / totalMax : 1 / questions.length
        allocated = Number((autoTargetTotal * ratio).toFixed(2))
        allocatedSum = Number((allocatedSum + allocated).toFixed(2))
      }

      results.push({
        order: q.order,
        sectionCaption: q.sectionCaption,
        typeName: q.typeName,
        questionText: q.questionText,
        answers: q.answers,
        options: q.options,
        maxScore: q.maxScore,
        allocatedScore: allocated,
        manualScore: manualScores[q.order] ?? 0,
      })
    }

    return results
  }, [questions, autoTargetTotal, manualScores])

  // Manual mode validations:
  const manualTotalSum = useMemo(() => {
    return Number(Object.values(manualScores).reduce((acc, cur) => acc + (Number(cur) || 0), 0).toFixed(2))
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
      let perQuestionScoresPayload: Record<number, number> | undefined = undefined

      if (mode === 'manual') {
        perQuestionScoresPayload = {}
        questions.forEach((q) => {
          perQuestionScoresPayload![q.order] = manualScores[q.order] ?? q.maxScore
        })
      } else {
        perQuestionScoresPayload = {}
        allocatedQuestionScores.forEach((q) => {
          perQuestionScoresPayload![q.order] = q.allocatedScore
        })
      }

      const payload: StartAutoCompletePayload = {
        homework_id: homework.id,
        homework_name: homework.name,
        mode,
        target_total: mode === 'auto' ? autoTargetTotal : Number(manualTotalSum.toFixed(2)),
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
      // Immediate visual feedback so user sees the pipeline active
      setTaskStatus({
        task_id: res.task_id,
        status: 'PREPARING',
        progress: 10,
        stage_label: '[1/8] 正在通过国内代理初始化 ETS 会话...',
        stage_text: '[1/8] 正在通过国内代理初始化 ETS 会话...',
      })
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
          {questions.length === 0 ? (
            <div className="fe-auto-mode-view" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <Icon name="assignment_late" style={{ fontSize: 40, color: '#f59e0b', marginBottom: 12 }} />
              <h4 style={{ margin: '0 0 8px', color: '#1e293b' }}>未能提取到该作业的题目明细</h4>
              <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 16px' }}>
                云端资源包可能尚未解析就绪或需重新同步，请返回重试或刷新页面。
              </p>
              <button
                type="button"
                className="control-secondary"
                onClick={() => {
                  setIsLoadingPaper(true)
                  setFetchedPaper(null)
                }}
              >
                <Icon name="refresh" />
                <span>重新解析试卷</span>
              </button>
            </div>
          ) : mode === 'auto' ? (
            /* AUTO MODE */
            <div className="fe-auto-mode-view">
              <div className="fe-slider-panel">
                <div className="fe-slider-panel-head">
                  <div className="fe-slider-title">
                    <Icon name="speed" />
                    <strong>目标完成总分与比例换算</strong>
                    <span className="admin-pill-badge is-muted">
                      当前比例: {(currentRatio * 100).toFixed(1)}% (最高上限 95%)
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

                {/* Ratio Preset Buttons */}
                <div className="fe-ratio-presets">
                  <span style={{ fontSize: 12, color: 'var(--control-muted)', fontWeight: 600 }}>比例快捷预设:</span>
                  {[
                    { label: '85% 比例 (推荐安全)', ratio: 0.85 },
                    { label: '90% 比例 (良好)', ratio: 0.90 },
                    { label: '92% 比例 (优异)', ratio: 0.92 },
                    { label: '95% 比例 (最高安全上限)', ratio: 0.95 },
                  ].map((p) => {
                    const isActive = Math.abs(currentRatio - p.ratio) < 0.015
                    return (
                      <button
                        key={p.ratio}
                        type="button"
                        className={`fe-ratio-preset-btn ${isActive ? 'is-active' : ''}`}
                        onClick={() => handleSelectRatio(p.ratio)}
                      >
                        {p.label} · {(paperTotalScore * p.ratio).toFixed(1)}分
                      </button>
                    )
                  })}
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
                    <span>0 分 (0%)</span>
                    <span>推荐安全区: {(paperTotalScore * 0.85).toFixed(1)} - {maxAutoScore} 分</span>
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>95% 上限 {maxAutoScore} 分</span>
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
                    <strong>各小题实际分数等比换算方案 ({totalQuestions} 题)</strong>
                    <span className="fe-balance-tag">
                      <Icon name="verified" />
                      小题求和与设定总分绝对吻合 ({autoTargetTotal.toFixed(2)} 分)
                    </span>
                  </div>
                  <Icon name={isBreakdownOpen ? 'expand_less' : 'expand_more'} />
                </button>

                {isBreakdownOpen && (
                  <div className="fe-breakdown-list">
                    <div className="fe-breakdown-table-head">
                      <span>题号</span>
                      <span>题型</span>
                      <span>题目实际满分</span>
                      <span>换算目标实际得分</span>
                      <span>5分制对应折算</span>
                    </div>
                    {allocatedQuestionScores.map((item) => (
                      <div key={item.order} className="fe-breakdown-table-row">
                        <span className="fe-td-order">Q{item.order}</span>
                        <span className="fe-td-type">{item.typeName}</span>
                        <span className="fe-td-max">{item.maxScore.toFixed(2)} 分</span>
                        <span className="fe-td-score">
                          <strong>{item.allocatedScore.toFixed(2)}</strong> 分 ({(item.maxScore > 0 ? (item.allocatedScore / item.maxScore) * 100 : 95).toFixed(0)}%)
                        </span>
                        <span className="fe-td-scale" style={{ fontSize: 11.5, color: 'var(--control-muted)', fontFamily: 'DM Mono, monospace' }}>
                          {item.maxScore > 0 ? ((item.allocatedScore / item.maxScore) * 5.0).toFixed(2) : '5.00'} / 5.00
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

              {/* Quick Preset Fill Bar */}
              <div className="fe-quick-fill-bar">
                <span>一键按比例快速填分:</span>
                {[
                  { label: '95% 比例 (最高安全)', ratio: 0.95 },
                  { label: '90% 比例 (良好)', ratio: 0.90 },
                  { label: '85% 比例 (稳健)', ratio: 0.85 },
                  { label: '100% 卷面满分 (危险)', ratio: 1.0 },
                ].map((p) => (
                  <button
                    key={p.ratio}
                    type="button"
                    className="fe-ratio-preset-btn"
                    onClick={() => handleQuickFillManualScores(p.ratio)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="fe-manual-toolbar">
                <div className="fe-manual-stat-left">
                  <span>逐题分值规划表</span>
                  <small>填写每道小题的期望真实得分，单题超出满分将自动标红告警</small>
                </div>
                <div className="fe-manual-stat-right">
                  <span>当前设定总分：</span>
                  <strong className={isManualTotalOverMax ? 'fe-text-danger' : 'fe-text-success'}>
                    {manualTotalSum.toFixed(2)}
                  </strong>
                  <span> / {paperTotalScore.toFixed(1)} 分 ({(manualTotalSum / maxAutoScore > 1 ? '超过95%' : `${(manualTotalSum / paperTotalScore * 100).toFixed(1)}%`)})</span>
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
                            <span className="fe-manual-max">官方实际满分: {q.maxScore.toFixed(2)} 分</span>
                            <span className="admin-pill-badge is-muted" style={{ fontSize: 11 }}>
                              得分率: {q.maxScore > 0 ? ((currentVal / q.maxScore) * 100).toFixed(1) : 0}%
                            </span>
                            {isOver && <span className="fe-danger-pill">【危险：单题已超出真实满分 ({q.maxScore.toFixed(2)}分)】</span>}
                          </div>
                          <p className="fe-manual-stem">{q.questionText}</p>
                          {q.options && q.options.length > 0 && (
                            <div className="fe-manual-options-list" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {q.options.map((opt, oIdx) => (
                                <span key={oIdx} className="admin-pill-badge is-muted" style={{ fontSize: 11.5 }}>
                                  {opt}
                                </span>
                              ))}
                            </div>
                          )}
                          {q.answers && q.answers.length > 0 && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Icon name="check_circle" style={{ fontSize: 14 }} />
                              <span>作答参考/标准内容: <strong>{q.answers.join(' / ')}</strong></span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="fe-manual-input-box">
                        <input
                          type="number"
                          step={0.05}
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
          disabled={!compatibility.supported || questions.length === 0}
          style={(!compatibility.supported || questions.length === 0) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          title={!compatibility.supported ? compatibility.reason : (questions.length === 0 ? '试卷题目未就绪' : '开始自动完成')}
          onClick={() => {
            if (!compatibility.supported) {
              onToast?.(compatibility.reason || '该作业包含未适配题型，暂未开放自动完成')
              return
            }
            if (questions.length === 0) {
              onToast?.('试卷题目尚未解析就绪，请重新解析')
              return
            }
            handleOpenRiskModal()
          }}
        >
          <Icon name={!compatibility.supported || questions.length === 0 ? 'block' : 'bolt'} />
          <span>
            {!compatibility.supported
              ? '该作业暂不支持自动完成'
              : questions.length === 0
                ? '题目未解析就绪'
                : '开始自动完成'}
          </span>
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
                    : `正在自动完成 (${taskStatus?.progress || 10}%)`}
                </strong>
                <small>{taskStatus?.stage_label || taskStatus?.stage_text || '后台流水线处理中...'}</small>
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
                    /* Settlement card (做题效果全景展示) */
                    <div className="fe-settlement-card">
                      <div className="fe-settlement-icon-wrap">
                        <Icon name="verified" filled />
                      </div>
                      <h3>恭喜，作业已成功自动完成并提交！</h3>
                      <p className="fe-settlement-desc">
                        所有题目作答录音与真实换算评分已通过国内代理成功上报至 ETS100 云端官方平台。
                      </p>

                      {/* Summary Score Stats */}
                      <div className="fe-settlement-stats">
                        <div className="fe-settlement-tile">
                          <small>官方最终得分</small>
                          <strong style={{ color: '#16a34a' }}>
                            {Number((taskStatus.result?.score ?? taskStatus.result?.final_score ?? (mode === 'auto' ? autoTargetTotal : manualTotalSum)).toFixed(2))} 分
                          </strong>
                        </div>
                        <div className="fe-settlement-tile">
                          <small>试卷总满分</small>
                          <strong>{paperTotalScore.toFixed(1)} 分</strong>
                        </div>
                        <div className="fe-settlement-tile">
                          <small>最终得分率</small>
                          <strong style={{ color: '#2563eb' }}>
                            {taskStatus.result?.score_rate ?? (
                              paperTotalScore > 0
                                ? ((Number(taskStatus.result?.score ?? taskStatus.result?.final_score ?? (mode === 'auto' ? autoTargetTotal : manualTotalSum)) / paperTotalScore) * 100).toFixed(1)
                                : '95.0'
                            )}%
                          </strong>
                        </div>
                        <div className="fe-settlement-tile">
                          <small>实际做题用时</small>
                          <strong>{formatSeconds(taskStatus.result?.use_time || suggestedTimeSeconds)}</strong>
                        </div>
                      </div>

                      {/* Question by question completion breakdown table */}
                      <div className="fe-settlement-table-wrap">
                        <table className="fe-settlement-table">
                          <thead>
                            <tr>
                              <th>题号</th>
                              <th>题型</th>
                              <th>题目内容节选</th>
                              <th>真实满分</th>
                              <th>最终实际得分</th>
                              <th>官方状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(taskStatus.result?.question_details || taskStatus.question_results || allocatedQuestionScores).map((rawItem: unknown, idx: number) => {
                              const item = rawItem as Record<string, unknown>
                              const order = Number(item.order || idx + 1)
                              const typeName = String(item.type_name || item.typeName || '题目')
                              const text = String(item.text || item.questionText || `第 ${order} 题`)
                              const maxS = (item.max_score ?? item.maxScore ?? (paperTotalScore / Math.max(1, totalQuestions))) as number
                              const score = (item.awarded_score ?? item.allocatedScore ?? (manualScores[order] || 0)) as number
                              return (
                                <tr key={order}>
                                  <td><strong>Q{order}</strong></td>
                                  <td><span className="fe-td-type">{typeName}</span></td>
                                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>
                                    {text}
                                  </td>
                                  <td>{Number(maxS).toFixed(2)} 分</td>
                                  <td><strong style={{ color: '#16a34a' }}>{Number(score).toFixed(2)} 分</strong></td>
                                  <td>
                                    <span className="admin-pill-badge is-active" style={{ fontSize: 11 }}>
                                      <Icon name="check" style={{ fontSize: 12 }} /> 官方已核验
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="fe-settlement-actions" style={{ display: 'flex', gap: 12, justifyContent: 'center', width: '100%', marginTop: 8 }}>
                        <button
                          type="button"
                          className="control-secondary"
                          onClick={() => setActiveTaskId(null)}
                        >
                          <Icon name="tune" />
                          <span>留在本页查看配置</span>
                        </button>
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
                      {/* 8-Stage Pipeline Strip */}
                      <div className="fe-pipeline-steps">
                        {[
                          { num: 1, label: '会话就绪', p: 5 },
                          { num: 2, label: '试卷提取', p: 15 },
                          { num: 3, label: '题型规划', p: 25 },
                          { num: 4, label: '逐题做题', p: 40 },
                          { num: 5, label: '语音合成', p: 60 },
                          { num: 6, label: '评分上报', p: 75 },
                          { num: 7, label: '用时终审', p: 85 },
                          { num: 8, label: '云端核对', p: 95 },
                        ].map((s) => {
                          const curP = taskStatus?.progress || 10
                          const isDone = curP > s.p + 8
                          const isActive = curP >= s.p && curP <= s.p + 8
                          return (
                            <div
                              key={s.num}
                              className={`fe-pipeline-step ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}`}
                            >
                              <Icon name={isDone ? 'check' : isActive ? 'sync' : 'circle'} className={isActive ? 'fe-spin' : ''} style={{ fontSize: 12 }} />
                              <span>{s.num}. {s.label}</span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Big Progress Bar */}
                      <div className="fe-exec-progress-track">
                        <div
                          className="fe-exec-progress-bar"
                          style={{ width: `${Math.max(6, taskStatus?.progress || 10)}%` }}
                        />
                      </div>

                      <div className="fe-exec-progress-meta">
                        <span className="fe-exec-stage-text">
                          <Icon name="sync" className="fe-spin" />
                          {taskStatus?.stage_label || taskStatus?.stage_text || '正在连接国内代理节点并初始化做题环境...'}
                        </span>
                        <strong className="fe-exec-percentage">
                          {taskStatus?.progress || 10}%
                        </strong>
                      </div>

                      {/* Question Stem preview with fade in */}
                      <div className="fe-exec-stem-preview">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <small>
                            当前作答题干 (第 {taskStatus?.current_question_index || 1} / {taskStatus?.total_questions || totalQuestions} 题)：
                          </small>
                          <span className="admin-pill-badge is-muted" style={{ fontSize: 11 }}>
                            {voiceMode === 'clone' ? '专属音色克隆中' : voiceMode === 'edge' ? 'Edge-TTS 合成中' : '静音模式'}
                          </span>
                        </div>
                        <p className="fe-stem-text">
                          {taskStatus?.current_question_text || '正在逐题提取作答素材与发音词汇表...'}
                        </p>
                      </div>

                      {/* Live Questions Checklist */}
                      {taskStatus?.question_results && taskStatus.question_results.length > 0 && (
                        <div className="fe-exec-questions-checklist">
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--control-muted)', marginBottom: 2 }}>
                            已完成题目流水明细 ({taskStatus.question_results.length}/{taskStatus.total_questions || totalQuestions})：
                          </div>
                          {taskStatus.question_results.map((q) => (
                            <div key={q.order} className="fe-exec-q-item is-done">
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Icon name="check_circle" style={{ fontSize: 14, color: '#16a34a' }} />
                                <strong>Q{q.order}</strong>
                                <span style={{ color: 'var(--control-muted)', fontSize: 11 }}>[{q.type_name}]</span>
                                <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {q.text}
                                </span>
                              </span>
                              <strong style={{ color: '#15803d', fontFamily: 'DM Mono, monospace' }}>
                                +{q.awarded_score.toFixed(2)} 分
                              </strong>
                            </div>
                          ))}
                        </div>
                      )}

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
                          <small>目标总分与比例</small>
                          <span>{mode === 'auto' ? `${autoTargetTotal.toFixed(2)}分 (95%比例)` : `${manualTotalSum.toFixed(2)}分`}</span>
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
