import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { searchMarketplace, installMarketplaceBlueprint, type MarketplaceBlueprint } from '@/lib/api';

function StarRating({ rating }: { rating?: number }) {
  if (rating === undefined) return <span className="text-xs text-gray-600">No rating</span>;

  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const stars = [];
  for (let i = 0; i < 5; i++) {
    if (i < full) stars.push('\u2605');
    else if (i === full && half) stars.push('\u00BD');
    else stars.push('\u2606');
  }
  return (
    <span className="text-yellow-400 text-sm" title={`${rating.toFixed(1)} / 5`}>
      {stars.join('')}
    </span>
  );
}

function BlueprintCard({
  blueprint,
  onInstall,
  isInstalling,
}: {
  blueprint: MarketplaceBlueprint;
  onInstall: () => void;
  isInstalling: boolean;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{blueprint.name}</span>
            <span className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-xs">
              v{blueprint.version}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            by <span className="text-gray-400">{blueprint.author}</span>
            {' '}&middot; {new Date(blueprint.publishedAt).toLocaleDateString()}
          </div>
        </div>
        <button
          onClick={onInstall}
          disabled={isInstalling}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
        >
          Install
        </button>
      </div>

      <div className="text-sm text-gray-400 mb-3">{blueprint.description}</div>

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {blueprint.tags.map((tag) => (
            <span key={tag} className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-xs">
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <StarRating rating={blueprint.rating} />
          <span className="text-xs text-gray-500">{blueprint.downloads} downloads</span>
        </div>
      </div>
    </div>
  );
}

export default function MarketplaceBrowser() {
  const [searchInput, setSearchInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [sortBy, setSortBy] = useState('downloads');
  const [installResult, setInstallResult] = useState<{ name: string; success: boolean } | null>(null);

  const query = useQuery({
    queryKey: ['marketplace', queryText, sortBy],
    queryFn: () =>
      searchMarketplace({
        query: queryText || undefined,
        sortBy,
      }),
  });

  const installMut = useMutation({
    mutationFn: ({ name, version }: { name: string; version: string }) =>
      installMarketplaceBlueprint(name, version),
    onSuccess: (_data, variables) => {
      setInstallResult({ name: variables.name, success: true });
      setTimeout(() => setInstallResult(null), 3000);
    },
    onError: (_err, variables) => {
      setInstallResult({ name: variables.name, success: false });
      setTimeout(() => setInstallResult(null), 3000);
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQueryText(searchInput);
  };

  const blueprints = query.data?.blueprints ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Marketplace</h2>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search blueprints..."
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white flex-1 focus:outline-none focus:border-blue-500"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="downloads">Most Downloaded</option>
            <option value="rating">Highest Rated</option>
            <option value="recent">Most Recent</option>
            <option value="name">Name</option>
          </select>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm"
          >
            Search
          </button>
        </div>
      </form>

      {installResult && (
        <div className={`mb-4 p-3 rounded text-sm ${
          installResult.success
            ? 'bg-green-500/20 text-green-300 border border-green-800'
            : 'bg-red-500/20 text-red-300 border border-red-800'
        }`}>
          {installResult.success
            ? `Successfully installed ${installResult.name}`
            : `Failed to install ${installResult.name}`}
        </div>
      )}

      {query.isLoading && <p className="text-gray-400">Searching marketplace...</p>}
      {query.error && (
        <p className="text-red-400">Error: {(query.error as Error).message}</p>
      )}

      {blueprints.length > 0 && (
        <div className="text-xs text-gray-500 mb-3">{blueprints.length} blueprint{blueprints.length !== 1 ? 's' : ''} found</div>
      )}

      <div className="space-y-4">
        {blueprints.map((bp) => (
          <BlueprintCard
            key={`${bp.name}-${bp.version}`}
            blueprint={bp}
            isInstalling={installMut.isPending}
            onInstall={() => installMut.mutate({ name: bp.name, version: bp.version })}
          />
        ))}
      </div>

      {!query.isLoading && blueprints.length === 0 && (
        <p className="text-gray-500 text-sm">No blueprints found in the marketplace.</p>
      )}
    </div>
  );
}
