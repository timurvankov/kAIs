import pytest
from knowledge.store import GraphitiKnowledgeStore

@pytest.fixture
def store():
    return GraphitiKnowledgeStore()
