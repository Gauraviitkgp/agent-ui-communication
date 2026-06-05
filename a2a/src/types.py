from pydantic import BaseModel, ConfigDict, SkipValidation
from a2a import types as a2atypes


class Thread(BaseModel):
    id: str 
    name: str 

class Task(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    id: str
    thread_id: str = ""
    state: SkipValidation[a2atypes.TaskState]
    metadata: dict|None = None

class Message(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    id: str
    thread_id: str 
    task_id: str
    role: SkipValidation[a2atypes.Role]

    parts: list['Parts'] = []

    def to_a2a_message(self) -> a2atypes.Message:
        return a2atypes.Message(
            message_id=self.id,
            context_id=self.thread_id,
            task_id=self.task_id,
            role=self.role,
            parts=[part.to_a2a_parts() for part in self.parts],
        )

    @classmethod
    def from_a2a_message(cls, message: a2atypes.Message) -> 'Message':
        return cls(
            id=message.message_id,
            thread_id=message.context_id,
            task_id=message.task_id,
            role=message.role,
            parts=[Parts.from_a2a_part(part, message.message_id, message.context_id) for part in message.parts],
        )

class Parts(BaseModel):
    id: str 
    message_id: str 
    thread_id: str
    content: str 

    def to_a2a_parts(self) -> a2atypes.Part:
        return a2atypes.Part(
            text=self.content, 
        )
    
    @classmethod
    def from_a2a_part(cls, part: a2atypes.Part, message_id: str, thread_id: str) -> 'Parts':
        return cls(
            id="",
            message_id=message_id,
            thread_id=thread_id,
            content=part.text,
        )

