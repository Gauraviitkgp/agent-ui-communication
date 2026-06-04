import { useEffect, useState } from 'react'
import type { AgentCard } from '@a2a-js/sdk'
import { createClient, newContextId, type Client } from './a2a/client'
import Chat from './components/Chat'
import AgentCardBanner from './components/AgentCardBanner'

const DEFAULT_BASE_URL = 'http://127.0.0.1:41241'

export default function App() {
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_BASE_URL)
  const [draftBaseUrl, setDraftBaseUrl] = useState<string>(DEFAULT_BASE_URL)
  const [contextId, setContextId] = useState<string>(() => newContextId())
  const [client, setClient] = useState<Client | null>(null)
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setClient(null)
    setAgentCard(null)
    setError(null)
    createClient(baseUrl)
      .then(async (c) => {
        if (cancelled) return
        setClient(c)
        try {
          const card = await c.getAgentCard()
          if (!cancelled) setAgentCard(card)
        } catch (e) {
          if (!cancelled) setError((e as Error).message)
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl])

  const handleApply = () => {
    setBaseUrl(draftBaseUrl.trim() || DEFAULT_BASE_URL)
    setContextId(newContextId())
  }

  const handleNewConversation = () => {
    setContextId(newContextId())
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>A2A Chat</h1>
        <div className="app__controls">
          <label className="app__url">
            Agent URL
            <input
              value={draftBaseUrl}
              onChange={(e) => setDraftBaseUrl(e.target.value)}
              spellCheck={false}
            />
          </label>
          <button onClick={handleApply} type="button">
            Connect
          </button>
          <button onClick={handleNewConversation} type="button">
            New conversation
          </button>
        </div>
      </header>

      <AgentCardBanner card={agentCard} error={error} />

      <main className="app__main">
        {client ? (
          <Chat
            key={`${baseUrl}::${contextId}`}
            client={client}
            contextId={contextId}
          />
        ) : (
          <div className="chat chat--placeholder">Connecting…</div>
        )}
      </main>

      <footer className="app__footer">
        <span>contextId: <code>{contextId}</code></span>
      </footer>
    </div>
  )
}
