import type { AgentCard } from '@a2a-js/sdk'

interface Props {
  card: AgentCard | null
  error: string | null
}

export default function AgentCardBanner({ card, error }: Props) {
  if (error) {
    return (
      <div className="banner banner--error">
        Failed to load agent card: {error}
      </div>
    )
  }
  if (!card) {
    return <div className="banner">Loading agent card…</div>
  }
  return (
    <div className="banner">
      <strong>{card.name}</strong>
      {card.version && <span className="banner__version">v{card.version}</span>}
      {card.description && <span className="banner__desc">— {card.description}</span>}
      {card.capabilities?.streaming && (
        <span className="banner__pill">streaming</span>
      )}
    </div>
  )
}
