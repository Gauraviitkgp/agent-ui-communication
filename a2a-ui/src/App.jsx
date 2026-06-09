import { useMemo, useState } from 'react'
import { ClientFactory } from '@a2a-js/sdk/client'

const DEFAULT_AGENT_URL = 'http://127.0.0.1:41241'

function readArtifactParts(task) {
  return (task?.artifacts ?? []).map((artifact) => ({
    id: artifact.artifactId,
    name: artifact.name,
    parts: artifact.parts,
  }))
}

export default function App() {
  const [agentUrl, setAgentUrl] = useState(DEFAULT_AGENT_URL)
  const [repoUrl, setRepoUrl] = useState('https://github.com/example/repo')
  const [authId, setAuthId] = useState('github-auth-1')
  const [lookupTaskId, setLookupTaskId] = useState('')
  const [task, setTask] = useState(null)
  const [status, setStatus] = useState('Idle')
  const [error, setError] = useState('')

  const clientFactory = useMemo(() => new ClientFactory(), [])
  const artifacts = readArtifactParts(task)

  async function createClient() {
    // Create a client instance from the provided agent URL.
    // The client first fetches the Agent Card from /.well-known/agent.json,
    // then uses the endpoint details from that card to call the A2A backend.
    // This allows the UI to work with any A2A backend without hardcoding endpoint URLs,
    // as long as the backend serves a compatible Agent Card.
    return clientFactory.createFromUrl(agentUrl, '.well-known/agent.json')
  }

  // Given a task id, fetch the full task from the A2A backend and read its
  // artifacts. This is the direct way to get stored artifact data later.
  async function fetchTaskArtifactsById(taskId) {
    const cleanTaskId = taskId.trim()
    if (!cleanTaskId) return

    setError('')
    setStatus(`Fetching artifacts for task ${cleanTaskId}...`)

    try {
      const client = await createClient()
      // getTask asks the backend task store for the task with this id.
      // The returned task contains status, history, and artifacts.
      const storedTask = await client.getTask({ id: cleanTaskId })
      setTask(storedTask)
      setStatus(
        `Fetched ${storedTask.artifacts?.length ?? 0} artifact(s) for task ${storedTask.id}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('Fetch failed')
    }
  }

  async function handleLookupSubmit(event) {
    event.preventDefault()
    await fetchTaskArtifactsById(lookupTaskId)
  }

  // Handles form submission to send a repository task to the A2A backend and
  // updates the UI based on streamed task/status/artifact events.
  async function submitRepoTask(event) {
    event.preventDefault()
    setError('')
    setTask(null)
    setStatus('Sending A2A message...')

    try {
      const client = await createClient()

      // Construct the user message that will be sent to the backend.
      // contextId groups messages into one conversation. taskId is omitted here
      // because this is a new task; the A2A server will create the task id.
      const message = {
        kind: 'message',
        role: 'user',
        messageId: crypto.randomUUID(),
        contextId: crypto.randomUUID(),
        parts: [
          {
            kind: 'text',
            text: JSON.stringify({
              kind: 'repository-task',
              repoUrl,
              authId,
            }),
          },
        ],
      }

      // sendMessageStream sends the message to the backend and returns an async
      // stream of events. The backend can emit task, status-update, and
      // artifact-update events while it is processing.
      let latestTask = null
      for await (const event of client.sendMessageStream({ message })) {
        // event.kind === 'task' means the backend has created or updated the
        // task object. We keep the latest id so we can fetch the stored task.
        if (event.kind === 'task') latestTask = event

        // event.kind === 'status-update' means the task state changed, for
        // example submitted -> working -> completed.
        if (event.kind === 'status-update') {
          setStatus(`Task state: ${event.status.state}`)
        }

        // event.kind === 'artifact-update' means the backend called
        // updater.add_artifact(...). The artifact is now part of the task.
        if (event.kind === 'artifact-update') {
          setStatus('Artifact received from backend')
        }
      }

      // After the stream completes, fetch the task by id. This proves that the
      // artifact is retrievable from the backend task store, not only from the
      // live stream event.
      if (latestTask?.id) {
        setLookupTaskId(latestTask.id)
        await fetchTaskArtifactsById(latestTask.id)
      } else {
        setStatus('Completed without a task id')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('Failed')
    }
  }

  return (
    <main className="shell">
      <section className="panel">
        <div className="heading">
          <h1>A2A Repository Task Sample</h1>
          <p>
            Sends repo URL and auth ID to the Python A2A backend. The backend
            stores the payload as a task artifact in the configured task store.
          </p>
        </div>

        <form className="form" onSubmit={submitRepoTask}>
          <label>
            Agent URL
            <input
              value={agentUrl}
              onChange={(event) => setAgentUrl(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            Repo URL
            <input
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            Auth ID
            <input
              value={authId}
              onChange={(event) => setAuthId(event.target.value)}
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={!repoUrl.trim() || !authId.trim()}>
            Send and store artifact
          </button>
        </form>

        <form className="form form--lookup" onSubmit={handleLookupSubmit}>
          <label className="task-id-field">
            Task ID
            <input
              value={lookupTaskId}
              onChange={(event) => setLookupTaskId(event.target.value)}
              placeholder="paste an existing task id"
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={!lookupTaskId.trim()}>
            Get task artifacts
          </button>
        </form>

        <div className="status">
          <strong>Status:</strong> {status}
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="panel">
        <h2>Task returned from backend</h2>
        <pre>{task ? JSON.stringify(task, null, 2) : 'No task yet.'}</pre>
      </section>

      <section className="panel">
        <h2>Artifacts stored on the task</h2>
        <pre>
          {artifacts.length
            ? JSON.stringify(artifacts, null, 2)
            : 'No artifacts yet.'}
        </pre>
      </section>
    </main>
  )
}
