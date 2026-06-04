import { ClientFactory, type Client } from '@a2a-js/sdk/client'
import type { Message, Part, MessageSendParams } from '@a2a-js/sdk'

export async function createClient(baseUrl: string): Promise<Client> {
  const factory = new ClientFactory()
  return factory.createFromUrl(baseUrl)
}

export function buildUserMessage(opts: {
  text: string
  contextId?: string
  taskId?: string
}): Message {
  const parts: Part[] = [{ kind: 'text', text: opts.text }]
  return {
    kind: 'message',
    role: 'user',
    messageId: crypto.randomUUID(),
    parts,
    contextId: opts.contextId,
    taskId: opts.taskId,
  }
}

export function newContextId(): string {
  return crypto.randomUUID()
}

export type { Client, MessageSendParams }
