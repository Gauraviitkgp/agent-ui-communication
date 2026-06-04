import { useEffect, useRef, useState } from 'react'
import type {
  Message,
  Part,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from '@a2a-js/sdk'
import { buildUserMessage, type Client } from '../a2a/client'
import MessageList, { type DisplayMessage, type ToolCall } from './MessageList'
import InputBox from './InputBox'

interface Props {
  client: Client
  contextId: string
}

type StreamEvent = Task | Message | TaskStatusUpdateEvent | TaskArtifactUpdateEvent

interface AgentStreamState {
  taskId: string | null
  state: TaskState | null
  // Insertion-ordered map of agentMessageId -> DisplayMessage (text content).
  agentMessages: Map<string, DisplayMessage>
  // Insertion-ordered map of artifactId -> DisplayMessage.
  artifacts: Map<string, DisplayMessage>
  // Insertion-ordered map of execId -> DisplayMessage (kind: 'tool-call').
  toolCalls: Map<string, DisplayMessage>
}

function newAgentStreamState(): AgentStreamState {
  return {
    taskId: null,
    state: null,
    agentMessages: new Map(),
    artifacts: new Map(),
    toolCalls: new Map(),
  }
}

function isToolCallData(
  d: unknown,
): d is { kind: 'tool-call-request' | 'tool-call-response'; data?: Record<string, unknown> } {
  if (!d || typeof d !== 'object') return false
  const k = (d as { kind?: unknown }).kind
  return k === 'tool-call-request' || k === 'tool-call-response'
}

function toolCallFields(inner: Record<string, unknown> | undefined): {
  execId: string
  toolId: string
  rest: Record<string, unknown>
} {
  const safe = inner ?? {}
  const execId = String(safe['exec-id'] ?? safe['execId'] ?? '')
  const toolId = String(safe['tool-id'] ?? safe['toolId'] ?? '')
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(safe)) {
    if (k === 'exec-id' || k === 'execId' || k === 'tool-id' || k === 'toolId') continue
    rest[k] = v
  }
  return { execId, toolId, rest }
}

function partsToText(parts: Part[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (p.kind === 'text') {
      out.push(p.text ?? '')
    } else if (p.kind === 'data') {
      if (isToolCallData(p.data)) continue // handled as a tool-call block elsewhere
      try {
        out.push('```json\n' + JSON.stringify(p.data, null, 2) + '\n```')
      } catch {
        out.push(String(p.data))
      }
    } else {
      out.push(`[${p.kind} part]`)
    }
  }
  return out.join('')
}

function applyToolCallParts(parts: Part[], s: AgentStreamState) {
  for (const p of parts) {
    if (p.kind !== 'data' || !isToolCallData(p.data)) continue
    const inner = (p.data as { data?: Record<string, unknown> }).data
    const { execId, toolId, rest } = toolCallFields(inner)
    const key = execId || `${toolId}:${s.toolCalls.size}` // fallback if no exec-id
    const existing = s.toolCalls.get(key)
    const isRequest = (p.data as { kind: string }).kind === 'tool-call-request'

    if (isRequest) {
      const tc: ToolCall = {
        execId,
        toolId: toolId || existing?.toolCall?.toolId || '',
        parameters: rest.parameters ?? rest,
        hasResponse: existing?.toolCall?.hasResponse ?? false,
        responseData: existing?.toolCall?.responseData,
      }
      s.toolCalls.set(key, {
        id: key,
        role: 'agent',
        kind: 'tool-call',
        toolCall: tc,
      })
    } else {
      // tool-call-response
      const tc: ToolCall = {
        execId,
        toolId: toolId || existing?.toolCall?.toolId || '',
        parameters: existing?.toolCall?.parameters,
        hasResponse: true,
        responseData: rest,
      }
      s.toolCalls.set(key, {
        id: key,
        role: 'agent',
        kind: 'tool-call',
        toolCall: tc,
      })
    }
  }
}

function hasOnlyToolCallData(parts: Part[]): boolean {
  if (parts.length === 0) return false
  return parts.every((p) => p.kind === 'data' && isToolCallData(p.data))
}

export default function Chat({ client, contextId }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [pendingTaskState, setPendingTaskState] = useState<TaskState | null>(null)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setMessages([])
    setPendingTaskState(null)
    setCurrentTaskId(null)
    setError(null)
    abortRef.current?.abort()
    abortRef.current = null
  }, [contextId])

  const handleSend = async (text: string) => {
    if (!text.trim() || isStreaming) return
    setError(null)

    const userMsg = buildUserMessage({
      text,
      contextId,
      taskId: currentTaskId ?? undefined,
    })

    const userDisplay: DisplayMessage = {
      id: userMsg.messageId,
      role: 'user',
      kind: 'message',
      text,
    }
    setMessages((prev) => [...prev, userDisplay])
    setIsStreaming(true)

    const stream = newAgentStreamState()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const events = client.sendMessageStream(
        { message: userMsg },
        { signal: controller.signal },
      )
      for await (const ev of events) {
        applyEvent(ev as StreamEvent, stream)
        renderStream(stream, setMessages, userMsg)
        if ('status' in ev && ev.status?.state) {
          setPendingTaskState(ev.status.state)
        }
        if ('kind' in ev && ev.kind === 'task') {
          setCurrentTaskId((ev as Task).id)
        }
      }
      const terminal: TaskState[] = ['completed', 'canceled', 'failed', 'rejected']
      if (stream.state && terminal.includes(stream.state)) {
        setCurrentTaskId(null)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!controller.signal.aborted) setError(msg)
    } finally {
      setIsStreaming(false)
      setPendingTaskState(stream.state)
      abortRef.current = null
    }
  }

  const handleCancel = async () => {
    if (currentTaskId) {
      try {
        await client.cancelTask({ id: currentTaskId })
      } catch {
        // server may already be done
      }
    }
    abortRef.current?.abort()
  }

  return (
    <div className="chat">
      <MessageList messages={messages} pendingState={pendingTaskState} />
      {error && <div className="chat__error">Error: {error}</div>}
      <InputBox
        disabled={isStreaming}
        onSend={handleSend}
        onCancel={isStreaming ? handleCancel : undefined}
        hint={
          pendingTaskState === 'input-required'
            ? 'Agent is waiting for your input…'
            : undefined
        }
      />
    </div>
  )
}

function recordAgentTextMessage(
  s: AgentStreamState,
  m: Message,
  kind: 'message' | 'status',
  state?: TaskState,
) {
  // Always route tool-call data parts to the toolCalls map.
  applyToolCallParts(m.parts, s)
  // If the message ONLY carried tool-call parts, don't create an empty text bubble.
  if (hasOnlyToolCallData(m.parts)) return
  const text = partsToText(m.parts)
  if (!text) return
  s.agentMessages.set(m.messageId, {
    id: m.messageId,
    role: 'agent',
    kind,
    text,
    state,
  })
}

function applyEvent(ev: StreamEvent, s: AgentStreamState) {
  switch (ev.kind) {
    case 'task': {
      s.taskId = ev.id
      s.state = ev.status.state
      if (ev.status.message?.role === 'agent') {
        recordAgentTextMessage(s, ev.status.message, 'message')
      }
      return
    }
    case 'status-update': {
      s.state = ev.status.state
      const m = ev.status.message
      if (m && m.role === 'agent') {
        recordAgentTextMessage(s, m, 'status', ev.status.state)
      }
      return
    }
    case 'artifact-update': {
      const id = ev.artifact.artifactId
      // Tool-call data parts inside artifacts also get routed.
      applyToolCallParts(ev.artifact.parts, s)
      if (hasOnlyToolCallData(ev.artifact.parts)) return
      const text = partsToText(ev.artifact.parts)
      const existing = s.artifacts.get(id)
      if (existing && ev.append) {
        s.artifacts.set(id, { ...existing, text: (existing.text ?? '') + text })
      } else {
        s.artifacts.set(id, {
          id,
          role: 'agent',
          kind: 'artifact',
          text,
          artifactName: ev.artifact.name,
        })
      }
      return
    }
    case 'message': {
      if (ev.role === 'agent') {
        recordAgentTextMessage(s, ev, 'message')
      }
      return
    }
  }
}

function renderStream(
  s: AgentStreamState,
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>,
  userMsg: Message,
) {
  setMessages((prev) => {
    const userIdx = prev.findIndex((m) => m.id === userMsg.messageId)
    const kept = userIdx >= 0 ? prev.slice(0, userIdx + 1) : prev
    const agentParts = [
      ...Array.from(s.agentMessages.values()),
      ...Array.from(s.toolCalls.values()),
      ...Array.from(s.artifacts.values()),
    ]
    return [...kept, ...agentParts]
  })
}
