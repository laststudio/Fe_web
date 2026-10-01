import { apiRequest } from './auth'

export type AutoCompleteMode = 'auto' | 'manual'
export type AutoCompleteVoiceMode = 'clone' | 'none'

export type AutoCompletePermitResponse = {
  permit_token: string
  expires_in?: number
}

export type QuestionTaskDetail = {
  order: number
  section_order?: number
  type_name?: string
  text?: string
  awarded_score: number
  max_score: number
  audio_url?: string
  status?: string
}

export type StartAutoCompletePayload = {
  homework_id: string
  homework_name: string
  resource_id?: string
  set_id?: string
  set_type?: number
  status?: string
  /** 前端按小题满分累加得到的卷面总分，用于后端核对两端分母是否一致 */
  paper_total?: number
  /** 用户设定的目标得分率（0-1）；后端以它为契约反推目标分，避免两端卷面口径差异 */
  target_ratio?: number
  /** 前端展示用的逐题满分（题号 -> 满分），仅用于后端核对两端题分口径 */
  question_maxes?: Record<string, number>
  /** 用时来源：recommended=用后端实测构成，manual=用用户填写的时长 */
  use_time_source?: 'recommended' | 'manual'
  mode: AutoCompleteMode
  target_total: number
  allow_over_max: boolean
  use_time: number
  voice_mode: AutoCompleteVoiceMode
  /** 仅 voice_mode==='clone' 时有意义：用哪个声音样本做参考音 */
  voice_id?: string
  per_question_scores?: Record<number, number | { total: number }>
  per_question_audio?: Record<string | number, string>
  permit_token: string
  disclaimer_text: string
}

export type AutoCompleteTaskStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PREPARING'
  | 'EXTRACTING'
  | 'SYNTHESIZING'
  | 'SUBMITTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | string

export type AutoCompleteTaskResult = {
  score?: number
  final_score?: number
  max_score?: number
  total_point?: number
  score_rate?: number
  /** 后端结算时实际采用的目标分 */
  target_total?: number | null
  /** 后端结算时实际采用的卷面总分（由小题满分累加） */
  paper_total?: number
  /** 前端上报的卷面总分，用于核对两端分母是否一致 */
  client_paper_total?: number | null
  /** 官方回读到的分数，用于核对提交是否真的生效 */
  official_point?: number | null
  /** 官方自己记录的用时（秒），用于核对"客户端显示用时"来源 */
  official_use_time?: number | null
  /** 官方记录的提交时刻 */
  official_submit_time?: string | null
  /** 我们上报给官方的 use_time（秒） */
  reported_use_time?: number | null
  /** 服务端真实耗时（秒） */
  real_elapsed_seconds?: number | null
  use_time: number
  homework_id?: string
  homework_name?: string
  completed_at?: string
  verified_url?: string
  question_details?: QuestionTaskDetail[]
  raw_response?: Record<string, unknown>
}

export type AutoCompleteTaskResponse = {
  task_id: string
  status: AutoCompleteTaskStatus
  progress: number
  stage_text?: string
  stage_label?: string
  homework_id?: string
  homework_name?: string
  mode?: string
  voice_mode?: string
  created_at?: number
  current_question_index?: number
  total_questions?: number
  current_question_text?: string
  question_results?: QuestionTaskDetail[]
  result?: AutoCompleteTaskResult | null
  error?: string | null
  target_use_time?: number
  current_elapsed_seconds?: number
  /** 排队位置（1 = 下一个就是它）；不在队列里为 0 或缺省 */
  queue_position?: number
  /** 当前等待队列总长度 */
  queue_size?: number
}

export function getAutoCompletePermit(
  accessToken: string,
  homeworkId: string,
  capToken?: string
): Promise<AutoCompletePermitResponse> {
  return apiRequest<AutoCompletePermitResponse>('/homework/auto-complete/permit', {
    accessToken,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(capToken ? { 'X-Cap-Token': capToken } : {}),
    },
    body: JSON.stringify({
      homework_id: homeworkId,
      cap_token: capToken,
    }),
  })
}

export type StartAutoCompleteResponse = {
  task_id: string
  /** 并发已满时会直接是 QUEUED（此时任务还没开始跑） */
  status?: AutoCompleteTaskStatus
  queue_position?: number
  queue_size?: number
}

export function startAutoComplete(
  accessToken: string,
  payload: StartAutoCompletePayload
): Promise<StartAutoCompleteResponse> {
  return apiRequest<StartAutoCompleteResponse>('/homework/auto-complete', {
    accessToken,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function getAutoCompleteTaskStatus(
  accessToken: string,
  taskId: string
): Promise<AutoCompleteTaskResponse> {
  return apiRequest<AutoCompleteTaskResponse>(
    `/homework/auto-complete/tasks/${encodeURIComponent(taskId)}`,
    { accessToken }
  )
}

export function getLatestAutoCompleteTask(
  accessToken: string
): Promise<{ task: AutoCompleteTaskResponse | null }> {
  return apiRequest<{ task: AutoCompleteTaskResponse | null }>(
    '/homework/auto-complete/latest-task',
    { accessToken }
  )
}

export function getAutoCompleteTasks(
  accessToken: string
): Promise<{ tasks: AutoCompleteTaskResponse[] }> {
  return apiRequest<{ tasks: AutoCompleteTaskResponse[] }>(
    '/homework/auto-complete/tasks',
    { accessToken }
  )
}

export function cancelAutoCompleteTask(
  accessToken: string,
  taskId: string
): Promise<{ success: boolean; task?: AutoCompleteTaskResponse; message?: string }> {
  return apiRequest<{ success: boolean; task?: AutoCompleteTaskResponse; message?: string }>(
    `/homework/auto-complete/tasks/${encodeURIComponent(taskId)}/cancel`,
    {
      method: 'POST',
      accessToken,
    }
  )
}

import type { HomeworkItem, Paper } from './homework'

export const SUPPORTED_QUESTION_TYPES = [
  'read_sentence',
  'read_chapter',
  'collector.read',
  'collector.choose',
  'choose',
  'collector.role',
  'collector.3q5a',
  'collector.dialogue',
  'collector.word',
  'word.read',
  'word.choice',
  'word_question',
  'repeat',
]

export const UNSUPPORTED_KEYWORD_PATTERNS = [
  { pattern: /作文|composition/i, name: '英语作文' },
  { pattern: /拼写|听写|write|dictation/i, name: '单词拼写/听写' },
]

export function checkHomeworkCompatibility(
  homework: HomeworkItem,
  paper?: Paper | null
): { supported: boolean; reason?: string; unsupportedList: string[] } {
  const unsupportedList: string[] = []

  const hw = homework as { kind?: string; set_type?: number; name?: string }
  // 1. 检查作业类型是否属于词汇/PK（set_type=6），这类作业走的是词汇通道而非听说通道
  // 注意：kind === 'mock' / set_type === 1 的听说模拟卷已改为放行，
  // 由后端 runner 通过 /m/exam/struct 探测 combination_id 后走官方模拟考提交通道，前端不再提前拦截。
  if (hw.set_type === 6) {
    return {
      supported: false,
      reason: '该作业属于词汇/PK 类作业（含单词对战与默写校验），暂未开放自动完成。',
      unsupportedList: ['词汇/PK 作业'],
    }
  }

  // 2. 如果已有试卷结构，检查各个题型
  if (paper && Array.isArray(paper.sections) && paper.sections.length > 0) {
    for (const sec of paper.sections) {
      if (!sec) continue
      const secType = String(sec.typeName || sec.category || '').toLowerCase()
      for (const rule of UNSUPPORTED_KEYWORD_PATTERNS) {
        if (rule.pattern.test(secType) && !unsupportedList.includes(rule.name)) {
          unsupportedList.push(rule.name)
        }
      }

      if (Array.isArray(sec.questions)) {
        for (const q of sec.questions) {
          if (!q) continue
          const qType = String(q.typeName || q.category || '').toLowerCase()
          for (const rule of UNSUPPORTED_KEYWORD_PATTERNS) {
            if (rule.pattern.test(qType) && !unsupportedList.includes(rule.name)) {
              unsupportedList.push(rule.name)
            }
          }
        }
      }
    }

    if (unsupportedList.length > 0) {
      return {
        supported: false,
        reason: `该作业包含当前版本未适配的题型（${unsupportedList.join('、')}），暂未开放自动完成以保障成绩安全。`,
        unsupportedList,
      }
    }
  }

  // 3. 检查作业名称与资源名称中是否有明确的未支持特征
  const hwName = String(homework?.name || '').toLowerCase()
  for (const rule of UNSUPPORTED_KEYWORD_PATTERNS) {
    if (rule.pattern.test(hwName) && !unsupportedList.includes(rule.name)) {
      unsupportedList.push(rule.name)
    }
  }

  if (unsupportedList.length > 0) {
    return {
      supported: false,
      reason: `该作业包含当前版本未适配的题型（${unsupportedList.join('、')}），暂未开放自动完成。`,
      unsupportedList,
    }
  }

  return { supported: true, unsupportedList: [] }
}
