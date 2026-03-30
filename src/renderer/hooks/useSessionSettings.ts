import { useCallback, useEffect, useRef, useState } from 'react'
import { bool } from './settingsCastUtils'
import type { UseAudioCaptureReturn } from './useAudioCapture'
import type { UseNoiseSuppressionReturn } from './useNoiseSuppression'
import { useNoiseSuppression } from './useNoiseSuppression'
import { useAudioCapture } from './useAudioCapture'

export interface SessionSettingsState {
  status: string
  setStatus: (v: string) => void
  isRunning: boolean
  setIsRunning: (v: boolean) => void
  isStarting: boolean
  setIsStarting: (v: boolean) => void
  sessionDuration: string
  sessions: Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>

  lastTranscriptPath: string | null
  setLastTranscriptPath: (v: string | null) => void
  summaryText: string | null
  setSummaryText: (v: string | null) => void
  isSummarizing: boolean
  setIsSummarizing: (v: boolean) => void

  crashedSession: { config: Record<string, unknown>; startedAt: number } | null
  setCrashedSession: (v: { config: Record<string, unknown>; startedAt: number } | null) => void

  startSessionTimer: () => void
  stopSessionTimer: () => void

  audio: UseAudioCaptureReturn
  noiseSuppression: UseNoiseSuppressionReturn
}

export function useSessionSettings(): SessionSettingsState {
  const [status, setStatus] = useState('Ready')
  const [isRunning, setIsRunning] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [sessionDuration, setSessionDuration] = useState('')
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionStartRef = useRef<number | null>(null)
  const [sessions, setSessions] = useState<Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>>([])

  const [lastTranscriptPath, setLastTranscriptPath] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)

  const [crashedSession, setCrashedSession] = useState<{ config: Record<string, unknown>; startedAt: number } | null>(null)

  // Noise suppression + audio capture
  const noiseSuppression = useNoiseSuppression()
  const audio = useAudioCapture(noiseSuppression.enabled ? noiseSuppression : undefined)

  // --- Timer helpers ---
  const formatDuration = useCallback((ms: number): string => {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }, [])

  const startSessionTimer = useCallback(() => {
    sessionStartRef.current = Date.now()
    sessionTimerRef.current = setInterval(() => {
      if (sessionStartRef.current) {
        setSessionDuration(formatDuration(Date.now() - sessionStartRef.current))
      }
    }, 1000)
  }, [formatDuration])

  const stopSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current)
      sessionTimerRef.current = null
    }
    sessionStartRef.current = null
    setSessionDuration('')
  }, [])

  // Load noise suppression setting and check crashed session on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.noiseSuppressionEnabled !== undefined) noiseSuppression.setEnabled(bool(s.noiseSuppressionEnabled, false))
      if (s.selectedMicrophone) audio.setSelectedDevice(typeof s.selectedMicrophone === 'string' ? s.selectedMicrophone : '')
    })

    // Check for crashed session
    window.api.getCrashedSession().then((session) => {
      if (session) {
        setCrashedSession(session)
        setStatus('Previous session ended unexpectedly. Resume?')
      }
    })
  }, [])

  // Load session history
  useEffect(() => {
    window.api.listSessions().then(setSessions).catch((e) => console.warn('[settings] Failed to load sessions:', e))
  }, [isRunning])

  // Handle audio: streaming chunks during speech, final segment on speech end
  useEffect(() => {
    const unsub1 = audio.onAudioChunk((chunk) => {
      window.api.processAudio(Array.from(chunk))
    })
    const unsub2 = audio.onStreamingChunk((buffer) => {
      window.api.processAudioStreaming(Array.from(buffer))
    })
    const unsub3 = audio.onSpeechSegmentEnd((finalBuffer) => {
      window.api.finalizeStreaming(Array.from(finalBuffer))
    })

    return () => {
      unsub1()
      unsub2()
      unsub3()
    }
  }, [])

  // Listen for status updates from main process
  useEffect(() => {
    const unsubscribe = window.api.onStatusUpdate((message) => {
      setStatus(message)
    })
    return () => unsubscribe?.()
  }, [])

  // Cleanup session timer on unmount
  useEffect(() => {
    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current)
      }
    }
  }, [])

  return {
    status, setStatus,
    isRunning, setIsRunning,
    isStarting, setIsStarting,
    sessionDuration,
    sessions,
    lastTranscriptPath, setLastTranscriptPath,
    summaryText, setSummaryText,
    isSummarizing, setIsSummarizing,
    crashedSession, setCrashedSession,
    startSessionTimer, stopSessionTimer,
    audio, noiseSuppression
  }
}
