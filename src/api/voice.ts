import { apiBlobRequest, apiRequest } from './auth'
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

/**
 * 试听：用该声音样本做参考音合成一小段音频。
 *
 * 不再传 model —— 合成引擎由后台「TTS 提供商」的默认项决定，试听与正式任务
 * 走同一条链路（含 failover），所以试听结果就代表实际效果。
 */
export function getVoiceClonePreview(
  accessToken: string,
  voiceId: string,
  text?: string
): Promise<Blob> {
  return apiBlobRequest(`/user/voices/${encodeURIComponent(voiceId)}/clone-preview`, {
    accessToken,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text || undefined,
    }),
  })
}


