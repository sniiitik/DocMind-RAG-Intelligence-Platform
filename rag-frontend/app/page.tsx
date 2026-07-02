'use client'
import { useState, useRef, useEffect } from 'react'
import { queryDocuments, evaluateAnswer, listDocuments } from '@/lib/api'
import {
  ACTIVE_CHAT_KEY,
  CHAT_DELETE_EVENT,
  CHAT_NEW_EVENT,
  CHAT_NEW_REQUEST_KEY,
  CHAT_SELECTED_EVENT,
  StoredChatSession,
  consumeNewStoredChatRequest,
  loadStoredChats,
  saveStoredChats,
} from '@/lib/chatSessions'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
  mode?: string
  intents?: string[]
  compareDocuments?: string[]
  retrievalMode?: string
  memoryUsed?: boolean
  context?: {
    citation_id?: string
    text: string
    source: string
    document_name?: string
    page: number
    content_type?: string
    source_label?: string
    section_title?: string
    structure_hint?: string
    distance?: number
    vector_score?: number
    keyword_score?: number
    rrf_score?: number
    rerank_score?: number
  }[]
  traceability?: {
    sentence: string
    supports: {
      citation_id?: string
      source_label?: string
      page?: number
      score: number
    }[]
  }[]
  scores?: {
    faithfulness?: number
    answer_relevancy?: number
    groundedness?: number
    citation_precision?: number
    answer_completeness?: number
    retrieval_recall?: number
  }
  loading?: boolean
}
type IndexedDocument = {
  name: string
  chunks: number
  pages: number[]
  page_count: number
  text_chunks: number
  table_chunks: number
}

type ChatSession = {
  id: string
  title: string
  sessionId: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

const ANSWER_MODES = [
  { value: 'qa', label: 'Answer', hint: 'Direct grounded answer from your documents.' },
  { value: 'summary', label: 'Summarize', hint: 'Condense the main points into a structured summary.' },
  { value: 'compare', label: 'Compare', hint: 'Contrast two or more documents or sections side by side.' },
  { value: 'risks', label: 'Risks', hint: 'Pull out drawbacks, limitations, and areas of concern.' },
  { value: 'action_items', label: 'Action Items', hint: 'Extract tasks, next steps, and owners if mentioned.' },
  { value: 'timeline', label: 'Timeline', hint: 'Surface dates, milestones, and sequence of events.' },
  { value: 'table_insights', label: 'Table Insights', hint: 'Focus retrieval on tables and numeric evidence.' },
] as const

function createChatSession(): ChatSession {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    sessionId: crypto.randomUUID(),
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

function chatTitleFromMessages(messages: Message[]) {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim())
  if (!firstUserMessage) return 'New chat'
  return firstUserMessage.content.length > 42
    ? `${firstUserMessage.content.slice(0, 42).trim()}...`
    : firstUserMessage.content
}

function normalizeMessages(messages: Message[]) {
  return messages.filter(message => !message.loading || message.role === 'assistant')
}

function isEmptyChatSession(chat: ChatSession | null | undefined) {
  return !chat || normalizeMessages(chat.messages).length === 0
}

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

function loadChats(): ChatSession[] {
  const parsed = loadStoredChats() as ChatSession[]
  return parsed.map(chat => ({
    ...chat,
    messages: (chat.messages || []).map(m => ({ ...(m as Message), loading: false })).filter(m => m.content),
  }))
}

function saveChats(chats: ChatSession[]) {
  try {
    const clean: StoredChatSession[] = chats.map(chat => ({
      ...chat,
      messages: chat.messages.filter(m => !m.loading && m.content),
    })).filter(chat => !isEmptyChatSession(chat as ChatSession))
    saveStoredChats(clean)
  } catch {
    // localStorage full — silently ignore
  }
}

function detectPageFilter(question: string): {
  page?: number
  page_start?: number
  page_end?: number
} {
  const q = question.toLowerCase()

  const rangePatterns = [
    /\bpages?\s+(\d+)\s*(?:-|–|—|to|through|thru)\s*(\d+)\b/i,
    /\bfrom\s+pages?\s+(\d+)\s*(?:-|–|—|to|through|thru)\s*(\d+)\b/i,
    /\bpages?\s+(\d+)\s+and\s+(\d+)\b/i,
  ]

  for (const pattern of rangePatterns) {
    const match = q.match(pattern)

    if (match) {
      const start = Number(match[1])
      const end = Number(match[2])

      if (Number.isFinite(start) && Number.isFinite(end)) {
        return {
          page_start: Math.min(start, end),
          page_end: Math.max(start, end),
        }
      }
    }
  }

  const singlePagePatterns = [
    /\bpage\s+(\d+)\b/i,
    /\bp\.\s*(\d+)\b/i,
    /\bpg\.?\s*(\d+)\b/i,
  ]

  for (const pattern of singlePagePatterns) {
    const match = q.match(pattern)

    if (match) {
      const page = Number(match[1])

      if (Number.isFinite(page)) {
        return { page }
      }
    }
  }

  return {}
}

export default function ChatPage() {
  const [chats, setChats] = useState<ChatSession[]>([])
  const [activeChatId, setActiveChatId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [expandedCtx, setExpandedCtx] = useState<string | null>(null)
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [selectedDocument, setSelectedDocument] = useState('')
  const [selectedCompareDocuments, setSelectedCompareDocuments] = useState<string[]>([])
  const [pageStart, setPageStart] = useState('')
  const [pageEnd, setPageEnd] = useState('')
  const [contentType, setContentType] = useState<'all' | 'text' | 'table'>('all')
  const [answerMode, setAnswerMode] = useState<(typeof ANSWER_MODES)[number]['value']>('qa')
  const sessionIdRef = useRef<string>('')
  const activeMode = ANSWER_MODES.find(mode => mode.value === answerMode) || ANSWER_MODES[0]
  const activeChat = chats.find(chat => chat.id === activeChatId) || null

  // Load from localStorage on first mount (client only)
  useEffect(() => {
    const storedChats = loadChats()
    const nextChats = storedChats.length > 0 ? storedChats : [createChatSession()]
    const storedActiveChatId = localStorage.getItem(ACTIVE_CHAT_KEY)
    const shouldCreateNewChat = consumeNewStoredChatRequest()
    const initialActiveChat = shouldCreateNewChat
      ? createChatSession()
      : nextChats.find(chat => chat.id === storedActiveChatId) || nextChats[0]
    const initialChats = shouldCreateNewChat ? [initialActiveChat, ...nextChats] : nextChats

    setChats(initialChats)
    setActiveChatId(initialActiveChat.id)
    setMessages(initialActiveChat.messages)
    sessionIdRef.current = initialActiveChat.sessionId
    setHydrated(true)
  }, [])

  useEffect(() => {
    function handleChatSelected(event: Event) {
      const customEvent = event as CustomEvent<{ chatId?: string }>
      const nextChatId = customEvent.detail?.chatId
      if (!nextChatId) return

      const currentChat = chats.find(chat => chat.id === activeChatId)
      const shouldDiscardCurrentDraft =
        !!currentChat &&
        currentChat.id !== nextChatId &&
        isEmptyChatSession(currentChat)

      const nextChats = shouldDiscardCurrentDraft
        ? chats.filter(chat => chat.id !== currentChat.id)
        : chats

      const nextChat = nextChats.find(chat => chat.id === nextChatId)
      if (!nextChat) return

      if (shouldDiscardCurrentDraft) {
        setChats(nextChats)
      }

      setActiveChatId(nextChat.id)
      setMessages(nextChat.messages)
      setInput('')
      setExpandedCtx(null)
      setExpandedTrace(null)
      sessionIdRef.current = nextChat.sessionId
    }

    function handleNewChatRequested() {
      localStorage.removeItem(CHAT_NEW_REQUEST_KEY)
      const nextChat = createChatSession()
      setChats(prev => [nextChat, ...prev])
      setActiveChatId(nextChat.id)
      setMessages([])
      setInput('')
      setExpandedCtx(null)
      setExpandedTrace(null)
      sessionIdRef.current = nextChat.sessionId
    }

    function handleDeleteChat(event: Event) {
      const customEvent = event as CustomEvent<{ chatId?: string }>
      const chatId = customEvent.detail?.chatId
      if (!chatId) return

      const chatToDelete = chats.find(chat => chat.id === chatId)
      if (!chatToDelete) return

      const remainingChats = chats.filter(chat => chat.id !== chatId)

      if (remainingChats.length === 0) {
        const replacement = createChatSession()
        setChats([replacement])
        setActiveChatId(replacement.id)
        setMessages(replacement.messages)
        sessionIdRef.current = replacement.sessionId
        return
      }

      setChats(remainingChats)

      if (chatId === activeChatId) {
        setActiveChatId(remainingChats[0].id)
        setMessages(remainingChats[0].messages)
        sessionIdRef.current = remainingChats[0].sessionId
      }
    }

    window.addEventListener(CHAT_SELECTED_EVENT, handleChatSelected as EventListener)
    window.addEventListener(CHAT_NEW_EVENT, handleNewChatRequested)
    window.addEventListener(CHAT_DELETE_EVENT, handleDeleteChat as EventListener)

    return () => {
      window.removeEventListener(CHAT_SELECTED_EVENT, handleChatSelected as EventListener)
      window.removeEventListener(CHAT_NEW_EVENT, handleNewChatRequested)
      window.removeEventListener(CHAT_DELETE_EVENT, handleDeleteChat as EventListener)
    }
  }, [activeChatId, chats])

  useEffect(() => {
    if (!hydrated || !activeChatId) return
    localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId)
  }, [activeChatId, hydrated])

  useEffect(() => {
    if (!hydrated || !activeChatId) return

    const normalizedMessages = normalizeMessages(messages)

    setChats(prevChats => {
      const chatIndex = prevChats.findIndex(chat => chat.id === activeChatId)
      if (chatIndex === -1) return prevChats

      const currentChat = prevChats[chatIndex]
      const nextTitle = chatTitleFromMessages(normalizedMessages)
      const sameTitle = currentChat.title === nextTitle
      const sameMessages = JSON.stringify(currentChat.messages) === JSON.stringify(normalizedMessages)

      if (sameTitle && sameMessages) {
        return prevChats
      }

      const nextChats = [...prevChats]
      nextChats[chatIndex] = {
        ...currentChat,
        title: nextTitle,
        messages: normalizedMessages,
        updatedAt: new Date().toISOString(),
      }
      return nextChats
    })
  }, [messages, activeChatId, hydrated])

  useEffect(() => {
    if (!hydrated) return
    saveChats(chats)
  }, [chats, hydrated])

  useEffect(() => {
    if (!hydrated) return
    if (!activeChatId && chats.length > 0) {
      setActiveChatId(chats[0].id)
    } else {
      const exists = chats.some(chat => chat.id === activeChatId)
      if (!exists && chats.length > 0) {
        setActiveChatId(chats[0].id)
      }
    }
  }, [activeChatId, chats, hydrated])

  useEffect(() => {
    listDocuments()
      .then(data => {
        const docs = data.documents || []
        setDocuments(
          docs.map((doc: string | IndexedDocument) => {
            if (typeof doc === 'string') {
              return {
                name: doc,
                chunks: 0,
                pages: [],
                page_count: 0,
                text_chunks: 0,
                table_chunks: 0,
              }
            }

            return doc
          })
        )
      })
      .catch(() => {
        setDocuments([])
      })
  }, [])

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
      const detectedPageFilter = detectPageFilter(q)

      if (!pageStart && !pageEnd) {
        if (detectedPageFilter.page) {
          setPageStart(String(detectedPageFilter.page))
          setPageEnd(String(detectedPageFilter.page))
        } else if (detectedPageFilter.page_start || detectedPageFilter.page_end) {
          if (detectedPageFilter.page_start) {
            setPageStart(String(detectedPageFilter.page_start))
          }
          if (detectedPageFilter.page_end) {
            setPageEnd(String(detectedPageFilter.page_end))
          }
        }
      }

      const hasManualPageFilter = Boolean(pageStart || pageEnd)
      const hasDetectedPageFilter = Boolean(
        detectedPageFilter.page ||
        detectedPageFilter.page_start ||
        detectedPageFilter.page_end
      )

      const payload = {
        question: q,
        top_k: answerMode === 'compare' ? 8 : hasManualPageFilter || hasDetectedPageFilter ? 12 : 5,
        mode: answerMode,
        session_id: sessionIdRef.current,
        conversation: messages
          .filter(message => !message.loading)
          .slice(-6)
          .map(message => ({ role: message.role, content: message.content })),
        ...(answerMode === 'compare' && selectedCompareDocuments.length > 0
          ? { document_names: selectedCompareDocuments }
          : {}),
        ...(selectedDocument ? { document_name: selectedDocument } : {}),

        // Manual UI filters take priority.
        ...(pageStart ? { page_start: Number(pageStart) } : {}),
        ...(pageEnd ? { page_end: Number(pageEnd) } : {}),

        // Auto-detected page filters are used only when manual fields are empty.
        ...(!hasManualPageFilter ? detectedPageFilter : {}),

        ...(contentType !== 'all' ? { content_type: contentType } : {}),
      }

      const data = await queryDocuments(payload)
      const contexts = data.context?.map((c: { text: string }) => c.text) || []

      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? {
            ...m,
            content: data.answer,
            sources: data.sources,
            context: data.context,
            traceability: data.traceability,
            mode: data.mode,
            intents: data.intents,
            compareDocuments: data.compare_documents,
            retrievalMode: data.retrieval_mode,
            memoryUsed: data.memory_used,
            loading: false,
          }
          : m
      ))

      // Run local evals in background
      if (contexts.length > 0) {
        evaluateAnswer(q, data.answer, contexts, {
          mode: data.mode,
          retrieval_mode: data.retrieval_mode,
          traceability: data.traceability,
        }).then(evalData => {
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

  function toggleCompareDocument(name: string) {
    setSelectedCompareDocuments(current =>
      current.includes(name)
        ? current.filter(item => item !== name)
        : [...current, name]
    )
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
        display: 'flex', alignItems: 'center',
        background: 'var(--bg-surface)',
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em' }}>
            {activeChat?.title || 'Chat'}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Ask, summarize, compare, and extract insights across your uploaded documents
          </p>
        </div>
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
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 3.5h7.2L18 7.3v13.2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
                <path d="M14 3.5V7a1 1 0 0 0 1 1h3" />
                <path d="M8.5 12h7" />
                <path d="M8.5 15h7" />
                <path d="M8.5 18h4.5" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 6 }}>Ready to answer</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Upload documents first, then choose a mode and ask for insights</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
              {['What are the key findings?', 'Summarise the main points', 'Compare the methods used in both documents'].map(q => (
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
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M7 3.5h7.2L18 7.3v13.2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
                      <path d="M14 3.5V7a1 1 0 0 0 1 1h3" />
                      <path d="M8.5 12h7" />
                      <path d="M8.5 15h7" />
                      <path d="M8.5 18h4.5" />
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
                    {msg.mode && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Mode: {msg.mode.replaceAll('_', ' ')}
                      </span>
                    )}
                    {msg.compareDocuments && msg.compareDocuments.length > 1 && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Compared: {msg.compareDocuments.length} docs
                      </span>
                    )}
                    {msg.retrievalMode && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Retrieval: {msg.retrievalMode}
                      </span>
                    )}
                    {msg.memoryUsed && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Follow-up memory on
                      </span>
                    )}
                    {msg.intents && msg.intents.length > 1 && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Intents: {msg.intents.slice(1).join(', ')}
                      </span>
                    )}
                  </div>
                )}

                {msg.scores && (
                  <div style={{ paddingLeft: 40, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Eval:</span>
                      {msg.scores.faithfulness != null && <ScoreBadge label="Faithful" value={msg.scores.faithfulness} />}
                      {msg.scores.answer_relevancy != null && <ScoreBadge label="Relevant" value={msg.scores.answer_relevancy} />}
                      {msg.scores.groundedness != null && <ScoreBadge label="Grounded" value={msg.scores.groundedness} />}
                      {msg.scores.citation_precision != null && <ScoreBadge label="Citations" value={msg.scores.citation_precision} />}
                      {msg.scores.answer_completeness != null && <ScoreBadge label="Complete" value={msg.scores.answer_completeness} />}
                      {msg.scores.retrieval_recall != null && <ScoreBadge label="Recall" value={msg.scores.retrieval_recall} />}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Scores are calibrated by mode, so summaries and comparisons are judged differently from direct Q&A.
                    </p>
                  </div>
                )}

                {msg.traceability && msg.traceability.length > 0 && (
                  <div style={{ paddingLeft: 40 }}>
                    <button onClick={() => setExpandedTrace(expandedTrace === msg.id ? null : msg.id)} style={{
                      fontSize: 11, color: 'var(--text-muted)', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        style={{ transform: expandedTrace === msg.id ? 'rotate(90deg)' : 'none', transition: '0.15s' }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      {expandedTrace === msg.id ? 'Hide' : 'Show'} sentence evidence map
                    </button>

                    {expandedTrace === msg.id && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {msg.traceability.map((trace, idx) => (
                          <div key={idx} style={{
                            padding: '10px 14px', borderRadius: 8,
                            background: 'var(--bg-raised)', border: '1px solid var(--border)',
                          }}>
                            <p style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 8 }}>
                              {trace.sentence}
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {trace.supports.map((support, supportIndex) => (
                                <span key={supportIndex} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {support.citation_id || `S${supportIndex + 1}`} · {support.source_label || 'Source'}{support.page ? ` · page ${support.page}` : ''} · support {Math.round(support.score * 100)}%
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
                              {(c.citation_id ? `${c.citation_id} · ` : '')}{c.source_label || c.source} · page {c.page}
                              {c.content_type && <> · {c.content_type}</>}
                              {c.section_title && <> · {c.section_title}</>}
                            </div>

                            <div style={{
                              display: 'flex',
                              gap: 6,
                              flexWrap: 'wrap',
                              marginBottom: 8,
                              fontSize: 10,
                              color: 'var(--text-muted)',
                            }}>
                              {c.vector_score != null && (
                                <span>vector: {Number(c.vector_score).toFixed(3)}</span>
                              )}
                              {c.keyword_score != null && (
                                <span>keyword: {Number(c.keyword_score).toFixed(3)}</span>
                              )}
                              {c.rrf_score != null && (
                                <span>fusion: {Number(c.rrf_score).toFixed(4)}</span>
                              )}
                              {c.rerank_score != null && (
                                <span>rerank: {Number(c.rerank_score).toFixed(3)}</span>
                              )}
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
      {/* Input */}
      <div style={{
        padding: '16px 32px 24px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}>

        {/* Filters */}
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 10,
          alignItems: 'center',
        }}>
          <select
            value={answerMode}
            onChange={e => setAnswerMode(e.target.value as (typeof ANSWER_MODES)[number]['value'])}
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
            }}
          >
            {ANSWER_MODES.map(mode => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>

          <span style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            padding: '0 2px',
          }}>
            {activeMode.hint}
          </span>

          <select
            value={selectedDocument}
            onChange={e => setSelectedDocument(e.target.value)}
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
              maxWidth: 220,
            }}
          >
            <option value="">All documents</option>
            {documents.map(doc => (
              <option key={doc.name} value={doc.name}>
                {doc.name}
              </option>
            ))}
          </select>

          {answerMode === 'compare' && documents.length > 0 && (
            <div style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Compare docs:</span>
              {documents.map(doc => {
                const active = selectedCompareDocuments.includes(doc.name)
                return (
                  <button
                    key={doc.name}
                    onClick={() => toggleCompareDocument(doc.name)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent-dim)' : 'var(--bg-raised)',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {doc.name}
                  </button>
                )
              })}
            </div>
          )}

          <input
            value={pageStart}
            onChange={e => setPageStart(e.target.value)}
            placeholder="Page from"
            inputMode="numeric"
            style={{
              width: 90,
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
            }}
          />

          <input
            value={pageEnd}
            onChange={e => setPageEnd(e.target.value)}
            placeholder="Page to"
            inputMode="numeric"
            style={{
              width: 90,
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
            }}
          />

          <select
            value={contentType}
            onChange={e => setContentType(e.target.value as 'all' | 'text' | 'table')}
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
            }}
          >
            <option value="all">All content</option>
            <option value="text">Text only</option>
            <option value="table">Tables only</option>
          </select>

          {(selectedDocument || pageStart || pageEnd || contentType !== 'all') && (
            <button
              onClick={() => {
                setSelectedDocument('')
                setSelectedCompareDocuments([])
                setPageStart('')
                setPageEnd('')
                setContentType('all')
              }}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Clear filters
            </button>
          )}
        </div>

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
            placeholder={answerMode === 'compare'
              ? 'Ask what should be compared across the selected documents...'
              : 'Ask a question about your documents…'}
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
          Enter to send · Shift+Enter for new line · chats and follow-up memory saved automatically
          {answerMode === 'compare' && selectedCompareDocuments.length < 2 && (
            <> · select 2 or more docs for the strongest comparison</>
          )}
          {(selectedDocument || pageStart || pageEnd || contentType !== 'all') && (
            <>
              {' '}· filters active
            </>
          )}
        </p>
      </div>
    </div>
  )
}
