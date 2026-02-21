#!/usr/bin/env bash
set -euo pipefail

# E2E test teardown — delete the kind cluster.

KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-kais-test}"

echo "=== E2E Teardown ==="
echo "Deleting kind cluster: $KIND_CLUSTER_NAME"

kind delete cluster --name="$KIND_CLUSTER_NAME" 2>/dev/null || true

echo "=== E2E Teardown Complete ==="
