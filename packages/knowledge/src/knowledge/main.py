from __future__ import annotations
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .models import AddFactRequest, SearchRequest, InvalidateRequest, Fact
from .store import GraphitiKnowledgeStore

store: GraphitiKnowledgeStore | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    neo4j_url = os.getenv("NEO4J_URL")
    graphiti_client = None

    if neo4j_url:
        try:
            from graphiti_core import Graphiti
            graphiti_client = Graphiti(neo4j_url, os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "kais"))
            await graphiti_client.build_indices_and_constraints()
        except Exception as e:
            print(f"[knowledge] Graphiti init failed, using in-memory fallback: {e}")

    store = GraphitiKnowledgeStore(graphiti_client)
    yield

    if graphiti_client:
        await graphiti_client.close()


app = FastAPI(title="kAIs Knowledge Service", lifespan=lifespan)


@app.post("/recall", response_model=list[Fact])
async def recall(req: SearchRequest) -> list[Fact]:
    assert store is not None
    return await store.search(req)


@app.post("/remember")
async def remember(req: AddFactRequest) -> dict[str, str]:
    assert store is not None
    fact_id = await store.add_fact(req)
    return {"factId": fact_id}


@app.post("/correct")
async def correct(req: InvalidateRequest) -> dict[str, str]:
    assert store is not None
    await store.invalidate(req.fact_id, req.reason)
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}
