#!/usr/bin/env node
import { Command } from 'commander';
import { execSync, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderTopology, type TopologySpec } from './topology-renderer.js';
import { formatMissionStatus } from './mission-formatter.js';

const EXAMPLE_CELL = `apiVersion: kais.io/v1
kind: Cell
metadata:
  name: researcher
  namespace: default
spec:
  mind:
    provider: anthropic
    model: claude-sonnet-4-20250514
    systemPrompt: |
      You are a research assistant. When you receive a topic,
      search for information and report findings.
    temperature: 0.7
  tools:
    - name: web_search
    - name: send_message
  resources:
    maxTokensPerTurn: 4096
    maxCostPerHour: 0.50
    memoryLimit: 256Mi
    cpuLimit: 500m
`;

function getApiUrl(opts: { apiUrl?: string }): string {
  return opts.apiUrl ?? process.env['KAIS_API_URL'] ?? 'http://localhost:3000';
}

export function createProgram(): Command {
  const program = new Command();
  program.name('kais').description('kAIs CLI — Kubernetes AI Swarm').version('0.1.0');

  // ----- Kubectl passthrough commands -----

  const kubectlCommands = ['apply', 'get', 'describe', 'delete'];
  for (const cmd of kubectlCommands) {
    program
      .command(cmd, { hidden: false })
      .description(`kubectl ${cmd} (passthrough)`)
      .allowUnknownOption()
      .allowExcessArguments()
      .action((_opts, command: Command) => {
        execFileSync('kubectl', [cmd, ...command.args], { stdio: 'inherit' });
      });
  }

  // ----- API commands -----

  program
    .command('exec <cell> <message>')
    .description('Send a message to a Cell via the kAIs API')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .option('--api-url <url>', 'API server URL')
    .action(async (cell: string, message: string, opts: { namespace: string; apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);
      const res = await fetch(`${apiUrl}/api/v1/cells/${encodeURIComponent(cell)}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, namespace: opts.namespace }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Error: ${res.status} ${text}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as { messageId: string };
      console.log(`Message sent (id: ${data.messageId})`);
    });

  const logs = program.command('logs').description('Fetch logs');

  logs
    .command('cell <name>')
    .description('Fetch event logs for a Cell')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .option('--limit <n>', 'Maximum number of log entries', '50')
    .option('--trace-id <id>', 'Filter logs by trace ID')
    .option('--api-url <url>', 'API server URL')
    .action(async (name: string, opts: { namespace: string; limit: string; traceId?: string; apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);
      const params = new URLSearchParams({
        namespace: opts.namespace,
        limit: opts.limit,
      });
      if (opts.traceId) {
        params.set('trace_id', opts.traceId);
      }
      const res = await fetch(
        `${apiUrl}/api/v1/cells/${encodeURIComponent(name)}/logs?${params.toString()}`,
      );
      if (!res.ok) {
        const text = await res.text();
        console.error(`Error: ${res.status} ${text}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        logs: Array<{ created_at: string; event_type: string; payload: unknown }>;
        total: number;
      };
      for (const log of data.logs) {
        const time = new Date(log.created_at).toLocaleTimeString();
        console.log(`[${time}] ${log.event_type.padEnd(18)} ${JSON.stringify(log.payload)}`);
      }
    });

  logs
    .command('formation <name>')
    .description('Interleaved logs from all cells in a Formation')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .option('--api-url <url>', 'API server URL')
    .action(async (name: string, opts: { namespace: string; apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);

      // Get the formation to list cells
      let formationJson: string;
      try {
        formationJson = execFileSync('kubectl', [
          'get', 'formation', name, '-n', opts.namespace, '-o', 'json',
        ], { encoding: 'utf-8' });
      } catch {
        console.error(`Error: failed to get formation "${name}" in namespace "${opts.namespace}"`);
        process.exitCode = 1;
        return;
      }
      const formation = JSON.parse(formationJson) as {
        spec: { cells: Array<{ name: string; replicas: number }> };
      };

      // Expand cell names
      const cellNames: string[] = [];
      for (const tpl of formation.spec.cells) {
        for (let i = 0; i < tpl.replicas; i++) {
          cellNames.push(`${tpl.name}-${i}`);
        }
      }

      // Fetch logs for each cell in parallel
      const params = new URLSearchParams({ namespace: opts.namespace });
      const logPromises = cellNames.map(async (cellName) => {
        const res = await fetch(
          `${apiUrl}/api/v1/cells/${encodeURIComponent(cellName)}/logs?${params.toString()}`,
        );
        if (!res.ok) {
          console.error(`Warning: failed to fetch logs for ${cellName} (${res.status})`);
          return [];
        }
        const data = (await res.json()) as {
          logs: Array<{ created_at: string; event_type: string; payload: unknown }>;
        };
        return data.logs.map((log) => ({ ...log, cellName }));
      });

      const allLogs = (await Promise.all(logPromises)).flat();

      // Sort by timestamp and display
      allLogs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      for (const log of allLogs) {
        const time = new Date(log.created_at).toLocaleTimeString();
        console.log(
          `[${time}] ${log.cellName.padEnd(20)} ${log.event_type.padEnd(18)} ${JSON.stringify(log.payload)}`,
        );
      }
    });

  program
    .command('attach <cell>')
    .description('Attach interactively to a Cell via WebSocket')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .option('--api-url <url>', 'API server URL')
    .action(async (cell: string, opts: { namespace: string; apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);
      const wsUrl = apiUrl.replace(/^http/, 'ws');
      const params = new URLSearchParams({ namespace: opts.namespace });
      const ws = new WebSocket(
        `${wsUrl}/api/v1/cells/${encodeURIComponent(cell)}/attach?${params.toString()}`,
      );
      ws.onmessage = (event) => {
        console.log(String(event.data));
      };
      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        process.exit(1);
      };
      ws.onclose = () => {
        process.exit(0);
      };
      // Read stdin and send to ws
      process.stdin.on('data', (data: Buffer) => {
        ws.send(data.toString().trim());
      });
    });

  program
    .command('usage <cell>')
    .description('Show cost and token usage for a Cell')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .option('--api-url <url>', 'API server URL')
    .action(async (cell: string, opts: { namespace: string; apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);
      const params = new URLSearchParams({ namespace: opts.namespace });
      const res = await fetch(
        `${apiUrl}/api/v1/cells/${encodeURIComponent(cell)}/usage?${params.toString()}`,
      );
      if (!res.ok) {
        const text = await res.text();
        console.error(`Error: ${res.status} ${text}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        totalCost: number;
        totalTokens: number;
        events: number;
      };
      console.log(`Cost:   $${data.totalCost.toFixed(4)}`);
      console.log(`Tokens: ${data.totalTokens}`);
      console.log(`Events: ${data.events}`);
    });

  // ----- Convenience commands -----

  program
    .command('init')
    .description('Scaffold a new kAIs project in the current directory')
    .action(() => {
      console.log('Scaffolding kAIs project...');
      const cellPath = resolve(process.cwd(), 'researcher.yaml');
      if (existsSync(cellPath)) {
        console.log('researcher.yaml already exists, skipping.');
      } else {
        writeFileSync(cellPath, EXAMPLE_CELL, 'utf-8');
        console.log('Created researcher.yaml');
      }

      const cellsDir = resolve(process.cwd(), 'cells');
      if (!existsSync(cellsDir)) {
        mkdirSync(cellsDir, { recursive: true });
        console.log('Created cells/ directory');
      }

      console.log('\nDone! Next steps:');
      console.log('  kais up                  # Start the platform');
      console.log('  kais apply -f researcher.yaml  # Deploy a Cell');
    });

  program
    .command('up')
    .description('Start the kAIs platform (minikube + infrastructure)')
    .action(() => {
      console.log('Starting kAIs platform...');
      execSync('minikube start --cpus=4 --memory=8g --driver=docker', { stdio: 'inherit' });
      execSync('helmfile apply', { stdio: 'inherit' });
      execSync('kubectl apply -f crds/', { stdio: 'inherit' });
      console.log('kAIs platform is up!');
    });

  program
    .command('down')
    .description('Stop the kAIs platform (minikube stop)')
    .action(() => {
      execSync('minikube stop', { stdio: 'inherit' });
    });

  // ----- Formation commands -----

  const scale = program.command('scale').description('Scale resources');

  scale
    .command('formation <name>')
    .description('Scale a cell template in a Formation')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .option('--cell <template>', 'Cell template name to scale')
    .option('--replicas <n>', 'Desired replica count')
    .action((name: string, opts: { namespace: string; cell?: string; replicas?: string }) => {
      if (!opts.cell) {
        console.error('Error: --cell is required');
        process.exitCode = 1;
        return;
      }
      if (!opts.replicas) {
        console.error('Error: --replicas is required');
        process.exitCode = 1;
        return;
      }
      const replicas = parseInt(opts.replicas, 10);
      if (isNaN(replicas) || replicas < 1) {
        console.error('Error: --replicas must be a positive integer');
        process.exitCode = 1;
        return;
      }

      // Get the formation to find the cell template index
      let formationJson: string;
      try {
        formationJson = execFileSync('kubectl', [
          'get', 'formation', name, '-n', opts.namespace, '-o', 'json',
        ], { encoding: 'utf-8' });
      } catch {
        console.error(`Error: failed to get formation "${name}" in namespace "${opts.namespace}"`);
        process.exitCode = 1;
        return;
      }
      const formation = JSON.parse(formationJson) as {
        spec: { cells: Array<{ name: string; replicas: number }> };
      };

      const cellIndex = formation.spec.cells.findIndex(
        (c: { name: string }) => c.name === opts.cell,
      );
      if (cellIndex === -1) {
        console.error(`Error: cell template "${opts.cell}" not found in formation "${name}"`);
        process.exitCode = 1;
        return;
      }

      const patch = JSON.stringify([
        { op: 'replace', path: `/spec/cells/${cellIndex}/replicas`, value: replicas },
      ]);
      try {
        execFileSync('kubectl', [
          'patch', 'formation', name, '-n', opts.namespace,
          '--type=json', '-p', patch,
        ], { stdio: 'inherit' });
      } catch {
        console.error(`Error: failed to patch formation "${name}" in namespace "${opts.namespace}"`);
        process.exitCode = 1;
        return;
      }
      console.log(`Scaled ${opts.cell} in formation ${name} to ${replicas} replicas`);
    });

  // ----- Mission commands -----

  const mission = program.command('mission').description('Mission management commands');

  mission
    .command('status <name>')
    .description('Show detailed mission status')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .action((name: string, opts: { namespace: string }) => {
      let missionJson: string;
      try {
        missionJson = execFileSync('kubectl', [
          'get', 'mission', name, '-n', opts.namespace, '-o', 'json',
        ], { encoding: 'utf-8' });
      } catch {
        console.error(`Error: failed to get mission "${name}" in namespace "${opts.namespace}"`);
        process.exitCode = 1;
        return;
      }
      const missionObj = JSON.parse(missionJson);
      console.log(formatMissionStatus(missionObj));
    });

  mission
    .command('retry <name>')
    .description('Force a mission retry by resetting phase to Pending')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .action((name: string, opts: { namespace: string }) => {
      const patch = JSON.stringify({ status: { phase: 'Pending' } });
      try {
        execFileSync('kubectl', [
          'patch', 'mission', name, '-n', opts.namespace,
          '--type=merge', '--subresource=status', '-p', patch,
        ], { stdio: 'inherit' });
      } catch {
        console.error(`Error: failed to patch mission "${name}" in namespace "${opts.namespace}"`);
        process.exitCode = 1;
        return;
      }
      console.log(`Mission ${name} set to Pending for retry`);
    });

  mission
    .command('abort <name>')
    .description('Abort a mission by setting phase to Failed')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .action((name: string, opts: { namespace: string }) => {
      const patch = JSON.stringify({ status: { phase: 'Failed', message: 'UserAborted' } });
      try {
        execFileSync('kubectl', [
          'patch', 'mission', name, '-n', opts.namespace,
          '--type=merge', '--subresource=status', '-p', patch,
        ], { stdio: 'inherit' });
      } catch {
        console.error(`Error: failed to patch mission "${name}" in namespace "${opts.namespace}"`);
        process.exitCode = 1;
        return;
      }
      console.log(`Mission ${name} aborted`);
    });

  // ----- Topology commands -----

  const topology = program.command('topology').description('Topology visualization commands');

  topology
    .command('show <formation-name>')
    .description('Show ASCII graph of a Formation topology')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .action((formationName: string, opts: { namespace: string }) => {
      let formationJson: string;
      try {
        formationJson = execFileSync('kubectl', [
          'get', 'formation', formationName, '-n', opts.namespace, '-o', 'json',
        ], { encoding: 'utf-8' });
      } catch {
        console.error(`Error: failed to get formation "${formationName}" in namespace "${opts.namespace}"`);
        process.exitCode = 1;
        return;
      }
      const formation = JSON.parse(formationJson) as {
        spec: {
          cells: Array<{ name: string; replicas: number; spec: unknown }>;
          topology: TopologySpec;
        };
      };

      const output = renderTopology(formation.spec.topology, formation.spec.cells);
      console.log(output);
    });

  // ----- Observability commands -----

  program
    .command('trace <mission>')
    .description('Open Jaeger UI for a mission trace')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .action((mission: string, _opts: { namespace: string }) => {
      const jaegerUrl = process.env['KAIS_JAEGER_URL'] ?? 'http://localhost:16686';
      const url = `${jaegerUrl}/search?service=kais-cell&tags=%7B%22mission%22%3A%22${encodeURIComponent(mission)}%22%7D`;
      console.log(`Opening Jaeger trace: ${url}`);
      try {
        const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        execSync(`${openCmd} '${url}'`, { stdio: 'ignore' });
      } catch {
        console.log(`Open this URL in your browser: ${url}`);
      }
    });

  program
    .command('metrics')
    .description('Show platform metrics summary')
    .option('--api-url <url>', 'API server URL')
    .action(async (opts: { apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);
      const res = await fetch(`${apiUrl}/api/v1/metrics`);
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = await res.json() as {
        activeCells: number;
        totalCostToday: number;
        totalTokensToday: number;
        llmCallsToday: number;
      };
      console.log(`Active Cells:    ${data.activeCells}`);
      console.log(`Cost Today:      $${data.totalCostToday.toFixed(4)}`);
      console.log(`Tokens Today:    ${data.totalTokensToday}`);
      console.log(`LLM Calls Today: ${data.llmCallsToday}`);
    });

  program
    .command('dashboard')
    .description('Open Grafana dashboard in browser')
    .action(() => {
      const grafanaUrl = process.env['KAIS_GRAFANA_URL'] ?? 'http://localhost:3001';
      console.log(`Opening Grafana: ${grafanaUrl}`);
      try {
        const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        execSync(`${openCmd} '${grafanaUrl}'`, { stdio: 'ignore' });
      } catch {
        console.log(`Open this URL in your browser: ${grafanaUrl}`);
      }
    });

  // ----- Knowledge commands -----

  const knowledge = program
    .command('knowledge')
    .description('Manage the knowledge graph')
    .addCommand(
      new Command('search')
        .argument('<query>', 'Search query')
        .option('--scope <scope>', 'Scope: platform|realm|formation|cell', 'platform')
        .option('--namespace <ns>', 'Namespace for realm scope', 'default')
        .option('-n, --max-results <n>', 'Max results', '10')
        .option('--api-url <url>', 'API server URL')
        .action(async (query: string, opts: { scope: string; namespace: string; maxResults: string; apiUrl?: string }) => {
          const apiUrl = getApiUrl(opts);
          const res = await fetch(
            `${apiUrl}/api/v1/knowledge/search`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query,
                scope: { level: opts.scope, realm_id: opts.namespace },
                max_results: parseInt(opts.maxResults, 10),
              }),
            },
          );
          if (!res.ok) {
            const text = await res.text();
            console.error(`Error: ${res.status} ${text}`);
            process.exitCode = 1;
            return;
          }
          const facts = await res.json() as Array<{ id: string; confidence: number; content: string; tags: string[] }>;
          for (const f of facts) {
            console.log(`  [${f.id.slice(0, 8)}] (${f.confidence}) ${f.content}`);
            if (f.tags.length) console.log(`         tags: ${f.tags.join(', ')}`);
          }
        }),
    )
    .addCommand(
      new Command('add')
        .argument('<fact>', 'Fact to add')
        .option('--scope <scope>', 'Scope', 'platform')
        .option('--confidence <n>', 'Confidence 0-1', '0.9')
        .option('--tags <tags>', 'Comma-separated tags', '')
        .option('--api-url <url>', 'API server URL')
        .action(async (fact: string, opts: { scope: string; confidence: string; tags: string; apiUrl?: string }) => {
          const apiUrl = getApiUrl(opts);
          const res = await fetch(
            `${apiUrl}/api/v1/knowledge/add`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: fact,
                scope: { level: opts.scope },
                source: { type: 'user_input' },
                confidence: parseFloat(opts.confidence),
                tags: opts.tags ? opts.tags.split(',') : [],
              }),
            },
          );
          if (!res.ok) {
            const text = await res.text();
            console.error(`Error: ${res.status} ${text}`);
            process.exitCode = 1;
            return;
          }
          const data = await res.json() as { factId: string };
          console.log(`Fact added: ${data.factId}`);
        }),
    );

  // ----- KnowledgeGraph commands -----

  knowledge
    .addCommand(
      new Command('graphs')
        .description('Manage KnowledgeGraph resources')
        .addCommand(
          new Command('list')
            .action(() => {
              const result = execFileSync('kubectl', ['get', 'knowledgegraphs', '-o', 'wide'], { encoding: 'utf-8' });
              console.log(result);
            }),
        )
        .addCommand(
          new Command('describe')
            .argument('<name>', 'KnowledgeGraph name')
            .action((name: string) => {
              const result = execFileSync('kubectl', ['describe', 'knowledgegraph', name], { encoding: 'utf-8' });
              console.log(result);
            }),
        ),
    );

  // ----- Blueprint commands -----

  program
    .command('blueprint')
    .description('Manage reusable team blueprints')
    .addCommand(
      new Command('list')
        .action(() => {
          const result = execFileSync('kubectl', ['get', 'blueprints', '-o', 'wide'], { encoding: 'utf-8' });
          console.log(result);
        }),
    )
    .addCommand(
      new Command('describe')
        .argument('<name>', 'Blueprint name')
        .action((name: string) => {
          const result = execFileSync('kubectl', ['describe', 'blueprint', name], { encoding: 'utf-8' });
          console.log(result);
        }),
    )
    .addCommand(
      new Command('use')
        .argument('<name>', 'Blueprint name')
        .option('--namespace <ns>', 'Target namespace', 'default')
        .option('--set <params...>', 'Parameter overrides (key=value)')
        .option('--mission <objective>', 'Mission objective')
        .option('--api-url <url>', 'API server URL')
        .action(async (name: string, opts: { namespace: string; set?: string[]; mission?: string; apiUrl?: string }) => {
          const apiUrl = getApiUrl(opts);
          const params: Record<string, string> = {};
          for (const p of opts.set ?? []) {
            const [k, v] = p.split('=');
            if (k && v) params[k] = v;
          }

          const res = await fetch(
            `${apiUrl}/api/v1/blueprints/${encodeURIComponent(name)}/instantiate`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                namespace: opts.namespace,
                parameters: params,
                mission: opts.mission,
              }),
            },
          );
          if (!res.ok) {
            const text = await res.text();
            console.error(`Error: ${res.status} ${text}`);
            process.exitCode = 1;
            return;
          }
          const data = await res.json() as { formationName: string; missionName?: string };
          console.log(`Formation: ${data.formationName}`);
          if (data.missionName) console.log(`Mission: ${data.missionName}`);
        }),
    );

  return program;
}
