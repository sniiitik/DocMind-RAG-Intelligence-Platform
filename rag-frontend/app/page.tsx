'use client'
import { useState, useRef, useEffect } from 'react'
import { queryDocuments, evaluateAnswer } from '@/lib/api'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
  context?: { text: string; source: string; page: number }[]
  scores?: { faithfulness?: number; answer_relevancy?: number }
  loading?: boolean
}

const STORAGE_KEY = 'docmind_chat_history'

function SourcePill({ source }: { source: string }) {
  const name = source.split('/').pop() || source
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      background: 'var(--accent-dim)', border: '1px solid rgba(124,106,247,0.2)',
      fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
    }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      {name}
    </span>
  )
}

function ScoreBadge({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)'
  const dimColor = pct >= 75 ? 'var(--success-dim)' : pct >= 50 ? 'var(--warning-dim)' : 'var(--danger-dim)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      background: dimColor, fontSize: 11,
      color, fontFamily: 'var(--font-mono)',
    }}>
      {label}: {pct}%
    </span>
  )
}

function loadHistory(): Message[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: Message[] = JSON.parse(raw)
    // Strip any loading states from a previous crashed session
    return parsed.map(m => ({ ...m, loading: false })).filter(m => m.content)
  } catch {
    return []
  }
}

function saveHistory(msgs: Message[]) {
  if (typeof window === 'undefined') return
  try {
    // Never persist loading bubbles
    const clean = msgs.filter(m => !m.loading && m.content)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // localStorage full — silently ignore
  }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [expandedCtx, setExpandedCtx] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load from localStorage on first mount (client only)
  useEffect(() => {
    setMessages(loadHistory())
    setHydrated(true)
  }, [])

  // Persist to localStorage whenever messages change
  useEffect(() => {
    if (!hydrated) return
    saveHistory(messages)
  }, [messages, hydrated])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const q = input.trim()
    if (!q || isLoading) return
    setInput('')

    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: q },
      { id: assistantId, role: 'assistant', content: '', loading: true },
    ])
    setIsLoading(true)

    try {
      const data = await queryDocuments(q)
      const contexts = data.context?.map((c: { text: string }) => c.text) || []

      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: data.answer, sources: data.sources, context: data.context, loading: false }
          : m
      ))

      // Run local evals in background
      if (contexts.length > 0) {
        evaluateAnswer(q, data.answer, contexts).then(evalData => {
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, scores: evalData.scores } : m
          ))
        }).catch(() => { })
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: 'Could not reach the backend. Make sure it is running on port 8000.', loading: false }
          : m
      ))
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  function clearHistory() {
    setMessages([])
    localStorage.removeItem(STORAGE_KEY)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const visibleMessages = messages.filter(m => !m.loading || m.role === 'assistant')
  const isEmpty = visibleMessages.length === 0 && !isLoading

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        padding: '18px 32px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-surface)',
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em' }}>
            Chat
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Ask anything across your uploaded documents
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={clearHistory} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
            </svg>
            Clear history
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {isEmpty && hydrated && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16, opacity: 0.6,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'var(--accent-dim)', border: '1px solid rgba(124,106,247,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 6 }}>Ready to answer</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Upload documents first, then ask questions</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
              {['What are the key findings?', 'Summarise the main points', 'What does the document say about...'].map(q => (
                <button key={q} onClick={() => setInput(q)} style={{
                  padding: '7px 14px', borderRadius: 20, fontSize: 12,
                  background: 'var(--bg-raised)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={msg.id} className="fade-up" style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            animationDelay: `${Math.min(i, 3) * 0.02}s`,
          }}>
            {msg.role === 'user' ? (
              <div style={{
                maxWidth: '72%', padding: '12px 16px', borderRadius: '16px 16px 4px 16px',
                background: 'var(--accent-dim)', border: '1px solid rgba(124,106,247,0.2)',
                fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)',
              }}>
                {msg.content}
              </div>
            ) : (
              <div style={{ maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 2,
                    background: 'var(--accent-dim)', border: '1px solid rgba(124,106,247,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    {msg.loading ? (
                      <div style={{ display: 'flex', gap: 5, padding: '12px 0' }}>
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                      </div>
                    ) : (
                      <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </p>
                    )}
                  </div>
                </div>

                {msg.sources && msg.sources.length > 0 && (
                  <div style={{ paddingLeft: 40, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Sources:</span>
                    {msg.sources.map(s => <SourcePill key={s} source={s} />)}
                  </div>
                )}

                {msg.scores && (
                  <div style={{ paddingLeft: 40, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Eval:</span>
                    {msg.scores.faithfulness != null && <ScoreBadge label="Faithful" value={msg.scores.faithfulness} />}
                    {msg.scores.answer_relevancy != null && <ScoreBadge label="Relevant" value={msg.scores.answer_relevancy} />}
                  </div>
                )}

                {msg.context && msg.context.length > 0 && (
                  <div style={{ paddingLeft: 40 }}>
                    <button onClick={() => setExpandedCtx(expandedCtx === msg.id ? null : msg.id)} style={{
                      fontSize: 11, color: 'var(--text-muted)', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        style={{ transform: expandedCtx === msg.id ? 'rotate(90deg)' : 'none', transition: '0.15s' }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      {expandedCtx === msg.id ? 'Hide' : 'Show'} {msg.context.length} retrieved chunks
                    </button>
                    {expandedCtx === msg.id && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {msg.context.map((c, idx) => (
                          <div key={idx} style={{
                            padding: '10px 14px', borderRadius: 8,
                            background: 'var(--bg-raised)', border: '1px solid var(--border)',
                            fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)',
                          }}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                              {c.source} · page {c.page}
                            </div>
                            {c.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '16px 32px 24px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}>
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-end',
          background: 'var(--bg-raised)', borderRadius: 14,
          border: '1px solid var(--border-bright)', padding: '10px 12px',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask a question about your documents…"
            rows={1}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none',
              color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.6,
              fontFamily: 'var(--font-body)', maxHeight: 120, overflowY: 'auto',
            }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = el.scrollHeight + 'px'
            }}
          />
          <button onClick={send} disabled={!input.trim() || isLoading} style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: input.trim() && !isLoading ? 'var(--accent)' : 'var(--bg-hover)',
            border: 'none', cursor: input.trim() && !isLoading ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
          Enter to send · Shift+Enter for new line · history saved automatically
        </p>
      </div>
    </div>
  )
}
