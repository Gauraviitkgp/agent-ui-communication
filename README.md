# A2A Artifact Storage Sample

This sample shows the path from a React JSX form to a Python A2A backend and
then into the A2A task store.

## Flow

1. The frontend sends this text part through A2A:

```json
{
  "kind": "repository-task",
  "repoUrl": "https://github.com/example/repo",
  "authId": "github-auth-1"
}
```

2. `main.py` parses that message in `RepoTaskAgentExecutor.execute`.

3. The backend creates `artifact_data` with `taskId`, `contextId`, `repoUrl`,
   `authId`, `state`, and `createdAt`.

4. `await updater.add_artifact(...)` attaches that data to the A2A task.

5. `DatabaseTaskStore` persists the task in the configured SQL database. When
   `MYSQL_URL` points at MySQL, the task row in MySQL contains the task payload,
   including the artifact.

## Run With SQLite

```bash
uv run python main.py
```

This uses `sqlite+aiosqlite:///tasks.db`.

## Run With MySQL

Create a MySQL database, then run:

```bash
MYSQL_URL='mysql+asyncmy://user:password@127.0.0.1:3306/a2a_tasks' uv run python main.py
```

The A2A SDK creates/uses its task-store tables via SQLAlchemy. The important
point is that artifacts are stored as part of the task record managed by
`DatabaseTaskStore`, not by manually inserting into a custom artifact table.

## Run Frontend

```bash
cd a2a-ui
npm install
npm run dev
```

Open `http://127.0.0.1:5173`, submit a repo URL and auth ID, then inspect the
returned task and its `artifacts` array.
