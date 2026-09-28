import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './components/Icon'
import {
  cancelAutoCompleteTask,
  checkHomeworkCompatibility,
  getAutoCompleteTasks,
  getAutoCompleteTaskStatus,
  startAutoComplete,
  type AutoCompleteMode,
  type AutoCompleteTaskResponse,
  type AutoCompleteVoiceMode,
  type StartAutoCompletePayload,
} from './api/autoComplete'
import { getVoiceAudioUrl, getVoiceClonePreview, getVoices, type VoiceProfile } from './api/voice'
import { getHomeworkDetail, startParseHomework, type HomeworkItem, type Paper } from './api/homework'
import {
  planQuestionAllocations,
  toFiveScale,
  type QuestionAllocation,
} from './utils/scoreAllocation'
import {
  SCORE_TRACK_MARKS,
  SLIDER_RESOLUTION,
  ratioToTrack,
  scoreToTrackValue,
  trackValueToScore,
} from './utils/scoreSlider'

const DISCLAIMER_PHRASE = '作者不为使用此功能造成的一切后果负责'

function friendlyTaskStage(stage: string | null | undefined, fallback = '任务处理中...'): string {
  const value = String(stage || '').trim()
  if (!value) return fallback
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
  return cleaned || fallback
}

export type FeatureCheck = {
  enabled: boolean
  status: 'enabled' | 'membership_required' | 'feature_disabled' | 'kill_switch'
  reason: string
  minMemberLevel?: number
  minMemberTier?: string
}

export type AutoCompletePageProps = {
  homework?: HomeworkItem | null
  paper?: Paper | null
  permitToken?: string
  accessToken: string
  onBack: () => void
  onRequestPermit?: () => void
  onOpenSettingsVoice?: () => void
  onToast?: (msg: string) => void
  onCompleted?: (result: AutoCompleteTaskResponse['result'], hwId: string) => void
  activeTask?: AutoCompleteTaskResponse | null
  onTaskChange?: (task: AutoCompleteTaskResponse | null) => void
  isHubRoute?: boolean
  getFeatureStatus?: (featureKey: string, defaultName?: string) => FeatureCheck
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
  /** 加权随机分配的附加信息（是否满分 / 是否易失分的大分值题 / 相对扣分比例） */
  allocation?: QuestionAllocation
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
  onCompleted,
  activeTask,
  onTaskChange,
  isHubRoute,
  getFeatureStatus,
}: AutoCompletePageProps) {
  // Current active homework fallback
  const currentHw = useMemo<HomeworkItem>(() => {
    if (homework && homework.id) return homework
    if (activeTask?.homework_id) {
      return {
        id: activeTask.homework_id,
        name: activeTask.homework_name || '作业自动完成',
        contents: [],
      }
    }
    return {
      id: '',
      name: '作业自动完成',
      contents: [],
    }
  }, [homework, activeTask])

  const [historyTasks, setHistoryTasks] = useState<AutoCompleteTaskResponse[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(() => Boolean(accessToken))
  const [selectedHistoryTask, setSelectedHistoryTask] = useState<AutoCompleteTaskResponse | null>(null)
  const [taskFilter, setTaskFilter] = useState<'all' | 'completed' | 'failed'>('all')

  // View mode: 'kanban' | 'execution' | 'config'
  const [viewMode, setViewMode] = useState<'kanban' | 'execution' | 'config'>(() => {
    // 1. If an active task is running, ALWAYS enter execution board directly!
    if (activeTask && !['COMPLETED', 'FAILED'].includes(activeTask.status)) {
      return 'execution'
    }
    // A completed task opens its unified result detail by default. The overview
    // remains available through the explicit “返回任务看板” action.
    if (activeTask?.status === 'COMPLETED') {
      return 'execution'
    }
    // 2. Hub route (/auto-complete) defaults to kanban overview
    if (isHubRoute || (typeof window !== 'undefined' && window.location.pathname === '/auto-complete')) {
      return 'kanban'
    }
    // 3. When entering with permit token to configure a task
    if (permitToken) {
      return 'config'
    }
    return 'kanban'
  })


  const loadHistoryTasks = useCallback((showSpinner = false) => {
    if (!accessToken) return
    if (showSpinner) {
      setIsLoadingHistory(true)
    }
    getAutoCompleteTasks(accessToken)
      .then((res) => {
        setHistoryTasks(Array.isArray(res.tasks) ? res.tasks : [])
      })
      .catch((err) => {
        console.warn('Failed to load auto complete tasks:', err)
      })
      .finally(() => {
        if (showSpinner) {
          setIsLoadingHistory(false)
        }
      })
  }, [accessToken])

  useEffect(() => {
    if (!accessToken) return
    let active = true
    getAutoCompleteTasks(accessToken)
      .then((res) => {
        if (active) {
          setHistoryTasks(Array.isArray(res.tasks) ? res.tasks : [])
        }
      })
      .catch((err) => {
        console.warn('Failed to load auto complete tasks:', err)
      })
      .finally(() => {
        if (active) {
          setIsLoadingHistory(false)
        }
      })
    return () => {
      active = false
    }
  }, [accessToken])

  // Mode selection
  const [mode, setMode] = useState<AutoCompleteMode>('auto')

  // Voice selection
  const [voiceMode, setVoiceMode] = useState<AutoCompleteVoiceMode>('clone')
  const [cloneModel, setCloneModel] = useState<'pocket-tts' | 'ming-omni-tts' | 'moss-tts-nano'>('pocket-tts')
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('')
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)

  // Loaded paper state (auto-load if not provided via props)
  const [fetchedPaper, setFetchedPaper] = useState<Paper | null>(null)
  const [isLoadingPaper, setIsLoadingPaper] = useState<boolean>(() => Boolean(permitToken && currentHw.id && !paper))

  const activePaper = paper || fetchedPaper

  // 推荐用时抖动量（±8%）：载入试卷时在回调里随机一次，避免每次推荐值完全相同
  const [timeJitter, setTimeJitter] = useState(1)

  useEffect(() => {
    if (!permitToken || !currentHw.id || !accessToken) return
    if (paper || fetchedPaper) {
      return
    }
    let active = true
    getHomeworkDetail(accessToken, currentHw.id)
      .then((res) => {
        if (active && res) {
          setFetchedPaper(res)
          // 每次载入试卷时重新抖一次推荐用时（±8%），避免每次推荐值都一样
          setTimeJitter(1 + (Math.random() * 0.16 - 0.08))
        }
      })
      .catch(async (err) => {
        console.warn('Paper not yet cached in Redis, auto-initiating parse:', err)
        if (!active) return
        try {
          const parseRes = await startParseHomework(accessToken, {
            homework_id: currentHw.id,
            homework_name: currentHw.name || '英语作业',
            contents: currentHw.contents || [],
            resource_id: currentHw.resource_id,
            pk: currentHw.pk,
            set_type: currentHw.set_type,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, fetchedPaper, currentHw.id, accessToken, permitToken])

  const compatibility = useMemo(() => {
    return checkHomeworkCompatibility(currentHw, activePaper)
  }, [currentHw, activePaper])

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
    const hwObj = currentHw as Record<string, unknown>
    const paperObj = activePaper as Record<string, unknown> | null
    const rawTotal = Number(
      hwObj?.total_score ||
      hwObj?.total_point ||
      paperObj?.totalScore ||
      paperObj?.total_score
    )
    const hwTitle = currentHw?.name || activePaper?.title || activePaper?.paperName || ''
    const isBeijing = /北京/i.test(hwTitle)
    const isPkOrVocab =
      currentHw?.pk === 1 ||
      currentHw?.set_type === 6 ||
      /词汇|单词|默写|word|pk/i.test(hwTitle)

    // A mock suite is an official full test (中考英语听说模考/机考套题/模拟考试), which officially standards at 30 (or 40 Beijing).
    const isMockSuite =
      !isPkOrVocab &&
      (/套题|模考|模拟考|机房模考|仿真|中考英语听说|听说模拟|听说测试|期末听说|期中听说/i.test(hwTitle) ||
        (tQuestions >= 8 && /机考|综合|套题/i.test(hwTitle)))

    // Dynamic standard benchmark point per question based on question type
    const getBenchmarkScore = (q: { typeName: string; sectionCaption?: string }) => {
      const text = `${q.sectionCaption || ''} ${q.typeName || ''}`.toLowerCase()
      if (/朗读|read/i.test(text)) {
        if (isMockSuite) return isBeijing ? 9.0 : 6.0
        if (tQuestions === 1) return isBeijing ? 6.0 : 5.0
        if (tQuestions === 2) return 2.5
        return isBeijing ? 3.0 : 2.0
      }
      if (/选择|choose/i.test(text)) {
        return 1.5
      }
      if (/填空|记录|fill/i.test(text)) {
        return 1.5
      }
      if (/询问|提问/i.test(text)) {
        return 1.5
      }
      if (/回答|3问5答|role/i.test(text)) {
        return 2.0
      }
      if (/转述|看图|表达|picture|essay/i.test(text)) {
        return isBeijing ? 10.0 : 6.0
      }
      if (/词汇|单词|默写|word/i.test(text)) {
        return 1.0
      }
      return 2.0
    }

    let calculatedPaperTotal: number

    if (isMockSuite) {
      // 卷面总分口径：优先由小题满分累加得出；只有题目完全没有满分信息时，
      // 才回退官方套题基准分（30.0 / 北京 40.0）。绝不把小题满分整体缩放去凑基准分，
      // 否则会出现「前端显示一题 3.75、目标分却按 30 分算」的错位。
      const mockStandardTotal = isBeijing ? 40.0 : 30.0
      const explicitSum = Number(qList.reduce((sum, q) => sum + (q.maxScore > 0 ? q.maxScore : 0), 0).toFixed(2))

      if (explicitSum > 0) {
        calculatedPaperTotal = explicitSum
      } else {
        calculatedPaperTotal = mockStandardTotal
        const sumW = qList.reduce((acc, q) => acc + getBenchmarkScore(q), 0)
        const scale = sumW > 0 ? calculatedPaperTotal / sumW : 1
        qList = qList.map((q) => ({
          ...q,
          maxScore: Number((getBenchmarkScore(q) * scale).toFixed(2)),
        }))
        const currentSum = Number(qList.reduce((sum, q) => sum + q.maxScore, 0).toFixed(2))
        const diff = Number((calculatedPaperTotal - currentSum).toFixed(2))
        if (diff !== 0 && qList.length > 0) {
          qList[qList.length - 1].maxScore = Number((qList[qList.length - 1].maxScore + diff).toFixed(2))
        }
      }
    } else if (isPkOrVocab) {
      // PK / Vocabulary: 100.0 or count
      const explicitSum = Number(qList.reduce((sum, q) => sum + (q.maxScore > 0 ? q.maxScore : 0), 0).toFixed(2))
      if (explicitSum > 0) {
        calculatedPaperTotal = explicitSum
      } else if (Number.isFinite(rawTotal) && rawTotal > 0) {
        calculatedPaperTotal = rawTotal
        const pt = Number((calculatedPaperTotal / tQuestions).toFixed(2))
        qList = qList.map((q) => ({ ...q, maxScore: pt }))
      } else {
        calculatedPaperTotal = tQuestions
        qList = qList.map((q) => ({ ...q, maxScore: 1.0 }))
      }
    } else {
      // Regular oral homework / single-type assignment (e.g. 模仿朗读):
      const hasExplicit = qList.some((q) => q.maxScore > 0)
      const explicitSum = Number(qList.reduce((sum, q) => sum + (q.maxScore > 0 ? q.maxScore : 0), 0).toFixed(2))

      // 卷面总分口径 = 各小题满分累加（与后端 runner 唯一口径保持一致）；
      // 官方 item 的 total_score 与小题实际满分经常对不上（30 vs 16.5），
      // 用它当分母会造成"设定分 / 结算分 / 客户端显示"三方错位。
      if (hasExplicit && explicitSum > 0 && Math.abs(explicitSum - 100.0) >= 0.1) {
        calculatedPaperTotal = explicitSum
      } else {
        // Assign benchmark points per question type!
        qList = qList.map((q) => {
          const pt = q.maxScore > 0 && q.maxScore < 30 ? q.maxScore : getBenchmarkScore(q)
          return { ...q, maxScore: Number(pt.toFixed(2)) }
        })
        calculatedPaperTotal = Number(qList.reduce((sum, q) => sum + q.maxScore, 0).toFixed(2))
      }
    }

    // 与后端 runner 同口径：有可信的官方卷面总分时以它为分母，
    // 并把各小题满分按比例归一到该总分，保证「显示满分 / 目标分 / 逐题得分」三者自洽。
    if (calculatedPaperTotal > 0 && qList.length > 0) {
      const currentSum = qList.reduce((acc, q) => acc + (q.maxScore > 0 ? q.maxScore : 0), 0)
      if (currentSum > 0 && Math.abs(currentSum - calculatedPaperTotal) > 0.01) {
        const scale = calculatedPaperTotal / currentSum
        qList = qList.map((q) => ({ ...q, maxScore: Number((q.maxScore * scale).toFixed(2)) }))
      }
      const scaledSum = Number(qList.reduce((acc, q) => acc + q.maxScore, 0).toFixed(2))
      const diff = Number((calculatedPaperTotal - scaledSum).toFixed(2))
      if (diff !== 0 && qList.length > 0) {
        qList[qList.length - 1] = {
          ...qList[qList.length - 1],
          maxScore: Number((qList[qList.length - 1].maxScore + diff).toFixed(2)),
        }
      }
    }

    return {
      totalQuestions: tQuestions,
      paperTotalScore: calculatedPaperTotal,
      questions: qList,
    }
  }, [currentHw, activePaper])

  // 1. Time Planning States & Calculation (reference: ets_auto_complete/src/ets_demo/workflow.py)
  const [timeOption, setTimeOption] = useState<'recommended' | 'custom'>('recommended')

  // Calculate recommended time dynamically:
  // 按照每道题的参考录音时长相加 x 2 + 2 分钟 (120 秒)
  // 推荐用时的随机抖动：在 effect 里生成（render 期不可有副作用），
  // 换卷/换作业时重新抖一次，保证每次推荐不完全相同。

  const { recommendedTimeSeconds, totalRefAudioSeconds } = useMemo(() => {
    // 推荐用时 = ①听题 + ②准备 + ③作答 + ④单题开销 + ⑤大题开销
    // ①听题优先用后端 ffprobe 实测的 section 音频时长（audioDurationSeconds），
    //   缺失时才按题干文本估算；②朗读类大题首题 50s、其余每题 8s；
    //   ③作答按参考答案文本估算（执行时会用真实 TTS 时长替换）；
    //   ④每题 5s（提示音/切换/缓冲）；⑤每个大题 15s（题型说明/页面切换）。
    // 不做卷面总分区间约束；结果做 ±8% 抖动并取整到 5 秒，避免每次推荐值相同。
    const kind = (currentHw as Record<string, unknown>)?.kind as string | undefined

    const estimateSpeech = (text: string): number => {
      const clean = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/ets_th\d+/gi, '')
        .trim()
      if (!clean) return 3
      const words = clean.match(/[a-zA-Z0-9'-]+/g)
      if (words && words.length > 0) return Math.max(3, words.length / 2.2)
      const chars = clean.replace(/\s+/g, '').length
      return Math.max(3, chars / 3.5)
    }

    const shuffle = (value: number): number => {
      return Math.max(30, Math.round((value * timeJitter) / 5) * 5)
    }

    // 词汇 PK / 作文：量纲与听说卷不同，单独处理
    if (kind === 'pk' || kind === 'vocab') {
      const value = Math.max(totalQuestions * 3, 30)
      return { recommendedTimeSeconds: shuffle(value), totalRefAudioSeconds: Math.max(10, totalQuestions * 3) }
    }
    if (kind === 'composition') {
      const chars = questions.reduce((acc, q) => acc + (q.questionText || '').replace(/\s+/g, '').length, 0)
      const value = Math.max(chars / 8, 300)
      return { recommendedTimeSeconds: shuffle(value), totalRefAudioSeconds: Math.round(chars / 8) }
    }

    type SecShape = {
      typeName?: string
      type?: string
      category?: string
      audioDurationSeconds?: number
      questions?: Array<Record<string, unknown>>
    }
    const sections = (((activePaper as Record<string, unknown> | null)?.sections as SecShape[] | undefined) || [])
      .filter((sec) => Array.isArray(sec.questions) && (sec.questions as unknown[]).length > 0)

    let listenTotal = 0
    let prepTotal = 0
    let answerTotal = 0
    let overhead = 0

    if (sections.length === 0) {
      // 拿不到结构化试卷时，退化为"每题 15 秒"
      const value = totalQuestions * 15
      return { recommendedTimeSeconds: shuffle(value), totalRefAudioSeconds: totalQuestions * 6 }
    }

    for (const sec of sections) {
      const secQs = (sec.questions || []) as Array<Record<string, unknown>>
      const typeText = `${sec.category || ''} ${sec.type || ''} ${sec.typeName || ''}`.toLowerCase()
      // 听选信息/信息转述/询问信息这类需要"听两遍"
      const playedTwice = /choose|choice|select|simple_expression|picture|topic|retell|转述|听选|询问|回答/i.test(typeText)
      const isRead = /read|朗读|跟读|repeat/i.test(typeText)

      let secListen: number
      if (typeof sec.audioDurationSeconds === 'number' && sec.audioDurationSeconds > 0) {
        secListen = sec.audioDurationSeconds * (playedTwice ? 2 : 1)
      } else {
        secListen =
          secQs.reduce(
            (acc, q) =>
              acc +
              Math.max(5, estimateSpeech(String(q.questionText || q.originalText || q.text || ''))),
            0
          ) * (playedTwice ? 2 : 1)
      }
      listenTotal += secListen

      secQs.forEach((q, idx) => {
        prepTotal += isRead && idx === 0 ? 50 : 8
        const answerText = Array.isArray(q.answers) && q.answers.length > 0
          ? String(q.answers[0])
          : String(q.questionText || q.originalText || q.text || '')
        answerTotal += estimateSpeech(answerText)
      })

      overhead += 15 + secQs.length * 5
    }

    const raw = listenTotal + prepTotal + answerTotal + overhead
    return {
      recommendedTimeSeconds: shuffle(raw),
      totalRefAudioSeconds: Math.round(answerTotal),
    }
  }, [activePaper, questions, totalQuestions, currentHw, timeJitter])

  const [customMinutes, setCustomMinutes] = useState<number | null>(null)
  const [customSeconds, setCustomSeconds] = useState<number | null>(null)

  const effectiveMinutes = customMinutes !== null ? customMinutes : Math.floor(recommendedTimeSeconds / 60)
  const effectiveSeconds = customSeconds !== null ? customSeconds : (recommendedTimeSeconds % 60)

  const customUseTimeSeconds = useMemo(() => {
    const m = Math.max(0, effectiveMinutes)
    const s = Math.max(0, Math.min(59, effectiveSeconds))
    return Math.max(10, Math.min(3600, m * 60 + s))
  }, [effectiveMinutes, effectiveSeconds])

  const selectedUseTimeSeconds = timeOption === 'recommended' ? recommendedTimeSeconds : customUseTimeSeconds

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60)
    const s = sec % 60
    return mins > 0 ? `${mins} 分 ${s} 秒` : `${s} 秒`
  }

  // 目标分口径的卷面总分：与后端 runner 保持一致，优先采用官方卷面满分
  // （hw.total_score / paper.totalScore，非 100 制），仅当官方值不可信时才用小题累加值。
  // 否则前端会按残缺的小题累加值（如 6.4）去压 95% 上限，把用户设定的 28.5 截成 6.1。
  const targetPaperTotal = useMemo(() => {
    // 卷面满分口径与后端一致：优先官方卷面总分（作业元数据 / 试卷缓存的 totalScore），
    // 其次是后端已回传的任务结论分，最后才是本地小题累加值。
    const hwObjEff = currentHw as Record<string, unknown> | undefined
    const paperObjEff = activePaper as Record<string, unknown> | null
    const official = Number(
      hwObjEff?.total_score ??
        hwObjEff?.total_point ??
        paperObjEff?.totalScore ??
        paperObjEff?.total_score
    )
    // 后端已用官方 total_point 校正过试卷，这里以"逐题满分累加"为最终校验：
    // 若题目分值已被校正（Σ 明显大于旧分母），以 Sum 为准，避免继续用旧总分。
    const sumQuestionMax = questions.reduce((acc, q) => acc + (q.maxScore > 0 ? q.maxScore : 0), 0)
    if (sumQuestionMax > 0 && Math.abs(sumQuestionMax - official) > 0.01) {
      return Number(sumQuestionMax.toFixed(2))
    }
    if (Number.isFinite(official) && official > 0 && Math.abs(official - 100) >= 0.01) {
      return official
    }
    return paperTotalScore > 0 ? paperTotalScore : 0
  }, [currentHw, activePaper, paperTotalScore, questions])

  // 逐题满分的展示口径：当解析出来的小题满分之和与官方卷面满分不一致时
  // （例如官方 30 分卷，14 道小题只累加到 16.5），按官方总分等比归一后再展示，
  // 这样"题面满分 / 设定比例 / 后端结算"三者才是同一套数。
  const displayQuestionMax = useMemo(() => {
    return (q: { maxScore: number }) => Number((q.maxScore || 0).toFixed(2))
  }, [])

  // 1. Auto mode target total score state: strictly capped at <= targetPaperTotal * 0.95
  const maxAutoScore = useMemo(() => {
    return Number((targetPaperTotal * 0.95).toFixed(2))
  }, [targetPaperTotal])

  const [selectedRatio, setSelectedRatio] = useState<number>(0.92)
  const [customAutoTargetTotal, setCustomAutoTargetTotal] = useState<number | null>(null)

  const defaultAutoTarget = useMemo(() => {
    return Number((targetPaperTotal * selectedRatio).toFixed(2))
  }, [targetPaperTotal, selectedRatio])

  const autoTargetTotal = useMemo(() => {
    const candidate = customAutoTargetTotal !== null ? customAutoTargetTotal : defaultAutoTarget
    return Math.min(candidate, maxAutoScore)
  }, [customAutoTargetTotal, defaultAutoTarget, maxAutoScore])

  const currentRatio = useMemo(() => {
    return targetPaperTotal > 0 ? autoTargetTotal / targetPaperTotal : 0.95
  }, [autoTargetTotal, targetPaperTotal])

  const handleSelectRatio = (ratio: number) => {
    const safeRatio = Math.min(0.95, Math.max(0, ratio))
    setSelectedRatio(safeRatio)
    setCustomAutoTargetTotal(Number((targetPaperTotal * safeRatio).toFixed(2)))
  }

  const handleUpdateAutoTargetTotal = (val: number) => {
    if (val > maxAutoScore) {
      setCustomAutoTargetTotal(maxAutoScore)
      setSelectedRatio(0.95)
      onToast?.(`目标分数最高为试卷满分的 95%（${maxAutoScore} 分）`)
    } else {
      const rounded = Number(val.toFixed(2))
      setCustomAutoTargetTotal(rounded)
      if (targetPaperTotal > 0) {
        setSelectedRatio(Number((rounded / targetPaperTotal).toFixed(2)))
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

  // Per-question custom audios (Base64 data URLs)
  const [manualQuestionAudios, setManualQuestionAudios] = useState<Record<number, string>>({})
  const [recordingOrder, setRecordingOrder] = useState<number | null>(null)
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<number | null>(null)

  const startRecording = async (order: number) => {
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        onToast?.('当前浏览器环境不支持麦克风录音，请使用现代浏览器或直接上传音频文件')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const mimeTypes = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']
      const supportedType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || ''
      const options = supportedType ? { mimeType: supportedType } : undefined
      const recorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const reader = new FileReader()
          reader.onloadend = () => {
            const base64data = reader.result as string
            setManualQuestionAudios((prev) => ({
              ...prev,
              [order]: base64data,
            }))
            onToast?.(`已成功保存第 Q${order} 题专属录音`)
          }
          reader.readAsDataURL(blob)
        }
        setRecordingOrder(null)
        setRecordingSeconds(0)
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current)
          recordTimerRef.current = null
        }
      }

      recorder.start(100)
      setRecordingOrder(order)
      setRecordingSeconds(0)
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1)
      }, 1000)
    } catch (err: unknown) {
      console.error('Microphone error:', err)
      onToast?.('录音失败，请确认已授予麦克风录音权限')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      audioChunksRef.current = []
      mediaRecorderRef.current.stop()
    }
    setRecordingOrder(null)
    setRecordingSeconds(0)
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
  }

  const handleFileUpload = (order: number, file: File) => {
    if (!file) return
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|webm|ogg|flac)$/i.test(file.name)) {
      onToast?.('请选择正确的音频文件格式 (MP3, WAV, M4A, WebM等)')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      onToast?.('音频文件过大，请选择 15MB 以内的录音文件')
      return
    }
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64data = reader.result as string
      setManualQuestionAudios((prev) => ({
        ...prev,
        [order]: base64data,
      }))
      onToast?.(`已成功绑定第 Q${order} 题自定义音频: ${file.name}`)
    }
    reader.readAsDataURL(file)
  }

  const handleClearAudio = (order: number) => {
    setManualQuestionAudios((prev) => {
      const copy = { ...prev }
      delete copy[order]
      return copy
    })
    onToast?.(`已清除第 Q${order} 题自定义音频，恢复为默认语音合成`)
  }

  // Collapsible state for auto mode score breakdown
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false)

  // 加权随机分配：与后端 auto_complete/scoring.py 同一套模型。
  // 这里用固定 seed 做"示意预览"（每次运行后端会重新随机），
  // 所以旁边提供"换一批"按钮重新抽样，让用户看到分配的波动范围。
  const [allocationSeed, setAllocationSeed] = useState<number>(20250928)

  const allocatedQuestionScores = useMemo<QuestionScoreItem[]>(() => {
    if (questions.length === 0) return []
    const plan = planQuestionAllocations(
      questions.map((q) => q.maxScore),
      autoTargetTotal,
      allocationSeed
    )
    return questions.map((q, idx) => ({
      order: q.order,
      sectionCaption: q.sectionCaption,
      typeName: q.typeName,
      questionText: q.questionText,
      answers: q.answers,
      options: q.options,
      maxScore: q.maxScore,
      allocatedScore: plan[idx]?.allocatedScore ?? 0,
      manualScore: manualScores[q.order] ?? 0,
      allocation: plan[idx],
    }))
  }, [questions, autoTargetTotal, manualScores, allocationSeed])

  // 计划满分题数 / 明显偏低的题数，用于面板上给出"本次形态"摘要
  const allocationSummary = useMemo(() => {
    const items = allocatedQuestionScores
    const fullCount = items.filter((item) => item.allocation?.isFull).length
    const lowCount = items.filter((item) => (item.allocation?.lossRatio ?? 0) >= 0.2).length
    const plannedTotal = items.reduce((sum, item) => sum + item.allocatedScore, 0)
    return {
      fullCount,
      lowCount,
      plannedTotal: Number(plannedTotal.toFixed(2)),
      lowestRatio: items.length
        ? Math.max(...items.map((item) => item.allocation?.lossRatio ?? 0))
        : 0,
    }
  }, [allocatedQuestionScores])

  // Manual mode validations:
  const manualTotalSum = useMemo(() => {
    return Number(Object.values(manualScores).reduce((acc, cur) => acc + (Number(cur) || 0), 0).toFixed(2))
  }, [manualScores])

  const manualOverMaxQuestions = useMemo(() => {
    return questions.filter((q) => (manualScores[q.order] || 0) > q.maxScore)
  }, [questions, manualScores])

  const isManualTotalOverMax = manualTotalSum > targetPaperTotal

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
    const url = getVoiceAudioUrl(selectedVoiceId, accessToken)
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

  // Model-specific Clone Audition handler
  const [isCloningPreview, setIsCloningPreview] = useState(false)
  const [isPlayingClonePreview, setIsPlayingClonePreview] = useState(false)
  const cloneAudioRef = useRef<HTMLAudioElement | null>(null)

  const handleToggleClonePreview = async (modelToUse = cloneModel) => {
    if (!selectedVoiceId) {
      onToast?.('请先在上方选择或录制专属声音')
      return
    }
    if (isPlayingClonePreview) {
      if (cloneAudioRef.current) cloneAudioRef.current.pause()
      setIsPlayingClonePreview(false)
      return
    }

    if (getFeatureStatus) {
      const featKey = `tts_model_${modelToUse.replace(/-/g, '_')}`
      const feat = getFeatureStatus(featKey, modelToUse)
      if (feat.status === 'feature_disabled' || feat.status === 'kill_switch') {
        onToast?.(feat.reason || '该 TTS 模型当前已被管理员停用')
        return
      }
    }

    if (cloneAudioRef.current) {
      cloneAudioRef.current.pause()
      cloneAudioRef.current = null
    }
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause()
      setIsPlayingPreview(false)
    }

    setIsCloningPreview(true)
    try {
      const blob = await getVoiceClonePreview(accessToken, selectedVoiceId, undefined, modelToUse)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      cloneAudioRef.current = audio
      setIsPlayingClonePreview(true)
      audio.onended = () => {
        setIsPlayingClonePreview(false)
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        setIsPlayingClonePreview(false)
        URL.revokeObjectURL(url)
        onToast?.('克隆试听播放失败')
      }
      await audio.play()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '克隆声音试听生成失败'
      onToast?.(msg)
    } finally {
      setIsCloningPreview(false)
    }
  }

  // Risk modal state
  const [isRiskModalOpen, setIsRiskModalOpen] = useState(false)
  const [typedPhrase, setTypedPhrase] = useState<string>(DISCLAIMER_PHRASE)
  const [isStartingTask, setIsStartingTask] = useState(false)

  // Execution Board state
  const [localTaskId, setLocalTaskId] = useState<string | null>(null)
  const [localTaskStatus, setLocalTaskStatus] = useState<AutoCompleteTaskResponse | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)

  // Current effective task & ID scoped strictly to current homework or hub
  const isTaskForCurrentHw = Boolean(
    isHubRoute ||
      (activeTask && String(activeTask.homework_id) === String(currentHw.id)) ||
      (localTaskStatus && String(localTaskStatus.homework_id) === String(currentHw.id))
  )
  const currentTask = isTaskForCurrentHw ? activeTask || localTaskStatus : localTaskStatus
  const currentTaskId = (isTaskForCurrentHw ? activeTask?.task_id || localTaskId : localTaskId) || null

  const onCompletedRef = useRef(onCompleted)
  const onTaskChangeRef = useRef(onTaskChange)
  useEffect(() => {
    onCompletedRef.current = onCompleted
  }, [onCompleted])
  useEffect(() => {
    onTaskChangeRef.current = onTaskChange
  }, [onTaskChange])
  const notifiedCompletedTaskIdsRef = useRef<Set<string>>(new Set())

  const handleDismissTaskModal = () => {
    setLocalTaskId(null)
    setLocalTaskStatus(null)
    onTaskChangeRef.current?.(null)
    setIsMinimized(false)
  }

  const [isCancelling, setIsCancelling] = useState(false)

  const handleCancelTask = async (taskIdToCancel?: string) => {
    const tid = taskIdToCancel || currentTaskId
    if (!tid || !accessToken || isCancelling) return
    if (!window.confirm('确定要终止当前的自动完成任务吗？')) return
    setIsCancelling(true)
    try {
      const res = await cancelAutoCompleteTask(accessToken, tid)
      if (res.success) {
        onToast?.('任务已成功终止')
        if (res.task) {
          setLocalTaskStatus(res.task)
          onTaskChangeRef.current?.(res.task)
        } else {
          handleDismissTaskModal()
        }
        void loadHistoryTasks(false)
      } else {
        onToast?.(res.message || '终止任务失败')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '网络请求失败，未能终止任务'
      onToast?.(message)
    } finally {
      setIsCancelling(false)
    }
  }

  const currentTaskStatus = currentTask?.status

  // Poll task status effect (if not already polled globally or if local is needed)
  useEffect(() => {
    let pollTimer: number | null = null
    if (currentTaskId && accessToken) {
      if (currentTaskStatus === 'COMPLETED' || currentTaskStatus === 'FAILED') {
        return
      }

      const poll = async () => {
        try {
          const res = await getAutoCompleteTaskStatus(accessToken, currentTaskId)
          setLocalTaskStatus(res)
          onTaskChangeRef.current?.(res)
          if (res.status === 'COMPLETED' || res.status === 'FAILED') {
            if (pollTimer) {
              clearInterval(pollTimer)
              pollTimer = null
            }
            void loadHistoryTasks(false)
            if (res.status === 'COMPLETED' && !notifiedCompletedTaskIdsRef.current.has(currentTaskId)) {
              notifiedCompletedTaskIdsRef.current.add(currentTaskId)
              onCompletedRef.current?.(res.result, currentHw.id)
            }
          }
        } catch {
          // Continue polling
        }
      }

      poll()
      pollTimer = window.setInterval(poll, 1800)
    }
    return () => {
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [currentTaskId, accessToken, currentHw.id, currentTaskStatus, loadHistoryTasks])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause()
      }
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current)
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop()
        } catch {
          // ignore
        }
      }
    }
  }, [])

  // Render full effect inspection for a chosen task
  const renderTaskEffectView = (task: AutoCompleteTaskResponse) => {
    const qDetails = task.result?.question_details || task.question_results || []
    const isCompleted = task.status === 'COMPLETED'
    const isFailed = task.status === 'FAILED'
    // 与执行页结算卡保持同一口径：优先使用后端最终结算分，再回退到兼容字段。
    const finalScore = task.result?.score ?? task.result?.final_score ?? task.result?.official_point ?? null
    const maxScore = task.result?.max_score ?? task.result?.total_point ?? null
    const scoreRate =
      task.result?.score_rate ??
      (finalScore !== null && maxScore
        ? ((Number(finalScore) / Number(maxScore)) * 100).toFixed(1)
        : null)
    const useTime = task.result?.use_time ? formatSeconds(task.result.use_time) : null
    const officialUseTime = task.result?.official_use_time
    const reportedUseTime = task.result?.reported_use_time
    const realElapsedSeconds = task.result?.real_elapsed_seconds
    const targetTotal = task.result?.target_total
    const clientPaperTotal = task.result?.client_paper_total
    const backendPaperTotal = task.result?.paper_total
    const completedAt =
      task.result?.completed_at ||
      (task.created_at ? new Date(task.created_at * 1000).toLocaleString() : null)

    return (
      <div className="fe-autocomplete-container">
        {/* Navigation Breadcrumb */}
        <div className="fe-reader-top-nav" style={{ marginBottom: 16 }}>
          <button
            className="control-secondary fe-back-btn"
            type="button"
            onClick={() => {
              setSelectedHistoryTask(null)
              setViewMode('kanban')
            }}
          >
            <Icon name="arrow_back" />
            <span>返回任务看板</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={`admin-pill-badge ${
                isCompleted ? 'is-active' : isFailed ? 'is-danger' : 'is-muted'
              }`}
            >
              <Icon
                name={isCompleted ? 'check_circle' : isFailed ? 'error' : 'sync'}
                className={!isCompleted && !isFailed ? 'fe-spin' : ''}
                style={{ fontSize: 14 }}
              />
              <span>
                {isCompleted ? '官方已核验完成' : isFailed ? '执行中断或失败' : '正在运行中'}
              </span>
            </span>
          </div>
        </div>

        {/* Task Hero Card */}
        <div className="fe-autocomplete-hero">
          <div className="fe-autocomplete-hero-head">
            <div
              className="fe-hero-icon-box"
              style={{
                background: isCompleted
                  ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
                  : undefined,
              }}
            >
              <Icon name={isCompleted ? 'task_alt' : 'bolt'} filled />
            </div>
            <div>
              <h2>{task.homework_name || '作业自动完成任务'}</h2>
              <p>
                音色模式:{' '}
                {task.voice_mode === 'clone'
                  ? '专属声音'
                  : task.voice_mode === 'edge'
                  ? '标准声音'
                  : '无录音'}
                {completedAt ? ` · 完成时间: ${completedAt}` : ''}
              </p>
            </div>
          </div>

          <div className="fe-autocomplete-stats-grid fe-completed-stats-grid">
            <div className="fe-stat-tile">
              <span className="fe-stat-label">官方最终得分</span>
              <strong className="fe-stat-value" style={{ color: isCompleted ? '#16a34a' : undefined }}>
                {finalScore !== null ? `${Number(finalScore).toFixed(2)} 分` : '--'}
              </strong>
            </div>
            <div className="fe-stat-tile">
              <span className="fe-stat-label">试卷总满分</span>
              <strong className="fe-stat-value">
                {maxScore !== null ? `${Number(maxScore).toFixed(1)} 分` : '--'}
              </strong>
            </div>
            <div className="fe-stat-tile">
              <span className="fe-stat-label">最终得分率</span>
              <strong className="fe-stat-value" style={{ color: '#2563eb' }}>
                {scoreRate !== null ? `${scoreRate}%` : '--'}
              </strong>
            </div>
            <div className="fe-stat-tile">
              <span className="fe-stat-label">实际答题用时</span>
              <strong className="fe-stat-value">{useTime || '--'}</strong>
            </div>
            <div className="fe-stat-tile">
              <span className="fe-stat-label">用时核对</span>
              <strong className="fe-stat-value fe-stat-value--stacked">
                {officialUseTime !== undefined && officialUseTime !== null
                  ? `官方记录 ${formatSeconds(Number(officialUseTime))}`
                  : '官方记录 --'}
                <small>
                  上报 {reportedUseTime !== undefined && reportedUseTime !== null ? `${reportedUseTime}s` : '--'}
                  {' · '}
                  真实 {realElapsedSeconds !== undefined && realElapsedSeconds !== null ? `${Math.round(Number(realElapsedSeconds))}s` : '--'}
                </small>
              </strong>
            </div>
            <div className="fe-stat-tile">
              <span className="fe-stat-label">本次上报目标分</span>
              <strong className="fe-stat-value fe-stat-value--stacked">
                {targetTotal !== undefined && targetTotal !== null ? `${Number(targetTotal).toFixed(2)} 分` : '--'}
                <small>
                  前端卷面 {clientPaperTotal !== undefined && clientPaperTotal !== null ? Number(clientPaperTotal).toFixed(2) : '--'}
                  {' / '}
                  后端卷面 {backendPaperTotal !== undefined && backendPaperTotal !== null ? Number(backendPaperTotal).toFixed(2) : '--'}
                </small>
              </strong>
            </div>
          </div>
        </div>

        {/* Error Alert if Failed */}
        {isFailed && (
          <div
            className="admin-status-strip is-danger"
            style={{
              margin: '0 0 20px',
              padding: '16px 20px',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#fef2f2',
              border: '1px solid #fca5a5',
            }}
          >
            <Icon name="error" style={{ fontSize: 24, color: '#dc2626', flexShrink: 0 }} />
            <div>
              <strong style={{ color: '#991b1b', fontSize: 14, display: 'block', marginBottom: 2 }}>
                任务执行异常
              </strong>
              <span style={{ color: '#b91c1c', fontSize: 13 }}>
                {task.error || friendlyTaskStage(task.stage_label, '任务执行中断')}
              </span>
            </div>
          </div>
        )}

        {/* Question by question breakdown and audio players */}
        <div className="fe-history-section">
          <div className="fe-history-header">
            <div className="fe-history-title-wrap">
              <Icon name="headphones" style={{ color: '#2563eb' }} />
              <h3>逐题得分与克隆录音效果试听 ({qDetails.length} 题)</h3>
            </div>
            <span className="fe-stat-label" style={{ fontSize: 12 }}>
              可直接在列表试听生成的克隆音频，核验发音语调与音质效果
            </span>
          </div>

          {qDetails.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '36px 16px',
                color: 'var(--control-muted)',
                fontSize: 13,
              }}
            >
              暂未记录到小题音频详情 (可能处于等待队列中或为非语音作业)
            </div>
          ) : (
            <div className="fe-history-table-wrap">
              <table className="fe-history-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>题号</th>
                    <th style={{ width: 100 }}>题型</th>
                    <th>题目/作答内容节选</th>
                    <th style={{ width: 90 }}>单题满分</th>
                    <th style={{ width: 90 }}>实际得分</th>
                    <th style={{ width: 230 }}>克隆录音试听</th>
                    <th style={{ width: 90 }}>官方状态</th>
                  </tr>
                </thead>
                <tbody>
                  {qDetails.map((q, idx) => {
                    const order = q.order || idx + 1
                    const typeName = q.type_name || '题目'
                    const text = q.text || `第 ${order} 题`
                    return (
                      <tr key={order}>
                        <td>
                          <strong>Q{order}</strong>
                        </td>
                        <td>
                          <span className="fe-td-type">{typeName}</span>
                        </td>
                        <td
                          style={{
                            maxWidth: 240,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          className="fe-td-text"
                          title={text}
                        >
                          {text}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{Number(q.max_score || 0).toFixed(2)} 分</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <strong style={{ color: '#16a34a' }}>
                            {Number(q.awarded_score || 0).toFixed(2)} 分
                          </strong>
                        </td>
                        <td>
                          {q.audio_url ? (
                            <div className="fe-audio-cell">
                              <audio
                                controls
                                src={q.audio_url}
                                preload="none"
                                className="fe-audio-player"
                              />
                            </div>
                          ) : ['听后选择', '词汇选择', '单项选择', '选择题'].some(k => typeName.includes(k)) ? (
                            <span className="admin-pill-badge is-muted" style={{ fontSize: 11 }}>客观选择题 · 无需录音</span>
                          ) : (
                            <span className="admin-pill-badge is-danger" style={{ fontSize: 11 }}>无音频数据</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span className="admin-pill-badge is-active" style={{ fontSize: 11 }}>
                            <Icon name="check" style={{ fontSize: 12 }} /> 已核验
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    )
  }

  // Render main Kanban Dashboard View (Current & Historical Tasks only)
  const renderHubView = () => {
    const isRunning = Boolean(
      activeTask && !['COMPLETED', 'FAILED'].includes(activeTask.status)
    )

    const completedTasksCount = historyTasks.filter((t) => t.status === 'COMPLETED').length
    const failedTasksCount = historyTasks.filter((t) => t.status === 'FAILED').length

    const filteredTasks = historyTasks.filter((t) => {
      if (taskFilter === 'completed') return t.status === 'COMPLETED'
      if (taskFilter === 'failed') return t.status === 'FAILED'
      return true
    })

    return (
      <div className="fe-autocomplete-container">
        {/* Top Header Card */}
        <div className="fe-kanban-hero">
          <div className="fe-kanban-hero-main">
            <div className="fe-hero-icon-box">
              <Icon name="monitoring" filled />
            </div>
            <div className="fe-kanban-hero-text">
              <div className="fe-kanban-title-row">
                <h2>自动完成任务看板</h2>
                <span className="admin-pill-badge is-muted">
                  <Icon name="analytics" style={{ fontSize: 13 }} />
                  <span>任务记录</span>
                </span>
              </div>
              <p>查看任务进度和历史记录</p>
            </div>
          </div>

          <div className="fe-kanban-hero-actions">
            <button
              type="button"
              className="control-secondary fe-btn-sm"
              onClick={onBack}
              title="返回作业列表"
            >
              <Icon name="arrow_back" />
              <span>返回作业列表</span>
            </button>
            <button
              type="button"
              className="control-secondary fe-btn-sm"
              onClick={() => void loadHistoryTasks(false)}
              disabled={isLoadingHistory}
              title="刷新历史任务列表"
            >
              <Icon name="refresh" className={isLoadingHistory ? 'fe-spin' : ''} />
              <span>刷新数据</span>
            </button>
          </div>
        </div>

        {/* 1. Live Running Task Card (if any) or Idle Indicator */}
        {isRunning && activeTask ? (
          <div className="fe-running-task-card">
            <div className="fe-running-task-head">
              <div className="fe-running-task-title">
                <span className="fe-capsule-spinner">
                  <Icon name="sync" className="fe-spin" style={{ color: '#059669', fontSize: 20 }} />
                </span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>
                      正在执行: {activeTask.homework_name || '作业自动完成'}
                    </h3>
                    <span className="admin-pill-badge is-active" style={{ fontSize: 11 }}>
                      <Icon name="bolt" style={{ fontSize: 12 }} /> 正在执行
                    </span>
                  </div>
                  <small style={{ color: '#047857', display: 'block', marginTop: 3 }}>
                    {friendlyTaskStage(activeTask.stage_label || activeTask.stage_text, '任务处理中...')}
                  </small>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="control-primary fe-btn-sm"
                  onClick={() => {
                    setLocalTaskId(activeTask.task_id)
                    setViewMode('execution')
                  }}
                >
                  <Icon name="bolt" />
                  <span>进入实时执行看板</span>
                </button>
                <button
                  type="button"
                  className="control-secondary fe-btn-sm"
                  onClick={() => setSelectedHistoryTask(activeTask)}
                >
                  <Icon name="headphones" />
                  <span>试听效果</span>
                </button>
                <button
                  type="button"
                  className="control-secondary fe-btn-sm"
                  onClick={() => handleCancelTask(activeTask.task_id)}
                  disabled={isCancelling}
                  style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                  title="终止当前任务"
                >
                  <Icon name={isCancelling ? 'sync' : 'cancel'} className={isCancelling ? 'fe-spin' : ''} />
                  <span>{isCancelling ? '终止中...' : '终止任务'}</span>
                </button>
              </div>
            </div>

            <div className="fe-exec-progress-track" style={{ height: 8, margin: '10px 0 6px' }}>
              <div
                className="fe-exec-progress-bar"
                style={{ width: `${Math.max(8, activeTask.progress || 10)}%` }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: '#065f46',
              }}
            >
              <span>
                当前进度: <strong>{activeTask.progress || 10}%</strong>
              </span>
              <span>
                {activeTask.current_question_index && activeTask.total_questions
                  ? `作答进度: 第 ${activeTask.current_question_index} / ${activeTask.total_questions} 题`
                  : '正在初始化题型与分值参数'}
              </span>
            </div>
          </div>
        ) : (
          <div className="fe-idle-task-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="fe-status-dot is-idle" />
              <span style={{ fontSize: 13, color: 'var(--control-muted)' }}>
                当前无正在执行的后台任务。如需开启作业，请在「当前作业」或「历史作业」中点击对应试卷的「⚡ 自动完成」。
              </span>
            </div>
          </div>
        )}

        {/* 2. Historical Tasks Section */}
        <div className="fe-history-section">
          <div className="fe-history-header">
            <div className="fe-history-title-wrap">
              <Icon name="history" style={{ color: '#2563eb' }} />
              <h3>历史任务记录</h3>
              <div className="fe-ratio-presets" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={`fe-ratio-preset-btn ${taskFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => setTaskFilter('all')}
                >
                  全部 ({historyTasks.length})
                </button>
                <button
                  type="button"
                  className={`fe-ratio-preset-btn ${taskFilter === 'completed' ? 'is-active' : ''}`}
                  onClick={() => setTaskFilter('completed')}
                >
                  已完成 ({completedTasksCount})
                </button>
                <button
                  type="button"
                  className={`fe-ratio-preset-btn ${taskFilter === 'failed' ? 'is-active' : ''}`}
                  onClick={() => setTaskFilter('failed')}
                >
                  失败/中断 ({failedTasksCount})
                </button>
              </div>
            </div>
          </div>

          {isLoadingHistory && historyTasks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 16px',
                color: 'var(--control-muted)',
              }}
            >
              <Icon
                name="sync"
                className="fe-spin"
                style={{ fontSize: 24, marginBottom: 8, color: '#2563eb' }}
              />
              <div>正在获取自动完成历史记录...</div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '36px 16px',
                color: 'var(--control-muted)',
                fontSize: 13.5,
              }}
            >
              <Icon name="inbox" style={{ fontSize: 32, color: '#94a3b8', marginBottom: 8 }} />
              <p style={{ margin: '0 0 6px' }}>暂无符合条件的自动完成记录</p>
              <small>在作业列表中点击「⚡ 自动完成」启动的任务将在此自动归档并支持录音回溯！</small>
            </div>
          ) : (
            <div className="fe-kanban-cards-grid">
              {filteredTasks.map((t, idx) => {
                const isDone = t.status === 'COMPLETED'
                const isErr = t.status === 'FAILED'
                const isRunningTask = !isDone && !isErr
                const score = t.result?.final_score ?? t.result?.score
                const maxS = t.result?.max_score ?? t.result?.total_point
                const rate =
                  t.result?.score_rate ??
                  (score !== undefined && maxS
                    ? ((Number(score) / Number(maxS)) * 100).toFixed(1)
                    : undefined)
                const timeStr =
                  t.result?.completed_at ||
                  (t.created_at ? new Date(t.created_at * 1000).toLocaleString() : '-')
                const qCount = t.result?.question_details?.length || t.total_questions || t.question_results?.length

                return (
                  <div
                    className={`fe-kanban-task-card ${
                      isRunningTask ? 'is-running' : isDone ? 'is-completed' : 'is-failed'
                    }`}
                    key={t.task_id || idx}
                  >
                    <div className="fe-kanban-card-header">
                      <div className="fe-kanban-card-title-group">
                        <strong className="fe-kanban-card-title" title={t.homework_name || '作业自动完成'}>
                          {t.homework_name || '作业自动完成'}
                        </strong>
                      </div>
                      <span
                        className={`admin-pill-badge ${
                          isDone ? 'is-active' : isErr ? 'is-danger' : 'is-muted'
                        }`}
                        style={{ fontSize: 11 }}
                      >
                        <Icon
                          name={isDone ? 'check' : isErr ? 'close' : 'sync'}
                          className={isRunningTask ? 'fe-spin' : ''}
                          style={{ fontSize: 12 }}
                        />
                        <span>{isDone ? '已完成' : isErr ? '失败/中断' : '执行中'}</span>
                      </span>
                    </div>

                    <div className="fe-kanban-card-metrics">
                      <div className="fe-kanban-metric-item">
                        <small>最终得分 / 满分</small>
                        <strong className="fe-kanban-metric-score" style={{ color: isDone ? '#16a34a' : undefined }}>
                          {score !== undefined ? `${Number(score).toFixed(2)}` : '--'}
                          {maxS !== undefined && <span className="fe-kanban-metric-max"> / {Number(maxS).toFixed(1)}分</span>}
                        </strong>
                      </div>
                      <div className="fe-kanban-metric-item">
                        <small>最终得分率</small>
                        <strong className="fe-kanban-metric-rate">
                          {rate !== undefined ? `${rate}%` : '--'}
                        </strong>
                      </div>
                      <div className="fe-kanban-metric-item">
                        <small>实际用时</small>
                        <span className="fe-kanban-metric-time">
                          {t.result?.use_time ? formatSeconds(t.result.use_time) : '--'}
                        </span>
                      </div>
                    </div>

                    <div className="fe-kanban-card-settings">
                      <div className="fe-kanban-setting-row">
                        <span className="fe-kanban-setting-label">
                          <Icon name="mic" style={{ fontSize: 13 }} /> 音色配置:
                        </span>
                        <span className="fe-kanban-setting-val">
                          {t.voice_mode === 'clone'
                            ? '专属声音克隆'
                            : t.voice_mode === 'edge'
                            ? '标准声音'
                            : '原声回放'}
                        </span>
                      </div>
                      <div className="fe-kanban-setting-row">
                        <span className="fe-kanban-setting-label">
                          <Icon name="tune" style={{ fontSize: 13 }} /> 作答模式:
                        </span>
                        <span className="fe-kanban-setting-val">
                          {t.mode === 'manual' ? '逐题设置分数' : '自动设置目标分'}
                        </span>
                      </div>
                      <div className="fe-kanban-setting-row">
                        <span className="fe-kanban-setting-label">
                          <Icon name="schedule" style={{ fontSize: 13 }} /> 记录时间:
                        </span>
                        <span className="fe-kanban-setting-val">{timeStr}</span>
                      </div>
                      {qCount ? (
                        <div className="fe-kanban-setting-row">
                          <span className="fe-kanban-setting-label">
                            <Icon name="format_list_numbered" style={{ fontSize: 13 }} /> 题目总数:
                          </span>
                          <span className="fe-kanban-setting-val">共 {qCount} 道题</span>
                        </div>
                      ) : null}
                    </div>

                    {isErr && (
                      <div className="fe-kanban-card-error">
                        <Icon name="info" style={{ fontSize: 14 }} />
                        <span>{t.error || '网络连接中断'}</span>
                      </div>
                    )}

                    <div className="fe-kanban-card-footer">
                      {isRunningTask ? (
                        <button
                          type="button"
                          className="control-primary fe-btn-sm fe-btn-block"
                          onClick={() => {
                            setLocalTaskId(t.task_id)
                            setViewMode('execution')
                          }}
                        >
                          <Icon name="bolt" />
                          <span>查看执行看板 ({t.progress || 0}%)</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="control-primary fe-btn-sm fe-btn-block"
                          onClick={() => setSelectedHistoryTask(t)}
                        >
                          <Icon name="headphones" />
                          <span>查看作答与试听效果</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {/* Floating Capsule for minimized active task */}
        {currentTaskId && isMinimized && (
          <div
            className="fe-minimized-floating-capsule"
            onClick={() => {
              setIsMinimized(false)
              setViewMode('execution')
            }}
            title="点击展开任务执行看板"
          >
            <div className="fe-capsule-spinner">
              <Icon
                name={currentTask?.status === 'COMPLETED' ? 'check_circle' : 'sync'}
                className={currentTask?.status === 'COMPLETED' ? '' : 'fe-spin'}
              />
            </div>
            <div className="fe-capsule-info">
              <strong>
                {currentTask?.status === 'COMPLETED'
                  ? '已完成自动做题'
                  : currentTask?.status === 'FAILED'
                  ? '任务执行中断'
                  : `正在自动完成 (${currentTask?.progress || 10}%)`}
              </strong>
              <small>{friendlyTaskStage(currentTask?.stage_label || currentTask?.stage_text)}</small>
            </div>
            <button
              type="button"
              className="fe-capsule-expand-btn"
              title="展开执行看板"
              onClick={(e) => {
                e.stopPropagation()
                setIsMinimized(false)
                setViewMode('execution')
              }}
            >
              <Icon name="open_in_full" />
            </button>
          </div>
        )}
      </div>
    )
  }

  // Dedicated Task Execution View (Full Dashboard Page)
  const renderExecutionView = () => {
    if (!currentTaskId) return null

    // 完成态统一使用历史详情看板，避免执行页结算卡与历史详情同时成为两套“完成看板”。
    // 这也让任务刚完成时直接看到完整的逐题得分、录音和六项结算数据。
    if (currentTask?.status === 'COMPLETED') {
      return renderTaskEffectView(currentTask)
    }

    return (
      <div className="fe-autocomplete-container">
        {/* Top Breadcrumb & Return Nav */}
        <div className="fe-reader-top-nav" style={{ marginBottom: 16 }}>
          <button
            className="control-secondary fe-back-btn"
            type="button"
            onClick={onBack}
            title="返回作业列表"
          >
            <Icon name="arrow_back" />
            <span>返回作业列表</span>
          </button>
          <button
            className="control-secondary fe-back-btn"
            type="button"
            onClick={() => {
              setViewMode('kanban')
              void loadHistoryTasks(false)
            }}
            title="前往自动完成任务总览看板"
          >
            <Icon name="dashboard" />
            <span>任务总览看板</span>
          </button>
          <span className={`admin-pill-badge ${currentTask?.status === 'COMPLETED' ? 'is-success' : currentTask?.status === 'FAILED' ? 'is-danger' : 'is-active'}`}>
            <Icon name={currentTask?.status === 'COMPLETED' ? 'check_circle' : currentTask?.status === 'FAILED' ? 'error' : 'bolt'} style={{ fontSize: 13 }} />
            <span>
              {currentTask?.status === 'COMPLETED'
                ? '任务已顺利完成'
                : currentTask?.status === 'FAILED'
                ? '任务执行中断'
                : '正在执行'}
            </span>
          </span>
        </div>

        {/* Full Dashboard Card */}
        <div className="fe-execution-card fe-execution-card--page">
          <div className="fe-execution-head">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2>自动完成任务执行看板</h2>
                {currentTask && !['COMPLETED', 'FAILED'].includes(currentTask.status) && (
                  <span className="admin-pill-badge is-active" style={{ fontSize: 11 }}>
                    <Icon name="sync" className="fe-spin" style={{ fontSize: 12 }} /> 运行中 ({currentTask.progress || 0}%)
                  </span>
                )}
              </div>
              <p>
                正在执行: <strong>{currentTask?.homework_name || currentHw?.name || '作业自动完成'}</strong>
              </p>
            </div>
            <div className="fe-execution-head-controls">
              {currentTask && !['COMPLETED', 'FAILED'].includes(currentTask.status) && (
                <button
                  type="button"
                  className="fe-head-control-btn fe-head-cancel-btn"
                  onClick={() => handleCancelTask()}
                  disabled={isCancelling}
                  title="立即终止当前云端任务"
                  style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                >
                  <Icon name={isCancelling ? 'sync' : 'cancel'} className={isCancelling ? 'fe-spin' : ''} />
                  <span>{isCancelling ? '终止中...' : '终止任务'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="fe-execution-body">
            {currentTask?.status === 'FAILED' ? (
              <div className="fe-empty-state">
                <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
                  <Icon name="error" />
                </div>
                <h2>任务执行遇到问题</h2>
                <p style={{ maxWidth: 520, margin: '8px auto 0', color: '#b91c1c', wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
                  {currentTask.error || friendlyTaskStage(currentTask.stage_label, '任务执行失败，请稍后重试。')}
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
                  <button
                    type="button"
                    className="control-primary"
                    onClick={() => {
                      handleDismissTaskModal()
                      onRequestPermit?.()
                    }}
                  >
                    <Icon name="replay" />
                    <span>重新尝试执行</span>
                  </button>
                  <button
                    type="button"
                    className="control-secondary"
                    onClick={() => {
                      handleDismissTaskModal()
                      void loadHistoryTasks(false)
                      setViewMode('kanban')
                    }}
                  >
                    <Icon name="dashboard" />
                    <span>前往任务看板</span>
                  </button>
                  <button
                    type="button"
                    className="control-secondary"
                    onClick={() => {
                      handleDismissTaskModal()
                      onBack()
                    }}
                  >
                    <Icon name="arrow_back" />
                    <span>返回作业列表</span>
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
                    const curP = currentTask?.progress || 10
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
                    style={{ width: `${Math.max(6, currentTask?.progress || 10)}%` }}
                  />
                </div>

                <div className="fe-exec-progress-meta">
                  <span className="fe-exec-stage-text">
                    <Icon name="sync" className="fe-spin" />
                    {friendlyTaskStage(currentTask?.stage_label || currentTask?.stage_text, '正在准备作业...')}
                  </span>
                  <strong className="fe-exec-percentage">
                    {currentTask?.progress || 10}%
                  </strong>
                </div>

                <div className="fe-exec-content-row">
                  {/* Question Stem preview with fade in */}
                  <div className="fe-exec-stem-preview">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <small>
                        当前作答题干 (第 {currentTask?.current_question_index || 1} / {currentTask?.total_questions || totalQuestions} 题)：
                      </small>
                      <span className="admin-pill-badge is-muted" style={{ fontSize: 11 }}>
                        {voiceMode === 'clone' ? '专属声音生成中' : voiceMode === 'edge' ? '标准声音生成中' : '静音模式'}
                      </span>
                    </div>
                    <p className="fe-stem-text">
                      {currentTask?.current_question_text || '正在逐题提取作答素材与发音词汇表...'}
                    </p>
                  </div>

                  <div className="fe-exec-details-grid">
                    <div className="fe-exec-tile">
                      <small>音色模式</small>
                      <span>
                        {voiceMode === 'clone'
                          ? '专属声音'
                          : voiceMode === 'edge'
                          ? '标准声音'
                          : '不上传声音'}
                      </span>
                    </div>
                    <div className="fe-exec-tile">
                      <small>目标总分与比例</small>
                      <span>{mode === 'auto' ? `${autoTargetTotal.toFixed(2)}分 (95%比例)` : `${manualTotalSum.toFixed(2)}分`}</span>
                    </div>
                  </div>
                </div>

                {/* Live Questions Checklist */}
                {currentTask?.question_results && currentTask.question_results.length > 0 && (
                  <div className="fe-exec-questions-checklist">
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--control-muted)', marginBottom: 2 }}>
                      已完成题目 ({currentTask.question_results.length}/{currentTask.total_questions || totalQuestions})：
                    </div>
                    {currentTask.question_results.map((q) => (
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

                {/* In-Progress Footer Navigation Actions */}
                <div className="fe-execution-in-progress-footer">
                  <div className="fe-exec-footer-tip">
                    <Icon name="info" style={{ fontSize: 16, color: '#3b82f6' }} />
                    <span>任务会在后台继续运行，关闭页面不会影响进度</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 1. If user selected a specific historical task to inspect effect
  if (selectedHistoryTask) {
    return renderTaskEffectView(selectedHistoryTask)
  }

  // 2. If viewMode is execution AND there is an active/target task:
  if (viewMode === 'execution' && currentTaskId) {
    return renderExecutionView()
  }

  // 3. If viewMode is kanban, or if arrived via /auto-complete or without permitToken
  if (viewMode === 'kanban' || (!permitToken && viewMode !== 'execution')) {
    return renderHubView()
  }

  // Trigger Risk Modal
  const handleOpenRiskModal = () => {
    if (voiceMode === 'clone' && (!selectedVoiceId || voices.length === 0)) {
      onToast?.('您尚未录制专属声音，请先录制声音或切换至标准声音')
      return
    }
    setIsRiskModalOpen(true)
    setTypedPhrase(DISCLAIMER_PHRASE)
  }

  // Submit Auto Complete Task
  const handleConfirmStart = async () => {
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
        homework_id: currentHw.id,
        homework_name: currentHw.name,
        resource_id: currentHw.resource_id || ((activePaper as Record<string, unknown> | null)?.resource_id as string | undefined),
        set_id: currentHw.set_id || ((activePaper as Record<string, unknown> | null)?.set_id as string | undefined),
        set_type: currentHw.set_type !== undefined ? Number(currentHw.set_type) : ((activePaper as Record<string, unknown> | null)?.set_type as number | undefined),
        status: currentHw.status !== undefined ? String(currentHw.status) : undefined,
        paper_total: paperTotalScore,
        target_ratio: mode === 'auto'
          ? (targetPaperTotal > 0 ? Number((autoTargetTotal / targetPaperTotal).toFixed(4)) : 0.95)
          : undefined,
        use_time_source: timeOption === 'recommended' ? 'recommended' : 'manual',
        question_maxes: questions.reduce<Record<string, number>>((acc, q) => {
          acc[String(q.order)] = displayQuestionMax(q)
          return acc
        }, {}),
        mode,
        target_total: mode === 'auto' ? autoTargetTotal : Number(manualTotalSum.toFixed(2)),
        allow_over_max: mode === 'manual' ? isManualTotalOverMax || manualOverMaxQuestions.length > 0 : false,
        use_time: selectedUseTimeSeconds,
        voice_mode: voiceMode,
        voice_id: voiceMode === 'clone' ? (selectedVoiceId || undefined) : undefined,
        clone_model: voiceMode === 'clone' ? cloneModel : undefined,
        per_question_scores: perQuestionScoresPayload,
        per_question_audio: mode === 'manual' && Object.keys(manualQuestionAudios).length > 0 ? manualQuestionAudios : undefined,
        permit_token: permitToken || '',
        disclaimer_text: typedPhrase.trim() || DISCLAIMER_PHRASE,
      }

      if (
        currentTask &&
        String(currentTask.homework_id) === String(currentHw.id) &&
        !['COMPLETED', 'FAILED'].includes(currentTask.status)
      ) {
        onToast?.('当前作业已有正在运行的任务，无需重复发起')
        setIsRiskModalOpen(false)
        return
      }

      if (voiceMode === 'clone' && getFeatureStatus) {
        const featKey = `tts_model_${cloneModel.replace(/-/g, '_')}`
        const feat = getFeatureStatus(featKey, cloneModel)
        if (!feat.enabled) {
          onToast?.(feat.reason || '当前所选 TTS 模型不可用')
          setIsRiskModalOpen(false)
          return
        }
      }

      const res = await startAutoComplete(accessToken, payload)
      setIsRiskModalOpen(false)
      setLocalTaskId(res.task_id)
      setIsMinimized(false)
      setViewMode('execution')
      // Immediate visual feedback so user sees the pipeline active
      const initialTask: AutoCompleteTaskResponse = {
        task_id: res.task_id,
        status: 'PREPARING',
        progress: 10,
        stage_label: '[1/8] 正在准备登录状态...',
        stage_text: '[1/8] 正在准备登录状态...',
        homework_id: currentHw.id,
        homework_name: currentHw.name,
      }
      setLocalTaskStatus(initialTask)
      onTaskChange?.(initialTask)
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
        <button
          className="control-secondary fe-back-btn"
          type="button"
          onClick={onBack}
          title="返回作业列表"
        >
          <Icon name="arrow_back" />
          <span>返回作业列表</span>
        </button>
        <button
          className="control-secondary fe-back-btn"
          type="button"
          onClick={() => setViewMode('kanban')}
          title="前往自动完成任务看板"
        >
          <Icon name="dashboard" />
          <span>前往任务看板</span>
        </button>
        <span className="admin-pill-badge is-muted">
          <Icon name="lock" style={{ fontSize: 14 }} />
          <span>安全准入中 · 令牌已核验</span>
        </span>
      </div>

      {/* Running Notice Banner if this exact homework is already executing */}
      {currentTask && !['COMPLETED', 'FAILED'].includes(currentTask.status) && (
        <div
          className="admin-status-strip is-success"
          style={{
            margin: '0 0 20px',
            padding: '16px 20px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: '#ecfdf5',
            border: '1.5px solid #a7f3d0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="sync" className="fe-spin" style={{ fontSize: 24, color: '#059669', flexShrink: 0 }} />
            <div>
              <strong style={{ color: '#065f46', fontSize: 14.5, display: 'block', marginBottom: 2 }}>
                该作业正在自动完成（进度 {currentTask.progress || 0}%）
              </strong>
              <span style={{ color: '#047857', fontSize: 13 }}>
                {friendlyTaskStage(currentTask.stage_label || currentTask.stage_text, '任务处理中，无需重复配置')}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="control-primary fe-btn-sm"
            onClick={() => setViewMode('execution')}
            style={{ background: '#059669', borderColor: '#059669', whiteSpace: 'nowrap' }}
          >
            <Icon name="bolt" />
            <span>进入实时执行看板</span>
          </button>
        </div>
      )}

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
            <h2>{currentHw?.name && currentHw.name !== '作业自动完成' ? currentHw.name : (activePaper?.title || activePaper?.paperName || currentHw?.name || '作业自动完成')}</h2>
            <p>配置自动完成任务</p>
          </div>
        </div>

        <div className="fe-autocomplete-stats-grid">
          <div className="fe-stat-tile">
            <span className="fe-stat-label">题目数量</span>
            <strong className="fe-stat-value">{totalQuestions} 题</strong>
          </div>
          <div className="fe-stat-tile">
            <span className="fe-stat-label">试卷官方满分</span>
            <strong className="fe-stat-value">{targetPaperTotal.toFixed(1)} 分</strong>
          </div>
          <div className="fe-stat-tile">
            <span className="fe-stat-label">建议答题用时</span>
            <strong className="fe-stat-value">{formatSeconds(recommendedTimeSeconds)}</strong>
          </div>
          <div className="fe-stat-tile">
            <span className="fe-stat-label">所属学科</span>
            <strong className="fe-stat-value">{currentHw.subject_name || '英语'}</strong>
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
              <small>自动按比例设置目标分数，最高 95%</small>
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
              <small>可自定义每道题的分值，超出满分时提示</small>
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
                    <span>/ {targetPaperTotal.toFixed(1)} 分</span>
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
                        {p.label} · {(targetPaperTotal * p.ratio).toFixed(1)}分
                      </button>
                    )
                  })}
                </div>

                <div className="fe-range-container">
                  <input
                    type="range"
                    className="fe-styled-slider"
                    min={0}
                    max={SLIDER_RESOLUTION}
                    step={1}
                    value={scoreToTrackValue(autoTargetTotal, targetPaperTotal)}
                    onChange={(e) =>
                      handleUpdateAutoTargetTotal(
                        trackValueToScore(parseFloat(e.target.value) || 0, targetPaperTotal)
                      )
                    }
                  />
                  <div className="fe-slider-ticks is-tracked">
                    {(
                      [
                        { ratio: 0, label: '0 分' },
                        ...SCORE_TRACK_MARKS.slice(0, -1).map((ratio) => ({
                          ratio,
                          label: `${(targetPaperTotal * ratio).toFixed(1)} 分`,
                        })),
                        {
                          ratio: 0.95,
                          label: `95% 上限 ${maxAutoScore.toFixed(1)} 分`,
                          highlight: true,
                        },
                      ] as { ratio: number; label: string; highlight?: boolean }[]
                    ).map((mark) => (
                      <span
                        key={mark.ratio}
                        className={mark.highlight ? 'is-cap' : undefined}
                        style={{
                          left: `${Math.min(99, ratioToTrack(mark.ratio) * 100).toFixed(2)}%`,
                        }}
                      >
                        {mark.label}
                      </span>
                    ))}
                  </div>
                  <p className="fe-slider-hint">
                    <Icon name="speed" />
                    滑块已按分数段非线性分布：<strong>90%~95%（{(targetPaperTotal * 0.9).toFixed(1)}~{maxAutoScore} 分）占约四成滑轨</strong>，
                    低分段被压缩（想填低分请直接用右侧输入框）。30 分卷上 0~15 分只占约五分之一。
                  </p>
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
                    <strong>各小题加权随机分配方案 ({totalQuestions} 题)</strong>
                    <span className="fe-balance-tag">
                      <Icon name="verified" />
                      小题求和与设定总分绝对吻合 ({allocationSummary.plannedTotal.toFixed(2)} 分)
                    </span>
                  </div>
                  <span className="fe-breakdown-head-actions">
                    <button
                      type="button"
                      className="fe-reroll-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setAllocationSeed((prev) => (prev * 1664525 + 1013904223) % 2147483647)
                        onToast?.('已重新抽样一批分配方案（实际运行时后端会再随机一次）')
                      }}
                    >
                      <Icon name="casino" />
                      换一批
                    </button>
                    <Icon name={isBreakdownOpen ? 'expand_less' : 'expand_more'} />
                  </span>
                </button>

                {isBreakdownOpen && (
                  <div className="fe-breakdown-list">
                    <div className="fe-breakdown-note">
                      <Icon name="info" />
                      <span>
                        分配规则：<strong>加权随机</strong>——少数题明显偏低（读错/漏读），其余题接近满分；
                        大分值长句子几乎不给满分，小分值题经常满分；目标分越高，扣分越轻、满分题越多。
                        每次运行的后端分配都会重新随机，本表是<b>同等形态的示意抽样</b>。
                      </span>
                    </div>
                    <div className="fe-breakdown-summary">
                      <span>本次示意：满分 <strong>{allocationSummary.fullCount}</strong> 题</span>
                      <i />
                      <span>明显偏低（扣 ≥20%）<strong>{allocationSummary.lowCount}</strong> 题</span>
                      <i />
                      <span>单题最大扣分 <strong>{(allocationSummary.lowestRatio * 100).toFixed(0)}%</strong></span>
                      <i />
                      <span>合计 <strong>{allocationSummary.plannedTotal.toFixed(2)}</strong> / {targetPaperTotal.toFixed(2)} 分</span>
                      {Math.abs(allocationSummary.plannedTotal - autoTargetTotal) >= 0.001 ? (
                        <span className="fe-breakdown-tip">
                          （设定 {autoTargetTotal.toFixed(2)} → 按 0.125 分档位结算{' '}
                          {allocationSummary.plannedTotal.toFixed(2)}）
                        </span>
                      ) : null}
                    </div>
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
                        <span className="fe-td-type">
                          {item.typeName}
                          {item.allocation?.isBigQuestion ? (
                            <em className="fe-td-badge is-big" title="大分值题：长句子朗读几乎不会满分">易失分</em>
                          ) : null}
                        </span>
                        <span className="fe-td-max">{item.maxScore.toFixed(2)} 分</span>
                        <span className="fe-td-score">
                          <strong>{item.allocatedScore.toFixed(2)}</strong> 分 ({(item.maxScore > 0 ? (item.allocatedScore / item.maxScore) * 100 : 95).toFixed(0)}%)
                          {item.allocation?.isFull ? (
                            <em className="fe-td-badge is-full">满分</em>
                          ) : (item.allocation?.lossRatio ?? 0) >= 0.2 ? (
                            <em className="fe-td-badge is-low">偏低</em>
                          ) : null}
                        </span>
                        <span className="fe-td-scale" style={{ fontSize: 11.5, color: 'var(--control-muted)', fontFamily: 'DM Mono, monospace' }}>
                          {toFiveScale(item.allocatedScore, item.maxScore)} / 5.00
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
                    <strong>【极度危险】当前设定总分 ({manualTotalSum.toFixed(1)}分) 超过试卷官方真正满分 ({targetPaperTotal.toFixed(1)}分)！</strong>
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
                  <span> / {targetPaperTotal.toFixed(1)} 分 ({(manualTotalSum / maxAutoScore > 1 ? '超过95%' : `${(manualTotalSum / targetPaperTotal * 100).toFixed(1)}%`)})</span>
                </div>
              </div>

              <div className="fe-manual-questions-list">
                {questions.map((q) => {
                  const currentVal = manualScores[q.order] ?? 0
                  const isOver = currentVal > q.maxScore
                  const hasCustomAudio = Boolean(manualQuestionAudios[q.order])
                  const isRecordingThis = recordingOrder === q.order

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

                          {/* Per-Question Custom Audio Control Bar */}
                          <div className="fe-per-question-audio-bar">
                            <div className="fe-audio-bar-meta">
                              <span className="fe-audio-meta-label">
                                <Icon name="mic" style={{ fontSize: 14 }} />
                                题目录音:
                              </span>
                              {hasCustomAudio ? (
                                <span className="admin-pill-badge is-success" style={{ fontSize: 11, gap: 3 }}>
                                  <Icon name="check" style={{ fontSize: 12 }} />
                                  已配置专属录音
                                </span>
                              ) : (
                                <span className="admin-pill-badge is-muted" style={{ fontSize: 11 }}>
                                  默认合成 ({voiceMode === 'clone' ? '专属声音' : voiceMode === 'edge' ? '标准声音' : '无声音'})
                                </span>
                              )}
                            </div>

                            <div className="fe-audio-bar-actions">
                              {isRecordingThis ? (
                                <div className="fe-recording-active-wrap">
                                  <span className="fe-record-indicator-pulse" />
                                  <span className="fe-record-timer">录音中 {recordingSeconds}s...</span>
                                  <button
                                    type="button"
                                    className="fe-record-btn is-stop"
                                    onClick={stopRecording}
                                    title="停止录音并保存"
                                  >
                                    <Icon name="stop" />
                                    <span>完成</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="fe-record-btn is-cancel"
                                    onClick={cancelRecording}
                                    title="取消本次录音"
                                  >
                                    <Icon name="close" />
                                    <span>取消</span>
                                  </button>
                                </div>
                              ) : (
                                <>
                                  {hasCustomAudio && (
                                    <audio
                                      controls
                                      src={manualQuestionAudios[q.order]}
                                      className="fe-audio-inline-player"
                                      preload="metadata"
                                    />
                                  )}

                                  <button
                                    type="button"
                                    className="fe-audio-action-btn"
                                    disabled={recordingOrder !== null}
                                    onClick={() => startRecording(q.order)}
                                    title="使用电脑麦克风录制本人声音"
                                  >
                                    <Icon name="mic" />
                                    <span>{hasCustomAudio ? '重新录制' : '录制音频'}</span>
                                  </button>

                                  <label className="fe-audio-action-btn fe-audio-upload-label" title="上传本地音频文件 (MP3/WAV/M4A/WebM)">
                                    <Icon name="upload_file" />
                                    <span>{hasCustomAudio ? '更换文件' : '上传音频'}</span>
                                    <input
                                      type="file"
                                      accept="audio/*,.mp3,.wav,.m4a,.aac,.webm,.ogg,.flac"
                                      style={{ display: 'none' }}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        if (file) {
                                          handleFileUpload(q.order, file)
                                        }
                                        e.target.value = ''
                                      }}
                                    />
                                  </label>

                                  {hasCustomAudio && (
                                    <button
                                      type="button"
                                      className="fe-audio-action-btn is-clear"
                                      onClick={() => handleClearAudio(q.order)}
                                      title="清除自定义音频，恢复为默认语音合成"
                                    >
                                      <Icon name="delete_outline" />
                                      <span>重置</span>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
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

      {/* 2.5 Time Planning Section */}
      <div className="admin-policy-card fe-time-section-card">
        <div className="admin-policy-card-head">
          <div className="fe-section-icon">
            <Icon name="schedule" />
          </div>
          <div>
            <h3>作答用时</h3>
            <p>设置合理的提交用时，避免提交过快</p>
          </div>
        </div>

        <div className="fe-time-options-grid">
          {/* Option A: Recommended */}
          <div
            className={`fe-voice-option-card ${timeOption === 'recommended' ? 'is-active' : ''}`}
            onClick={() => setTimeOption('recommended')}
          >
            <div className="fe-voice-card-radio">
              <span className={`fe-radio-circle ${timeOption === 'recommended' ? 'is-checked' : ''}`} />
            </div>
            <div className="fe-voice-card-content">
              <div className="fe-voice-card-title">
                <strong>智能推荐耗时: {formatSeconds(recommendedTimeSeconds)}</strong>
                <span className="admin-pill-badge is-success">算法推荐</span>
              </div>
              <p>
                按本试卷每道题的参考录音时长（共约 {formatSeconds(totalRefAudioSeconds)}）× 2 + 2 分钟准备与过渡缓冲时间推算。
              </p>
            </div>
          </div>

          {/* Option B: Custom */}
          <div
            className={`fe-voice-option-card ${timeOption === 'custom' ? 'is-active' : ''}`}
            onClick={() => setTimeOption('custom')}
          >
            <div className="fe-voice-card-radio">
              <span className={`fe-radio-circle ${timeOption === 'custom' ? 'is-checked' : ''}`} />
            </div>
            <div className="fe-voice-card-content">
              <div className="fe-voice-card-title">
                <strong>自定义作答耗时: {formatSeconds(customUseTimeSeconds)}</strong>
                <span className="admin-pill-badge is-muted">自由指定</span>
              </div>
              <p>手动输入期望提交的总用时，或使用下方快捷预设档位。</p>
            </div>
          </div>
        </div>

        {timeOption === 'custom' && (
          <div className="fe-custom-time-panel">
            <div className="fe-time-presets-bar">
              <span style={{ fontSize: 13, color: '#64748b' }}>快捷预设档位：</span>
              {[
                { label: '1 分钟', sec: 60 },
                { label: '3 分钟', sec: 180 },
                { label: '5 分钟', sec: 300 },
                { label: '8 分钟', sec: 480 },
                { label: '10 分钟', sec: 600 },
                { label: `推荐耗时 (${formatSeconds(recommendedTimeSeconds)})`, sec: recommendedTimeSeconds },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`fe-ratio-preset-btn ${customUseTimeSeconds === preset.sec ? 'is-active' : ''}`}
                  onClick={() => {
                    setCustomMinutes(Math.floor(preset.sec / 60))
                    setCustomSeconds(preset.sec % 60)
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="fe-custom-time-inputs">
              <div className="fe-time-input-group">
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={effectiveMinutes}
                  onChange={(e) => setCustomMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                  className="fe-time-num-input"
                />
                <span className="fe-time-unit">分</span>
              </div>
              <div className="fe-time-input-group">
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={effectiveSeconds}
                  onChange={(e) => setCustomSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  className="fe-time-num-input"
                />
                <span className="fe-time-unit">秒</span>
              </div>
              <div className="fe-time-total-display">
                <span>总计用时: <strong>{customUseTimeSeconds} 秒</strong> ({formatSeconds(customUseTimeSeconds)})</span>
              </div>
            </div>

            {customUseTimeSeconds < 30 && (
              <div className="fe-danger-banner" style={{ marginTop: 12 }}>
                <Icon name="warning" filled />
                <div>
                  <strong>【高风险告警】作答耗时少于 30 秒！</strong>
                  <p>建议作答用时不少于 60 秒。</p>
                </div>
              </div>
            )}
          </div>
        )}
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
                <strong>专属声音</strong>
                <span className="admin-pill-badge is-success">推荐</span>
              </div>
              <p>使用您录制的声音生成朗读音频。</p>
            </div>
          </div>

          {/* Option 2: standard voice */}
          <div
            className={`fe-voice-option-card ${voiceMode === 'edge' ? 'is-active' : ''}`}
            onClick={() => setVoiceMode('edge')}
          >
            <div className="fe-voice-card-radio">
              <span className={`fe-radio-circle ${voiceMode === 'edge' ? 'is-checked' : ''}`} />
            </div>
            <div className="fe-voice-card-content">
              <div className="fe-voice-card-title">
                <strong>标准声音</strong>
                <span className="admin-pill-badge is-muted">标准发音</span>
              </div>
              <p>标准英语发音，适合普通朗读。</p>
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

        {voiceMode === 'clone' && (
          <div className="fe-voice-clone-panel">
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
                  <span>{isPlayingPreview ? '暂停原声' : '试听原声样本'}</span>
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

            <div className="fe-voice-model-picker">
              <div className="fe-voice-model-header">
                <div className="fe-voice-model-title-wrap">
                  <Icon name="psychology" style={{ fontSize: 16, color: 'var(--control-blue)' }} />
                  <span>AI 克隆驱动模型：</span>
                </div>
                <span className="fe-voice-model-tag-free">按会员权限解锁</span>
              </div>

              <div className="fe-voice-model-tabs">
                {[
                  {
                    id: 'pocket-tts',
                    name: 'Pocket TTS',
                    badge: '快速·默认',
                    isMaintenance: false,
                  },
                  {
                    id: 'ming-omni-tts',
                    name: 'Ming-Omni',
                    badge: '自然·较慢',
                    isMaintenance: false,
                  },
                  {
                    id: 'moss-tts-nano',
                    name: 'MOSS Nano',
                    badge: '平稳',
                    isMaintenance: false,
                  },
                ].map((m) => {
                  const isSel = cloneModel === m.id
                  const featKey = `tts_model_${m.id.replace(/-/g, '_')}`
                  const feat: FeatureCheck = getFeatureStatus
                    ? getFeatureStatus(featKey, m.name)
                    : { enabled: true, status: 'enabled', reason: '' }
                  const isRestricted = feat.status === 'membership_required'
                  const isDisabled = m.isMaintenance || feat.status === 'feature_disabled'

                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`fe-voice-model-tab-btn ${isSel ? 'is-active' : ''} ${isDisabled ? 'is-disabled' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (m.isMaintenance) {
                          onToast?.('Ming-Omni 上游服务维护中，请使用推荐的 Pocket TTS 或 MOSS Nano')
                          return
                        }
                        if (isDisabled) {
                          onToast?.(feat.reason || `${m.name} 已被停用`)
                          return
                        }
                        if (isRestricted) {
                          onToast?.(feat.reason || `${m.name} 需要 ${feat.minMemberTier === 'ultra' ? 'SVIP' : 'VIP'} 会员权限`)
                        }
                        setCloneModel(m.id as 'pocket-tts' | 'ming-omni-tts' | 'moss-tts-nano')
                      }}
                    >
                      <span className="fe-voice-model-tab-name">{m.name}</span>
                      {isDisabled ? (
                        <span className="fe-voice-model-tab-badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>已停用</span>
                      ) : isRestricted ? (
                        <span className="fe-voice-model-tab-badge" style={{ background: '#fef3c7', color: '#b45309' }}>
                          {feat.minMemberTier === 'ultra' ? 'SVIP' : 'VIP'}
                        </span>
                      ) : (
                        <span className="fe-voice-model-tab-badge">{m.badge}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="fe-voice-model-detail-card">
                {cloneModel === 'pocket-tts' && (
                  <div>
                    <div className="fe-voice-model-detail-title">
                      <strong>Pocket TTS · 推荐</strong>
                      <span>耗时 ~2s · 推荐</span>
                    </div>
                    <p>响应快，适合普通朗读。</p>
                  </div>
                )}
                {cloneModel === 'ming-omni-tts' && (
                  <div>
                    <div className="fe-voice-model-detail-title">
                      <strong>Ming-Omni</strong>
                      <span style={{ color: '#d97706', fontWeight: 600 }}>预计等待 60~120 秒</span>
                    </div>
                    <p>声音更接近自然口语，预计等待 60~120 秒。</p>
                  </div>
                )}
                {cloneModel === 'moss-tts-nano' && (
                  <div>
                    <div className="fe-voice-model-detail-title">
                      <strong>MOSS TTS Nano</strong>
                      <span>耗时 ~2s · 自然平稳</span>
                    </div>
                    <p>声音自然平稳，适合口语朗读。</p>
                  </div>
                )}

                {(() => {
                  const currentFeatKey = `tts_model_${cloneModel.replace(/-/g, '_')}`
                  const currentFeat = getFeatureStatus ? getFeatureStatus(currentFeatKey, cloneModel) : null
                  if (!currentFeat || currentFeat.enabled) return null
                  return (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: currentFeat.status === 'feature_disabled' ? '#fee2e2' : '#fef3c7',
                        color: currentFeat.status === 'feature_disabled' ? '#991b1b' : '#92400e',
                        fontSize: 11.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Icon name="warning" style={{ fontSize: 14 }} />
                      <span>{currentFeat.reason}</span>
                    </div>
                  )
                })()}

                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 8,
                    borderTop: '1px dashed var(--control-line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    className="control-secondary fe-btn-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleClonePreview(cloneModel)
                    }}
                    disabled={isCloningPreview || !selectedVoiceId}
                    title={!selectedVoiceId ? '请先选择声音' : '试听当前模型声音克隆效果'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      padding: '4px 12px',
                      borderRadius: 6,
                      borderColor: isPlayingClonePreview ? '#8b5cf6' : undefined,
                      color: isPlayingClonePreview ? '#7c3aed' : undefined,
                      background: isPlayingClonePreview ? '#f5f3ff' : undefined,
                    }}
                  >
                    <Icon
                      name={isCloningPreview ? 'sync' : isPlayingClonePreview ? 'pause' : 'auto_awesome'}
                      className={isCloningPreview ? 'fe-spin' : ''}
                      style={{ fontSize: 15 }}
                    />
                    <span>
                      {isCloningPreview
                        ? '正在合成音频...'
                        : isPlayingClonePreview
                        ? '暂停试听'
                        : '试听此模型发音效果'}
                    </span>
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--control-muted)' }}>
                    {selectedVoiceId ? '基于当前选中的声音样本' : '需在上方选择声音样本'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Bottom Action Bar */}
      <div className="fe-autocomplete-footer-bar">
        <div className="fe-footer-summary">
          <span>预计总分：<strong>{mode === 'auto' ? autoTargetTotal.toFixed(1) : manualTotalSum.toFixed(1)}</strong> 分</span>
          <span className="fe-sep">·</span>
          <span>用时：<strong>{formatSeconds(selectedUseTimeSeconds)}</strong></span>
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
                <h2>作业自动完成确认 · 任务参数核对</h2>
                <p>
                  {mode === 'auto'
                    ? '一键自动优化分配模式'
                    : '手动自定义逐题控分模式'}
                </p>
              </div>
            </div>

            <div className="fe-risk-card-body">
              <div className="fe-risk-step-content">
                <div className="fe-risk-notice-box">
                  <strong>任务提交参数核对</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 16px', marginTop: 8 }}>
                    <div>目标总分：<strong style={{ color: '#16a34a' }}>{mode === 'auto' ? autoTargetTotal.toFixed(1) : manualTotalSum.toFixed(1)} 分</strong> / 卷面满分 {targetPaperTotal.toFixed(1)} 分</div>
                    <div>题目数：<strong>{totalQuestions} 道</strong> · 卷面由小题满分累加：<strong>{targetPaperTotal.toFixed(2)} 分</strong></div>
                    <div>上报做题用时：<strong>{formatSeconds(selectedUseTimeSeconds)}</strong></div>
                    <div>题目总数：<strong>{totalQuestions} 道</strong></div>
                    <div>语音录音模式：<strong>{voiceMode === 'clone' ? '专属声音' : (voiceMode === 'edge' ? '标准声音' : '无需录音 / 快速完成')}</strong></div>
                  </div>
                </div>

                {mode === 'manual' && isManualTotalOverMax && (
                  <div className="fe-risk-notice-box" style={{ marginTop: 8, borderColor: '#fca5a5', background: '#fef2f2' }}>
                    <p style={{ color: '#dc2626', fontWeight: 600, margin: 0 }}>
                      ⚠️ 警告：当前设定总分 ({manualTotalSum.toFixed(1)} 分) 超出试卷卷面满分 ({targetPaperTotal.toFixed(1)} 分)。
                    </p>
                  </div>
                )}

                <div className="fe-risk-input-section" style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 13, color: 'var(--control-muted)', margin: 0 }}>
                    任务提交后会在后台执行；未启用真实录音时完成会更快。
                  </p>
                </div>
              </div>
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

              <button
                type="button"
                className="control-primary fe-confirm-btn is-ready-green"
                disabled={isStartingTask}
                onClick={handleConfirmStart}
              >
                <Icon name={isStartingTask ? 'sync' : 'play_arrow'} className={isStartingTask ? 'fe-spin' : ''} />
                <span>
                  {isStartingTask ? '正在提交任务...' : '确认无误，立即开始'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Capsule (when task is actively running in background while viewing config) */}
      {currentTaskId && currentTask && !['COMPLETED', 'FAILED'].includes(currentTask.status) && (
        <div
          className="fe-minimized-floating-capsule"
          onClick={() => {
            setIsMinimized(false)
            setViewMode('execution')
          }}
          title="点击展开实时任务执行看板"
        >
          <div className="fe-capsule-spinner">
            <Icon name="sync" className="fe-spin" />
          </div>
          <div className="fe-capsule-info">
            <strong>正在自动完成 ({currentTask?.progress || 10}%)</strong>
            <small>{friendlyTaskStage(currentTask?.stage_label || currentTask?.stage_text)}</small>
          </div>
          <button
            type="button"
            className="fe-capsule-cancel-btn"
            title="终止任务"
            onClick={(e) => {
              e.stopPropagation()
              void handleCancelTask()
            }}
            disabled={isCancelling}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              padding: '4px 6px',
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 16,
            }}
          >
            <Icon name={isCancelling ? 'sync' : 'cancel'} className={isCancelling ? 'fe-spin' : ''} />
          </button>
          <button
            type="button"
            className="fe-capsule-expand-btn"
            title="展开实时执行看板"
            onClick={(e) => {
              e.stopPropagation()
              setIsMinimized(false)
              setViewMode('execution')
            }}
          >
            <Icon name="open_in_full" />
          </button>
        </div>
      )}
    </div>
  )
}

export default AutoCompletePage
