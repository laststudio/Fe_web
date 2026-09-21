import { apiRequest } from './auth'

export type PlatformAccountInfo = {
  bound: boolean
  account_display: string
  profile: Record<string, unknown> | null
  last_used_at: string | null
}

export type HomeworkContentItem = {
  group_name: string
  url: string
  download_url?: string
}

export type HomeworkItem = {
  id: string
  name: string
  subject_name?: string
  start_time?: string
  end_time?: string
  create_time?: string
  status?: string | number
  total_score?: number
  contents: HomeworkContentItem[]
  parsed?: boolean
  set_type?: number
  set_id?: string
  pk?: number
  kind?: string
  resource_id?: string
}

export type HomeworkListResponse = {
  status: string
  base_url: string
  homeworks: HomeworkItem[]
}

export type Question = {
  order: number
  sectionOrder: number
  sectionCaption: string
  typeName: string
  questionText: string
  answers: string[]
  options: string[]
  important: string[]
  category: string
  originalText: string
}

export type Section = {
  caption: string
  category: string
  typeName: string
  questions: Question[]
  originalContent?: unknown
}

export type Paper = {
  paperId: string
  title: string
  paperName: string
  regionLabel: string
  status: string
  totalQuestions: number
  sections: Section[]
}

export type ParseTaskStatus = 'PENDING' | 'EXTRACTING' | 'RESOLVING' | 'COMPLETED' | 'FAILED'

export type ParseTaskResponse = {
  task_id: string | null
  status: ParseTaskStatus
  progress?: number
  result?: Paper
  error?: string | null
}

export const FE_SHARE_SIGNATURE = 'Fe守护你的答案喵~ 官网:lastudio.cc'

export function cleanDisplayText(text: string, splitPipes = false): string {
  if (!text) return ''
  const pipeNormalized = splitPipes ? text.replace(/\|/g, '\n') : text
  return pipeNormalized
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>|<\/br>|<\/p>|<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u200B/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

export function cleanAnswerText(text: string): string {
  return cleanDisplayText(text, true)
}

export function formatPaperAsText(paper: Paper): string {
  const lines: string[] = [paper.title || paper.paperName || '作业答案', '']

  for (const section of paper.sections) {
    if (!section.questions || section.questions.length === 0) continue
    if (section.category === 'read_chapter' && !section.questions.some((q) => (q.answers && q.answers.length > 0) || q.questionText)) continue

    lines.push(section.caption || section.typeName || '题目')
    lines.push('')

    const isZhuanShu = (section.typeName && section.typeName.includes('转述')) || section.category === 'topic'
    const takeCount = isZhuanShu ? 1 : 2

    for (const q of section.questions) {
      const answers = (q.answers || []).slice(0, takeCount)
      const cleaned = answers.map((a) =>
        cleanAnswerText(a)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      )

      let answerText = isZhuanShu
        ? cleaned.flat().join(' ')
        : cleaned.map((parts) => parts.join(' ')).join('\n')

      if (!answerText.trim() && q.questionText) {
        answerText = cleanDisplayText(q.questionText)
      }

      lines.push(`Q${q.order}. ${answerText}`)
    }
    lines.push('')
  }

  lines.push(FE_SHARE_SIGNATURE)
  return lines.join('\n').trimEnd()
}

export function getPlatformAccount(accessToken: string, refresh?: boolean): Promise<PlatformAccountInfo> {
  const query = refresh ? '?refresh=1' : ''
  return apiRequest<PlatformAccountInfo>(`/homework/account${query}`, { accessToken })
}

export function getHomeworkList(
  accessToken: string,
  status: '1' | '2' | '3' = '1',
  capToken?: string,
  refresh?: boolean
): Promise<HomeworkListResponse> {
  const query = new URLSearchParams({ status })
  if (capToken) query.set('cap_token', capToken)
  if (refresh) query.set('refresh', '1')
  return apiRequest<HomeworkListResponse>(`/homework/list?${query.toString()}`, {
    accessToken,
    headers: capToken ? { 'X-Cap-Token': capToken } : undefined,
  })
}

export function startParseHomework(
  accessToken: string,
  payload: {
    homework_id: string
    homework_name: string
    contents: HomeworkContentItem[]
    resource_id?: string
    pk?: number
    set_type?: number
  }
): Promise<ParseTaskResponse> {
  return apiRequest<ParseTaskResponse>('/homework/parse', {
    accessToken,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function getTaskStatus(accessToken: string, taskId: string): Promise<ParseTaskResponse> {
  return apiRequest<ParseTaskResponse>(`/homework/tasks/${encodeURIComponent(taskId)}`, { accessToken })
}

export function getHomeworkDetail(accessToken: string, homeworkId: string): Promise<Paper> {
  return apiRequest<Paper>(`/homework/detail/${encodeURIComponent(homeworkId)}`, { accessToken })
}

export type SoftwareConfig = {
  latestVersionCode: number
  updateUrl: string
  isKillSwitchOn: boolean
  isForce: boolean
  updateMessage: string
  noticeMessage: string
  announcementTitle: string
  announcementMessage: string
  announcementUpdatedAt: string
  announcementUrl: string
  changelogUrl: string
  changelogTitle: string
  changelogSummary: string
  verificationCode: string
  verificationTitle: string
  verificationMessage: string
  donateEnabled: boolean
  integrityCheckEnabled: boolean
  features: Record<string, boolean>
}

export type SoftwareFeatureItem = {
  feature_key: string
  name: string
  description?: string
  status: 'enabled' | 'disabled'
  available_for_version: boolean
  reason: string | null
  requires_membership: boolean
  min_member_level: number
  min_member_tier?: string
  deny_message?: string | null
}

export function getSoftwareConfig(softwareKey = 'fe-web'): Promise<SoftwareConfig> {
  return apiRequest<SoftwareConfig>(`/software/${softwareKey}/config`)
}

export function getSoftwareFeatures(softwareKey = 'fe-web'): Promise<SoftwareFeatureItem[]> {
  return apiRequest<SoftwareFeatureItem[]>(`/software/${softwareKey}/features`)
}

export function trackFeatureUsage(
  accessToken: string,
  featureKey: string,
  action?: string,
  details?: Record<string, unknown>
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/homework/track', {
    accessToken,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feature_key: featureKey,
      action,
      details,
    }),
  }).catch((err) => {
    console.debug('Failed to track feature usage:', err)
    return { ok: false }
  })
}

