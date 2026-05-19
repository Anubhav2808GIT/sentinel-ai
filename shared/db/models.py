import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Float, JSON
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.dialects.postgresql import UUID

Base = declarative_base()

class Incident(Base):
    __tablename__ = "incidents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service = Column(String, index=True)
    severity = Column(String, index=True)
    status = Column(String, default="active", index=True) # active, investigating, resolved
    event_count = Column(Integer, default=1)
    first_seen = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    events = relationship("Event", back_populates="incident", cascade="all, delete-orphan")
    ai_analysis = relationship("AIAnalysis", back_populates="incident", uselist=False, cascade="all, delete-orphan")

class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    incident_id = Column(UUID(as_uuid=True), ForeignKey("incidents.id"), index=True)
    service = Column(String)
    level = Column(String)
    message = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

    incident = relationship("Incident", back_populates="events")

class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    incident_id = Column(UUID(as_uuid=True), ForeignKey("incidents.id"), unique=True, index=True)
    summary = Column(String)
    root_cause = Column(String)
    remediation = Column(JSON) # Store as list of strings
    confidence = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)

    incident = relationship("Incident", back_populates="ai_analysis")
