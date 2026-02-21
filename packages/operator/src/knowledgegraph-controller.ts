import { getTracer } from '@kais/core';
import type { KnowledgeGraphResource } from './types.js';

const tracer = getTracer('kais-operator');

interface KnowledgeGraphKubeClient {
  updateKnowledgeGraphStatus(
    name: string,
    namespace: string,
    status: NonNullable<KnowledgeGraphResource['status']>,
  ): Promise<void>;
  emitKnowledgeGraphEvent(
    resource: KnowledgeGraphResource,
    type: string,
    message: string,
  ): Promise<void>;
  listKnowledgeGraphs(namespace: string): Promise<KnowledgeGraphResource[]>;
  createPod(namespace: string, pod: unknown): Promise<void>;
  createService(namespace: string, service: unknown): Promise<void>;
  deletePod(name: string, namespace: string): Promise<void>;
  deleteService(name: string, namespace: string): Promise<void>;
}

export class KnowledgeGraphController {
  private readonly kube: KnowledgeGraphKubeClient;

  constructor(kube: KnowledgeGraphKubeClient) {
    this.kube = kube;
  }

  async reconcile(kg: KnowledgeGraphResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_knowledgegraph');
    const { name, namespace } = kg.metadata;

    try {
      span.setAttributes({ 'resource.name': name, 'resource.namespace': namespace });
      const parentChain = await this.resolveParentChain(kg);

      if (kg.spec.dedicated) {
        await this.reconcileDedicated(kg, parentChain);
      } else {
        await this.reconcileShared(kg, parentChain);
      }
    } catch (err) {
      await this.kube.updateKnowledgeGraphStatus(name, namespace, {
        phase: 'Error',
        database: name,
        parentChain: [],
      });
      await this.kube.emitKnowledgeGraphEvent(kg, 'Error', (err as Error).message);
    } finally {
      span.end();
    }
  }

  async reconcileDelete(kg: KnowledgeGraphResource): Promise<void> {
    const { name, namespace } = kg.metadata;
    if (kg.spec.dedicated) {
      await this.kube.deletePod(`neo4j-${name}`, namespace);
      await this.kube.deleteService(`neo4j-${name}`, namespace);
    }
  }

  private async reconcileShared(
    kg: KnowledgeGraphResource,
    parentChain: string[],
  ): Promise<void> {
    const { name, namespace } = kg.metadata;
    const endpoint = 'bolt://neo4j.kais-system:7687';

    await this.kube.updateKnowledgeGraphStatus(name, namespace, {
      phase: 'Ready',
      endpoint,
      database: name,
      parentChain,
    });
    await this.kube.emitKnowledgeGraphEvent(kg, 'Ready', `Shared database "${name}" ready`);
  }

  private async reconcileDedicated(
    kg: KnowledgeGraphResource,
    parentChain: string[],
  ): Promise<void> {
    const { name, namespace } = kg.metadata;
    const podName = `neo4j-${name}`;
    const serviceName = `neo4j-${name}`;
    const endpoint = `bolt://${serviceName}.${namespace}:7687`;

    await this.kube.updateKnowledgeGraphStatus(name, namespace, {
      phase: 'Provisioning',
      endpoint,
      database: name,
      parentChain,
    });

    const resources = kg.spec.resources ?? { memory: '512Mi', cpu: '250m' };

    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace,
        labels: { app: 'kais-neo4j', 'kais.io/knowledgegraph': name },
      },
      spec: {
        containers: [{
          name: 'neo4j',
          image: 'neo4j:5-community',
          ports: [
            { containerPort: 7687, name: 'bolt' },
            { containerPort: 7474, name: 'http' },
          ],
          env: [
            { name: 'NEO4J_AUTH', value: 'neo4j/kais' },
            { name: 'NEO4J_PLUGINS', value: '["apoc"]' },
          ],
          resources: {
            requests: { memory: resources.memory, cpu: resources.cpu },
            limits: { memory: resources.memory, cpu: resources.cpu },
          },
        }],
      },
    };

    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace,
        labels: { app: 'kais-neo4j', 'kais.io/knowledgegraph': name },
      },
      spec: {
        selector: { 'kais.io/knowledgegraph': name },
        ports: [
          { port: 7687, targetPort: 7687, name: 'bolt' },
          { port: 7474, targetPort: 7474, name: 'http' },
        ],
      },
    };

    await this.kube.createPod(namespace, pod);
    await this.kube.createService(namespace, service);

    await this.kube.updateKnowledgeGraphStatus(name, namespace, {
      phase: 'Ready',
      endpoint,
      database: name,
      parentChain,
    });
    await this.kube.emitKnowledgeGraphEvent(kg, 'Ready', `Dedicated Neo4j "${podName}" ready`);
  }

  private async resolveParentChain(kg: KnowledgeGraphResource): Promise<string[]> {
    if (!kg.spec.parentRef) return [];

    const allKGs = await this.kube.listKnowledgeGraphs(kg.metadata.namespace);
    const byName = new Map(allKGs.map((k) => [k.metadata.name, k]));
    const chain: string[] = [];
    const visited = new Set<string>();
    let current: string | undefined = kg.spec.parentRef;

    while (current && !visited.has(current)) {
      visited.add(current);
      const parent = byName.get(current);
      if (!parent) break;
      chain.push(current);
      current = parent.spec.parentRef;
    }

    return chain;
  }
}
