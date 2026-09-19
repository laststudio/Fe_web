import { apiRequest } from './auth'

export type AutoCompleteMode = 'auto' | 'manual'
export type AutoCompleteVoiceMode = 'clone' | 'edge' | 'none'

export type AutoCompletePermitResponse = {
  permit_token: string
  expires_in?: number
}

export type StartAutoCompletePayload = {
  homework_id: string
  homework_name: string
  mode: AutoCompleteMode
  target_total: number
  allow_over_max: boolean
  use_time: number
  voice_mode: AutoCompleteVoiceMode
  voice_id?: string
  per_question_scores?: Record<number, { total: number }>
  permit_token: string
  disclaimer_text: string
}

export type AutoCompleteTaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export type AutoCompleteTaskResult = {
  score: number
  max_score: number
  use_time: number
  homework_id: string
  homework_name?: string
  verified_url?: string
  raw_response?: Record<string, unknown>
}

export type AutoCompleteTaskResponse = {
  task_id: string
  status: AutoCompleteTaskStatus
  progress: number
  stage_text?: string
  current_question_text?: string
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
