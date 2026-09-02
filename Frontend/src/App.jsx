import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { api } from './api'


// ---------------------------------------------------------------------
// PROFESSIONAL AI MESSAGE RENDERER
// Converts the agents' Markdown responses into clean, readable UI.
// ---------------------------------------------------------------------
function AIMessage({ text }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0

  const inline = (value) => {
    const parts = String(value).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
    return parts.map((part, index) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return <strong key={index} className="font-extrabold text-slate-900">{part.slice(2, -2)}</strong>
      }
      if (/^`[^`]+`$/.test(part)) {
        return <code key={index} className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-800 text-[0.9em]">{part.slice(1, -1)}</code>
      }
      if (/^\*[^*]+\*$/.test(part)) {
        return <em key={index}>{part.slice(1, -1)}</em>
      }
      return <span key={index}>{part}</span>
    })
  }

  while (i < lines.length) {
    const line = lines[i].trim()

    if (!line) {
      i += 1
      continue
    }

    // Markdown table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const tableLines = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        tableLines.push(lines[i].trim())
        i += 1
      }
      const parseRow = (row) => row.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
      const headers = parseRow(tableLines[0])
      const rows = tableLines.slice(2).map(parseRow)
      blocks.push(
        <div key={`table-${i}`} className="overflow-x-auto my-4 rounded-2xl border border-slate-200">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-100">
              <tr>{headers.map((h, idx) => <th key={idx} className="px-3 py-2.5 text-left font-black text-slate-700 border-b border-slate-200 whitespace-nowrap">{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={r % 2 ? 'bg-slate-50/60' : 'bg-white'}>
                  {headers.map((_, c) => <td key={c} className="px-3 py-2.5 text-slate-600 border-b border-slate-100">{inline(row[c] || '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Headings
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      blocks.push(<h3 key={`h-${i}`} className="text-base font-black text-slate-900 mt-2 mb-2">{inline(heading[1])}</h3>)
      i += 1
      continue
    }

    // Numbered list with nested sub-line support
    if (/^\d+[.)]\s+/.test(line)) {
      const olItems = []
      while (i < lines.length) {
        const curLine = lines[i].trim()
        if (/^\d+[.)]\s+/.test(curLine)) {
          const title = curLine.replace(/^\d+[.)]\s+/, '')
          i += 1
          const subLines = []
          while (i < lines.length) {
            const sub = lines[i].trim()
            if (!sub) {
              let nextIdx = i + 1
              while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++
              if (nextIdx < lines.length && /^\d+[.)]\s+/.test(lines[nextIdx].trim())) {
                i = nextIdx
                break
              }
            }
            if (/^\d+[.)]\s+/.test(sub) || /^#{1,3}\s+/.test(sub) || sub.includes('|')) {
              break
            }
            if (sub) {
              subLines.push(sub)
            }
            i += 1
          }
          olItems.push({ title, subLines })
        } else if (!curLine) {
          i += 1
        } else {
          break
        }
      }

      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 space-y-3 my-3">
          {olItems.map((item, idx) => (
            <li key={idx} className="space-y-1.5">
              <div className="font-black text-slate-900">{inline(item.title)}</div>
              {item.subLines.length > 0 && (
                <div className="pl-2 space-y-1">
                  {item.subLines.map((subLine, sIdx) => {
                    const isBullet = /^[-*•]\s+/.test(subLine)
                    const cleanSub = subLine.replace(/^[-*•]\s+/, '')
                    return (
                      <div key={sIdx} className={`text-xs text-slate-600 ${isBullet ? 'flex items-start gap-2 pl-1' : 'pl-4 italic text-slate-500'}`}>
                        {isBullet && <span className="text-teal-600 font-bold">•</span>}
                        <span>{inline(cleanSub)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Bulleted list (standalone)
    if (/^[-*•]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''))
        i += 1
      }
      blocks.push(<ul key={`ul-${i}`} className="list-disc pl-5 space-y-1.5 my-2">{items.map((item, idx) => <li key={idx}>{inline(item)}</li>)}</ul>)
      continue
    }

    // Normal paragraph; combine consecutive text lines.
    const paragraph = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i].trim()) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i].trim())
    ) {
      paragraph.push(lines[i].trim())
      i += 1
    }
    blocks.push(<p key={`p-${i}`} className="leading-7 mb-3 last:mb-0">{inline(paragraph.join(' '))}</p>)
  }

  return <div className="text-sm leading-relaxed text-slate-700">{blocks}</div>
}

// ---------------------------------------------------------------------
// DATABASE-BACKED AI CHAT HISTORY + CHATGPT-STYLE CONVERSATIONS
// ---------------------------------------------------------------------
function useChatHistory(email, agentKey) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const [messages, setMessages] = useState([])
  const [conversations, setConversations] = useState([])
  const [conversationId, setConversationId] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const saveTimerRef = useRef(null)
  const loadIdRef = useRef(0)

  const loadConversations = async (preferredId = null) => {
    if (!normalizedEmail) return []
    const result = await api.listConversations(agentKey, normalizedEmail, 50)
    const items = Array.isArray(result?.conversations) ? result.conversations : []
    setConversations(items)

    const validPreferred = preferredId && items.some(item => Number(item.conversation_id) === Number(preferredId))
    const nextId = validPreferred
      ? Number(preferredId)
      : (items.length ? Number(items[0].conversation_id) : null)

    if (nextId !== null) setConversationId(nextId)
    return items
  }

  useEffect(() => {
    const loadId = ++loadIdRef.current
    let cancelled = false
    setLoaded(false)
    setMessages([])
    setConversations([])
    setConversationId(null)

    if (!normalizedEmail) return () => { cancelled = true }

    async function loadInitial() {
      try {
        let items = await loadConversations()

        // One-time migration from the older agent+user history model/localStorage.
        if (!items.length) {
          try {
            const legacy = await api.getChatHistory(agentKey, normalizedEmail)
            const legacyMessages = Array.isArray(legacy?.messages)
              ? legacy.messages.map(({ role, text }) => ({ role, text }))
              : []
            if (legacyMessages.length) {
              const created = await api.createConversation(agentKey, normalizedEmail, 'Previous conversation')
              await api.saveConversationMessages(created.conversation_id, normalizedEmail, legacyMessages)
              items = await loadConversations(created.conversation_id)
            } else {
              const storageKey = `apex_chat_history:${normalizedEmail}:${agentKey}`
              const saved = localStorage.getItem(storageKey)
              const localMessages = saved ? JSON.parse(saved) : []
              if (Array.isArray(localMessages) && localMessages.length) {
                const created = await api.createConversation(agentKey, normalizedEmail, 'Previous conversation')
                await api.saveConversationMessages(created.conversation_id, normalizedEmail, localMessages)
                items = await loadConversations(created.conversation_id)
                localStorage.removeItem(storageKey)
              }
            }
          } catch {
            // Migration is best-effort and must never block the AI agent.
          }
        }

        if (!cancelled && loadId === loadIdRef.current) {
          setLoaded(true)
        }
      } catch {
        if (!cancelled && loadId === loadIdRef.current) {
          setMessages([])
          setConversations([])
          setConversationId(null)
          setLoaded(false)
        }
      }
    }

    loadInitial()
    return () => {
      cancelled = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [normalizedEmail, agentKey])

  useEffect(() => {
    if (!conversationId || !normalizedEmail) return
    const requestId = ++loadIdRef.current
    let cancelled = false

    async function loadSelectedConversation() {
      try {
        const result = await api.getConversation(conversationId, normalizedEmail)
        if (cancelled || requestId !== loadIdRef.current) return
        const loadedMessages = Array.isArray(result?.messages)
          ? result.messages.map(({ role, text }) => ({ role, text }))
          : []
        setMessages(loadedMessages)
        setConversations(prev => prev.map(item => item.conversation_id === conversationId
          ? { ...item, ...(result?.conversation || {}) }
          : item))
        setLoaded(true)
      } catch {
        if (!cancelled && requestId === loadIdRef.current) {
          setMessages([])
          setLoaded(true)
        }
      }
    }

    loadSelectedConversation()
    return () => { cancelled = true }
  }, [conversationId, normalizedEmail])

  useEffect(() => {
    if (!loaded || !normalizedEmail || !conversationId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        const result = await api.saveConversationMessages(conversationId, normalizedEmail, messages)
        setConversations(prev => prev.map(item => item.conversation_id === conversationId
          ? { ...item, title: result?.title || item.title, updated_at: result?.updated_at || item.updated_at }
          : item
        ).sort((a, b) => {
          const at = String(a.updated_at || '')
          const bt = String(b.updated_at || '')
          return bt.localeCompare(at) || Number(b.conversation_id) - Number(a.conversation_id)
        }))
      } catch {
        // Persistence failure must not interrupt the conversation.
      }
    }, 200)
    return () => clearTimeout(saveTimerRef.current)
  }, [messages, loaded, normalizedEmail, conversationId])

  // If the user starts typing in a completely new workspace without
  // explicitly pressing New chat, create the conversation automatically.
  // Persist the first messages BEFORE switching conversationId so the
  // conversation-loading effect cannot overwrite the just-entered message.
  useEffect(() => {
    if (!loaded || !normalizedEmail || conversationId || !messages.length) return
    let cancelled = false
    const initialMessages = messages.map(({ role, text }) => ({ role, text }))
    ;(async () => {
      try {
        const created = await api.createConversation(agentKey, normalizedEmail, 'New conversation')
        if (cancelled) return

        await api.saveConversationMessages(
          created.conversation_id,
          normalizedEmail,
          initialMessages
        )
        if (cancelled) return

        const item = {
          conversation_id: Number(created.conversation_id),
          agent_key: agentKey,
          title: created.title || 'New conversation',
          created_at: created.created_at,
          updated_at: created.updated_at,
        }
        setConversations(prev => [item, ...prev.filter(c => Number(c.conversation_id) !== item.conversation_id)])
        setConversationId(item.conversation_id)
      } catch {
        // Persistence failure must never prevent the AI from responding.
      }
    })()
    return () => { cancelled = true }
  }, [messages.length, loaded, normalizedEmail, conversationId, agentKey])

  const newChat = async () => {
    if (!normalizedEmail) return
    try {
      // Flush the current conversation before switching, so an immediately
      // clicked New chat cannot discard the last unsaved turn.
      if (conversationId && messages.length) {
        await api.saveConversationMessages(conversationId, normalizedEmail, messages)
      }
      const created = await api.createConversation(agentKey, normalizedEmail, 'New conversation')
      const item = {
        conversation_id: Number(created.conversation_id),
        agent_key: agentKey,
        title: created.title || 'New conversation',
        created_at: created.created_at,
        updated_at: created.updated_at,
      }
      setConversations(prev => [item, ...prev])
      setConversationId(item.conversation_id)
      setMessages([])
      setLoaded(true)
    } catch {
      // Ignore transient history errors; AI functionality remains usable.
    }
  }

  const selectConversation = async (id) => {
    const numericId = Number(id)
    if (!numericId || numericId === conversationId) return
    try {
      if (conversationId && messages.length) {
        await api.saveConversationMessages(conversationId, normalizedEmail, messages)
      }
    } catch {
      // Keep navigation available even if a final persistence attempt fails.
    }
    setLoaded(false)
    setConversationId(numericId)
  }

  const clearHistory = async () => {
    if (!normalizedEmail || !conversationId) return
    setMessages([])
    try {
      await api.saveConversationMessages(conversationId, normalizedEmail, [])
      setConversations(prev => prev.map(item => item.conversation_id === conversationId
        ? { ...item, title: 'New conversation', updated_at: new Date().toISOString() }
        : item
      ))
    } catch {
      // UI remains responsive if persistence is temporarily unavailable.
    }
  }

  const deleteConversation = async (id) => {
    if (!normalizedEmail || !id) return
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return
    try {
      await api.deleteConversation(id, normalizedEmail)
      const remaining = conversations.filter(item => Number(item.conversation_id) !== Number(id))
      setConversations(remaining)
      if (Number(id) === Number(conversationId)) {
        if (remaining.length) {
          setConversationId(Number(remaining[0].conversation_id))
        } else {
          await newChat()
        }
      }
    } catch {
      // Keep the existing conversation if deletion fails.
    }
  }

  return [messages, setMessages, clearHistory, {
    conversations,
    conversationId,
    newChat,
    selectConversation,
    deleteConversation,
  }]
}

function ConversationSidebar({ agentKey, conversations, conversationId, onNewChat, onSelectConversation, onDeleteConversation }) {
  const labelMap = {
    'banking-agent': 'Banking AI',
    'rag-agent': 'RAG Intelligence',
    'email-agent': 'Email Agent',
    'weather-agent': 'Weather AI',
    'crypto-agent': 'Crypto AI',
    'web-search-agent': 'Web Search',
    'image-generation-agent': 'Image Generator',
    'email-reader-agent': 'Email Reader',
    'calendar-agent': 'Calendar Agent',
  }
  return (
    <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/80 p-3 md:p-3.5 flex md:flex-col max-h-64 md:max-h-none">
      <div className="flex md:block items-center gap-2 w-full">
        <button type="button" onClick={onNewChat} className="flex w-auto md:w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-black text-white shadow-sm transition-all hover:bg-teal-600">
          <span className="text-base leading-none">＋</span>
          <span>New chat</span>
        </button>
        <div className="hidden md:block mt-4 px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Recent · {labelMap[agentKey] || agentKey}</div>
      </div>

      <div className="mt-2 md:mt-2 flex md:block gap-2 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden md:flex-1 scrollbar-thin pr-1 w-full">
        {!conversations.length ? (
          <div className="hidden md:block rounded-xl border border-dashed border-slate-200 bg-white px-3 py-5 text-center text-[10px] font-semibold text-slate-400">No previous chats yet.</div>
        ) : conversations.map(item => {
          const active = Number(item.conversation_id) === Number(conversationId)
          return (
            <div key={item.conversation_id} className={`group relative min-w-[190px] md:min-w-0 rounded-xl transition-all ${active ? 'bg-white border border-slate-200 shadow-sm' : 'hover:bg-white/70'}`}>
              <button type="button" onClick={() => onSelectConversation(item.conversation_id)} className="w-full text-left px-3 py-2.5 pr-9">
                <div className={`truncate text-[11px] font-bold ${active ? 'text-slate-900' : 'text-slate-600'}`}>{item.title || 'New conversation'}</div>
                <div className="mt-0.5 text-[9px] font-medium text-slate-400">{item.updated_at || item.created_at || ''}</div>
              </button>
              <button type="button" onClick={() => onDeleteConversation(item.conversation_id)} className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-md text-slate-300 hover:bg-rose-50 hover:text-rose-500" title="Delete conversation" aria-label="Delete conversation">×</button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function AgentConversationCard({
  agentKey,
  messages,
  loading,
  onClear,
  label,
  emptyIcon,
  emptyTitle,
  emptyText,
  loadingText,
  input,
  setInput,
  onSubmit,
  placeholder,
  submitLabel = 'Send',
  multiline = false,
  conversation,
}) {
  const messagesContainerRef = useRef(null)
  const messagesEndRef = useRef(null)

  const scrollToLatest = useCallback((behavior = 'smooth') => {
    const container = messagesContainerRef.current
    if (!container) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    })

    // A second frame catches layout changes caused by newly rendered content.
    window.requestAnimationFrame(() => {
      const current = messagesContainerRef.current
      if (!current) return
      current.scrollTo({
        top: current.scrollHeight,
        behavior,
      })
    })
  }, [])

  useLayoutEffect(() => {
    // useLayoutEffect makes the new user message visible before the browser
    // paints, which prevents the old "Working… then message appears" flash.
    scrollToLatest('auto')
  }, [messages.length, loading, scrollToLatest])

  useEffect(() => {
    // Smoothly follow the conversation when the AI response is added.
    const timer = window.setTimeout(() => scrollToLatest('smooth'), 0)
    return () => window.clearTimeout(timer)
  }, [messages, loading, scrollToLatest])

  return (
    <div className="bg-white border border-slate-200/80 rounded-[2rem] shadow-[0_18px_45px_rgba(15,23,42,0.06)] overflow-hidden flex min-h-[620px] md:min-h-[650px]">
      {conversation && (
        <ConversationSidebar
          agentKey={agentKey}
          conversations={conversation.conversations}
          conversationId={conversation.conversationId}
          onNewChat={conversation.newChat}
          onSelectConversation={conversation.selectConversation}
          onDeleteConversation={conversation.deleteConversation}
        />
      )}

      <div className="min-w-0 flex-1 flex flex-col">
        <div ref={messagesContainerRef} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-6 scrollbar-thin">
          {messages.length === 0 ? (
            <div className="min-h-[500px] flex items-center justify-center text-center px-4">
              <div className="max-w-md">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 border border-teal-100 text-2xl font-black shadow-sm">{emptyIcon}</div>
                <div className="mt-5 text-lg font-black text-slate-900">{emptyTitle}</div>
                <div className="mt-2 text-sm leading-6 font-medium text-slate-500">{emptyText}</div>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-7">
              {messages.map((m, i) => {
                const isUser = m.role === 'user'
                return (
                  <div key={i} className={`flex w-full items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {!isUser && (
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white shadow-sm">AI</div>
                    )}
                    <div className={isUser
                      ? 'max-w-[82%] rounded-3xl rounded-br-md bg-slate-900 px-5 py-3.5 text-sm leading-6 text-white shadow-sm'
                      : 'max-w-[88%] px-1 py-0.5 text-sm leading-7 text-slate-700'}>
                      {isUser ? <span className="whitespace-pre-wrap">{m.text}</span> : <AIMessage text={m.text} />}
                    </div>
                  </div>
                )
              })}
              {loading && (
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">AI</div>
                  <div className="flex items-center gap-2 py-1.5 text-sm text-slate-400">
                    <span className="inline-flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                    </span>
                    <span>{loadingText}</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} aria-hidden="true" className="h-px w-full" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            {label}
            <span className="rounded-full bg-white px-2 py-0.5 text-slate-500 border border-slate-200">{messages.length}</span>
          </div>
          <button type="button" onClick={onClear} disabled={!conversation?.conversationId || !messages.length} className="rounded-lg px-2.5 py-1.5 text-[10px] font-black text-slate-500 transition-colors hover:bg-white hover:text-rose-600 disabled:opacity-30">Clear chat</button>
        </div>

        <form
          onSubmit={(e) => {
            onSubmit(e)
            // Scroll immediately after React schedules the new user message.
            window.requestAnimationFrame(() => scrollToLatest('smooth'))
          }}
          className="border-t border-slate-100 bg-white px-4 sm:px-6 py-4"
        >
          <div className="mx-auto flex w-full max-w-none items-end gap-2 rounded-3xl border border-slate-200 bg-slate-50 p-2 shadow-[0_6px_18px_rgba(15,23,42,0.04)] focus-within:border-slate-300 focus-within:bg-white focus-within:shadow-[0_8px_24px_rgba(15,23,42,0.07)] transition-all">
            {multiline ? (
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                rows={1}
                placeholder={placeholder}
                disabled={loading}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmit(e)
                  }
                }}
                className="min-h-11 max-h-36 flex-1 resize-none bg-transparent px-3 py-3 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
              />
            ) : (
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={placeholder}
                disabled={loading}
                className="h-11 flex-1 bg-transparent px-3 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
              />
            )}
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-11 shrink-0 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-black text-white transition-all hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-40"
              title={submitLabel}
              aria-label={submitLabel}
            >
              <span className="hidden sm:inline">{loading ? 'Working…' : submitLabel}</span>
              <span className="sm:hidden">↑</span>
            </button>
          </div>
          <div className="mx-auto mt-2 w-full text-center text-[10px] font-medium text-slate-400">{multiline ? 'Enter to send · Shift+Enter for a new line' : 'Enter to send'}</div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// ENHANCED GLASSMORPHIC LOGIN SCREEN
// ---------------------------------------------------------------------

function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  // ===== NEW: GOOGLE SUCCESS HANDLER =====
  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      const data = await api.googleIdentityLogin(credentialResponse.credential);

      if (!data?.email) {
        setError("Google authentication failed.");
        return;
      }

      const normalizedEmail = String(data.email).trim().toLowerCase();
      localStorage.setItem('apex_user_email', normalizedEmail);
      localStorage.setItem('lastVisitedPath', 'Dashboard');

      if (data.google_authorization_url) {
        // Identity is already verified. Continue immediately into the
        // combined Gmail + Calendar OAuth consent screen.
        window.location.href = data.google_authorization_url;
        return;
      }

      // Both services were already connected for this Apex account.
      onLogin(normalizedEmail);
    } catch (err) {
      setError(err.message || "Network error during Google login.");
    } finally {
      setLoading(false);
    }
  };
  // =======================================

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    const normalizedEmail = email.trim().toLowerCase()

    setLoading(true)
    try {
      if (mode === 'login') {
        // Assuming api is imported at the top of your file
        const result = await api.login(normalizedEmail, password)
        onLogin(result.email) 
      } else {
        await api.signup(normalizedEmail, password)
        setSuccess('Account created! Switch to Log In to continue.')
        setMode('login')
        setPassword('')
        setConfirmPassword('')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-slate-950 flex items-center justify-center p-4 overflow-hidden selection:bg-teal-500 selection:text-white">
      {/* Dynamic Background Mesh Orbs */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-teal-500/20 rounded-full blur-[120px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-teal-500/20 rounded-full blur-[120px] pointer-events-none animate-pulse delay-1000" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-slate-800/30 rounded-full blur-[150px] pointer-events-none" />

      {/* Glassmorphism Portal Card */}
      <div className="relative z-10 bg-slate-900/60 backdrop-blur-2xl border border-slate-800/80 p-10 rounded-[2.5rem] w-full max-w-md shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3.5 mb-2">
          <div className="w-4 h-4 bg-gradient-to-tr from-teal-400 to-teal-300 rounded-full shadow-lg shadow-teal-500/50 animate-ping" />
          <h1 className="text-2xl font-black text-white tracking-tight">Apex Capital Bank</h1>
        </div>
        <p className="text-slate-400 text-xs font-semibold mb-8 tracking-wider uppercase">Secure Bank Portal</p>

        <div className="flex bg-slate-950/80 p-1.5 rounded-2xl mb-8 border border-slate-800/80">
          <button
            className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 ${mode === 'login' ? 'bg-gradient-to-r from-teal-500 to-teal-500 text-slate-950 shadow-lg shadow-teal-500/20' : 'text-slate-400 hover:text-white'}`}
            onClick={() => { setMode('login'); setError(''); setSuccess('') }}
          >
            Log In
          </button>
          <button
            className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 ${mode === 'signup' ? 'bg-gradient-to-r from-teal-500 to-teal-500 text-slate-950 shadow-lg shadow-teal-500/20' : 'text-slate-400 hover:text-white'}`}
            onClick={() => { setMode('signup'); setError(''); setSuccess('') }}
          >
            Sign Up
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-2xl font-bold backdrop-blur-sm">{error}</div>}
        {success && <div className="mb-6 p-4 bg-teal-500/10 border border-teal-500/30 text-teal-400 text-xs rounded-2xl font-bold backdrop-blur-sm">{success}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Enter Email</label>
            <input
              className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl px-4 py-3.5 text-white text-sm font-medium focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder:text-slate-600"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. your_name@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Enter Password</label>
            <input
              className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl px-4 py-3.5 text-white text-sm font-medium focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder:text-slate-600"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Confirm Password</label>
              <input
                className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl px-4 py-3.5 text-white text-sm font-medium focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder:text-slate-600"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          )}

          <button className="w-full mt-4 bg-gradient-to-r from-teal-600 to-teal-500 hover:opacity-95 text-slate-950 font-black py-4 rounded-2xl transition-all duration-300 shadow-xl shadow-teal-500/20 hover:shadow-teal-500/35 hover:-translate-y-0.5 active:translate-y-0 text-sm tracking-wide" type="submit" disabled={loading}>
            {loading ? 'Authenticating System...' : mode === 'login' ? 'Access Dashboard' : 'Initialize Account'}
          </button>
        </form>

        {/* ===== NEW: GOOGLE BUTTON UI ===== */}
        <GoogleOAuthProvider clientId="694408535156-it1itq096lqf92e2em5fv69opupik1a1.apps.googleusercontent.com">
          <div className="mt-8">
            <div className="relative flex items-center justify-center mb-6">
              <div className="border-t border-slate-800/80 w-full"></div>
              <span className="bg-slate-900 px-3 text-[10px] font-black text-slate-500 uppercase tracking-widest absolute">
                Or Continue With
              </span>
            </div>
            
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google Sign-In window failed to load.')}
                shape="pill"
                theme="filled_black"
              />
            </div>
          </div>
        </GoogleOAuthProvider>
        {/* ================================= */}
        
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// SIDEBAR
// ---------------------------------------------------------------------
const NAV_ITEMS = [
  ['Dashboard', '⌂'],
  ['Weather Updates', '☁'],
  ['Crypto Updates', '₿'],
  ['Your AI Assistant', '✦'],
  ['Email Agent', '✉'],
  ['Web Search Agent', '⌕'],
  ['Image Generator', '◈'],
  ['Email Reader', '▤'],
  ['Calendar Agent', '◷'],
  ['Create Account', '+'],
  ['Deposit', '↓'],
  ['Withdraw', '↑'],
  ['Transfer', '⇄'],
  ['View Balance', '$'],
  ['Transaction History', '↺'],
  ['All Accounts', '◎'],
]

function Sidebar({ page, setPage, email, onLogout }) {
  return (
    <div className="w-72 bg-white/80 backdrop-blur-xl border-r border-slate-200/80 flex flex-col h-screen p-5 sticky top-0 shadow-[4px_0_28px_rgba(15,23,42,0.045)]">
      <div className="mb-7 rounded-2xl border border-slate-200/80 bg-slate-950 p-4 text-white shadow-lg shadow-slate-900/10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/15 text-lg font-black text-teal-300">A</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black tracking-tight">Apex Capital Bank</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">AI Banking Platform</div>
          </div>
        </div>
      </div>

      <div className="mb-3 px-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Workspace</div>
      <div className="flex-1 space-y-1 overflow-y-auto pr-1 scrollbar-none">
        {NAV_ITEMS.map(([item, icon]) => {
          const isActive = page === item
          return (
            <button
              key={item}
              title={item}
              className={`w-full text-left px-3 py-2.5 rounded-2xl text-sm font-bold transition-all duration-200 flex items-center gap-3 group ${isActive ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/15 translate-x-1' : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-900'}`}
              onClick={() => setPage(item)}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black ${isActive ? 'bg-teal-400/15 text-teal-300' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-800'}`}>{icon}</span>
              <span className="truncate">{item}</span>
              {isActive && <div className="ml-auto w-1.5 h-1.5 bg-teal-400 rounded-full shadow-sm animate-pulse" />}
            </button>
          )
        })}
      </div>

      <div className="pt-6 border-t border-slate-100 mt-4">
        <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-2xl mb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-xs font-black text-teal-700">{String(email || 'U').charAt(0).toUpperCase()}</div>
            <div className="min-w-0">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Active Session</div>
              <div className="text-xs font-black text-slate-800 truncate">{email}</div>
            </div>
          </div>
        </div>
        <button className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-2xl text-xs transition-all shadow-sm" onClick={onLogout}>
          Sign Out
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// SVG LIQUIDITY TREND CHART
// ---------------------------------------------------------------------
function LiquidityTrendChart() {
  const points = [
    { month: 'Jan', val: 320 },
    { month: 'Feb', val: 450 },
    { month: 'Mar', val: 410 },
    { month: 'Apr', val: 680 },
    { month: 'May', val: 590 },
    { month: 'Jun', val: 740 },
    { month: 'Jul', val: 830 },
  ]

  const maxVal = 1000
  const height = 120
  const width = 600

  const svgPoints = points.map((p, idx) => {
    const x = (idx / (points.length - 1)) * width
    const y = height - (p.val / maxVal) * height
    return `${x},${y}`
  }).join(' ')

  const areaPath = `M 0,${height} L ${svgPoints} L ${width},${height} Z`

  return (
    <div className="mt-6 pt-6 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Capital Growth Velocity</span>
          <p className="text-xs font-semibold text-slate-500">System Liquidity Trajectory</p>
        </div>
        <span className="text-xs font-extrabold text-teal-600 bg-teal-50 px-3 py-1 rounded-full border border-teal-100/80">
          ↑ 159.3% Growth
        </span>
      </div>

      <div className="relative w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 overflow-visible">
          <defs>
            <linearGradient id="tealArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f766e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#0f766e" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <line x1="0" y1="0" x2={width} y2="0" stroke="#f1f5f9" strokeDasharray="4" />
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#f1f5f9" strokeDasharray="4" />
          <line x1="0" y1={height} x2={width} y2={height} stroke="#f1f5f9" strokeDasharray="4" />

          <path d={areaPath} fill="url(#tealArea)" />

          <polyline
            fill="none"
            stroke="#0f766e"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={svgPoints}
          />

          {points.map((p, idx) => {
            const x = (idx / (points.length - 1)) * width
            const y = height - (p.val / maxVal) * height
            return (
              <g key={idx} className="group/dot cursor-pointer">
                <circle cx={x} cy={y} r="5" className="fill-white stroke-teal-600 stroke-[3] group-hover/dot:r-7 transition-all duration-200" />
              </g>
            )
          })}
        </svg>

        <div className="flex justify-between text-[10px] font-black text-slate-400 mt-2 font-mono">
          {points.map(p => <span key={p.month}>{p.month}</span>)}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// ENHANCED ANALYTICS DASHBOARD
// ---------------------------------------------------------------------
function Dashboard({ email, onNavigate }) {
  const [accounts, setAccounts] = useState([])
  const [weather, setWeather] = useState([])
  const [crypto, setCrypto] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  async function loadDashboardData(showRefreshState = false) {
    if (showRefreshState) setRefreshing(true)
    setError('')

    try {
      const [accountData, weatherData, cryptoData] = await Promise.all([
        api.listAccounts(),
        api.getWeatherCities(),
        api.getCryptoCurrencies(),
      ])

      setAccounts(accountData || [])
      setWeather(weatherData?.cities || [])
      setCrypto(cryptoData?.currencies || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadDashboardData()

    const interval = setInterval(() => {
      loadDashboardData()
    }, 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  const totalAccounts = accounts.length
  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0)
  const avgBalance = totalAccounts ? totalBalance / totalAccounts : 0
  const maxBalance = Math.max(1, ...accounts.map((a) => Number(a.balance || 0)))
  const topAccount = accounts.reduce(
    (best, account) => (!best || Number(account.balance || 0) > Number(best.balance || 0) ? account : best),
    null
  )

  const firstName = email?.split('@')[0]?.split(/[._-]/)[0]
  const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : 'there'
  const lahoreWeather = weather.find((city) => city.city === 'Lahore') || weather[0]
  const bitcoin = crypto.find((coin) => coin.name === 'Bitcoin') || crypto[0]

  return (
    <div className="max-w-7xl mx-auto animate-fade-in pb-10">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-slate-950 text-white p-7 md:p-9 mb-6 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
        <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="absolute right-20 -bottom-40 h-80 w-80 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="absolute left-1/2 top-0 h-48 w-48 -translate-x-1/2 rounded-full bg-teal-400/5 blur-3xl" />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-7">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/20 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-teal-300 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.8)] animate-pulse" />
              Banking Command Center
            </div>

            <h1 className="mt-5 text-4xl md:text-5xl xl:text-6xl font-black tracking-tight">
              Welcome back, {displayName}.
            </h1>

            <p className="mt-3 max-w-2xl text-sm md:text-base font-medium leading-relaxed text-slate-300">
              Your accounts, liquidity, live markets and intelligent banking tools are all in one place.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start xl:self-center">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-md min-w-[165px]">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">System Status</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-black text-teal-300">
                <span className="h-2.5 w-2.5 rounded-full bg-teal-400 animate-pulse" />
                Live & Synchronized
              </div>
            </div>

            <button
              onClick={() => loadDashboardData(true)}
              disabled={refreshing}
              className="min-w-[130px] rounded-2xl bg-white px-5 py-4 text-sm font-black text-slate-900 shadow-xl transition-all hover:-translate-y-0.5 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? 'Refreshing…' : '↻ Refresh Data'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-600">
          {error}
        </div>
      )}

      {/* KPI CARDS */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 rounded-[2rem] border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Total Balance',
              value: `$${totalBalance.toFixed(2)}`,
              detail: 'Across all active accounts',
              icon: '◆',
              accent: 'teal',
            },
            {
              label: 'Available Funds',
              value: `$${totalBalance.toFixed(2)}`,
              detail: 'Fully liquid capital',
              icon: '↗',
              accent: 'teal',
            },
            {
              label: 'Active Accounts',
              value: totalAccounts,
              detail: 'Connected banking profiles',
              icon: '◎',
              accent: 'slate',
            },
            {
              label: 'Average Balance',
              value: `$${avgBalance.toFixed(2)}`,
              detail: 'Average per account',
              icon: '≈',
              accent: 'slate',
            },
          ].map((card) => (
            <div
              key={card.label}
              className="group relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_45px_rgba(15,23,42,0.09)]"
            >
              <div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full ${
                card.accent === 'teal' ? 'bg-teal-50' : 'bg-slate-50'
              } transition-transform duration-500 group-hover:scale-125`} />

              <div className="relative z-10">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{card.label}</div>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ${
                    card.accent === 'teal' ? 'bg-teal-50 text-teal-600' : 'bg-slate-50 text-slate-600'
                  }`}>
                    {card.icon}
                  </div>
                </div>

                <div className="mt-7 text-3xl font-black tracking-tight text-slate-900">{card.value}</div>
                <div className="mt-2 text-xs font-semibold text-slate-400">{card.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ANALYTICS + QUICK ACTIONS */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-6 mb-6">
        <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 md:p-7 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Balance Overview</div>
              <h3 className="mt-1 text-xl font-black text-slate-900">Capital distribution</h3>
              <p className="mt-1 text-xs font-medium text-slate-400">Current account allocation and liquidity trajectory</p>
            </div>
            <div className="rounded-xl bg-teal-50 px-3 py-2 text-right">
              <div className="text-[9px] font-black uppercase tracking-wider text-teal-600">Liquidity</div>
              <div className="text-sm font-black text-teal-700">100%</div>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {accounts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                No accounts initialized yet.
              </div>
            ) : (
              accounts.map((account) => (
                <div key={account.account_id} className="group">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white group-hover:bg-teal-600 transition-colors">
                        {account.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-800">{account.name}</div>
                        <div className="text-[10px] font-mono font-bold text-slate-400">#{account.account_number}</div>
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-sm font-black text-slate-900">${Number(account.balance || 0).toFixed(2)}</div>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal-700 to-teal-400 transition-all duration-700 group-hover:brightness-110"
                      style={{ width: `${(Number(account.balance || 0) / maxBalance) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <LiquidityTrendChart />
        </div>

        <div className="rounded-[2rem] border border-slate-200/80 bg-slate-950 p-6 shadow-[0_18px_45px_rgba(15,23,42,0.12)] text-white">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-teal-300">Quick Actions</div>
          <h3 className="mt-1 text-xl font-black">Move money faster</h3>
          <p className="mt-1 text-xs font-medium leading-relaxed text-slate-400">Jump directly into your most-used banking operations.</p>

          <div className="mt-6 space-y-3">
            {[
              ['＋', 'Create Account', 'Open a new banking profile'],
              ['↓', 'Deposit', 'Add funds to an account'],
              ['↑', 'Withdraw', 'Move available funds out'],
              ['⇄', 'Transfer', 'Route funds between accounts'],
            ].map(([icon, title, detail]) => (
              <button
                key={title}
                onClick={() => onNavigate(title)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-teal-400/30 hover:bg-white/[0.08]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-400/10 text-lg font-black text-teal-300">{icon}</div>
                  <div>
                    <div className="text-sm font-black">{title}</div>
                    <div className="mt-0.5 text-[10px] font-medium text-slate-400">{detail}</div>
                  </div>
                  <div className="ml-auto text-slate-500">→</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* LIVE DATA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Live Weather</div>
              <h3 className="mt-1 text-lg font-black text-slate-900">Lahore</h3>
            </div>
            <div className="text-3xl">{lahoreWeather ? <WeatherIcon condition={lahoreWeather.current.condition} /> : '🌤️'}</div>
          </div>

          {lahoreWeather ? (
            <>
              <div className="mt-5 flex items-end gap-3">
                <div className="text-4xl font-black text-slate-900">{Math.round(lahoreWeather.current.temperature)}°</div>
                <div className="pb-1 text-xs font-bold text-slate-400">Celsius</div>
              </div>
              <div className="mt-1 text-sm font-bold text-slate-500">{lahoreWeather.current.condition}</div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[9px] font-black uppercase text-slate-400">Feels</div>
                  <div className="mt-1 text-xs font-black text-slate-800">{Math.round(lahoreWeather.current.feels_like)}°C</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[9px] font-black uppercase text-slate-400">Wind</div>
                  <div className="mt-1 text-xs font-black text-slate-800">{Math.round(lahoreWeather.current.wind_speed)} km/h</div>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-8 h-20 rounded-2xl bg-slate-50 animate-pulse" />
          )}
        </div>

        <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Live Crypto</div>
              <h3 className="mt-1 text-lg font-black text-slate-900">Bitcoin</h3>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-teal-300">₿</div>
          </div>

          {bitcoin ? (
            <>
              <div className="mt-5 text-4xl font-black text-slate-900">{formatCryptoPrice(bitcoin.price_usd)}</div>
              <div className={`mt-1 text-sm font-black ${bitcoin.price_change_24h_percent >= 0 ? 'text-teal-600' : 'text-rose-600'}`}>
                {bitcoin.price_change_24h_percent >= 0 ? '↑' : '↓'} {Math.abs(bitcoin.price_change_24h_percent).toFixed(2)}% today
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[9px] font-black uppercase text-slate-400">24h High</div>
                  <div className="mt-1 text-xs font-black text-slate-800">{formatCryptoPrice(bitcoin.high_24h_usd)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[9px] font-black uppercase text-slate-400">24h Low</div>
                  <div className="mt-1 text-xs font-black text-slate-800">{formatCryptoPrice(bitcoin.low_24h_usd)}</div>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-8 h-20 rounded-2xl bg-slate-50 animate-pulse" />
          )}
        </div>

        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-teal-700 via-teal-800 to-slate-950 p-6 text-white shadow-[0_18px_45px_rgba(15,118,110,0.20)]">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-teal-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10">✦</span>
              AI Banking Assistant
            </div>
            <h3 className="mt-5 text-2xl font-black leading-tight">Your banking copilot is ready.</h3>
            <p className="mt-2 text-xs font-medium leading-relaxed text-teal-50/80">
              Ask about balances, transfers, accounts, policies and more using natural language.
            </p>
            <button
              onClick={() => onNavigate('Your AI Assistant')}
              className="mt-6 rounded-xl bg-white px-4 py-3 text-xs font-black text-slate-950 transition-all hover:-translate-y-0.5 hover:bg-teal-50"
            >
              Open AI Assistant →
            </button>
          </div>
        </div>
      </div>

      {/* ACCOUNTS */}
      <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 md:p-7 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Portfolio</div>
            <h3 className="mt-1 text-xl font-black text-slate-900">Your Accounts</h3>
            <p className="mt-1 text-xs font-medium text-slate-400">Live view of your connected banking profiles</p>
          </div>

          {topAccount && (
            <div className="rounded-2xl bg-teal-50 border border-teal-100 px-4 py-3">
              <div className="text-[9px] font-black uppercase tracking-wider text-teal-600">Largest account</div>
              <div className="mt-1 text-sm font-black text-teal-800">{topAccount.name} · ${Number(topAccount.balance || 0).toFixed(2)}</div>
            </div>
          )}
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm font-semibold text-slate-400">
            No accounts found. Create your first account to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map((account) => (
              <div
                key={account.account_id}
                className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-teal-200 hover:bg-white hover:shadow-xl"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white group-hover:bg-teal-600 transition-colors">
                      {account.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-900">{account.name}</div>
                      <div className="mt-0.5 text-[10px] font-mono font-bold text-slate-400">Account #{account.account_number}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-black text-slate-900 font-mono">${Number(account.balance || 0).toFixed(2)}</div>
                    <div className="text-[9px] font-black uppercase tracking-wider text-teal-600">Active</div>
                  </div>
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-700 to-teal-400 transition-all duration-700"
                    style={{ width: `${(Number(account.balance || 0) / maxBalance) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// CREATE ACCOUNT
// ---------------------------------------------------------------------
function CreateAccountPage({email}) {
  const [name, setName] = useState('')
  const [startingBalance, setStartingBalance] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setResult(null)
    try {
      const account = await api.createAccount(name.trim(), Number(startingBalance) || 0, email)
      setResult(account)
      setName('')
      setStartingBalance('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="max-w-xl animate-fade-in">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Create Account</h2>
        <p className="text-slate-500 text-sm font-medium mt-1">Open a new secure client banking profile</p>
      </div>

      <div className="bg-white border border-slate-200/80 p-10 rounded-[2.5rem] shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Account Holder Name</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Wahaj Ahmed"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Initial Funding Balance</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              min="0"
              step="0.01"
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <button className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-teal-600/25 active:scale-[0.99]" type="submit">
            Initialize Account Profile
          </button>
        </form>

        {error && <div className="mt-6 p-4 bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-2xl font-bold">{error}</div>}
        {result && (
          <div className="mt-6 p-5 bg-teal-50 border border-teal-200 text-teal-800 text-sm font-mono rounded-2xl font-bold">
            ✓ Success! ID {result.account_id} · #{result.account_number} · Balance ${result.balance.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// DEPOSIT / WITHDRAW
// ---------------------------------------------------------------------
function AmountActionPage({ title, subtitle, actionLabel, onSubmit }) {
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setResult(null)
    try {
      const account = await onSubmit(Number(accountId), Number(amount))
      setResult(account)
      setAmount('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="max-w-xl animate-fade-in">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">{title}</h2>
        <p className="text-slate-500 text-sm font-medium mt-1">{subtitle}</p>
      </div>

      <div className="bg-white border border-slate-200/80 p-10 rounded-[2.5rem] shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Enter Account Number</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="e.g., 1"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Enter Transaction Amount</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
          <button className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-teal-600/25 active:scale-[0.99]" type="submit">
            {actionLabel}
          </button>
        </form>

        {error && <div className="mt-6 p-4 bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-2xl font-bold">{error}</div>}
        {result && result.new_balance !== undefined && (
          <div className="mt-6 p-5 bg-teal-50 border border-teal-200 text-teal-800 text-sm font-mono rounded-2xl font-bold">
            ✓ Updated Ledger — {result.name}: ${result.new_balance.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// TRANSFER
// ---------------------------------------------------------------------
function TransferPage({ email }) {
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setResult(null)
    try {
      // Pass email for authorization
      const res = await api.transfer(Number(fromId), Number(toId), Number(amount), email)
      setResult(res)
      setAmount('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="max-w-xl animate-fade-in">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Fund Transfer</h2>
        <p className="text-slate-500 text-sm font-medium mt-1">Execute secure inter-account capital routing</p>
      </div>

      <div className="bg-white border border-slate-200/80 p-10 rounded-[2.5rem] shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Sender Account Number</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              placeholder="1"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Receiver Account Number</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              placeholder="2"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Transfer Amount</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
          <button className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-teal-600/25 active:scale-[0.99]" type="submit">
            Authorize Transfer
          </button>
        </form>

        {error && <div className="mt-6 p-4 bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-2xl font-bold">{error}</div>}
        {result && result.from_account && result.to_account && (
          <div className="mt-6 p-5 bg-teal-50 border border-teal-200 text-teal-800 text-sm font-mono rounded-2xl font-bold">
            ✓ Transfer Verified · {result.from_account.name}: ${result.from_account.balance.toFixed(2)} → {result.to_account.name}: ${result.to_account.balance.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// VIEW BALANCE
// ---------------------------------------------------------------------
function ViewBalancePage({ email }) {
  const [accountId, setAccountId] = useState('')
  const [account, setAccount] = useState(null)
  const [error, setError] = useState('')

  async function handleCheck(e) {
    e.preventDefault()
    setError('')
    setAccount(null)
    try {
      // Pass email for permission check
      const result = await api.getAccount(Number(accountId), email)
      setAccount(result)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="max-w-xl animate-fade-in">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Balance Inquiry</h2>
        <p className="text-slate-500 text-sm font-medium mt-1">Instant liquidity lookup for specified profile</p>
      </div>

      <div className="bg-white border border-slate-200/80 p-10 rounded-[2.5rem] shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
        <form onSubmit={handleCheck} className="space-y-6">
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Account Number</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-4 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="1"
              required
            />
          </div>
          <button className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-teal-600/25 active:scale-[0.99]" type="submit">
            Query Balance
          </button>
        </form>

        {error && <div className="mt-6 p-4 bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-2xl font-bold">{error}</div>}
        {account && (
          <div className="mt-6 p-8 bg-slate-900 text-white rounded-3xl flex items-center justify-between shadow-lg shadow-slate-900/10">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{account.name}</div>
              <div className="text-[10px] font-mono text-slate-500">Account #{account.account_number}</div>
            </div>
            <div className="text-3xl font-black text-teal-400 font-mono">${account.balance.toFixed(2)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// TRANSACTION HISTORY
// ---------------------------------------------------------------------
function TransactionHistoryPage({ email }) {
  const [accountId, setAccountId] = useState('')
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')

  async function handleFetch(e) {
    e.preventDefault()
    setError('')
    setHistory(null)
    try {
      // Pass email for permission check
      const result = await api.transactionHistory(Number(accountId), email)
      setHistory(result)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="max-w-4xl animate-fade-in">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Audit History</h2>
        <p className="text-slate-500 text-sm font-medium mt-1">Immutable transaction ledger and movement logs</p>
      </div>

      <div className="bg-white border border-slate-200/80 p-6 rounded-[2.5rem] shadow-[0_10px_30px_rgba(15,23,42,0.045)] mb-8">
        <form onSubmit={handleFetch} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Account Number</label>
            <input
              className="w-full bg-slate-50/50 border border-slate-200/80 rounded-2xl px-4 py-3.5 text-slate-900 text-sm font-medium focus:outline-none focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10 transition-all"
              type="number"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="1"
              required
            />
          </div>
          <button className="bg-teal-600 hover:bg-teal-500 text-white font-bold px-8 py-3.5 rounded-2xl transition-all shadow-xl shadow-teal-600/25 active:scale-[0.99]" type="submit">
            Fetch Log
          </button>
        </form>
        {error && <div className="mt-4 p-4 bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-2xl font-bold">{error}</div>}
      </div>

      {history && (
        history.length === 0 ? (
          <div className="bg-white border border-slate-200/80 rounded-[2.5rem] p-16 text-center text-slate-400 text-sm font-semibold">No transactional audit logs found for this account.</div>
        ) : (
          <div className="bg-white border border-slate-200/80 rounded-[2.5rem] overflow-hidden shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 text-[11px] font-black uppercase tracking-wider bg-slate-50/50">
                  <th className="p-5">Type</th>
                  <th className="p-5">Amount</th>
                  <th className="p-5">Balance After</th>
                  <th className="p-5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm font-medium">
                {history.map((t, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-5">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${t.type === 'deposit' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="p-5 font-mono font-bold text-slate-900">${t.amount.toFixed(2)}</td>
                    <td className="p-5 font-mono text-slate-600">${t.balance_after.toFixed(2)}</td>
                    <td className="p-5 font-mono text-slate-400 text-xs">{t.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// ALL ACCOUNTS
// ---------------------------------------------------------------------
function AllAccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listAccounts()
      .then(setAccounts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl animate-fade-in">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Account Registry</h2>
        <p className="text-slate-500 text-sm font-medium mt-1">Complete system database of active banking profiles</p>
      </div>

      {error && <div className="p-4 bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-2xl mb-6 font-bold">{error}</div>}
      
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white border border-slate-200/60 rounded-3xl animate-pulse shadow-sm" />)}
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-[2.5rem] p-16 text-center text-slate-400 text-sm font-semibold">No accounts found in registry.</div>
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-[2.5rem] overflow-hidden shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 text-[11px] font-black uppercase tracking-wider bg-slate-50/50">
                <th className="p-5">ID</th>
                <th className="p-5">Account Number</th>
                <th className="p-5">Holder Name</th>
                <th className="p-5">Current Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-medium">
              {accounts.map((a) => (
                <tr key={a.account_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-5 font-mono text-slate-400 font-bold">#{a.account_id}</td>
                  <td className="p-5 font-mono text-slate-600">{a.account_number}</td>
                  <td className="p-5 font-extrabold text-slate-900">{a.name}</td>
                  <td className="p-5 font-mono text-teal-600 font-black text-base">${a.balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// AI AGENT & RAG PAGE (With Split History & email Check)
// ---------------------------------------------------------------------
function AIAgentPage({ email }) {
  const [mode, setMode] = useState('agent')
  const [agentMessages, setAgentMessages, clearAgentHistory, agentConversation] = useChatHistory(email, 'banking-agent')
  const [ragMessages, setRagMessages, clearRagHistory, ragConversation] = useChatHistory(email, 'rag-agent')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const messages = mode === 'agent' ? agentMessages : ragMessages
  const setMessages = mode === 'agent' ? setAgentMessages : setRagMessages
  const clearHistory = mode === 'agent' ? clearAgentHistory : clearRagHistory

  async function handleSend(e) {
    e.preventDefault()
    if (!input.trim()) return

    const text = input.trim()
    const userMsg = { role: 'user', text }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput('')
    setLoading(true)

    try {
      if (mode === 'agent') {
        const res = await api.chatAgent(text, messages, email)
        setMessages([...newHistory, { role: 'assistant', text: res.response }])
      } else {
        const res = await api.askPolicy(text, messages)
        setMessages([...newHistory, { role: 'assistant', text: res.answer }])
      }
    } catch (err) {
      setMessages([...newHistory, { role: 'assistant', text: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-5rem)] flex flex-col animate-fade-in">
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Your AI Assistant</h2>
          <p className="text-slate-500 text-sm font-medium mt-1">Autonomous banking actions and policy intelligence</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-full border border-slate-200 shadow-sm">
          <button className={`px-5 py-2 text-xs font-black rounded-full transition-all ${mode === 'agent' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`} onClick={() => setMode('agent')}>Banking Agent</button>
          <button className={`px-5 py-2 text-xs font-black rounded-full transition-all ${mode === 'rag' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`} onClick={() => setMode('rag')}>RAG Intelligence</button>
        </div>
      </div>

      <AgentConversationCard
        agentKey={mode === 'agent' ? 'banking-agent' : 'rag-agent'}
        conversation={mode === 'agent' ? agentConversation : ragConversation}
        messages={messages}
        loading={loading}
        onClear={clearHistory}
        label={mode === 'agent' ? 'Banking AI conversation' : 'RAG conversation'}
        emptyIcon="AI"
        emptyTitle={mode === 'agent' ? 'How can I help with your banking?' : 'Ask about banking policy'}
        emptyText={mode === 'agent' ? 'Ask naturally about balances, transfers, accounts, or other supported banking actions.' : 'Ask questions about institutional protocols, terms, and compliance documents.'}
        loadingText={mode === 'agent' ? 'Working on your banking request…' : 'Reviewing policy information…'}
        input={input}
        setInput={setInput}
        onSubmit={handleSend}
        placeholder={mode === 'agent' ? 'Message your Banking AI…' : 'Message your RAG assistant…'}
        submitLabel="Send"
        multiline
      />
    </div>
  )
}

// ---------------------------------------------------------------------
// AI EMAIL AGENT
// ---------------------------------------------------------------------
function EmailAgentPage({ email }) {
  const [messages, setMessages, clearHistory, conversation] = useChatHistory(email, 'email-agent')
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function generateDraft(e) {
    e.preventDefault()
    if (!prompt.trim()) return
    const text = prompt.trim()
    const history = messages
    const userMsg = { role: 'user', text }
    setMessages([...history, userMsg])
    setPrompt('')
    setLoading(true)
    setError('')
    setStatus('')
    setDraft(null)

    try {
      const result = await api.createEmailDraft(text, email, history)
      setDraft(result)
      setMessages([...history, userMsg, { role: 'assistant', text: `Draft prepared for ${result.recipient}. Review the draft panel before sending.` }])
      setStatus('Draft ready. Review it below and send only when you are satisfied.')
    } catch (err) {
      setError(err.message)
      setMessages([...history, userMsg, { role: 'assistant', text: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  async function sendDraft() {
    if (!draft) return
    setSending(true)
    setError('')
    setStatus('')
    try {
      await api.sendEmail(draft.recipient, draft.subject, draft.body, email)
      setStatus('Email sent successfully through Gmail.')
      setMessages(prev => [...prev, { role: 'assistant', text: `Email sent successfully to ${draft.recipient}.` }])
      setDraft(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function clearChat() {
    clearHistory()
    setDraft(null)
    setStatus('')
    setError('')
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <GoogleConnectionCard provider="gmail" email={email} />
      <AgentHero icon="✉" eyebrow="AI EMAIL AGENT" title="Write professional emails" subtitle="Describe what you want to say, review the generated draft, and approve it before anything is sent." />
      {error && <AgentError text={error} />}

      <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-6">
        <div>
          <AgentConversationCard
            messages={messages}
            loading={loading}
            onClear={clearChat}
            agentKey="email-agent"
        conversation={conversation}
        label="Email conversation"
            emptyIcon="✉"
            emptyTitle="Your email assistant is ready"
            emptyText="Tell the agent who you want to email and what you want to say. Your conversation stays visible while you review the draft."
            loadingText="Writing your professional email…"
            input={prompt}
            setInput={setPrompt}
            onSubmit={generateDraft}
            placeholder="e.g. Send an email to abc@gmail.com about tomorrow's meeting…"
            submitLabel="Draft Email"
            multiline
          />
          {status && <div className="mt-4 rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs font-bold text-teal-700">{status}</div>}
        </div>

        <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Review & approve</div>
          <h3 className="mt-1 text-xl font-black text-slate-900">Email Preview</h3>
          {!draft ? (
            <div className="mt-6 flex min-h-80 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center px-8">
              <div><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-slate-200 text-lg shadow-sm">✉</div><div className="mt-4 text-sm font-black text-slate-700">No draft yet</div><div className="mt-1 text-xs font-medium text-slate-400">Describe the email in the conversation to generate a draft.</div></div>
            </div>
          ) : (
            <div className="mt-5">
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Recipient</label>
              <input className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-teal-500" value={draft.recipient} onChange={e => setDraft({ ...draft, recipient: e.target.value })} />
              <label className="mt-4 block text-[10px] font-black uppercase tracking-wider text-slate-400">Subject</label>
              <input className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-teal-500" value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
              <label className="mt-4 block text-[10px] font-black uppercase tracking-wider text-slate-400">Message</label>
              <textarea className="mt-2 w-full min-h-56 resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium leading-relaxed text-slate-800 outline-none focus:border-teal-500" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
              <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">Review the recipient, subject, and message. You can edit anything before sending.</div>
              <button type="button" onClick={sendDraft} disabled={sending} className="mt-4 w-full rounded-2xl bg-teal-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-teal-600/20 transition-all hover:bg-teal-500 disabled:opacity-50">{sending ? 'Sending through Gmail…' : '✓ Send Email'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// WEATHER
// ---------------------------------------------------------------------
const WEATHER_ICONS = {
  'Clear sky': '☀️',
  'Mainly clear': '🌤️',
  'Partly cloudy': '⛅',
  'Overcast': '☁️',
  'Fog': '🌫️',
  'Depositing rime fog': '🌫️',
  'Slight drizzle': '🌦️',
  'Moderate drizzle': '🌦️',
  'Dense drizzle': '🌧️',
  'Slight rain': '🌦️',
  'Moderate rain': '🌧️',
  'Heavy rain': '🌧️',
  'Slight rain showers': '🌦️',
  'Moderate rain showers': '🌧️',
  'Violent rain showers': '⛈️',
  'Thunderstorm': '⛈️',
  'Thunderstorm with slight hail': '⛈️',
  'Thunderstorm with heavy hail': '⛈️',
}

function WeatherIcon({ condition }) {
  return <span className="text-3xl" aria-hidden="true">{WEATHER_ICONS[condition] || '🌤️'}</span>
}

function formatWeatherDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function WeatherPage({ email }) {
  const [cities, setCities] = useState([])
  const [selectedCity, setSelectedCity] = useState('Lahore')
  const [selectedWeather, setSelectedWeather] = useState(null)
  const [mode, setMode] = useState('manual')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages, clearHistory, conversation] = useChatHistory(email, 'weather-agent')
  const [agentLoading, setAgentLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, agentLoading])

  async function loadWeather() {
    setError('')
    try {
      const data = await api.getWeatherCities()
      setCities(data.cities || [])
      const selected = (data.cities || []).find(c => c.city === selectedCity) || data.cities?.[0]
      if (selected) {
        setSelectedCity(selected.city)
        setSelectedWeather(selected)
      }
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadSelectedCity(city) {
    setSelectedCity(city)
    setDetailLoading(true)
    setError('')
    try {
      const data = await api.getWeatherCity(city)
      setSelectedWeather(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    loadWeather()
    const interval = setInterval(loadWeather, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  async function handleWeatherChat(e) {
    e.preventDefault()
    if (!input.trim() || agentLoading) return

    const text = input.trim()
    const userMsg = { role: 'user', text }
    const history = messages
    setMessages([...history, userMsg])
    setInput('')
    setAgentLoading(true)

    try {
      const result = await api.askWeatherAgent(text, history)
      setMessages([...history, userMsg, { role: 'assistant', text: result.response }])
    } catch (err) {
      setMessages([...history, userMsg, { role: 'assistant', text: `Error: ${err.message}` }])
    } finally {
      setAgentLoading(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="mb-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Live Weather</h2>
          <p className="text-slate-500 text-sm font-medium mt-1">
            Live conditions and 5-day forecasts for five supported cities
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-white border border-slate-200 p-1.5 rounded-2xl shadow-sm">
            <button
              onClick={() => setMode('manual')}
              className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all ${mode === 'manual' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Manual Check
            </button>
            <button
              onClick={() => setMode('ai')}
              className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all ${mode === 'ai' ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Ask AI Agent
            </button>
          </div>
          <button
            onClick={loadWeather}
            disabled={loading}
            className="bg-white border border-slate-200 px-4 py-3 rounded-2xl text-xs font-black text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-600 rounded-2xl text-sm font-bold">
          {error}
        </div>
      )}

      {mode === 'manual' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-44 bg-white border border-slate-200 rounded-3xl animate-pulse" />
                ))
              : cities.map((city) => (
                <button
                  key={city.city}
                  onClick={() => loadSelectedCity(city.city)}
                  className={`text-left bg-white border p-5 rounded-3xl shadow-sm hover:-translate-y-1 hover:shadow-xl transition-all ${
                    selectedCity === city.city
                      ? 'border-teal-400 ring-4 ring-teal-500/10'
                      : 'border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-black text-slate-900">{city.city}</span>
                    <WeatherIcon condition={city.current.condition} />
                  </div>
                  <div className="text-4xl font-black text-slate-900">
                    {Math.round(city.current.temperature)}°C
                  </div>
                  <div className="text-xs font-bold text-slate-500 mt-1">{city.current.condition}</div>
                  <div className="text-[10px] font-bold text-slate-400 mt-4">
                    Feels {Math.round(city.current.feels_like)}° · Wind {Math.round(city.current.wind_speed)} km/h
                  </div>
                </button>
              ))}
          </div>

          {selectedWeather && (
            <div className="bg-white border border-slate-200/80 rounded-[2.5rem] p-7 shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-7">
                <div>
                  <div className="flex items-center gap-3">
                    <WeatherIcon condition={selectedWeather.current.condition} />
                    <h3 className="text-2xl font-black text-slate-900">{selectedWeather.city}</h3>
                  </div>
                  <p className="text-xs text-slate-400 font-semibold mt-1">
                    {selectedWeather.timezone} · Live data from Open-Meteo
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-black text-teal-600">{Math.round(selectedWeather.current.temperature)}°C</div>
                  <div className="text-sm font-bold text-slate-500">{selectedWeather.current.condition}</div>
                </div>
              </div>

              {detailLoading && (
                <div className="text-xs text-teal-600 font-bold mb-4">Updating selected city…</div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                {[
                  ['Feels Like', `${Math.round(selectedWeather.current.feels_like)}°C`],
                  ['Humidity', `${selectedWeather.current.humidity}%`],
                  ['Wind', `${Math.round(selectedWeather.current.wind_speed)} km/h`],
                  ['Rain Now', `${selectedWeather.current.precipitation} mm`],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
                    <div className="text-lg font-black text-slate-900 mt-1">{value}</div>
                  </div>
                ))}
              </div>

              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">5-Day Forecast</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {selectedWeather.forecast.map(day => (
                  <div key={day.date} className="border border-slate-200 rounded-2xl p-4">
                    <div className="text-xs font-black text-slate-700">{formatWeatherDate(day.date)}</div>
                    <div className="my-3"><WeatherIcon condition={day.condition} /></div>
                    <div className="text-sm font-bold text-slate-600">{day.condition}</div>
                    <div className="mt-2 text-sm font-black text-slate-900">
                      {Math.round(day.max_temperature)}° / {Math.round(day.min_temperature)}°
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 mt-2">
                      Rain {day.precipitation_probability}% · {day.precipitation} mm
                    </div>
                  </div>
                ))}
              </div>

              {lastUpdated && (
                <div className="text-[10px] font-bold text-slate-400 mt-5">
                  Dashboard refreshed: {lastUpdated.toLocaleTimeString()}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="max-w-5xl">
          <AgentConversationCard
            messages={messages}
            loading={agentLoading}
            onClear={clearHistory}
            agentKey="weather-agent"
        conversation={conversation}
        label="Weather conversation"
            emptyIcon="🌤️"
            emptyTitle="Ask about the weather"
            emptyText="Ask naturally about Lahore, Karachi, Islamabad, Peshawar, or Quetta. The agent uses live weather data before answering."
            loadingText="Checking live weather…"
            input={input}
            setInput={setInput}
            onSubmit={handleWeatherChat}
            placeholder="Message your Weather AI…"
            submitLabel="Send"
            multiline
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// CRYPTO
// ---------------------------------------------------------------------
const CRYPTO_ICONS = {
  Bitcoin: '₿',
  Ethereum: 'Ξ',
  BNB: '◆',
  Solana: '≋',
  XRP: '✕',
}

function formatCryptoPrice(value) {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
}

function CryptoPage({ email }) {
  const [currencies, setCurrencies] = useState([])
  const [selectedAsset, setSelectedAsset] = useState('Bitcoin')
  const [selectedCrypto, setSelectedCrypto] = useState(null)
  const [mode, setMode] = useState('manual')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages, clearHistory, conversation] = useChatHistory(email, 'crypto-agent')
  const [agentLoading, setAgentLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, agentLoading])

  async function loadCrypto() {
    setError('')
    try {
      const data = await api.getCryptoCurrencies()
      setCurrencies(data.currencies || [])
      const selected = (data.currencies || []).find(c => c.name === selectedAsset) || data.currencies?.[0]
      if (selected) {
        setSelectedAsset(selected.name)
        setSelectedCrypto(selected)
      }
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadSelectedCrypto(asset) {
    setSelectedAsset(asset)
    setDetailLoading(true)
    setError('')
    try {
      const data = await api.getCryptoAsset(asset)
      setSelectedCrypto(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    loadCrypto()
    const interval = setInterval(loadCrypto, 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  async function handleCryptoChat(e) {
    e.preventDefault()
    if (!input.trim() || agentLoading) return

    const text = input.trim()
    const userMsg = { role: 'user', text }
    const history = messages
    setMessages([...history, userMsg])
    setInput('')
    setAgentLoading(true)

    try {
      const result = await api.askCryptoAgent(text, history)
      setMessages([...history, userMsg, { role: 'assistant', text: result.response }])
    } catch (err) {
      setMessages([...history, userMsg, { role: 'assistant', text: `Error: ${err.message}` }])
    } finally {
      setAgentLoading(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="mb-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Live Crypto</h2>
          <p className="text-slate-500 text-sm font-medium mt-1">
            Live market prices and 24-hour data for five supported cryptocurrencies
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-white border border-slate-200 p-1.5 rounded-2xl shadow-sm">
            <button
              onClick={() => setMode('manual')}
              className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all ${mode === 'manual' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Manual Check
            </button>
            <button
              onClick={() => setMode('ai')}
              className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all ${mode === 'ai' ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Ask AI Agent
            </button>
          </div>
          <button
            onClick={loadCrypto}
            disabled={loading}
            className="bg-white border border-slate-200 px-4 py-3 rounded-2xl text-xs font-black text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-600 rounded-2xl text-sm font-bold">
          {error}
        </div>
      )}

      {mode === 'manual' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-48 bg-white border border-slate-200 rounded-3xl animate-pulse" />
                ))
              : currencies.map((coin) => (
                <button
                  key={coin.name}
                  onClick={() => loadSelectedCrypto(coin.name)}
                  className={`text-left bg-white border p-5 rounded-3xl shadow-sm hover:-translate-y-1 hover:shadow-xl transition-all ${
                    selectedAsset === coin.name
                      ? 'border-teal-400 ring-4 ring-teal-500/10'
                      : 'border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black">{CRYPTO_ICONS[coin.name] || '$'}</span>
                      <div>
                        <div className="font-black text-slate-900">{coin.name}</div>
                        <div className="text-[10px] font-black text-slate-400">{coin.symbol}</div>
                      </div>
                    </div>
                  </div>
                  <div className="text-3xl font-black text-slate-900">{formatCryptoPrice(coin.price_usd)}</div>
                  <div className={`text-xs font-black mt-2 ${coin.price_change_24h_percent >= 0 ? 'text-teal-600' : 'text-rose-600'}`}>
                    {coin.price_change_24h_percent >= 0 ? '↑' : '↓'} {Math.abs(coin.price_change_24h_percent).toFixed(2)}% 24h
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 mt-4">
                    H {formatCryptoPrice(coin.high_24h_usd)} · L {formatCryptoPrice(coin.low_24h_usd)}
                  </div>
                </button>
              ))}
          </div>

          {selectedCrypto && (
            <div className="bg-white border border-slate-200/80 rounded-[2.5rem] p-7 shadow-[0_10px_30px_rgba(15,23,42,0.045)]">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-7">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl font-black">{CRYPTO_ICONS[selectedCrypto.name] || '$'}</span>
                    <div>
                      <h3 className="text-2xl font-black text-slate-900">{selectedCrypto.name}</h3>
                      <p className="text-xs text-slate-400 font-semibold mt-1">{selectedCrypto.symbol}/USDT · Live data from Binance</p>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-black text-teal-600">{formatCryptoPrice(selectedCrypto.price_usd)}</div>
                  <div className={`text-sm font-black ${selectedCrypto.price_change_24h_percent >= 0 ? 'text-teal-600' : 'text-rose-600'}`}>
                    {selectedCrypto.price_change_24h_percent >= 0 ? '+' : ''}{selectedCrypto.price_change_24h_percent.toFixed(2)}% in 24h
                  </div>
                </div>
              </div>

              {detailLoading && (
                <div className="text-xs text-teal-600 font-bold mb-4">Updating selected asset…</div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                {[
                  ['24h High', formatCryptoPrice(selectedCrypto.high_24h_usd)],
                  ['24h Low', formatCryptoPrice(selectedCrypto.low_24h_usd)],
                  ['24h Volume', selectedCrypto.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 2 })],
                  ['Quote Volume', formatCryptoPrice(selectedCrypto.quote_volume_24h_usd)],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
                    <div className="text-lg font-black text-slate-900 mt-1 truncate">{value}</div>
                  </div>
                ))}
              </div>

              {lastUpdated && (
                <div className="text-[10px] font-bold text-slate-400 mt-5">
                  Dashboard refreshed: {lastUpdated.toLocaleTimeString()} · Prices update automatically every minute
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="max-w-5xl">
          <AgentConversationCard
            messages={messages}
            loading={agentLoading}
            onClear={clearHistory}
            agentKey="crypto-agent"
        conversation={conversation}
        label="Crypto conversation"
            emptyIcon="₿"
            emptyTitle="Ask about the crypto market"
            emptyText="Ask naturally about Bitcoin, Ethereum, BNB, Solana, or XRP. The agent retrieves live market data before answering."
            loadingText="Checking live crypto market data…"
            input={input}
            setInput={setInput}
            onSubmit={handleCryptoChat}
            placeholder="Message your Crypto AI…"
            submitLabel="Send"
            multiline
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// WEB SEARCH AGENT
// ---------------------------------------------------------------------
function WebSearchAgentPage({ email }) {
  const [messages, setMessages, clearHistory, conversation] = useChatHistory(email, 'web-search-agent')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function search(e) {
    e.preventDefault()
    if (!query.trim() || loading) return
    const text = query.trim()
    const history = messages
    const userMsg = { role: 'user', text }
    setMessages([...history, userMsg])
    setQuery('')
    setLoading(true)
    setError('')
    try {
      const response = await api.webSearch(text, history, 5)
      setResult(response)
      setMessages([...history, userMsg, { role: 'assistant', text: response.summary || 'No concise summary was returned.' }])
    } catch (err) {
      setError(err.message)
      setMessages([...history, userMsg, { role: 'assistant', text: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function clearChat() {
    clearHistory()
    setResult(null)
    setError('')
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <AgentHero icon="⌕" eyebrow="WEB SEARCH AGENT" title="Research the live web" subtitle="Search the internet with Tavily and continue the research as a natural conversation." />
      {error && <AgentError text={error} />}

      <AgentConversationCard
        messages={messages}
        loading={loading}
        onClear={clearChat}
        agentKey="web-search-agent"
        conversation={conversation}
        label="Web search conversation"
        emptyIcon="⌕"
        emptyTitle="Ready to research"
        emptyText="Ask anything about the live web. Your questions and AI summaries stay together in this conversation."
        loadingText="Searching the live web…"
        input={query}
        setInput={setQuery}
        onSubmit={search}
        placeholder="e.g. What are the latest developments in AI banking?"
        submitLabel="Search AI"
        multiline
      />

      {result?.results?.length > 0 && (
        <div className="mt-5 bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sources for latest search</div>
          <div className="mt-3 grid gap-3">
            {result.results.map((source, i) => (
              <a key={i} href={source.url} target="_blank" rel="noreferrer" className="block rounded-2xl border border-slate-200 p-4 hover:border-teal-300 hover:bg-teal-50/30 transition-all">
                <div className="text-sm font-black text-slate-800">{source.title || 'Source'}</div>
                <div className="text-xs text-slate-500 mt-1 line-clamp-2">{source.content}</div>
                <div className="text-[10px] text-teal-600 font-bold mt-2 break-all">{source.url}</div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// IMAGE GENERATOR
// ---------------------------------------------------------------------
function ImageGeneratorPage({ email }) {
  const [messages, setMessages, clearHistory, conversation] = useChatHistory(email, 'image-generation-agent')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [size, setSize] = useState('1K')
  const [image, setImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function generate(e) {
    e.preventDefault()
    if (!prompt.trim() || loading) return
    const text = prompt.trim()
    const history = messages
    const userMsg = { role: 'user', text }
    setMessages([...history, userMsg])
    setPrompt('')
    setLoading(true)
    setError('')
    setImage(null)
    try {
      const generated = await api.generateImage(text, ratio, size)
      setImage(generated)
      setMessages([...history, userMsg, { role: 'assistant', text: 'Image generated successfully. The result is shown beside this conversation.' }])
    } catch (err) {
      setError(err.message)
      setMessages([...history, userMsg, { role: 'assistant', text: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function clearChat() {
    clearHistory()
    setImage(null)
    setError('')
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <AgentHero icon="✦" eyebrow="IMAGE GENERATION AGENT" title="Turn ideas into visuals" subtitle="Describe an image naturally and keep every generation prompt in one consistent AI conversation." />
      {error && <AgentError text={error} />}

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.6fr] gap-6">
        <AgentConversationCard
          messages={messages}
          loading={loading}
          onClear={clearChat}
          agentKey="image-generation-agent"
        conversation={conversation}
        label="Image generation conversation"
          emptyIcon="✦"
          emptyTitle="Your image agent is ready"
          emptyText="Describe the visual you want. Previous prompts remain visible here so you can easily continue or refine your ideas."
          loadingText="Creating your image…"
          input={prompt}
          setInput={setPrompt}
          onSubmit={generate}
          placeholder="Describe the image you want…"
          submitLabel="Generate"
          multiline
        />

        <div className="space-y-5">
          <div className="bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Generation settings</div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Aspect ratio</label>
                <select value={ratio} onChange={e => setRatio(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold">
                  <option>1:1</option><option>16:9</option><option>9:16</option><option>4:3</option><option>3:4</option><option>21:9</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Quality</label>
                <select value={size} onChange={e => setSize(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold">
                  <option>1K</option><option>2K</option><option>4K</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm min-h-[360px] flex items-center justify-center">
            {loading ? (
              <div className="text-center"><div className="text-4xl animate-pulse">✦</div><div className="mt-3 font-black text-slate-700">Creating your image…</div><div className="text-xs text-slate-400 mt-1">This can take a little while.</div></div>
            ) : image ? (
              <div className="w-full"><img src={image.image || (image.data_base64 ? `data:${image.mime_type || 'image/png'};base64,${image.data_base64}` : '')} alt="Generated visual" className="w-full rounded-2xl shadow-xl" /><div className="text-[10px] font-bold text-slate-400 mt-3">Model: {image.model} · {image.width}×{image.height}</div></div>
            ) : (
              <EmptyAgentState icon="✦" title="No image generated yet" text="Describe the visual you want and generate it from the conversation." />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// EMAIL READER
// ---------------------------------------------------------------------
function EmailReaderPage({ email }) {
  const [messages, setMessages, clearHistory, conversation] = useChatHistory(email, 'email-reader-agent')
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function read(e) {
    e.preventDefault()
    if (!question.trim() || loading) return
    const text = question.trim()
    const history = messages
    const userMsg = { role: 'user', text }
    setMessages([...history, userMsg])
    setQuestion('')
    setLoading(true)
    setError('')
    try {
      const response = await api.readEmails(text, email, history, 10)
      setResult(response)
      setMessages([...history, userMsg, { role: 'assistant', text: response.answer || 'No answer was returned.' }])
    } catch (err) {
      setError(err.message)
      setMessages([...history, userMsg, { role: 'assistant', text: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function clearChat() {
    clearHistory()
    setResult(null)
    setError('')
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <GoogleConnectionCard provider="gmail" email={email} />
      <AgentHero icon="✉" eyebrow="EMAIL READER AGENT" title="Understand your inbox" subtitle="Ask questions about your recent Gmail messages and continue the conversation naturally." />
      {error && <AgentError text={error} />}

      <AgentConversationCard
        messages={messages}
        loading={loading}
        onClear={clearChat}
        agentKey="email-reader-agent"
        conversation={conversation}
        label="Email reader conversation"
        emptyIcon="✉"
        emptyTitle="Your inbox assistant is ready"
        emptyText="Ask about recent emails, senders, subjects, deadlines, or anything else available in your connected inbox."
        loadingText="Reading your inbox…"
        input={question}
        setInput={setQuestion}
        onSubmit={read}
        placeholder="e.g. Did I receive an email from HR?"
        submitLabel="Read AI"
        multiline
      />

      <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-semibold text-amber-700">This reader is read-only. It does not send, delete, or modify emails.</div>

      {result?.emails?.length > 0 && (
        <div className="mt-5 bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recent messages from latest query</div>
          <div className="mt-4 space-y-3">
            {result.emails.map((mail, i) => (
              <details key={i} className="group rounded-2xl border border-slate-200 p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0"><div className="text-sm font-black text-slate-800 truncate">{mail.subject || '(No subject)'}</div><div className="text-xs text-slate-500 mt-1 truncate">From: {mail.from}</div></div>
                    <div className="text-[10px] text-slate-400 whitespace-nowrap">{mail.date}</div>
                  </div>
                </summary>
                <div className="mt-4 pt-4 border-t border-slate-100 text-xs leading-6 text-slate-600 whitespace-pre-wrap">{mail.body}</div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// CALENDAR AGENT
// ---------------------------------------------------------------------
function CalendarAgentPage({ email }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ summary: '', start: '', end: '', timezone: 'Asia/Karachi', description: '', location: '' })
  const [creating, setCreating] = useState(false)
  const [messages, setMessages, clearHistory, conversation] = useChatHistory(email, 'calendar-agent')
  const [input, setInput] = useState('')
  const [agentLoading, setAgentLoading] = useState(false)
  const chatEndRef = useRef(null)

  async function loadEvents() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getCalendarEvents(10, email)
      setEvents(data.events || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadEvents() }, [email])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, agentLoading])

  async function createEvent(e) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    setError('')
    try {
      await api.createCalendarEvent(form, email)
      setForm({ summary: '', start: '', end: '', timezone: 'Asia/Karachi', description: '', location: '' })
      await loadEvents()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function askAgent(e) {
    e?.preventDefault()
    const prompt = input.trim()
    if (!prompt || agentLoading) return

    const userMessage = { role: 'user', text: prompt }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setAgentLoading(true)
    setError('')

    try {
      const data = await api.askCalendarAgent(prompt, messages, email)
      setMessages([...nextMessages, { role: 'assistant', text: data.response || 'I could not produce a Calendar response.' }])
      await loadEvents()
    } catch (err) {
      setMessages([...nextMessages, { role: 'assistant', text: `**Calendar Agent Error**\n\n${err.message}` }])
    } finally {
      setAgentLoading(false)
    }
  }

  function clearChat() {
    clearHistory()
    setError('')
  }

  const field = (key, label, type = 'text', placeholder = '') => <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</label><input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none focus:border-teal-500" required={key === 'summary' || key === 'start' || key === 'end'} /></div>

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <GoogleConnectionCard provider="calendar" email={email} />
      <AgentHero icon="◷" eyebrow="CALENDAR AGENT" title="Plan your schedule" subtitle="Give the agent a natural-language instruction, read your upcoming events, or create an event manually. Your existing Calendar functionality remains available." />
      {error && <AgentError text={error} />}

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <div>
          <AgentConversationCard
            messages={messages}
            loading={agentLoading}
            onClear={clearChat}
            agentKey="calendar-agent"
        conversation={conversation}
        label="Calendar conversation"
            emptyIcon="◷"
            emptyTitle="Plan your schedule"
            emptyText="Ask about upcoming meetings or give a natural-language instruction to create a Google Calendar event."
            loadingText="Calendar Agent is working…"
            input={input}
            setInput={setInput}
            onSubmit={askAgent}
            placeholder="Message your Calendar Agent…"
            submitLabel="Send"
            multiline
          />
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Upcoming</div><h3 className="text-xl font-black mt-1">Next calendar events</h3></div><button onClick={loadEvents} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black hover:bg-slate-50">↻ Refresh</button></div>
            <div className="mt-5 space-y-3">{loading ? <div className="text-sm text-slate-400">Loading calendar…</div> : events.length === 0 ? <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400">No upcoming events found.</div> : events.map(event => <div key={event.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex justify-between gap-4"><div className="font-black text-slate-800">{event.summary || '(Untitled event)'}</div><div className="text-[10px] font-bold text-slate-400 whitespace-nowrap">{event.start}</div></div>{event.location && <div className="text-xs text-slate-500 mt-2">📍 {event.location}</div>}{event.description && <div className="text-xs text-slate-500 mt-2 line-clamp-2">{event.description}</div>}{event.html_link && <a href={event.html_link} target="_blank" rel="noreferrer" className="inline-block text-[10px] font-black text-teal-600 mt-3">Open in Google Calendar →</a>}</div>)}</div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Manual creation</div>
            <h3 className="text-lg font-black mt-1">Create event directly</h3>
            <form onSubmit={createEvent} className="mt-4 space-y-4">
              {field('summary', 'Title', 'text', 'Team meeting')}
              <div className="grid grid-cols-2 gap-3">{field('start', 'Start', 'datetime-local')}{field('end', 'End', 'datetime-local')}</div>
              {field('location', 'Location', 'text', 'Office / Zoom')}
              <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-teal-500" /></div>
              <button disabled={creating} className="w-full rounded-2xl bg-slate-900 text-white py-4 text-sm font-black hover:bg-teal-700 disabled:opacity-50">{creating ? 'Creating event…' : 'Create Google Calendar Event'}</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function GoogleConnectionCard({ provider, email }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      setStatus(await api.googleStatus(provider, email))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [provider, email])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_connected') === 'true' && params.get('provider') === provider) {
      refresh()
    }
  }, [provider])

  return (
    <div className="mb-5 rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Google connection</div>
          {loading ? <div className="mt-1 text-sm font-bold text-slate-500">Checking connection…</div> : status?.connected ? (
            <div className="mt-1 text-sm font-black text-teal-700">Connected: {status.google_email}</div>
          ) : <div className="mt-1 text-sm font-bold text-slate-700">No Google account connected</div>}
          <div className="mt-1 text-xs font-medium text-slate-400">This Google account belongs only to your Apex session: {email}</div>
          {error && <div className="mt-2 text-xs font-bold text-rose-600">{error}</div>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => api.googleConnect(provider, email)} className="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black text-white hover:bg-teal-700">
            {status?.connected ? 'Reconnect Google' : 'Connect Google'}
          </button>
          {status?.connected && <button onClick={async () => { await api.googleDisconnect(provider, email); await refresh() }} className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-50">Disconnect</button>}
        </div>
      </div>
    </div>
  )
}

function AgentHero({ icon, eyebrow, title, subtitle }) {
  return <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 text-white p-7 md:p-9 mb-6 shadow-[0_24px_60px_rgba(15,23,42,0.14)]"><div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-teal-500/20 blur-3xl" /><div className="relative z-10"><div className="inline-flex items-center gap-2 rounded-full border border-teal-400/20 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-teal-300"><span className="text-base">{icon}</span>{eyebrow}</div><h2 className="mt-4 text-3xl md:text-4xl font-black tracking-tight">{title}</h2><p className="mt-2 max-w-3xl text-sm md:text-base text-slate-300 font-medium leading-relaxed">{subtitle}</p></div></div>
}

function EmptyAgentState({ icon, title, text }) {
  return <div className="h-full min-h-72 flex items-center justify-center text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 border border-slate-200 text-2xl">{icon}</div><div className="mt-4 text-sm font-black text-slate-700">{title}</div><div className="mt-1 text-xs font-medium text-slate-400">{text}</div></div></div>
}

function AgentError({ text }) {
  return <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-600">{text}</div>
}

// ---------------------------------------------------------------------
// APP ROOT
// ---------------------------------------------------------------------
export default function App() {
  const [email, setEmail] = useState(() => localStorage.getItem('apex_user_email'))
  const [page, setPage] = useState(() => localStorage.getItem('lastVisitedPath') || 'Dashboard')
  const [profile, setProfile] = useState(null)
  const [googleError, setGoogleError] = useState('')

useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const emailParam = params.get('user_email')

    // If Google redirect handed us the email, capture and save it immediately.
    // Normalize it the same way login/signup do, so it always matches what's
    // stored in localStorage the rest of the time.
    if (emailParam) {
      localStorage.setItem('apex_user_email', emailParam.trim().toLowerCase())
      window.history.replaceState({}, document.title, '/dashboard')
    }

    const storedEmail = localStorage.getItem('apex_user_email')

    if (storedEmail) {
      setEmail(storedEmail)
      api.me(storedEmail)
        .then(setProfile)
        .catch(() => {
          localStorage.removeItem('apex_user_email')
          localStorage.removeItem('lastVisitedPath')
          sessionStorage.clear()
          setProfile(null)
          setEmail(null)
        })
    }

    // After the Google OAuth round-trip the browser does a full page reload,
    // so React state is gone - restore whichever page the user was on
    // (saved just before we navigated away to Google) instead of dumping
    // them back on the generic Dashboard.
    const restoredPage = localStorage.getItem('lastVisitedPath') || 'Dashboard'

    if (params.get('google_connected') === 'true') {
      setPage(restoredPage)
      window.history.replaceState({}, document.title, '/dashboard')
    } else if (params.get('google_error')) {
      // Show this to the user instead of only logging it - otherwise a
      // failed connection looks identical to a successful one, and the
      // very next attempt to use the feature just fails again with no
      // clue why.
      setGoogleError(params.get('google_error'))
      setPage(restoredPage)
      window.history.replaceState({}, document.title, '/dashboard')
    }
  }, [])

  // Keep the current page in sync with localStorage so a forced reload
  // (like the Google OAuth redirect) can restore it.
  useEffect(() => {
    if (email) {
      localStorage.setItem('lastVisitedPath', page)
    }
  }, [page, email])

  function handleLogin(loggedInEmail) {
    const normalizedEmail = String(loggedInEmail || '').trim().toLowerCase()
    localStorage.setItem('apex_user_email', normalizedEmail)
    localStorage.removeItem('lastVisitedPath')
    sessionStorage.clear()
    setEmail(normalizedEmail)
    setPage('Dashboard')
  }

  function handleLogout() {
    localStorage.clear()
    sessionStorage.clear()
    setProfile(null)
    setPage('Dashboard')
    setEmail(null)
    window.history.replaceState({}, document.title, '/login')
  }

  if (!email) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div className="flex min-h-screen bg-[#f4f8f7] text-slate-900 font-sans selection:bg-teal-500 selection:text-white">
      <Sidebar page={page} setPage={setPage} email={email} onLogout={handleLogout} />
      <div className="flex-1 p-10 overflow-y-auto max-h-screen scrollbar-thin">
        {googleError && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <span><strong>Google connection failed:</strong> {googleError}</span>
            <button
              onClick={() => setGoogleError('')}
              className="shrink-0 font-bold text-red-500 hover:text-red-700"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {page === 'Dashboard' && <Dashboard email={email} onNavigate={setPage} />}
        {page === 'Weather Updates' && <WeatherPage email={email} />}
        {page === 'Crypto Updates' && <CryptoPage email={email} />}
        {page === 'Your AI Assistant' && <AIAgentPage email={email} />}
        {page === 'Email Agent' && <EmailAgentPage email={email} />}
        {page === 'Web Search Agent' && <WebSearchAgentPage email={email} />}
        {page === 'Image Generator' && <ImageGeneratorPage email={email} />}
        {page === 'Email Reader' && <EmailReaderPage email={email} />}
        {page === 'Calendar Agent' && <CalendarAgentPage email={email} />}
        {page === 'Create Account' && <CreateAccountPage email={email}/>}
        {page === 'Deposit' && (
          <AmountActionPage
            title="Deposit Capital"
            subtitle="Securely inject funds into designated account profile"
            actionLabel="Confirm Deposit"
            onSubmit={(id, amount) => api.deposit(id, amount, email)}
          />
        )}
        {page === 'Withdraw' && (
          <AmountActionPage
            title="Withdraw Capital"
            subtitle="Process authorized liquidity withdrawal requests"
            actionLabel="Confirm Withdrawal"
            onSubmit={(id, amount) => api.withdraw(id, amount, email)}
          />
        )}
        {page === 'Transfer' && <TransferPage email={email} />}
        {page === 'View Balance' && <ViewBalancePage email={email} />}
        {page === 'Transaction History' && <TransactionHistoryPage email={email} />}
        {page === 'All Accounts' && <AllAccountsPage />}
      </div>
    </div>
  )
}