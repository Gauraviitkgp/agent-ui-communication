import argparse
import asyncio
import contextlib
from datetime import UTC, datetime
import json
import logging
import os

import uvicorn
from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.agent_execution.context import RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import (
    create_agent_card_routes,
    create_jsonrpc_routes,
    create_rest_routes,
)
from a2a.server.routes.agent_card_routes import agent_card_to_dict
from a2a.server.tasks.database_task_store import DatabaseTaskStore
from a2a.server.tasks.task_updater import TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentProvider,
    AgentSkill,
    Part,
    Task,
    TaskState,
    TaskStatus,
)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google.protobuf import json_format
from google.protobuf.struct_pb2 import Value
from sqlalchemy.ext.asyncio import create_async_engine

logger = logging.getLogger(__name__)


class RepoTaskAgentExecutor(AgentExecutor):
    """Receives repo/auth payloads and stores them as A2A task artifacts."""

    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        updater = TaskUpdater(
            event_queue=event_queue,
            task_id=context.task_id or '',
            context_id=context.context_id or '',
        )
        await updater.cancel()
    async def execute(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        task_id = context.task_id
        context_id = context.context_id
        # The user message is the input provided by the user that triggered this execution.
        # It is extracted from the request context and can be used for logging, debugging, or as part of the task processing logic.
        user_message = context.message
        if not task_id or not context_id or not user_message:
            return

        updater = TaskUpdater(
            event_queue=event_queue,
            task_id=task_id,
            context_id=context_id,
        )
        await event_queue.enqueue_event(
            Task(
                id=task_id,
                context_id=context_id,
                status=TaskStatus(state=TaskState.TASK_STATE_SUBMITTED),
                history=[user_message],
            )
        )
        await updater.start_work(
            message=updater.new_agent_message(
                parts=[Part(text='Creating repository task artifact...')]
            )
        )

        repo_task = self._parse_repo_task_payload(context.get_user_input())
        if repo_task is None:
            # If the input is not valid JSON or doesn't contain the expected fields, mark the task as failed and provide an error message.
            # The expected input format is a JSON object with the following structure:
            # {
            #   "kind": "repository-task",
            #   "repoUrl": "https://github.com/user/repo",
            #   "authId": "your-auth-id"
            # }
            await updater.failed(
                message=updater.new_agent_message(
                    parts=[
                        Part(
                            text=(
                                'Expected JSON: {"kind":"repository-task",'
                                '"repoUrl":"...","authId":"..."}'
                            )
                        )
                    ]
                )
            )
            return
        # If the input is valid, construct an artifact containing the repository task information and add it to the task. 
        # This artifact will be stored in the task store (e.g., MySQL if MYSQL_URL is set) and can be accessed later for processing or reference.
        artifact_data = {
            'kind': 'repository-task',
            'taskId': task_id,
            'contextId': context_id,
            'repoUrl': repo_task['repoUrl'],
            'authId': repo_task['authId'],
            'state': 'stored',
            'createdAt': datetime.now(UTC).isoformat(),
        }

        # This is the important line: DatabaseTaskStore persists the Task, and
        # the Task includes this artifact. With MYSQL_URL set to a MySQL DSN,
        # the artifact lands in the MySQL-backed task store.
        await updater.add_artifact(
            parts=[
                Part(data=json_format.ParseDict(artifact_data, Value())),
            ],
            name='repository-task',
            last_chunk=True,
        )
        # storing in artifact is same as storing in mysql ?
        # Storing in an artifact means that the repository task information is added as an artifact to the A2A task. 
        # The A2A framework will then handle the persistence of this artifact according to the configured task store. 
        # If the task store is backed by MySQL (as indicated by the MYSQL_URL environment variable),
        #  then the artifact will be stored in the MySQL database. So, while you are adding an artifact to the task, 
        # the underlying storage mechanism (MySQL in this case) is responsible for actually saving that artifact data in a persistent way.
        # where is my sql database ? how do i see the stored artifact in mysql ?
        # The MySQL database is specified by the MYSQL_URL environment variable. If you have set it to something like 'mysql+aiomysql://user:password@host:port/database',
        # then you can connect to that MySQL database using a MySQL client (like MySQL Workbench, phpMyAdmin, or the MySQL command line tool) using the same connection details (user, password, host, port, database).
        # what will be tyhe schema?
        # what is the implementation of DatabaseTaskStore?
        await updater.complete(
            message=updater.new_agent_message(
                parts=[
                    Part(
                        text=(
                            'Stored repository task info in artifact '
                            f'for task {task_id}.'
                        )
                    )
                ]
            )
        )
    def _parse_repo_task_payload(self, raw: str) -> dict[str, str] | None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None

        if not isinstance(payload, dict):
            return None
        if payload.get('kind') != 'repository-task':
            return None

        repo_url = str(payload.get('repoUrl') or '').strip()
        auth_id = str(payload.get('authId') or '').strip()
        if not repo_url or not auth_id:
            return None

        return {'repoUrl': repo_url, 'authId': auth_id}


def build_agent_card(host: str, port: int) -> AgentCard:
    return AgentCard(
        name='Repo Task Artifact Agent',
        description='Stores repo URL and auth ID as an A2A artifact.',
        provider=AgentProvider(
            organization='Local Sample',
            url='http://localhost',
        ),
        version='1.0.0',
        capabilities=AgentCapabilities(
            streaming=True,
            push_notifications=False,
        ),
        default_input_modes=['text'],
        default_output_modes=['text', 'application/json'],
        skills=[
            AgentSkill(
                id='store_repository_task',
                name='Store repository task',
                description='Stores repoUrl and authId in the task artifact.',
                tags=['repo', 'artifact', 'mysql'],
                examples=[
                    '{"kind":"repository-task","repoUrl":"https://github.com/org/repo","authId":"github-auth-1"}'
                ],
                input_modes=['text'],
                output_modes=['application/json'],
            )
        ],
        supported_interfaces=[
            AgentInterface(
                protocol_binding='JSONRPC',
                protocol_version='1.0',
                url=f'http://{host}:{port}/a2a/jsonrpc',
            ),
            AgentInterface(
                protocol_binding='JSONRPC',
                protocol_version='0.3',
                url=f'http://{host}:{port}/a2a/jsonrpc',
            ),
            AgentInterface(
                protocol_binding='HTTP+JSON',
                protocol_version='1.0',
                url=f'http://{host}:{port}/a2a/rest',
            ),
            AgentInterface(
                protocol_binding='HTTP+JSON',
                protocol_version='0.3',
                url=f'http://{host}:{port}/a2a/rest',
            ),
        ],
    )


async def serve(host: str = '127.0.0.1', port: int = 41241) -> None:
    agent_card = build_agent_card(host, port)

    database_url = os.getenv(
        'MYSQL_URL',
        'sqlite+aiosqlite:///tasks.db',
    )
    engine = create_async_engine(database_url, echo=False)
    # DatabaseTaskStore uses SQLAlchemy to persist tasks and their artifacts. 
    # By configuring it with a MySQL database URL, you enable the A2A framework to store task information in MySQL. 
    # This allows you to query and manage tasks and their associated artifacts using MySQL tools and interfaces.
    task_store = DatabaseTaskStore(engine=engine)
    await task_store.initialize()
    
    # The DefaultRequestHandler is responsible for handling incoming requests to the A2A agent. 
    # By passing an instance of RepoTaskAgentExecutor, you are specifying that this handler should
    # use the logic defined in RepoTaskAgentExecutor to process incoming requests.
    # The logic in RepoTaskAgentExecutor is responsible for handling the specific tasks related to repository tasks,
    # such as storing the repo URL and auth ID as artifacts in the task store.
    # intutive way to understand this is that when a request comes in to the A2A agent (e.g., a JSON-RPC call or an HTTP request),
    # the DefaultRequestHandler will delegate the processing of that request to the RepoTaskAgentExecutor, which contains the specific logic for handling repository tasks.
    request_handler = DefaultRequestHandler(
        agent_executor=RepoTaskAgentExecutor(),
        task_store=task_store,
        agent_card=agent_card,
    )

    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )

    @app.get('/.well-known/agent.json')
    async def get_agent_json() -> dict:
        return agent_card_to_dict(agent_card)

    @app.get('/.well-known/agent-card.json')
    async def get_agent_card_json() -> dict:
        return agent_card_to_dict(agent_card)

    app.router.routes.extend(
        create_jsonrpc_routes(
            request_handler=request_handler,
            rpc_url='/a2a/jsonrpc',
            enable_v0_3_compat=True,
        )
    )
    app.router.routes.extend(
        create_rest_routes(
            request_handler=request_handler,
            path_prefix='/a2a/rest',
            enable_v0_3_compat=True,
        )
    )
    app.router.routes.extend(create_agent_card_routes(agent_card=agent_card))
    app.router.routes.extend(
        create_agent_card_routes(
            agent_card=agent_card,
            card_url='/.well-known/agent.json',
        )
    )

    logger.info('Using task store database: %s', database_url)
    logger.info('Agent card: http://%s:%s/.well-known/agent.json', host, port)
    await uvicorn.Server(uvicorn.Config(app, host=host, port=port)).serve()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=41241)
    args = parser.parse_args()
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(serve(host=args.host, port=args.port))
