import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchKnowledge, type Fact } from '@/lib/api';

const SCOPE_COLORS: Record<string, string> = {
  platform: 'bg-purple-500/20 text-purple-300',
  realm: 'bg-blue-500/20 text-blue-300',
  formation: 'bg-green-500/20 text-green-300',
  cell: 'bg-yellow-500/20 text-yellow-300',
};

const SOURCE_COLORS: Record<string, string> = {
  mission_extraction: 'bg-blue-500/20 text-blue-300',
  experiment: 'bg-green-500/20 text-green-300',
  user_input: 'bg-yellow-500/20 text-yellow-300',
  promoted: 'bg-purple-500/20 text-purple-300',
  explicit_remember: 'bg-orange-500/20 text-orange-300',
};

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = confidence * 100;
  let color = 'bg-green-500';
  if (confidence < 0.5) color = 'bg-red-500';
  else if (confidence < 0.75) color = 'bg-yellow-500';

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`${color} h-full rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400">{pct.toFixed(0)}%</span>
    </div>
  );
}

function FactCard({ fact }: { fact: Fact }) {
  const isExpired = fact.validUntil && new Date(fact.validUntil) < new Date();

  return (
    <div className={`bg-gray-900 border rounded-lg p-4 ${isExpired ? 'border-red-800 opacity-60' : 'border-gray-800'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${SCOPE_COLORS[fact.scope.level] ?? 'bg-gray-700 text-gray-300'}`}>
            {fact.scope.level}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs ${SOURCE_COLORS[fact.source.type] ?? 'bg-gray-700 text-gray-300'}`}>
            {fact.source.type.replace(/_/g, ' ')}
          </span>
          {isExpired && (
            <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300">expired</span>
          )}
        </div>
        <ConfidenceBar confidence={fact.confidence} />
      </div>

      <div className="text-sm text-white mb-3">{fact.content}</div>

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {fact.tags.map((tag) => (
            <span key={tag} className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-xs">
              #{tag}
            </span>
          ))}
        </div>
        <span className="text-xs text-gray-600 font-mono">{fact.id.slice(0, 8)}</span>
      </div>

      <div className="mt-2 text-xs text-gray-600 flex gap-3">
        <span>Valid from: {new Date(fact.validFrom).toLocaleDateString()}</span>
        {fact.validUntil && (
          <span>Until: {new Date(fact.validUntil).toLocaleDateString()}</span>
        )}
        {fact.scope.realmId && <span>Realm: {fact.scope.realmId}</span>}
        {fact.scope.formationId && <span>Formation: {fact.scope.formationId}</span>}
        {fact.scope.cellId && <span>Cell: {fact.scope.cellId}</span>}
      </div>
    </div>
  );
}

export default function KnowledgeExplorer() {
  const [searchInput, setSearchInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [minConfidence, setMinConfidence] = useState(0);
  const [maxResults, setMaxResults] = useState(20);

  const query = useQuery({
    queryKey: ['knowledge', queryText, minConfidence, maxResults],
    queryFn: () =>
      searchKnowledge({
        query: queryText,
        minConfidence: minConfidence > 0 ? minConfidence : undefined,
        maxResults,
      }),
    enabled: queryText.length > 0,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQueryText(searchInput);
  };

  const facts = query.data?.facts ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Knowledge Explorer</h2>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search knowledge base..."
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white flex-1 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm"
          >
            Search
          </button>
        </div>
        <div className="flex gap-4 items-center">
          <label className="text-xs text-gray-500 flex items-center gap-2">
            Min confidence:
            <input
              type="range"
              min="0"
              max="100"
              value={minConfidence * 100}
              onChange={(e) => setMinConfidence(parseInt(e.target.value, 10) / 100)}
              className="w-24"
            />
            <span className="text-gray-400 w-8">{(minConfidence * 100).toFixed(0)}%</span>
          </label>
          <label className="text-xs text-gray-500 flex items-center gap-2">
            Max results:
            <select
              value={maxResults}
              onChange={(e) => setMaxResults(parseInt(e.target.value, 10))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>
      </form>

      {query.isLoading && <p className="text-gray-400">Searching...</p>}
      {query.error && (
        <p className="text-red-400">Error: {(query.error as Error).message}</p>
      )}

      {facts.length > 0 && (
        <div className="text-xs text-gray-500 mb-3">
          {facts.length} result{facts.length !== 1 ? 's' : ''}
        </div>
      )}

      <div className="space-y-3">
        {facts.map((fact) => (
          <FactCard key={fact.id} fact={fact} />
        ))}
      </div>

      {queryText && !query.isLoading && facts.length === 0 && (
        <p className="text-gray-500 text-sm">No facts found matching your query.</p>
      )}

      {!queryText && (
        <p className="text-gray-500 text-sm">Enter a search query to explore the knowledge base.</p>
      )}
    </div>
  );
}
