import type { BlueprintStatus } from '@kais/core';
import { getTracer } from '@kais/core';

import type { BlueprintResource } from './types.js';

const tracer = getTracer('kais-operator');

/**
 * BlueprintController reconciles Blueprint CRDs and tracks versions.
 *
 * On each reconcile it compares the current spec against the last-seen spec.
 * If the spec has changed (or this is the first reconcile), a new version
 * entry is appended to the status and persisted via the KubeClient.
 */
export class BlueprintController {
  private readonly kube: {
    updateBlueprintStatus(
      name: string,
      namespace: string,
      status: BlueprintStatus,
    ): Promise<void>;
  };
  private readonly lastSpecs = new Map<string, string>();

  constructor(kube: {
    updateBlueprintStatus(
      name: string,
      namespace: string,
      status: BlueprintStatus,
    ): Promise<void>;
  }) {
    this.kube = kube;
  }

  /**
   * Reconcile a Blueprint resource.
   *
   * Compares the spec against the previously-seen spec for this resource.
   * If the spec changed (or is seen for the first time), a new version entry
   * is appended to the status. Otherwise the status is written back as-is
   * to confirm the reconciliation.
   */
  async reconcile(blueprint: BlueprintResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_blueprint', {
      attributes: {
        'resource.name': blueprint.metadata.name,
        'resource.namespace': blueprint.metadata.namespace,
      },
    });
    try {
      const key = `${blueprint.metadata.namespace}/${blueprint.metadata.name}`;
      const lastSpecStr = this.lastSpecs.get(key);
      const currentSpecStr = JSON.stringify(blueprint.spec);
      const currentVersions = blueprint.status?.versions ?? [];
      const currentVersion =
        currentVersions.length > 0
          ? Math.max(...currentVersions.map((v) => v.version))
          : 0;

      let newVersions = [...currentVersions];

      if (lastSpecStr === undefined || lastSpecStr !== currentSpecStr) {
        const newVersion = currentVersion + 1;
        newVersions.push({
          version: newVersion,
          createdAt: new Date().toISOString(),
          changes:
            lastSpecStr === undefined ? 'Initial version' : 'Spec updated',
        });
      }

      this.lastSpecs.set(key, currentSpecStr);

      const status: BlueprintStatus = {
        usageCount: blueprint.status?.usageCount ?? 0,
        lastUsed: blueprint.status?.lastUsed,
        avgSuccessRate: blueprint.status?.avgSuccessRate,
        versions: newVersions,
      };

      await this.kube.updateBlueprintStatus(
        blueprint.metadata.name,
        blueprint.metadata.namespace,
        status,
      );
    } finally {
      span.end();
    }
  }
}
