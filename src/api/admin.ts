import { apiRequest, type User } from './auth'

export type UserRecord = {
  id: number
  time: string
  records: string
  target_id: number
  action: string
  target_type: string
  admin_id: number
  user_name: string
  admin_name: string
}

export type AdminCard = {
  id: number
  code: string
  member_level: number
  valid_days: number
  status: 'unused' | 'used' | 'disabled' | string
  owner_id: number
  used_by: number | null
  used_time: string | null
  create_time: string
}

export type CardRequest = {
  id: number
  agent_id: number
  member_level: number
  valid_days: number
  count: number
  status: 'pending' | 'approved' | 'rejected' | string
  reviewed_by: number | null
  review_time: string | null
  create_time: string
}

export type CardBatchInput = {
  member_level: number
  valid_days: number
  count: number
}

function authorized(accessToken: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  return { ...init, headers }
}

function jsonRequest(accessToken: string, method: string, body: unknown): RequestInit {
  return authorized(accessToken, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getAllPages<T extends { id: number }>(accessToken: string, path: string) {
  const items: T[] = []
  let beforeId: number | undefined

  do {
    const params = new URLSearchParams({ limit: '100' })
    if (beforeId !== undefined) params.set('before_id', String(beforeId))
    const page = await apiRequest<T[]>(`${path}?${params}`, authorized(accessToken))
    items.push(...page)
    beforeId = page.length === 100 ? page.at(-1)?.id : undefined
  } while (beforeId !== undefined)

  return items
}

export function getUsers(accessToken: string) {
  return getAllPages<User>(accessToken, '/admin/get_user_list')
}

export function createUser(accessToken: string, username: string, password: string) {
  return apiRequest<User>('/admin/create_user', jsonRequest(accessToken, 'POST', { username, passwd: password }))
}

export function deleteUser(accessToken: string, id: number) {
  return apiRequest<{ message: string }>('/admin/del_user', jsonRequest(accessToken, 'POST', { id }))
}

export function changeUserRole(accessToken: string, id: number, role: number) {
  return apiRequest<User>('/admin/change_user_role', jsonRequest(accessToken, 'POST', { id, target_role: role }))
}

export function changeUserLevel(accessToken: string, id: number, level: number, expireTime: string) {
  return apiRequest<User>('/admin/change_user_level', jsonRequest(accessToken, 'POST', {
    id,
    target_level: level,
    expire_time: expireTime,
  }))
}

export function changeUserPassword(accessToken: string, id: number, password: string) {
  return apiRequest<{ id: number; name: string }>('/admin/change_password', jsonRequest(accessToken, 'POST', { id, passwd: password }))
}

export function getUserRecords(accessToken: string) {
  return getAllPages<UserRecord>(accessToken, '/admin/get_user_records')
}

export function getCards(accessToken: string) {
  return getAllPages<AdminCard>(accessToken, '/admin/cards')
}

export function generateCards(accessToken: string, input: CardBatchInput) {
  return apiRequest<{ count: number; cards: AdminCard[] }>('/admin/cards/generate', jsonRequest(accessToken, 'POST', input))
}

export function disableCard(accessToken: string, cardId: number) {
  return apiRequest<{ message: string; id: number }>(`/admin/cards/${cardId}/disable`, authorized(accessToken, { method: 'POST' }))
}

export function getCardRequests(accessToken: string) {
  return getAllPages<CardRequest>(accessToken, '/card_requests')
}

export function applyForCards(accessToken: string, input: CardBatchInput) {
  return apiRequest<CardRequest>('/agent/card_requests', jsonRequest(accessToken, 'POST', input))
}

export function reviewCardRequest(accessToken: string, requestId: number, approved: boolean) {
  return apiRequest<{ request: CardRequest; cards: AdminCard[] }>(
    `/admin/card_requests/${requestId}/review`,
    jsonRequest(accessToken, 'POST', { approved }),
  )
}
