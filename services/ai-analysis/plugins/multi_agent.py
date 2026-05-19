from abc import ABC, abstractmethod
from typing import Dict, Any, List

class AIOperatorAgent(ABC):
    """
    FUTURE PLACEHOLDER: Multi-agent orchestrator.
    Will route specific sub-tasks (like DB analysis, k8s logs) to specialized LLM agents.
    """
    
    @abstractmethod
    async def delegate_analysis(self, incident_context: Dict[str, Any]) -> List[str]:
        pass
    
    @abstractmethod
    async def synthesize_agent_reports(self, reports: List[str]) -> str:
        pass
