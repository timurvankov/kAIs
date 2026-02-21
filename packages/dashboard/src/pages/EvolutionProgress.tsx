import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEvolutions, fetchEvolution, type Evolution } from '@/lib/api';

const PHASE_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-500/20 text-yellow-300',
  Running: 'bg-blue-500/20 text-blue-300',
  Analyzing: 'bg-purple-500/20 text-purple-300',
  Completed: 'bg-green-500/20 text-green-300',
  Failed: 'bg-red-500/20 text-red-300',
  Aborted: 'bg-gray-500/20 text-gray-300',
};

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PHASE_COLORS[phase] ?? 'bg-gray-700 text-gray-300'}`}>
      {phase}
    </span>
  );
}

function TextFitnessCurve({ generations, maxFitness }: { generations: number; maxFitness?: number }) {
  if (generations <= 0 || maxFitness === undefined) {
    return (
      <div className="bg-gray-800 rounded p-4 text-xs font-mono text-gray-500 text-center">
        No fitness data available yet
      </div>
    );
  }

  const chartHeight = 8;
  const chartWidth = Math.min(generations, 40);

  // Simulate a simple ascending curve visualization
  const lines: string[] = [];
  for (let row = chartHeight; row >= 1; row--) {
    const threshold = (row / chartHeight) * (maxFitness || 1);
    let line = `${(threshold).toFixed(2).padStart(6)} |`;
    for (let col = 0; col < chartWidth; col++) {
      // Simple ascending curve approximation
      const genFitness = (maxFitness || 0) * (col / Math.max(chartWidth - 1, 1));
      line += genFitness >= threshold ? '\u2588' : ' ';
    }
    lines.push(line);
  }
  lines.push('       +' + '-'.repeat(chartWidth));
  const genLabel = '        Gen 0' + ' '.repeat(Math.max(0, chartWidth - 8)) + `Gen ${generations}`;
  lines.push(genLabel);

  return (
    <div className="bg-gray-800 rounded p-4">
      <div className="text-xs text-gray-500 mb-2">Fitness Curve (text approximation)</div>
      <pre className="text-xs font-mono text-green-400 leading-tight">
        {lines.join('\n')}
      </pre>
    </div>
  );
}

function GeneImportance({ importance }: { importance: Record<string, number> }) {
  const sorted = Object.entries(importance).sort((a, b) => b[1] - a[1]);
  const maxVal = Math.max(...sorted.map(([, v]) => v), 0.01);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-400 mb-3">Gene Importance</h4>
      <div className="space-y-2">
        {sorted.map(([gene, value]) => (
          <div key={gene} className="flex items-center gap-3">
            <span className="text-xs font-mono text-blue-400 w-32 truncate">{gene}</span>
            <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${(value / maxVal) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-12 text-right">{value.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvolutionDetailView({ evolution }: { evolution: Evolution }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{evolution.name}</h3>
        <PhaseBadge phase={evolution.status.phase} />
        <span className="text-xs text-gray-500">{evolution.namespace}</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{evolution.status.generation}</div>
          <div className="text-xs text-gray-500">
            Generation / {evolution.spec.stopping.maxGenerations} max
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">
            {evolution.status.bestFitness !== undefined
              ? evolution.status.bestFitness.toFixed(4)
              : 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Best Fitness</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{evolution.status.populationSize}</div>
          <div className="text-xs text-gray-500">Population Size</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">${evolution.status.totalCost.toFixed(4)}</div>
          <div className="text-xs text-gray-500">Total Cost</div>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Generation Progress</span>
          <span>{evolution.status.generation} / {evolution.spec.stopping.maxGenerations}</span>
        </div>
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full"
            style={{ width: `${(evolution.status.generation / evolution.spec.stopping.maxGenerations) * 100}%` }}
          />
        </div>
      </div>

      <TextFitnessCurve
        generations={evolution.status.generation}
        maxFitness={evolution.status.bestFitness}
      />

      {evolution.status.geneImportance && Object.keys(evolution.status.geneImportance).length > 0 && (
        <GeneImportance importance={evolution.status.geneImportance} />
      )}

      {evolution.status.bestIndividual && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Best Individual</h4>
          <div className="grid grid-cols-2 gap-3 text-sm mb-3">
            <div>
              <span className="text-gray-500">ID:</span>{' '}
              <span className="text-blue-400 font-mono">{evolution.status.bestIndividual.id}</span>
            </div>
            <div>
              <span className="text-gray-500">Fitness:</span>{' '}
              <span className="text-green-400">
                {evolution.status.bestIndividual.fitness?.toFixed(4) ?? 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Generation:</span>{' '}
              <span className="text-gray-300">{evolution.status.bestIndividual.generation}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 mb-2">Genes:</div>
          <div className="bg-gray-800 rounded p-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(evolution.status.bestIndividual.genes).map(([gene, value]) => (
                <div key={gene} className="bg-gray-700 rounded px-2 py-1">
                  <span className="text-xs text-blue-400 font-mono">{gene}</span>
                  <span className="text-xs text-gray-500"> = </span>
                  <span className="text-xs text-white">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Gene Definitions</h4>
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                <th className="py-2 px-3">Gene</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Range / Values</th>
              </tr>
            </thead>
            <tbody>
              {evolution.spec.genes.map((gene) => (
                <tr key={gene.name} className="border-t border-gray-800">
                  <td className="py-2 px-3 font-mono text-blue-400">{gene.name}</td>
                  <td className="py-2 px-3 text-gray-400">{gene.type}</td>
                  <td className="py-2 px-3 text-xs text-gray-400">
                    {gene.type === 'enum' && gene.values
                      ? gene.values.map(String).join(', ')
                      : gene.type === 'numeric'
                        ? `${gene.min ?? '-inf'} to ${gene.max ?? 'inf'}`
                        : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-800 rounded p-3 text-xs text-gray-400">
        <span className="text-gray-500">Selection:</span> {evolution.spec.selection} &middot;{' '}
        <span className="text-gray-500">Crossover:</span> {evolution.spec.crossover} &middot;{' '}
        <span className="text-gray-500">Mutation rate:</span> {evolution.spec.mutation.rate} &middot;{' '}
        <span className="text-gray-500">Elitism:</span> {evolution.spec.elitism} &middot;{' '}
        <span className="text-gray-500">Budget:</span> ${evolution.spec.budget.maxTotalCost.toFixed(2)}
      </div>

      {evolution.status.message && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm text-gray-400">
          {evolution.status.message}
        </div>
      )}
    </div>
  );
}

export default function EvolutionProgress() {
  const [selectedEvolution, setSelectedEvolution] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['evolutions'],
    queryFn: () => fetchEvolutions(),
  });

  const detailQuery = useQuery({
    queryKey: ['evolution', selectedEvolution],
    queryFn: () => fetchEvolution(selectedEvolution!),
    enabled: !!selectedEvolution,
  });

  const evolutions = listQuery.data?.evolutions ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Evolution Progress</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading evolutions...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {evolutions.map((evo) => (
          <button
            key={evo.name}
            onClick={() => setSelectedEvolution(evo.name === selectedEvolution ? null : evo.name)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedEvolution === evo.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white">{evo.name}</span>
              <PhaseBadge phase={evo.status.phase} />
            </div>
            <div className="text-xs text-gray-500">
              Gen {evo.status.generation}/{evo.spec.stopping.maxGenerations} &middot;{' '}
              Fitness: {evo.status.bestFitness?.toFixed(3) ?? 'N/A'} &middot;{' '}
              ${evo.status.totalCost.toFixed(4)}
            </div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && evolutions.length === 0 && (
        <p className="text-gray-500 text-sm">No evolutions found.</p>
      )}

      {selectedEvolution && detailQuery.isLoading && (
        <p className="text-gray-400">Loading evolution details...</p>
      )}
      {selectedEvolution && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <EvolutionDetailView evolution={detailQuery.data} />}
    </div>
  );
}
