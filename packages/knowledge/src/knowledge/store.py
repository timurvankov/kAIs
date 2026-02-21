from __future__ import annotations
import uuid
from datetime import datetime, timezone
from .models import Fact, AddFactRequest, SearchRequest, KnowledgeScope, ScopeLevel

SCOPE_ORDER = [ScopeLevel.platform, ScopeLevel.realm, ScopeLevel.formation, ScopeLevel.cell]


def is_visible(fact_scope: KnowledgeScope, query_scope: KnowledgeScope) -> bool:
    """Check if a fact's scope is visible from the query scope."""
    fact_level = SCOPE_ORDER.index(fact_scope.level)
    query_level = SCOPE_ORDER.index(query_scope.level)
    if fact_level < query_level:
        return True
    if fact_level > query_level:
        return False
    # Same level — check IDs
    if fact_scope.level == ScopeLevel.platform:
        return True
    if fact_scope.level == ScopeLevel.realm:
        return fact_scope.realm_id == query_scope.realm_id
    if fact_scope.level == ScopeLevel.formation:
        return (fact_scope.realm_id == query_scope.realm_id and
                fact_scope.formation_id == query_scope.formation_id)
    if fact_scope.level == ScopeLevel.cell:
        return (fact_scope.realm_id == query_scope.realm_id and
                fact_scope.formation_id == query_scope.formation_id and
                fact_scope.cell_id == query_scope.cell_id)
    return False


class GraphitiKnowledgeStore:
    """
    Knowledge store backed by Graphiti + Neo4j.
    Falls back to in-memory keyword matching when Graphiti is not available.
    """

    def __init__(self, graphiti_client=None):
        self._graphiti = graphiti_client
        self._facts: dict[str, Fact] = {}  # in-memory fallback

    async def add_fact(self, req: AddFactRequest) -> str:
        fact_id = str(uuid.uuid4())
        fact = Fact(
            id=fact_id,
            content=req.content,
            scope=req.scope,
            source=req.source,
            confidence=req.confidence,
            valid_from=datetime.now(timezone.utc),
            tags=req.tags,
        )

        if self._graphiti:
            await self._graphiti.add_episode(
                name=f"fact-{fact_id}",
                episode_body=req.content,
                source_description=f"kais:{req.source.type}",
                group_id=self._scope_group(req.scope),
            )

        self._facts[fact_id] = fact
        return fact_id

    async def search(self, req: SearchRequest) -> list[Fact]:
        if self._graphiti:
            results = await self._graphiti.search(
                query=req.query,
                group_ids=self._visible_groups(req.scope),
                num_results=req.max_results,
            )
            return self._map_graphiti_results(results, req)

        # In-memory fallback: simple keyword matching
        query_lower = req.query.lower()
        words = query_lower.split()
        matches = []
        for fact in self._facts.values():
            if not req.include_invalidated and fact.valid_until is not None:
                continue
            if fact.confidence < req.min_confidence:
                continue
            if not is_visible(fact.scope, req.scope):
                continue
            content_lower = fact.content.lower()
            if any(w in content_lower or w in " ".join(fact.tags).lower() for w in words):
                matches.append(fact)

        matches.sort(key=lambda f: f.confidence, reverse=True)
        return matches[: req.max_results]

    async def invalidate(self, fact_id: str, reason: str) -> None:
        fact = self._facts.get(fact_id)
        if fact:
            fact.valid_until = datetime.now(timezone.utc)

    def _scope_group(self, scope: KnowledgeScope) -> str:
        parts = [scope.level.value]
        if scope.realm_id:
            parts.append(scope.realm_id)
        if scope.formation_id:
            parts.append(scope.formation_id)
        if scope.cell_id:
            parts.append(scope.cell_id)
        return ":".join(parts)

    def _visible_groups(self, scope: KnowledgeScope) -> list[str]:
        groups = ["platform"]
        if scope.realm_id:
            groups.append(f"realm:{scope.realm_id}")
        if scope.formation_id:
            groups.append(f"formation:{scope.realm_id}:{scope.formation_id}")
        if scope.cell_id:
            groups.append(f"cell:{scope.realm_id}:{scope.formation_id}:{scope.cell_id}")
        return groups

    def _map_graphiti_results(self, results, req: SearchRequest) -> list[Fact]:
        return []
