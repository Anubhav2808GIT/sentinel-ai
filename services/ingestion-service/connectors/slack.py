from abc import ABC, abstractmethod

class SlackConnector(ABC):
    """
    FUTURE PLACEHOLDER: Slack / ChatOps Integration.
    Will allow ingestion of incident reports triggered by users in Slack,
    and pushing updates to incident channels.
    """
    
    @abstractmethod
    async def push_alert(self, channel_id: str, message: str) -> bool:
        pass
    
    @abstractmethod
    async def listen_for_commands(self) -> None:
        pass
