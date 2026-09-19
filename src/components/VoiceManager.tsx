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

const SAMPLE_TEXT =
  'The quick brown fox jumps over the lazy dog. Continuous learning and daily practice are the golden keys to mastering spoken English and unlocking endless new opportunities across the world.'

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

  // Recording studio state
  const [isRecording, setIsRecording] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [isPlayingRecorded, setIsPlayingRecorded] = useState(false)
  const [voiceName, setVoiceName] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const studioAudioRef = useRef<HTMLAudioElement | null>(null)

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
    }
  }, [accessToken])

  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl)
      }
    }
  }, [recordedUrl])

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

    const audioUrl = getVoiceAudioUrl(voiceId)
    const audio = new Audio(audioUrl)
    previewAudioRef.current = audio
    setPlayingVoiceId(voiceId)

    audio.onended = () => {
      setPlayingVoiceId(null)
    }
    audio.onerror = () => {
      setPlayingVoiceId(null)
      onToast?.('音频播放失败，请检查文件是否存在')
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

  // Recording controls
  const startRecording = async () => {
    setRecordError(null)
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl)
      setRecordedUrl(null)
      setRecordedBlob(null)
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordError('当前浏览器不支持音频录制或未开启 HTTPS 权限')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/wav' })
        const url = URL.createObjectURL(blob)
        setRecordedBlob(blob)
        setRecordedUrl(url)
        setIsRecording(false)
        if (!voiceName) {
          setVoiceName(`我的声音_${new Date().getMonth() + 1}${new Date().getDate()}`)
        }
      }

      recorder.start()
      setIsRecording(true)
      setCountdown(10)

      let timeLeft = 10
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = window.setInterval(() => {
        timeLeft -= 1
        setCountdown(timeLeft)
        if (timeLeft <= 0) {
          if (timerRef.current) clearInterval(timerRef.current)
          timerRef.current = null
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
        }
      }, 1000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '无法访问麦克风设备'
      setRecordError(`麦克风权限异常: ${msg}`)
      setIsRecording(false)
    }
  }

  const stopRecordingEarly = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
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
    const finalName = voiceName.trim() || `声音克隆_${Date.now().toString().slice(-4)}`
    setIsUploading(true)
    try {
      await uploadVoice(accessToken, recordedBlob, finalName)
      onToast?.('声音上传并保存成功！')
      // Reset studio
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
      setRecordedBlob(null)
      setRecordedUrl(null)
      setVoiceName('')
      await loadVoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '声音上传失败'
      onToast?.(msg)
    } finally {
      setIsUploading(false)
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
              <h3>我的克隆声音资产库</h3>
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
            <p>已录制并同步至云端的声音样本，可用于 tts.ai 高拟真自动朗读答题</p>
          </div>
        </div>

        {error && (
          <div className="admin-status-strip is-danger" style={{ margin: '0 20px 16px' }}>
            <Icon name="error" />
            <span>{error}</span>
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
              <small>请在下方「在线录音棚」录制一段 10 秒语音，开启专属音色克隆。</small>
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

      {/* 2. Online Recording Studio Card */}
      <section className="admin-policy-card fe-studio-card">
        <div className="admin-policy-card-head">
          <div className="fe-voice-head-icon is-studio">
            <Icon name="mic" />
          </div>
          <div>
            <h3>在线录音棚 (10秒样本采集)</h3>
            <p>朗读下方标准化 30 词英语文本，算法将提取您的发音音色、声学特征与共鸣腔</p>
          </div>
        </div>

        <div className="fe-studio-body">
          {/* Sample Text Banner */}
          <div className="fe-studio-sample-box">
            <div className="fe-studio-sample-header">
              <span className="fe-studio-tag">朗读范本 (30 词)</span>
              <small>请以自然语速、吐字清晰地朗读以下内容：</small>
            </div>
            <blockquote className="fe-studio-text">
              “{SAMPLE_TEXT}”
            </blockquote>
          </div>

          {recordError && (
            <div className="admin-status-strip is-danger" style={{ marginTop: 14 }}>
              <Icon name="warning" />
              <span>{recordError}</span>
            </div>
          )}

          {/* Recording Progress & Controls */}
          <div className="fe-studio-recorder-row">
            {isRecording ? (
              <div className="fe-studio-active-state">
                <div className="fe-studio-pulse-ring">
                  <span className="fe-pulse-dot" />
                  <span className="fe-studio-countdown-num">{countdown}s</span>
                </div>
                <div className="fe-studio-recording-info">
                  <strong>正在录音中... 请保持环境安静并朗读上方文本</strong>
                  <div className="fe-studio-progress-track">
                    <div
                      className="fe-studio-progress-fill"
                      style={{ width: `${((10 - countdown) / 10) * 100}%` }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="control-secondary is-danger"
                  onClick={stopRecordingEarly}
                >
                  <Icon name="stop" /> 提前完成
                </button>
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
                    <span>{isPlayingRecorded ? '暂停试听' : '试听录音 (10s)'}</span>
                  </button>
                  <button
                    type="button"
                    className="control-secondary"
                    onClick={startRecording}
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
                    maxLength={20}
                  />
                  <button
                    type="button"
                    className="control-primary"
                    onClick={handleUploadRecorded}
                    disabled={isUploading}
                  >
                    <Icon name={isUploading ? 'sync' : 'cloud_upload'} className={isUploading ? 'fe-spin' : ''} />
                    <span>{isUploading ? '正在上传保存...' : '保存至声音库'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="fe-studio-idle-state">
                <button
                  type="button"
                  className="control-primary fe-studio-record-btn"
                  onClick={startRecording}
                >
                  <Icon name="mic" />
                  <span>开始 10 秒录音</span>
                </button>
                <span className="fe-studio-hint">
                  点击后浏览器将请求麦克风权限，录音满 10 秒后自动生成试听。
                </span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default VoiceManager
