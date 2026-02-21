import pytest
from knowledge.models import AddFactRequest, SearchRequest, KnowledgeScope, FactSource, FactSourceType, ScopeLevel
from knowledge.store import GraphitiKnowledgeStore, is_visible


@pytest.mark.asyncio
async def test_add_and_search(store):
    await store.add_fact(AddFactRequest(
        content="TypeScript projects should use strict mode",
        scope=KnowledgeScope(level=ScopeLevel.platform),
        source=FactSource(type=FactSourceType.user_input),
        confidence=0.95,
        tags=["typescript"],
    ))
    results = await store.search(SearchRequest(
        query="typescript strict",
        scope=KnowledgeScope(level=ScopeLevel.platform),
    ))
    assert len(results) == 1
    assert "strict mode" in results[0].content


@pytest.mark.asyncio
async def test_scope_hierarchy(store):
    await store.add_fact(AddFactRequest(
        content="Platform fact",
        scope=KnowledgeScope(level=ScopeLevel.platform),
        source=FactSource(type=FactSourceType.user_input),
        confidence=0.9,
        tags=[],
    ))
    await store.add_fact(AddFactRequest(
        content="Cell fact",
        scope=KnowledgeScope(level=ScopeLevel.cell, realm_id="ns", cell_id="c1"),
        source=FactSource(type=FactSourceType.explicit_remember),
        confidence=0.8,
        tags=[],
    ))
    # Cell sees both
    cell_results = await store.search(SearchRequest(
        query="fact",
        scope=KnowledgeScope(level=ScopeLevel.cell, realm_id="ns", cell_id="c1"),
    ))
    assert len(cell_results) >= 2
    # Platform sees only platform
    plat_results = await store.search(SearchRequest(
        query="fact",
        scope=KnowledgeScope(level=ScopeLevel.platform),
    ))
    assert len(plat_results) == 1


@pytest.mark.asyncio
async def test_invalidate(store):
    fid = await store.add_fact(AddFactRequest(
        content="Old fact",
        scope=KnowledgeScope(level=ScopeLevel.platform),
        source=FactSource(type=FactSourceType.user_input),
        confidence=0.9,
        tags=[],
    ))
    await store.invalidate(fid, "superseded")
    results = await store.search(SearchRequest(
        query="old",
        scope=KnowledgeScope(level=ScopeLevel.platform),
    ))
    assert len(results) == 0


def test_is_visible():
    platform = KnowledgeScope(level=ScopeLevel.platform)
    cell = KnowledgeScope(level=ScopeLevel.cell, realm_id="ns", cell_id="c1")
    assert is_visible(platform, cell) is True
    assert is_visible(cell, platform) is False
