import type { DisplayMessage } from './MessageList'

function pretty(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export default function MessageItem({ message }: { message: DisplayMessage }) {
  if (message.kind === 'tool-call' && message.toolCall) {
    const tc = message.toolCall
    return (
      <div className="msg msg--agent msg--tool">
        <div className="msg__meta">
          Tool call
          <span className="msg__tag">{tc.toolId || '(unknown tool)'}</span>
          {tc.execId && <span className="msg__tag">exec: {tc.execId}</span>}
          <span className={`msg__tag ${tc.hasResponse ? 'tag--ok' : 'tag--pending'}`}>
            {tc.hasResponse ? 'response received' : 'awaiting response'}
          </span>
        </div>
        <div className="tool">
          <div className="tool__section">
            <div className="tool__label">request</div>
            <pre className="tool__body">{pretty(tc.parameters)}</pre>
          </div>
          {tc.hasResponse && (
            <div className="tool__section">
              <div className="tool__label">response</div>
              <pre className="tool__body">{pretty(tc.responseData)}</pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  const cls =
    message.role === 'user'
      ? 'msg msg--user'
      : message.kind === 'artifact'
      ? 'msg msg--agent msg--artifact'
      : message.kind === 'status'
      ? 'msg msg--agent msg--status'
      : 'msg msg--agent'

  return (
    <div className={cls}>
      <div className="msg__meta">
        {message.role === 'user' ? 'You' : 'Agent'}
        {message.kind === 'artifact' && message.artifactName && (
          <span className="msg__tag">artifact: {message.artifactName}</span>
        )}
        {message.kind === 'status' && message.state && (
          <span className="msg__tag">{message.state}</span>
        )}
      </div>
      <pre className="msg__body">{message.text ?? ''}</pre>
    </div>
  )
}
