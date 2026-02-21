from __future__ import annotations
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .models import AddFactRequest, SearchRequest, InvalidateRequest, Fact
from .store import GraphitiKnowledgeStore
from .router import KnowledgeGraphRouter

router = KnowledgeGraphRouter()
fallback_store: GraphitiKnowledgeStore | None = None

DEFAULT_GRAPH_ID = "__default__"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global fallback_store
    neo4j_url = os.getenv("NEO4J_URL")
    graphiti_client = None

    if neo4j_url:
        try:
            from graphiti_core import Graphiti
            graphiti_client = Graphiti(neo4j_url, os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "kais"))
            await graphiti_client.build_indices_and_constraints()
        except Exception as e:
            print(f"[knowledge] Graphiti init failed, using in-memory fallback: {e}")

    fallback_store = GraphitiKnowledgeStore(graphiti_client)
    router.register_graph(
        graph_id=DEFAULT_GRAPH_ID,
        endpoint=neo4j_url,
        database="neo4j",
        parent_chain=[],
        inherit=False,
    )

    yield

    if graphiti_client:
        await graphiti_client.close()


app = FastAPI(title="kAIs Knowledge Service", lifespan=lifespan)


def _resolve_graph_id(graph_id: str | None) -> str:
    return graph_id if graph_id and router.get_store(graph_id) else DEFAULT_GRAPH_ID


def _get_store(graph_id: str | None) -> GraphitiKnowledgeStore:
    gid = _resolve_graph_id(graph_id)
    if gid == DEFAULT_GRAPH_ID and fallback_store:
        return fallback_store
    store = router.get_store(gid)
    if store:
        return store
    assert fallback_store is not None
    return fallback_store


@app.post("/recall", response_model=list[Fact])
async def recall(req: SearchRequest) -> list[Fact]:
    gid = _resolve_graph_id(req.graph_id)
    if gid != DEFAULT_GRAPH_ID:
        return await router.search(gid, req)
    return await _get_store(req.graph_id).search(req)


@app.post("/remember")
async def remember(req: AddFactRequest) -> dict[str, str]:
    gid = _resolve_graph_id(req.graph_id)
    if gid != DEFAULT_GRAPH_ID:
        fact_id = await router.add_fact(gid, req)
    else:
        fact_id = await _get_store(req.graph_id).add_fact(req)
    return {"factId": fact_id}


@app.post("/correct")
async def correct(req: InvalidateRequest) -> dict[str, str]:
    gid = _resolve_graph_id(req.graph_id)
    if gid != DEFAULT_GRAPH_ID:
        await router.invalidate(gid, req.fact_id, req.reason)
    else:
        await _get_store(req.graph_id).invalidate(req.fact_id, req.reason)
    return {"status": "ok"}


@app.post("/graphs/register")
async def register_graph(body: dict) -> dict[str, str]:
    router.register_graph(
        graph_id=body["graphId"],
        endpoint=body.get("endpoint"),
        database=body.get("database", body["graphId"]),
        parent_chain=body.get("parentChain", []),
        inherit=body.get("inherit", True),
    )
    return {"status": "ok"}


@app.post("/graphs/unregister")
async def unregister_graph(body: dict) -> dict[str, str]:
    router.unregister_graph(body["graphId"])
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}
