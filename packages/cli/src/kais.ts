#!/usr/bin/env node
import { Command } from 'commander';
import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

/** Build auth headers from --token flag or saved config. */
function authHeaders(opts: { token?: string }): Record<string, string> {
  let token = opts.token ?? process.env['KAIS_TOKEN'];
  if (!token) {
    try {
      const configPath = resolve(process.env['HOME'] ?? '~', '.kais', 'config.json');
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        token = config.token;
      }
    } catch {
      // ignore
    }
  }
  if (token) return { 'Authorization': `Bearer ${token}` };
  return {};
}

/** Render a simple budget bar: [███░░░░░░░] */
function budgetBar(spent: number, delegated: number, allocated: number): string {
  if (allocated <= 0) return '';
  const width = 20;
  const spentChars = Math.round((spent / allocated) * width);
  const delegatedChars = Math.round((delegated / allocated) * width);
  const freeChars = Math.max(0, width - spentChars - delegatedChars);
  return `[${'█'.repeat(spentChars)}${'▓'.repeat(delegatedChars)}${'░'.repeat(freeChars)}]`;
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

  // ----- Phase 8: Tree commands -----

  const tree = program.command('tree').description('Cell tree visualization');

  tree
    .command('show <cellId>')
    .description('Show recursive cell tree from a given cell')
    .option('--depth <n>', 'Maximum display depth', '10')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (cellId: string, opts: { depth: string; apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const res = await fetch(`${apiUrl}/api/v1/tree/${encodeURIComponent(cellId)}`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        root: string;
        nodes: Array<{ cellId: string; parentId: string | null; depth: number; path: string; descendantCount: number; namespace: string }>;
      };

      const maxDepth = parseInt(opts.depth, 10) || 10;

      // Build tree from flat node list
      const byId = new Map(data.nodes.map(n => [n.cellId, n]));
      const children = new Map<string | null, string[]>();
      for (const n of data.nodes) {
        const list = children.get(n.parentId) ?? [];
        list.push(n.cellId);
        children.set(n.parentId, list);
      }

      function printNode(id: string, prefix: string, isLast: boolean, depth: number): void {
        if (depth > maxDepth) return;
        const node = byId.get(id);
        if (!node) return;
        const connector = depth === 0 ? '' : isLast ? '└── ' : '├── ';
        const desc = node.descendantCount > 0 ? ` (${node.descendantCount} descendants)` : '';
        console.log(`${prefix}${connector}${node.cellId} [${node.namespace}]${desc}`);
        const kids = children.get(id) ?? [];
        const nextPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : '│   ');
        kids.forEach((kid, i) => printNode(kid, nextPrefix, i === kids.length - 1, depth + 1));
      }

      printNode(data.root, '', true, 0);
    });

  tree
    .command('ancestors <cellId>')
    .description('Show ancestor chain from cell to root')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (cellId: string, opts: { apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const res = await fetch(`${apiUrl}/api/v1/tree/${encodeURIComponent(cellId)}/ancestors`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        ancestors: Array<{ cellId: string; depth: number; namespace: string }>;
      };
      for (const a of data.ancestors) {
        const indent = '  '.repeat(a.depth);
        console.log(`${indent}${a.cellId} [${a.namespace}] depth=${a.depth}`);
      }
    });

  // ----- Phase 8: Budget commands -----

  const budget = program.command('budget').description('Budget management commands');

  budget
    .command('show <cellId>')
    .description('Show budget balance for a cell')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (cellId: string, opts: { apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const res = await fetch(`${apiUrl}/api/v1/budgets/${encodeURIComponent(cellId)}`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const b = (await res.json()) as {
        cellId: string; allocated: number; spent: number; delegated: number; available: number;
      };
      console.log(`Cell:      ${b.cellId}`);
      console.log(`Allocated: $${b.allocated.toFixed(2)}`);
      console.log(`Spent:     $${b.spent.toFixed(2)}`);
      console.log(`Delegated: $${b.delegated.toFixed(2)}`);
      console.log(`Available: $${b.available.toFixed(2)}`);
    });

  budget
    .command('tree <cellId>')
    .description('Show budget tree from a root cell')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (cellId: string, opts: { apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const res = await fetch(`${apiUrl}/api/v1/budgets/${encodeURIComponent(cellId)}/tree`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      interface TreeNode { cellId: string; balance: { allocated: number; spent: number; delegated: number; available: number }; children: TreeNode[] }
      const data = (await res.json()) as { tree: TreeNode[] };

      function printBudgetNode(node: TreeNode, prefix: string, isLast: boolean): void {
        const connector = prefix === '' ? '' : isLast ? '└── ' : '├── ';
        const b = node.balance;
        const bar = budgetBar(b.spent, b.delegated, b.allocated);
        console.log(`${prefix}${connector}${node.cellId}  $${b.spent.toFixed(2)}/$${b.allocated.toFixed(2)} ${bar}`);
        const nextPrefix = prefix === '' ? '' : prefix + (isLast ? '    ' : '│   ');
        node.children.forEach((child, i) => printBudgetNode(child, nextPrefix, i === node.children.length - 1));
      }

      for (const root of data.tree) {
        printBudgetNode(root, '', true);
      }
    });

  budget
    .command('history <cellId>')
    .description('Show budget ledger history for a cell')
    .option('--limit <n>', 'Maximum entries', '20')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (cellId: string, opts: { limit: string; apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const limit = parseInt(opts.limit, 10) || 20;
      const res = await fetch(
        `${apiUrl}/api/v1/budgets/${encodeURIComponent(cellId)}/history?limit=${limit}`,
        { headers },
      );
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        history: Array<{
          id: number; cellId: string; operation: string; amount: number;
          fromCellId?: string; toCellId?: string; balanceAfter: number;
          reason?: string; createdAt: string;
        }>;
      };

      if (data.history.length === 0) {
        console.log('No ledger entries found.');
        return;
      }

      console.log('ID     OP          AMOUNT   BALANCE  FROM/TO              REASON              TIME');
      console.log('─'.repeat(100));
      for (const e of data.history) {
        const time = new Date(e.createdAt).toLocaleString();
        const peer = e.fromCellId ?? e.toCellId ?? '-';
        console.log(
          `${String(e.id).padEnd(7)}${e.operation.padEnd(12)}$${e.amount.toFixed(2).padStart(7)}  $${e.balanceAfter.toFixed(2).padStart(7)}  ${peer.padEnd(21)}${(e.reason ?? '').padEnd(20)}${time}`,
        );
      }
    });

  budget
    .command('top-up <parentCellId> <childCellId> <amount>')
    .description('Top up a child cell budget from parent')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (parentCellId: string, childCellId: string, amountStr: string, opts: { apiUrl?: string; token?: string }) => {
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        console.error('Error: amount must be a positive number');
        process.exitCode = 1;
        return;
      }
      const apiUrl = getApiUrl(opts);
      const headers = { ...authHeaders(opts), 'Content-Type': 'application/json' };
      const res = await fetch(`${apiUrl}/api/v1/budgets/${encodeURIComponent(parentCellId)}/top-up`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ childCellId, amount }),
      });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Topped up ${childCellId} with $${amount.toFixed(2)} from ${parentCellId}`);
    });

  // ----- Phase 8: Spawn request commands -----

  const spawn = program.command('spawn-requests').description('Spawn request management');

  spawn
    .command('list')
    .description('List spawn requests')
    .option('--status <status>', 'Filter by status (Pending, Approved, Rejected)')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('--limit <n>', 'Maximum entries', '100')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (opts: { status?: string; namespace?: string; limit: string; apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const params = new URLSearchParams();
      if (opts.status) params.set('status', opts.status);
      if (opts.namespace) params.set('namespace', opts.namespace);
      params.set('limit', opts.limit);

      const res = await fetch(`${apiUrl}/api/v1/spawn-requests?${params.toString()}`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        requests: Array<{
          id: number; name: string; namespace: string; requestorCellId: string;
          status: string; reason?: string; createdAt: string;
        }>;
      };

      if (data.requests.length === 0) {
        console.log('No spawn requests found.');
        return;
      }

      console.log('ID     NAME                 NAMESPACE   REQUESTOR            STATUS     CREATED');
      console.log('─'.repeat(95));
      for (const r of data.requests) {
        const time = new Date(r.createdAt).toLocaleString();
        console.log(
          `${String(r.id).padEnd(7)}${r.name.padEnd(21)}${r.namespace.padEnd(12)}${r.requestorCellId.padEnd(21)}${r.status.padEnd(11)}${time}`,
        );
      }
    });

  spawn
    .command('approve <id>')
    .description('Approve a spawn request')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (id: string, opts: { apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = { ...authHeaders(opts), 'Content-Type': 'application/json' };
      const res = await fetch(`${apiUrl}/api/v1/spawn-requests/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as { id: number; status: string };
      console.log(`SpawnRequest #${data.id} approved`);
    });

  spawn
    .command('reject <id>')
    .description('Reject a spawn request')
    .option('--reason <reason>', 'Rejection reason')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (id: string, opts: { reason?: string; apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = { ...authHeaders(opts), 'Content-Type': 'application/json' };
      const res = await fetch(`${apiUrl}/api/v1/spawn-requests/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: opts.reason }),
      });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as { id: number; status: string };
      console.log(`SpawnRequest #${data.id} rejected`);
    });

  // ----- Phase 8: Auth commands -----

  const auth = program.command('auth').description('Authentication commands');

  auth
    .command('login')
    .description('Save an API token for authentication')
    .option('--token <token>', 'Bearer token')
    .option('--api-url <url>', 'API server URL to store')
    .action((opts: { token?: string; apiUrl?: string }) => {
      if (!opts.token) {
        console.error('Error: --token is required');
        process.exitCode = 1;
        return;
      }
      const configDir = resolve(process.env['HOME'] ?? '~', '.kais');
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      const config: Record<string, string> = {};
      config.token = opts.token;
      if (opts.apiUrl) config.apiUrl = opts.apiUrl;
      writeFileSync(resolve(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
      console.log(`Token saved to ${configDir}/config.json`);
    });

  auth
    .command('whoami')
    .description('Show current authenticated user')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (opts: { apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      if (!headers['Authorization']) {
        console.error('Error: no auth token configured. Run: kais auth login --token <token>');
        process.exitCode = 1;
        return;
      }
      const res = await fetch(`${apiUrl}/api/v1/auth/whoami`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as { user: { name: string; roles: string[] } | null };
      if (!data.user) {
        console.log('Not authenticated');
        return;
      }
      console.log(`User:  ${data.user.name}`);
      console.log(`Roles: ${data.user.roles.join(', ')}`);
    });

  // ----- Phase 8: Roles commands -----

  const roles = program.command('roles').description('RBAC role management');

  roles
    .command('list')
    .description('List available RBAC roles')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (opts: { apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const res = await fetch(`${apiUrl}/api/v1/roles`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        roles: Array<{ name: string; namespace?: string; spec: { rules: Array<{ resources: string[]; verbs: string[] }> } }>;
      };

      if (data.roles.length === 0) {
        console.log('No roles configured.');
        return;
      }

      console.log('NAME                 SCOPE            RULES');
      console.log('─'.repeat(70));
      for (const r of data.roles) {
        const scope = r.namespace ?? 'cluster-wide';
        const ruleCount = r.spec.rules.length;
        console.log(`${r.name.padEnd(21)}${scope.padEnd(17)}${ruleCount} rule(s)`);
      }
    });

  roles
    .command('describe <name>')
    .description('Show detailed role information')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (name: string, opts: { apiUrl?: string; token?: string }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const res = await fetch(`${apiUrl}/api/v1/roles/${encodeURIComponent(name)}`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const role = (await res.json()) as {
        name: string; namespace?: string;
        spec: { rules: Array<{ resources: string[]; verbs: string[]; maxAllocation?: number }> };
      };

      console.log(`Name:      ${role.name}`);
      console.log(`Scope:     ${role.namespace ?? 'cluster-wide'}`);
      console.log(`Rules:`);
      for (const [i, rule] of role.spec.rules.entries()) {
        console.log(`  [${i + 1}] Resources: ${rule.resources.join(', ')}`);
        console.log(`      Verbs:     ${rule.verbs.join(', ')}`);
        if (rule.maxAllocation !== undefined) {
          console.log(`      Max alloc: $${rule.maxAllocation.toFixed(2)}`);
        }
      }
    });

  // ----- Phase 8: MCP commands -----

  const mcp = program.command('mcp').description('MCP Gateway commands');

  mcp
    .command('serve')
    .description('Start the MCP Gateway server')
    .option('--port <port>', 'Port to listen on', '3001')
    .option('--api-url <url>', 'kAIs API URL for the gateway to connect to')
    .action((opts: { port: string; apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);
      const port = opts.port;
      console.log(`Starting MCP Gateway on port ${port}, connecting to ${apiUrl}...`);
      try {
        execSync(
          `KAIS_API_URL=${apiUrl} MCP_PORT=${port} npx @kais/mcp-gateway`,
          { stdio: 'inherit' },
        );
      } catch {
        console.error('MCP Gateway exited');
        process.exitCode = 1;
      }
    });

  mcp
    .command('status')
    .description('Check MCP Gateway health')
    .option('--port <port>', 'MCP Gateway port', '3001')
    .action(async (opts: { port: string }) => {
      try {
        const res = await fetch(`http://localhost:${opts.port}/healthz`);
        if (res.ok) {
          console.log(`MCP Gateway is running on port ${opts.port}`);
        } else {
          console.log(`MCP Gateway returned ${res.status}`);
          process.exitCode = 1;
        }
      } catch {
        console.log(`MCP Gateway is not running on port ${opts.port}`);
        process.exitCode = 1;
      }
    });

  // ----- Phase 8: Audit log command -----

  const audit = program.command('audit').description('Audit log commands');

  audit
    .command('log')
    .description('Query the audit log')
    .option('--actor <actor>', 'Filter by actor')
    .option('--action <action>', 'Filter by action (create, update, delete, get)')
    .option('--resource <type>', 'Filter by resource type')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('--since <date>', 'Start date (ISO format)')
    .option('--until <date>', 'End date (ISO format)')
    .option('--limit <n>', 'Maximum entries', '50')
    .option('--api-url <url>', 'API server URL')
    .option('--token <token>', 'Auth token')
    .action(async (opts: {
      actor?: string; action?: string; resource?: string; namespace?: string;
      since?: string; until?: string; limit: string; apiUrl?: string; token?: string;
    }) => {
      const apiUrl = getApiUrl(opts);
      const headers = authHeaders(opts);
      const params = new URLSearchParams();
      if (opts.actor) params.set('actor', opts.actor);
      if (opts.action) params.set('action', opts.action);
      if (opts.resource) params.set('resourceType', opts.resource);
      if (opts.namespace) params.set('namespace', opts.namespace);
      if (opts.since) params.set('since', opts.since);
      if (opts.until) params.set('until', opts.until);
      params.set('limit', opts.limit);

      const res = await fetch(`${apiUrl}/api/v1/audit-log?${params.toString()}`, { headers });
      if (!res.ok) {
        console.error(`Error: ${res.status} ${await res.text()}`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as {
        entries: Array<{
          id: number; actor: string; action: string; resourceType: string;
          resourceId?: string; namespace: string; outcome: string; statusCode: number;
          timestamp: string;
        }>;
        total: number;
      };

      if (data.entries.length === 0) {
        console.log('No audit entries found.');
        return;
      }

      console.log(`Showing ${data.entries.length} of ${data.total} entries\n`);
      console.log('ID     ACTOR           ACTION   RESOURCE          NAMESPACE   OUTCOME  TIME');
      console.log('─'.repeat(95));
      for (const e of data.entries) {
        const time = new Date(e.timestamp).toLocaleString();
        const resource = e.resourceId ? `${e.resourceType}/${e.resourceId}` : e.resourceType;
        console.log(
          `${String(e.id).padEnd(7)}${e.actor.padEnd(16)}${e.action.padEnd(9)}${resource.padEnd(18)}${e.namespace.padEnd(12)}${e.outcome.padEnd(9)}${time}`,
        );
      }
    });

  return program;
}
