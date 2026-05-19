from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

class AIMemoryRepository(ABC):
    """
    FUTURE PLACEHOLDER: Clean architecture boundary for Semantic Memory.
    This interface defines the contract for persisting and retrieving AI incident vectors.
    """

    @abstractmethod
    async def save_incident_embedding(self, incident_id: str, embedding: List[float], metadata: Dict[str, Any]) -> bool:
        """Stores the embedding of a completed RCA for future semantic search."""
        pass

    @abstractmethod
    async def find_similar_incidents(self, query_embedding: List[float], similarity_threshold: float = 0.85, top_k: int = 5) -> List[Dict[str, Any]]:
        """Retrieves past incidents that map closely to a new anomaly."""
        pass

    @abstractmethod
    async def build_knowledge_graph(self, incident_ids: List[str]) -> Dict[str, Any]:
        """Constructs an entity-relationship graph (Memory Graph) of related historical failures."""
        pass
