import pytest
from knowledge.router import KnowledgeGraphRouter
from knowledge.models import KnowledgeScope, ScopeLevel, AddFactRequest, SearchRequest, FactSource, FactSourceType


@pytest.fixture
def kg_router():
    r = KnowledgeGraphRouter()
    r.register_graph(graph_id="platform-kg", endpoint=None, database="platform-kg", parent_chain=[], inherit=True)
    r.register_graph(graph_id="trading-kg", endpoint=None, database="trading-kg", parent_chain=["platform-kg"], inherit=True)
    r.register_graph(graph_id="isolated-kg", endpoint=None, database="isolated-kg", parent_chain=["platform-kg"], inherit=False)
    return r


@pytest.mark.asyncio
async def test_get_store_returns_store(kg_router):
    assert kg_router.get_store("trading-kg") is not None


@pytest.mark.asyncio
async def test_get_store_returns_none_for_unknown(kg_router):
    assert kg_router.get_store("unknown") is None


@pytest.mark.asyncio
async def test_search_chain_with_inherit(kg_router):
    chain = kg_router.get_search_chain("trading-kg")
    assert [g.graph_id for g in chain] == ["trading-kg", "platform-kg"]


@pytest.mark.asyncio
async def test_search_chain_without_inherit(kg_router):
    chain = kg_router.get_search_chain("isolated-kg")
    assert [g.graph_id for g in chain] == ["isolated-kg"]


@pytest.mark.asyncio
async def test_search_merges_from_chain(kg_router):
    source = FactSource(type=FactSourceType.user_input)
    scope_p = KnowledgeScope(level=ScopeLevel.platform)
    scope_r = KnowledgeScope(level=ScopeLevel.realm, realm_id="trading")

    await kg_router.get_store("platform-kg").add_fact(
        AddFactRequest(content="platform fact about markets", scope=scope_p, source=source)
    )
    await kg_router.get_store("trading-kg").add_fact(
        AddFactRequest(content="trading fact about markets", scope=scope_r, source=source)
    )

    results = await kg_router.search("trading-kg", SearchRequest(query="markets", scope=scope_r))
    assert len(results) == 2


@pytest.mark.asyncio
async def test_search_isolated_only_own(kg_router):
    source = FactSource(type=FactSourceType.user_input)
    scope_p = KnowledgeScope(level=ScopeLevel.platform)
    scope_r = KnowledgeScope(level=ScopeLevel.realm, realm_id="trading")

    await kg_router.get_store("platform-kg").add_fact(
        AddFactRequest(content="platform fact about markets", scope=scope_p, source=source)
    )
    await kg_router.get_store("isolated-kg").add_fact(
        AddFactRequest(content="isolated fact about markets", scope=scope_r, source=source)
    )

    results = await kg_router.search("isolated-kg", SearchRequest(query="markets", scope=scope_r))
    assert len(results) == 1
    assert "isolated" in results[0].content
