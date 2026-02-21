#!/usr/bin/env node
import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

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
        const args = command.args.join(' ');
        execSync(`kubectl ${cmd} ${args}`, { stdio: 'inherit' });
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

  program
    .command('logs <cell>')
    .description('Fetch event logs for a Cell')
    .option('-n, --namespace <ns>', 'Kubernetes namespace', 'default')
    .option('--limit <n>', 'Maximum number of log entries', '50')
    .option('--api-url <url>', 'API server URL')
    .action(async (cell: string, opts: { namespace: string; limit: string; apiUrl?: string }) => {
      const apiUrl = getApiUrl(opts);
      const params = new URLSearchParams({
        namespace: opts.namespace,
        limit: opts.limit,
      });
      const res = await fetch(
        `${apiUrl}/api/v1/cells/${encodeURIComponent(cell)}/logs?${params.toString()}`,
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

  return program;
}
