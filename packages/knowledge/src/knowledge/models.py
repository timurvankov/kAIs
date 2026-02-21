from __future__ import annotations
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field


class ScopeLevel(str, Enum):
    platform = "platform"
    realm = "realm"
    formation = "formation"
    cell = "cell"


class KnowledgeScope(BaseModel):
    level: ScopeLevel
    realm_id: str | None = None
    formation_id: str | None = None
    cell_id: str | None = None


class FactSourceType(str, Enum):
    mission_extraction = "mission_extraction"
    experiment = "experiment"
    user_input = "user_input"
    promoted = "promoted"
    explicit_remember = "explicit_remember"


class FactSource(BaseModel):
    type: FactSourceType
    mission_id: str | None = None
    experiment_id: str | None = None


class Fact(BaseModel):
    id: str
    content: str
    scope: KnowledgeScope
    source: FactSource
    confidence: float = Field(ge=0, le=1)
    valid_from: datetime
    valid_until: datetime | None = None
    tags: list[str] = []


class AddFactRequest(BaseModel):
    content: str
    scope: KnowledgeScope
    source: FactSource
    confidence: float = Field(ge=0, le=1, default=0.5)
    tags: list[str] = []


class SearchRequest(BaseModel):
    query: str
    scope: KnowledgeScope
    max_results: int = 20
    min_confidence: float = 0.0
    include_invalidated: bool = False


class InvalidateRequest(BaseModel):
    fact_id: str
    reason: str
