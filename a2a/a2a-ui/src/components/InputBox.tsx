import { useState, type KeyboardEvent } from 'react'

interface Props {
  disabled: boolean
  onSend: (text: string) => void
  onCancel?: () => void
  hint?: string
}

export default function InputBox({ disabled, onSend, onCancel, hint }: Props) {
  const [value, setValue] = useState('')

  const send = () => {
    const t = value.trim()
    if (!t) return
    onSend(t)
    setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="input">
      {hint && <div className="input__hint">{hint}</div>}
      <div className="input__row">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
          rows={2}
        />
        {onCancel ? (
          <button type="button" onClick={onCancel} className="input__cancel">
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={disabled || !value.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}
