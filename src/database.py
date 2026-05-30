from .types import Task,Thread,Parts,Message
import pandas as pd


threads: pd.DataFrame = pd.DataFrame(columns=["id", "name"])
tasks: pd.DataFrame = pd.DataFrame(columns=["id", "thread_id", "state", "metadata"])
messages: pd.DataFrame = pd.DataFrame(columns=["id", "thread_id", "task_id", "role"])
parts: pd.DataFrame = pd.DataFrame(columns=["id", "message_id", "thread_id", "content"])

def log_database_state():
    print("Current Threads:")
    print(threads.to_string(index=False))

    print("\nCurrent Tasks:")
    print(tasks.to_string(index=False))

    print("\nCurrent Messages:")
    print(messages.to_string(index=False))

    print("\nCurrent Parts:")
    print(parts.to_string(index=False))


def add_thread(thread: Thread):
    global threads
    threads = pd.concat([threads, pd.DataFrame([{"id": thread.id, "name": thread.name}])], ignore_index=True)


def add_message(message: Message):
    global messages, parts
    messages = pd.concat([messages, pd.DataFrame([{
        "id": message.id,
        "thread_id": message.thread_id,
        "task_id": message.task_id,
        "role": message.role,
    }])], ignore_index=True)
    if message.parts:
        parts = pd.concat([parts, pd.DataFrame([{
            "id": part.id,
            "message_id": part.message_id,
            "thread_id": part.thread_id,
            "content": part.content,
        } for part in message.parts])], ignore_index=True)


def get_thread(thread_id: str) -> Thread | None:
    rows = threads[threads["id"] == thread_id]
    if rows.empty:
        return None
    return Thread(**rows.iloc[0])


def get_messages(by_thread_id: str) -> list[Message]:
    rows = messages[messages["thread_id"] == by_thread_id]
    result = []
    for _, row in rows.iterrows():
        msg_parts = parts[parts["message_id"] == row["id"]]
        message = Message(**row)
        message.parts = [Parts(**p) for _, p in msg_parts.iterrows()]
        result.append(message)
    return result
    