import { apiRequest } from './auth'

export type AutoCompleteMode = 'auto' | 'manual'
export type AutoCompleteVoiceMode = 'clone' | 'edge' | 'none'

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
  mode: AutoCompleteMode
  target_total: number
  allow_over_max: boolean
  use_time: number
  voice_mode: AutoCompleteVoiceMode
  voice_id?: string
  per_question_scores?: Record<number, number | { total: number }>
  per_question_audio?: Record<string | number, string>
  permit_token: string
  disclaimer_text: string
}

export type AutoCompleteTaskStatus =
  | 'PENDING'
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

export function startAutoComplete(
  accessToken: string,
  payload: StartAutoCompletePayload
): Promise<{ task_id: string }> {
  return apiRequest<{ task_id: string }>('/homework/auto-complete', {
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
  // 1. 检查作业类型是否为考试/模拟考
  if (hw.kind === 'mock' || hw.set_type === 6) {
    return {
      supported: false,
      reason: '该作业属于考场模拟卷（含严格防作弊及考场ID校验），暂未开放自动完成。',
      unsupportedList: ['模拟考卷'],
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
