from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid

class LogEvent(BaseModel):
    service: str = Field(..., description="Name of the service generating the log")
    level: str = Field(..., description="Log level: INFO, WARNING, ERROR, etc.")
    message: str = Field(..., description="The actual log message")
    timestamp: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Time of the event")

class Incident(BaseModel):
    incident_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    service: str
    severity: str
    event_count: int
    first_seen: datetime
    last_seen: datetime
    events: List[dict]
