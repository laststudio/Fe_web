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

export function getUsers(accessToken: string) {
  return apiRequest<User[]>('/admin/get_user_list', authorized(accessToken))
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
  return apiRequest<UserRecord[]>('/admin/get_user_records', authorized(accessToken))
}

export function getCards(accessToken: string) {
  return apiRequest<AdminCard[]>('/admin/cards', authorized(accessToken))
}

export function generateCards(accessToken: string, input: CardBatchInput) {
  return apiRequest<{ count: number; cards: AdminCard[] }>('/admin/cards/generate', jsonRequest(accessToken, 'POST', input))
}

export function disableCard(accessToken: string, cardId: number) {
  return apiRequest<{ message: string; id: number }>(`/admin/cards/${cardId}/disable`, authorized(accessToken, { method: 'POST' }))
}

export function getCardRequests(accessToken: string) {
  return apiRequest<CardRequest[]>('/card_requests', authorized(accessToken))
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
