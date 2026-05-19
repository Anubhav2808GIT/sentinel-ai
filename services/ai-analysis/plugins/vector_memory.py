from abc import ABC, abstractmethod
from typing import List, Dict, Any

class VectorMemoryStore(ABC):
    """
    FUTURE PLACEHOLDER: Interface for vector-based semantic memory.
    Will be used for semantic incident search and historical pattern matching.
    """
    
    @abstractmethod
    async def store_incident(self, incident_id: str, analysis_summary: str, embeddings: List[float]) -> bool:
        pass
    
    @abstractmethod
    async def semantic_search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        pass
