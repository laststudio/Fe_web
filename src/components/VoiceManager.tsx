import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  deleteVoice,
  getVoiceAudioUrl,
  getVoiceClonePreview,
  getVoices,
  setDefaultVoice,
  uploadVoice,
  type VoiceProfile,
} from '../api/voice'
import { AudioRecorder } from '../utils/audioRecorder'

const SAMPLE_TEXT =
  '生活就像海洋，只有意志坚强的人，才能到达彼岸。\nThis is an apple. I like apples. Apples are good for our health.'

export function VoiceManager({
  accessToken,
  onToast,
}: {
  accessToken: string
  onToast?: (msg: string) => void
}) {
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Audio preview for existing voices
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  // Cloned voice preview state
  const [cloningVoiceId, setCloningVoiceId] = useState<string | null>(null)
  const [playingClonedId, setPlayingClonedId] = useState<string | null>(null)
  const cloneAudioRef = useRef<HTMLAudioElement | null>(null)

  // Studio tabs: 'mic' | 'upload'
  const isSecure = typeof window !== 'undefined' ? (window.isSecureContext ?? true) : true
  const hasMicSupport = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const [studioMode, setStudioMode] = useState<'mic' | 'upload'>(
    !isSecure || !hasMicSupport ? 'upload' : 'mic'
  )

  const isAtLimit = voices.length >= 3

  // Recording studio state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedDuration, setRecordedDuration] = useState<number>(0)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [isPlayingRecorded, setIsPlayingRecorded] = useState(false)
  const [voiceName, setVoiceName] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)

  const recorderRef = useRef<AudioRecorder | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const studioAudioRef = useRef<HTMLAudioElement | null>(null)

  // Local file upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadFileDuration, setUploadFileDuration] = useState<number | null>(null)
  const [uploadFileUrl, setUploadFileUrl] = useState<string | null>(null)
  const [uploadVoiceName, setUploadVoiceName] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const [isPlayingUploadFile, setIsPlayingUploadFile] = useState(false)
  const uploadAudioRef = useRef<HTMLAudioElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const loadVoices = async () => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const list = await getVoices(accessToken)
      setVoices(Array.isArray(list) ? list : [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取声音列表失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    if (!accessToken) return

    getVoices(accessToken)
      .then((list) => {
        if (active) {
          setVoices(Array.isArray(list) ? list : [])
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : '获取声音列表失败')
          setLoading(false)
        }
      })

    return () => {
      active = false
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current = null
      }
      if (studioAudioRef.current) {
        studioAudioRef.current.pause()
        studioAudioRef.current = null
      }
      if (cloneAudioRef.current) {
        cloneAudioRef.current.pause()
        cloneAudioRef.current = null
      }
      if (uploadAudioRef.current) {
        uploadAudioRef.current.pause()
        uploadAudioRef.current = null
      }
      if (recorderRef.current) {
        recorderRef.current.cancel()
      }
    }
  }, [accessToken])

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
      if (uploadFileUrl) URL.revokeObjectURL(uploadFileUrl)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [recordedUrl, uploadFileUrl])

  const handleTogglePlay = (voiceId: string) => {
    if (playingVoiceId === voiceId) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
      }
      setPlayingVoiceId(null)
      return
    }

    if (cloneAudioRef.current) {
      cloneAudioRef.current.pause()
      setPlayingClonedId(null)
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
    }

    const audioUrl = getVoiceAudioUrl(voiceId, accessToken)
    const audio = new Audio(audioUrl)
    previewAudioRef.current = audio
    setPlayingVoiceId(voiceId)

    audio.onended = () => {
      setPlayingVoiceId(null)
    }
    audio.onerror = () => {
      setPlayingVoiceId(null)
      onToast?.('音频播放失败，请检查文件是否存在或权限是否有效')
    }
    audio.play().catch(() => {
      setPlayingVoiceId(null)
      onToast?.('音频播放被浏览器阻止或无法加载')
    })
  }

  const handleToggleClonePreview = async (voice: VoiceProfile) => {
    if (playingClonedId === voice.id) {
      if (cloneAudioRef.current) {
        cloneAudioRef.current.pause()
      }
      setPlayingClonedId(null)
      return
    }

    if (cloneAudioRef.current) {
      cloneAudioRef.current.pause()
      cloneAudioRef.current = null
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      setPlayingVoiceId(null)
    }

    setCloningVoiceId(voice.id)
    try {
      const blob = await getVoiceClonePreview(accessToken, voice.id)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      cloneAudioRef.current = audio
      setPlayingClonedId(voice.id)

      audio.onended = () => {
        setPlayingClonedId(null)
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        setPlayingClonedId(null)
        URL.revokeObjectURL(url)
        onToast?.('克隆试听播放失败')
      }
      await audio.play()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '声音克隆试听生成失败'
      onToast?.(msg)
    } finally {
      setCloningVoiceId(null)
    }
  }

  const handleSetDefault = async (voiceId: string) => {
    try {
      await setDefaultVoice(accessToken, voiceId)
      onToast?.('已将该音色设为默认')
      await loadVoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '设置默认声音失败'
      onToast?.(msg)
    }
  }

  const handleDelete = async (voiceId: string, name: string) => {
    if (!window.confirm(`确定要删除声音「${name}」吗？删除后将无法恢复。`)) return
    try {
      if (playingVoiceId === voiceId && previewAudioRef.current) {
        previewAudioRef.current.pause()
        setPlayingVoiceId(null)
      }
      await deleteVoice(accessToken, voiceId)
      onToast?.('声音已成功删除')
      await loadVoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除声音失败'
      onToast?.(msg)
    }
  }

  // --- Online Mic Recording Controls ---

  const startRecording = async () => {
    if (isAtLimit) {
      onToast?.('每个账号最多保存 3 个声音样本，请先删除已有声音')
      return
    }

    setRecordError(null)
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl)
      setRecordedUrl(null)
      setRecordedBlob(null)
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordError(
        '当前浏览器不支持麦克风录音，或未处于安全上下文 (HTTPS 或安全源)。请切换至上方「本地上传」直接上传音频。'
      )
      return
    }

    try {
      const recorder = new AudioRecorder()
      recorderRef.current = recorder

      await recorder.start((level) => {
        setAudioLevel(level)
      })

      setIsRecording(true)
      setRecordingSeconds(0)

      let sec = 0
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      recordTimerRef.current = window.setInterval(() => {
        sec += 1
        setRecordingSeconds(sec)
        if (sec >= 30) {
          void stopRecording()
        }
      }, 1000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '无法访问麦克风设备'
      setRecordError(`麦克风启动异常: ${msg}。若无法解决，建议使用「本地上传」方式。`)
      setIsRecording(false)
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current)
        recordTimerRef.current = null
      }
    }
  }

  const stopRecording = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }

    if (!recorderRef.current) return

    try {
      const { blob, duration } = await recorderRef.current.stop()
      if (duration < 2.8) {
        setRecordError(`录音时长仅 ${duration.toFixed(1)} 秒，系统要求至少需录制 3 秒，请重新录制。`)
        setIsRecording(false)
        return
      }

      const url = URL.createObjectURL(blob)
      setRecordedBlob(blob)
      setRecordedDuration(duration)
      setRecordedUrl(url)
      setIsRecording(false)

      const now = new Date()
      const defaultName = `我的原声_${now.getMonth() + 1}${now.getDate()}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
      setVoiceName(defaultName)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '录音数据获取失败'
      setRecordError(msg)
      setIsRecording(false)
    } finally {
      recorderRef.current = null
      setAudioLevel(0)
    }
  }

  const cancelRecording = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    if (recorderRef.current) {
      recorderRef.current.cancel()
      recorderRef.current = null
    }
    setIsRecording(false)
    setRecordingSeconds(0)
    setAudioLevel(0)
    setRecordError(null)
  }

  const togglePlayRecorded = () => {
    if (!recordedUrl) return
    if (isPlayingRecorded) {
      if (studioAudioRef.current) studioAudioRef.current.pause()
      setIsPlayingRecorded(false)
      return
    }

    const audio = new Audio(recordedUrl)
    studioAudioRef.current = audio
    setIsPlayingRecorded(true)
    audio.onended = () => setIsPlayingRecorded(false)
    audio.onerror = () => {
      setIsPlayingRecorded(false)
      onToast?.('无法试听录音')
    }
    audio.play().catch(() => setIsPlayingRecorded(false))
  }

  const handleUploadRecorded = async () => {
    if (!recordedBlob) return
    if (isAtLimit) {
      onToast?.('每个账号最多保存 3 个声音样本，请先删除旧声音后再保存')
      return
    }

    const finalName = voiceName.trim() || `我的原声_${Date.now().toString().slice(-4)}`
    setIsUploading(true)
    try {
      await uploadVoice(accessToken, recordedBlob, finalName)
      onToast?.('声音上传并保存成功！已加入您的克隆声音资产库')
      // Reset studio recording
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
      setRecordedBlob(null)
      setRecordedUrl(null)
      setVoiceName('')
      await loadVoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '声音上传失败'
      setRecordError(msg)
      onToast?.(msg)
    } finally {
      setIsUploading(false)
    }
  }

  // --- Local File Upload Controls ---

  const processSelectedFile = (file: File) => {
    if (isAtLimit) {
      setUploadError('当前账号已达到 3 个声音上限，请先在上方资产库中删除旧声音后再上传。')
      return
    }

    setUploadError(null)
    if (uploadFileUrl) {
      URL.revokeObjectURL(uploadFileUrl)
      setUploadFileUrl(null)
    }
    setUploadFile(null)
    setUploadFileDuration(null)

    // Check size limit: 5MB
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(`文件大小为 ${(file.size / (1024 * 1024)).toFixed(1)}MB，不能超过 5MB`)
      return
    }

    const url = URL.createObjectURL(file)
    const audio = new Audio(url)

    audio.onloadedmetadata = () => {
      const dur = audio.duration
      if (!dur || isNaN(dur)) {
        // Fallback if browser can't read duration directly
        setUploadFile(file)
        setUploadFileUrl(url)
        setUploadVoiceName(file.name.replace(/\.[^/.]+$/, '').slice(0, 30))
        return
      }

      if (dur < 2.9) {
        setUploadError(`音频时长过短（仅 ${dur.toFixed(1)} 秒），声音克隆要求至少 3 秒`)
        URL.revokeObjectURL(url)
        return
      }
      if (dur > 30.5) {
        setUploadError(`音频时长过长（${dur.toFixed(1)} 秒），声音克隆要求在 30 秒以内，请裁剪后上传`)
        URL.revokeObjectURL(url)
        return
      }

      setUploadFile(file)
      setUploadFileDuration(dur)
      setUploadFileUrl(url)
      setUploadVoiceName(file.name.replace(/\.[^/.]+$/, '').slice(0, 30))
    }

    audio.onerror = () => {
      // Browser couldn't decode metadata directly, still allow upload as backend ffmpeg will transcode
      setUploadFile(file)
      setUploadFileUrl(url)
      setUploadVoiceName(file.name.replace(/\.[^/.]+$/, '').slice(0, 30))
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processSelectedFile(file)
    }
  }

  const handleTogglePlayUploadFile = () => {
    if (!uploadFileUrl) return
    if (isPlayingUploadFile) {
      if (uploadAudioRef.current) uploadAudioRef.current.pause()
      setIsPlayingUploadFile(false)
      return
    }

    const audio = new Audio(uploadFileUrl)
    uploadAudioRef.current = audio
    setIsPlayingUploadFile(true)
    audio.onended = () => setIsPlayingUploadFile(false)
    audio.onerror = () => {
      setIsPlayingUploadFile(false)
      onToast?.('无法试听该文件')
    }
    audio.play().catch(() => setIsPlayingUploadFile(false))
  }

  const handleSaveUploadedFile = async () => {
    if (!uploadFile) return
    if (isAtLimit) {
      onToast?.('每个账号最多保存 3 个声音样本，请先删除旧声音后再保存')
      return
    }

    const finalName = uploadVoiceName.trim() || uploadFile.name.replace(/\.[^/.]+$/, '').slice(0, 30) || '本地导入原声'
    setIsUploadingFile(true)
    try {
      await uploadVoice(accessToken, uploadFile, finalName)
      onToast?.('音频文件上传成功！已加入您的克隆声音资产库')
      if (uploadFileUrl) URL.revokeObjectURL(uploadFileUrl)
      setUploadFile(null)
      setUploadFileUrl(null)
      setUploadFileDuration(null)
      setUploadVoiceName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadVoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '音频文件上传失败'
      setUploadError(msg)
      onToast?.(msg)
    } finally {
      setIsUploadingFile(false)
    }
  }

  return (
    <div className="fe-voice-manager-section">
      {/* 1. Existing Voices Card */}
      <section className="admin-policy-card fe-voice-card">
        <div className="admin-policy-card-head">
          <div className="fe-voice-head-icon">
            <Icon name="record_voice_over" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h3>我的克隆声音资产库</h3>
                <span
                  className={`admin-pill-badge ${isAtLimit ? 'is-warning' : 'is-success'}`}
                  title="每个账号最多可保存 3 个声音样本"
                >
                  已用 {voices.length} / 3
                </span>
              </div>
              <button
                type="button"
                className="control-icon-button"
                onClick={loadVoices}
                disabled={loading}
                title="刷新声音列表"
              >
                <Icon name="refresh" className={loading ? 'fe-spin' : ''} />
              </button>
            </div>
            <p>已录制或上传并同步至云端的声音样本，每个账号最多保留 3 个，可用于 tts.ai 高拟真自动朗读答题</p>
          </div>
        </div>

        {error && (
          <div className="admin-status-strip is-danger" style={{ margin: '0 20px 16px' }}>
            <Icon name="error" />
            <span>{error}</span>
          </div>
        )}

        {isAtLimit && (
          <div className="admin-status-strip is-warning" style={{ margin: '0 20px 14px' }}>
            <Icon name="info" />
            <span>当前账号已达到 3 个声音样本的保存上限（3/3）。如需录制新声音或上传新音频，请先删除不需要的旧声音。</span>
          </div>
        )}

        <div className="fe-voice-list">
          {loading && voices.length === 0 ? (
            <div className="fe-voice-empty">
              <Icon name="sync" className="fe-spin" />
              <span>正在获取声音列表...</span>
            </div>
          ) : voices.length === 0 ? (
            <div className="fe-voice-empty">
              <Icon name="mic_none" />
              <p>暂无已录制声音样本</p>
              <small>请在下方「声音采集棚」录制一段 3~30 秒语音或直接上传音频，开启专属音色克隆（上限 3 个）。</small>
            </div>
          ) : (
            voices.map((voice) => {
              const isPlaying = playingVoiceId === voice.id
              return (
                <div key={voice.id} className={`fe-voice-item ${voice.is_default ? 'is-default' : ''}`}>
                  <div className="fe-voice-item-left">
                    <button
                      type="button"
                      className={`fe-voice-play-btn ${isPlaying ? 'is-playing' : ''}`}
                      onClick={() => handleTogglePlay(voice.id)}
                      title={isPlaying ? '暂停试听' : '试听声音'}
                    >
                      <Icon name={isPlaying ? 'pause' : 'play_arrow'} />
                    </button>
                    <div className="fe-voice-item-meta">
                      <div className="fe-voice-title-row">
                        <strong>{voice.name}</strong>
                        {voice.is_default && (
                          <span className="admin-pill-badge is-success">默认音色</span>
                        )}
                      </div>
                      <span className="fe-voice-subtitle">
                        {voice.duration ? `${Math.round(voice.duration)} 秒` : '约 10 秒'} ·{' '}
                        {voice.format ? voice.format.toUpperCase() : 'WAV'} ·{' '}
                        {voice.created_at ? new Date(voice.created_at).toLocaleDateString() : '近期录制'}
                      </span>
                    </div>
                  </div>

                  <div className="fe-voice-item-actions">
                    <button
                      type="button"
                      className="control-secondary fe-voice-action-btn"
                      onClick={() => handleToggleClonePreview(voice)}
                      disabled={cloningVoiceId === voice.id}
                      title="使用 tts.ai 试听基于此录音克隆出的朗读发音效果"
                      style={
                        playingClonedId === voice.id
                          ? {
                              borderColor: '#8b5cf6',
                              color: '#7c3aed',
                              background: '#f5f3ff',
                            }
                          : undefined
                      }
                    >
                      <Icon
                        name={
                          cloningVoiceId === voice.id
                            ? 'sync'
                            : playingClonedId === voice.id
                            ? 'pause'
                            : 'auto_awesome'
                        }
                        className={cloningVoiceId === voice.id ? 'fe-spin' : ''}
                      />
                      <span>
                        {cloningVoiceId === voice.id
                          ? '正在克隆...'
                          : playingClonedId === voice.id
                          ? '暂停克隆'
                          : '试听克隆效果'}
                      </span>
                    </button>
                    {!voice.is_default && (
                      <button
                        type="button"
                        className="control-secondary fe-voice-action-btn"
                        onClick={() => handleSetDefault(voice.id)}
                      >
                        <Icon name="star" />
                        <span>设为默认</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="control-secondary fe-voice-action-btn is-danger"
                      onClick={() => handleDelete(voice.id, voice.name)}
                      title="删除此声音"
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* 2. Recording & Upload Studio Card */}
      <section className="admin-policy-card fe-studio-card">
        <div className="admin-policy-card-head">
          <div className="fe-voice-head-icon is-studio">
            <Icon name="mic" />
          </div>
          <div>
            <h3>声音样本采集棚 (3~30秒录制或上传 · 每个账号上限3个)</h3>
            <p>朗读下方简单通用的示范英语或直接上传已有音频，每个账号最多保留 3 个音色样本</p>
          </div>
        </div>

        <div className="fe-studio-body">
          {/* Mode Switch Tabs */}
          <div className="fe-studio-tabs">
            <button
              type="button"
              className={`fe-studio-tab-btn ${studioMode === 'mic' ? 'is-active' : ''}`}
              onClick={() => {
                if (!isSecure && !hasMicSupport) {
                  onToast?.('当前非 HTTPS 环境，浏览器禁止麦克风调用，请使用本地上传')
                }
                setStudioMode('mic')
              }}
            >
              <Icon name="mic" />
              <span>麦克风在线录音 (3~30秒)</span>
            </button>
            <button
              type="button"
              className={`fe-studio-tab-btn ${studioMode === 'upload' ? 'is-active' : ''}`}
              onClick={() => setStudioMode('upload')}
            >
              <Icon name="cloud_upload" />
              <span>本地音频文件上传 (MP3 / WAV / M4A)</span>
            </button>
          </div>

          {/* Limit Reached Banner */}
          {isAtLimit && (
            <div className="admin-status-strip is-warning" style={{ marginBottom: 14 }}>
              <Icon name="warning" />
              <span>
                当前账号已达 3 个声音样本上限（3/3）。请先在上方资产库中删除旧声音后再录制或上传新音频。
              </span>
            </div>
          )}

          {/* Insecure Context Hint */}
          {(!isSecure || !hasMicSupport) && studioMode === 'mic' && (
            <div className="admin-status-strip is-warning" style={{ marginBottom: 14 }}>
              <Icon name="info" />
              <span>
                检测到当前页面未处于安全上下文（HTTPS 或安全源），浏览器限制了麦克风权限。建议直接切换至「本地音频文件上传」直接选择已有音频文件。
              </span>
            </div>
          )}

          {/* Sample Text Banner */}
          <div className="fe-studio-sample-box">
            <div className="fe-studio-sample-header">
              <span className="fe-studio-tag">朗读范本 (简单通用)</span>
              <small>请以自然语速、吐字清晰地朗读以下标准基础文本（录制 3~30 秒均可）：</small>
            </div>
            <blockquote className="fe-studio-text">
              “{SAMPLE_TEXT}”
            </blockquote>
          </div>

          {/* TAB 1: Microphone Recording */}
          {studioMode === 'mic' && (
            <div className="fe-studio-recorder-row">
              {recordError && (
                <div className="admin-status-strip is-danger" style={{ marginBottom: 14 }}>
                  <Icon name="warning" />
                  <span>{recordError}</span>
                </div>
              )}

              {isRecording ? (
                <div className="fe-studio-active-state">
                  <div className="fe-studio-pulse-ring">
                    <span className="fe-pulse-dot" />
                    <span className="fe-studio-countdown-num">
                      {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                      {String(recordingSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="fe-studio-recording-info">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong>
                        {recordingSeconds < 3
                          ? `正在录音中... (还需 ${3 - recordingSeconds} 秒达到有效时长)`
                          : '正在录音中... 朗读完毕可随时点击「完成录音」'}
                      </strong>
                      {/* Audio Level Equalizer Visualizer */}
                      <div className="fe-studio-visualizer" title="麦克风音量动态波形">
                        {[0.2, 0.5, 0.8, 1.0, 0.7, 0.4, 0.9, 0.6, 0.3].map((factor, idx) => {
                          const height = Math.max(4, Math.min(22, Math.round(audioLevel * 22 * factor + 4)))
                          return (
                            <span
                              key={idx}
                              className="fe-visualizer-bar"
                              style={{ height: `${height}px` }}
                            />
                          )
                        })}
                      </div>
                    </div>
                    <div className="fe-studio-progress-track">
                      <div
                        className="fe-studio-progress-fill"
                        style={{ width: `${(recordingSeconds / 30) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {recordingSeconds >= 3 ? (
                      <button
                        type="button"
                        className="control-primary is-success"
                        style={{ padding: '8px 16px', background: '#16a34a', borderColor: '#15803d' }}
                        onClick={() => void stopRecording()}
                      >
                        <Icon name="check" /> 完成录音 ({recordingSeconds}s)
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="control-secondary"
                        disabled
                        style={{ padding: '8px 14px', opacity: 0.6 }}
                      >
                        需录制满 3 秒
                      </button>
                    )}
                    <button
                      type="button"
                      className="control-secondary is-danger"
                      onClick={cancelRecording}
                    >
                      <Icon name="close" /> 取消
                    </button>
                  </div>
                </div>
              ) : recordedUrl ? (
                <div className="fe-studio-recorded-state">
                  <div className="fe-studio-preview-controls">
                    <button
                      type="button"
                      className="control-secondary"
                      onClick={togglePlayRecorded}
                    >
                      <Icon name={isPlayingRecorded ? 'pause' : 'play_arrow'} />
                      <span>{isPlayingRecorded ? '暂停试听' : `试听录音 (${recordedDuration.toFixed(1)}s)`}</span>
                    </button>
                    <button
                      type="button"
                      className="control-secondary"
                      onClick={startRecording}
                      disabled={isAtLimit}
                    >
                      <Icon name="replay" />
                      <span>重新录制</span>
                    </button>
                  </div>

                  <div className="fe-studio-save-form">
                    <input
                      type="text"
                      className="fe-studio-name-input"
                      placeholder="输入此音色名称，例如：我的原声 1"
                      value={voiceName}
                      onChange={(e) => setVoiceName(e.target.value)}
                      maxLength={30}
                    />
                    <button
                      type="button"
                      className="control-primary"
                      onClick={handleUploadRecorded}
                      disabled={isUploading || isAtLimit}
                      title={isAtLimit ? '已达每个账号上限 3/3，请先删除已有声音' : undefined}
                    >
                      <Icon name={isUploading ? 'sync' : 'cloud_upload'} className={isUploading ? 'fe-spin' : ''} />
                      <span>{isUploading ? '正在上传保存...' : isAtLimit ? '已达上限 (3/3)' : '保存至声音库'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="fe-studio-idle-state">
                  <button
                    type="button"
                    className="control-primary fe-studio-record-btn"
                    onClick={startRecording}
                    disabled={isAtLimit}
                    title={isAtLimit ? '已达每个账号上限 3/3，请先删除已有声音' : undefined}
                  >
                    <Icon name="mic" />
                    <span>{isAtLimit ? '已达 3 个声音上限' : '开始麦克风录音'}</span>
                  </button>
                  <span className="fe-studio-hint">
                    {isAtLimit
                      ? '每个账号最多保存 3 个声音样本，如需新录制请先删除已有声音。'
                      : '录制 3~30 秒的声音样本，浏览器将直接编码为无损高拟真 WAV 音频。'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Local File Upload */}
          {studioMode === 'upload' && (
            <div className="fe-studio-recorder-row">
              {uploadError && (
                <div className="admin-status-strip is-danger" style={{ marginBottom: 14 }}>
                  <Icon name="warning" />
                  <span>{uploadError}</span>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />

              {uploadFile ? (
                <div className="fe-upload-selected-card">
                  <div className="fe-upload-file-header">
                    <div className="fe-upload-file-info">
                      <Icon name="audio_file" style={{ fontSize: 24, color: '#16a34a' }} />
                      <div>
                        <strong>{uploadFile.name}</strong>
                        <span>
                          {(uploadFile.size / 1024).toFixed(0)} KB
                          {uploadFileDuration ? ` · 约 ${uploadFileDuration.toFixed(1)} 秒` : ''}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="control-secondary fe-btn-sm"
                        onClick={handleTogglePlayUploadFile}
                      >
                        <Icon name={isPlayingUploadFile ? 'pause' : 'play_arrow'} />
                        <span>{isPlayingUploadFile ? '暂停' : '试听'}</span>
                      </button>
                      <button
                        type="button"
                        className="control-secondary fe-btn-sm"
                        onClick={() => !isAtLimit && fileInputRef.current?.click()}
                        disabled={isAtLimit}
                      >
                        <Icon name="swap_horiz" />
                        <span>更换文件</span>
                      </button>
                    </div>
                  </div>

                  <div className="fe-studio-save-form">
                    <input
                      type="text"
                      className="fe-studio-name-input"
                      placeholder="设置声音名称"
                      value={uploadVoiceName}
                      onChange={(e) => setUploadVoiceName(e.target.value)}
                      maxLength={30}
                    />
                    <button
                      type="button"
                      className="control-primary"
                      onClick={handleSaveUploadedFile}
                      disabled={isUploadingFile || isAtLimit}
                      title={isAtLimit ? '已达每个账号上限 3/3，请先删除已有声音' : undefined}
                    >
                      <Icon name={isUploadingFile ? 'sync' : 'cloud_upload'} className={isUploadingFile ? 'fe-spin' : ''} />
                      <span>{isUploadingFile ? '正在上传保存...' : isAtLimit ? '已达上限 (3/3)' : '上传并保存至声音库'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`fe-upload-dropzone ${isDragging ? 'is-dragover' : ''}`}
                  onClick={() => {
                    if (isAtLimit) {
                      onToast?.('当前账号已达 3 个声音上限，请先删除旧声音')
                      return
                    }
                    fileInputRef.current?.click()
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!isAtLimit) setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    if (isAtLimit) {
                      onToast?.('当前账号已达 3 个声音上限，请先删除旧声音')
                      return
                    }
                    const file = e.dataTransfer.files?.[0]
                    if (file) processSelectedFile(file)
                  }}
                  style={isAtLimit ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                >
                  <div className="fe-upload-dropzone-icon">
                    <Icon name="cloud_upload" />
                  </div>
                  <div className="fe-upload-dropzone-title">
                    {isAtLimit ? '已达到每个账号 3 个声音上限' : '点击选择音频文件，或将音频拖拽至此处'}
                  </div>
                  <div className="fe-upload-dropzone-hint">
                    {isAtLimit
                      ? '每个账号最多保存 3 个声音样本，请先在上方资产库中删除已有声音后再上传新文件。'
                      : '支持 MP3, WAV, M4A, AAC, WebM, OGG 等常见格式；大小不超过 5MB；时长 3 ~ 30 秒（系统将自动转码并归一化为标准高拟真样本）。'}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default VoiceManager
