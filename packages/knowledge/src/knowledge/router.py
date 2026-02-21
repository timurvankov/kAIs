from __future__ import annotations
from dataclasses import dataclass
from .models import SearchRequest, AddFactRequest, Fact
from .store import GraphitiKnowledgeStore


@dataclass
class RegisteredGraph:
    graph_id: str
    store: GraphitiKnowledgeStore
    parent_chain: list[str]
    inherit: bool


class KnowledgeGraphRouter:
    """Routes knowledge operations to the correct graph store, with optional parent chain traversal."""

    def __init__(self):
        self._graphs: dict[str, RegisteredGraph] = {}

    def register_graph(
        self,
        graph_id: str,
        endpoint: str | None,
        database: str,
        parent_chain: list[str],
        inherit: bool,
    ) -> None:
        store = GraphitiKnowledgeStore(graphiti_client=None)
        self._graphs[graph_id] = RegisteredGraph(
            graph_id=graph_id,
            store=store,
            parent_chain=parent_chain,
            inherit=inherit,
        )

    def unregister_graph(self, graph_id: str) -> None:
        self._graphs.pop(graph_id, None)

    def get_store(self, graph_id: str) -> GraphitiKnowledgeStore | None:
        entry = self._graphs.get(graph_id)
        return entry.store if entry else None

    def get_search_chain(self, graph_id: str) -> list[RegisteredGraph]:
        entry = self._graphs.get(graph_id)
        if not entry:
            return []

        chain = [entry]
        if not entry.inherit:
            return chain

        for parent_id in entry.parent_chain:
            parent = self._graphs.get(parent_id)
            if parent:
                chain.append(parent)

        return chain

    async def search(self, graph_id: str, req: SearchRequest) -> list[Fact]:
        chain = self.get_search_chain(graph_id)
        if not chain:
            return []

        all_results: list[Fact] = []
        for entry in chain:
            results = await entry.store.search(req)
            all_results.extend(results)

        seen: set[str] = set()
        unique: list[Fact] = []
        for fact in all_results:
            if fact.content not in seen:
                seen.add(fact.content)
                unique.append(fact)

        unique.sort(key=lambda f: f.confidence, reverse=True)
        return unique[: req.max_results]

    async def add_fact(self, graph_id: str, req: AddFactRequest) -> str:
        store = self.get_store(graph_id)
        if not store:
            raise ValueError(f"Unknown knowledge graph: {graph_id}")
        return await store.add_fact(req)

    async def invalidate(self, graph_id: str, fact_id: str, reason: str) -> None:
        store = self.get_store(graph_id)
        if not store:
            raise ValueError(f"Unknown knowledge graph: {graph_id}")
        await store.invalidate(fact_id, reason)
