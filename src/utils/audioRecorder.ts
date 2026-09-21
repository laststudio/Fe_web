/**
 * AudioRecorder: Direct Web Audio PCM-to-WAV recorder with fallback to MediaRecorder.
 * Produces standard 16-bit mono RIFF WAV files universally compatible with all audio decoders and APIs.
 */

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // RIFF header
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')

  // "fmt " sub-chunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // SubChunk1Size for PCM
  view.setUint16(20, 1, true) // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true) // NumChannels = 1 (mono)
  view.setUint32(24, sampleRate, true) // SampleRate
  view.setUint32(28, sampleRate * 2, true) // ByteRate = SampleRate * NumChannels * BitsPerSample/8
  view.setUint16(32, 2, true) // BlockAlign = NumChannels * BitsPerSample/8
  view.setUint16(34, 16, true) // BitsPerSample = 16

  // "data" sub-chunk
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  // Write PCM samples
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export class AudioRecorder {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private mediaRecorder: MediaRecorder | null = null
  private pcmChunks: Float32Array[] = []
  private mediaRecorderChunks: Blob[] = []
  private isRecording = false
  private startTime = 0

  async start(onLevelChange?: (level: number) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持音频录制，或页面未处于安全上下文 (HTTPS/localhost)')
    }

    this.pcmChunks = []
    this.mediaRecorderChunks = []
    this.isRecording = true
    this.startTime = Date.now()

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    // Try Web Audio API for clean PCM recording
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass()
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume()
        }

        const source = this.audioContext.createMediaStreamSource(this.stream)
        const scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1)
        this.scriptNode = scriptNode

        scriptNode.onaudioprocess = (e) => {
          if (!this.isRecording) return
          const input = e.inputBuffer.getChannelData(0)
          this.pcmChunks.push(new Float32Array(input))

          if (onLevelChange) {
            let sum = 0
            const step = Math.max(1, Math.floor(input.length / 64))
            let count = 0
            for (let i = 0; i < input.length; i += step) {
              sum += input[i] * input[i]
              count++
            }
            const rms = Math.sqrt(sum / count)
            onLevelChange(Math.min(1, rms * 5))
          }
        }

        source.connect(scriptNode)
        scriptNode.connect(this.audioContext.destination)
        return
      }
    } catch {
      // Fallback to MediaRecorder
    }

    // Fallback: MediaRecorder
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''
      const recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream)
      this.mediaRecorder = recorder

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.mediaRecorderChunks.push(e.data)
        }
      }

      recorder.start(100)
    } catch (err) {
      this.cleanup()
      throw err
    }
  }

  async stop(): Promise<{ blob: Blob; duration: number }> {
    this.isRecording = false
    const duration = Math.max(0.1, (Date.now() - this.startTime) / 1000)

    // If Web Audio was used
    if (this.audioContext && this.pcmChunks.length > 0) {
      const sampleRate = this.audioContext.sampleRate
      let totalLength = 0
      for (const chunk of this.pcmChunks) {
        totalLength += chunk.length
      }

      const merged = new Float32Array(totalLength)
      let offset = 0
      for (const chunk of this.pcmChunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      const blob = encodeWav(merged, sampleRate)
      this.cleanup()
      return { blob, duration }
    }

    // If MediaRecorder was used
    if (this.mediaRecorder) {
      const recorder = this.mediaRecorder
      return new Promise((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(this.mediaRecorderChunks, {
            type: recorder.mimeType || 'audio/webm',
          })
          this.cleanup()
          resolve({ blob, duration })
        }
        if (recorder.state === 'recording') {
          recorder.stop()
        } else {
          const blob = new Blob(this.mediaRecorderChunks, {
            type: recorder.mimeType || 'audio/webm',
          })
          this.cleanup()
          resolve({ blob, duration })
        }
      })
    }

    this.cleanup()
    throw new Error('未采集到任何音频数据')
  }

  cancel(): void {
    this.isRecording = false
    this.cleanup()
  }

  private cleanup(): void {
    this.isRecording = false
    if (this.scriptNode) {
      try {
        this.scriptNode.disconnect()
      } catch {
        // ignore
      }
      this.scriptNode = null
    }
    if (this.audioContext) {
      try {
        void this.audioContext.close()
      } catch {
        // ignore
      }
      this.audioContext = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // ignore
        }
      })
      this.stream = null
    }
    this.mediaRecorder = null
    this.pcmChunks = []
    this.mediaRecorderChunks = []
  }
}
