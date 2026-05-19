from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator

class KubernetesConnector(ABC):
    """
    FUTURE PLACEHOLDER: Kubernetes API Ingestion.
    Will stream events directly from K8s API server (OOMKills, PodCrashLoopBackOff).
    """
    
    @abstractmethod
    async def stream_events(self, namespace: str = "default") -> AsyncGenerator[Any, None]:
        pass
