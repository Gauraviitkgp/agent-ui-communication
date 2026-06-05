import { useEffect, useRef } from 'react'
import type { TaskState } from '@a2a-js/sdk'
import MessageItem from './MessageItem'

export interface ToolCall {
  execId: string
  toolId: string
  parameters?: unknown
  hasResponse: boolean
  responseData?: unknown
}

export interface DisplayMessage {
  id: string
  role: 'user' | 'agent'
  kind: 'message' | 'status' | 'artifact' | 'tool-call'
  text?: string
  state?: TaskState
  artifactName?: string
  toolCall?: ToolCall
}

interface Props {
  messages: DisplayMessage[]
  pendingState: TaskState | null
}

export default function MessageList({ messages, pendingState }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pendingState])

  return (
    <div className="messages" ref={scrollRef}>
      {messages.length === 0 && (
        <div className="messages__empty">
          Type a message to start. Try: <code>hi</code>, <code>help</code>, or <code>tool</code>.
        </div>
      )}
      {messages.map((m) => (
        <MessageItem key={`${m.id}-${m.kind}`} message={m} />
      ))}
      {pendingState && pendingState !== 'completed' && (
        <div className="status-line">task state: <code>{pendingState}</code></div>
      )}
    </div>
  )
}
