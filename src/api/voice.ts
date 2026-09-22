import { apiRequest } from './auth'
import { oauthConfig } from '../auth/config'

export type VoiceProfile = {
  id: string
  user_id?: number
  name: string
  file_path?: string
  duration?: number
  format?: string
  is_default: boolean
  created_at: string
}

export function getVoices(accessToken: string): Promise<VoiceProfile[]> {
  return apiRequest<VoiceProfile[]>('/user/voices', { accessToken })
}

export function uploadVoice(accessToken: string, file: Blob | File, name: string): Promise<VoiceProfile> {
  const formData = new FormData()
  formData.append('file', file, file instanceof File ? file.name : 'voice.wav')
  formData.append('name', name)

  return apiRequest<VoiceProfile>('/user/voices', {
    accessToken,
    method: 'POST',
    body: formData,
  })
}

export function deleteVoice(accessToken: string, voiceId: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/user/voices/${encodeURIComponent(voiceId)}`, {
    accessToken,
    method: 'DELETE',
  })
}

export function setDefaultVoice(accessToken: string, voiceId: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/user/voices/${encodeURIComponent(voiceId)}/default`, {
    accessToken,
    method: 'PATCH',
  })
}

export function getVoiceAudioUrl(voiceId: string, accessToken?: string): string {
  const base = `${oauthConfig.apiUrl}/user/voices/${encodeURIComponent(voiceId)}/audio`
  return accessToken ? `${base}?token=${encodeURIComponent(accessToken)}` : base
}

export async function getVoiceClonePreview(
  accessToken: string,
  voiceId: string,
  text?: string
): Promise<Blob> {
  const url = `${oauthConfig.apiUrl}/user/voices/${encodeURIComponent(voiceId)}/clone-preview`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: text || undefined }),
  })
  if (!res.ok) {
    let detail = '声音克隆试听生成失败'
    try {
      const data = await res.json()
      if (data.detail) detail = data.detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return await res.blob()
}

