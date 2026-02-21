#!/usr/bin/env bash
set -euo pipefail

# E2E test setup — prepares a kind cluster with kAIs infrastructure.
# Assumes: kind cluster already created (by helm/kind-action in CI or manually)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== E2E Setup ==="
echo "Project root: $PROJECT_ROOT"

# 1. Apply CRDs
echo "--- Applying CRDs ---"
kubectl apply -f "$PROJECT_ROOT/deploy/crds/"

# 2. Build and load Docker images into kind (with retry for transient network errors)
echo "--- Building Docker images ---"
build_with_retry() {
  local tag="$1" dockerfile="$2" max_attempts=3
  for attempt in $(seq 1 $max_attempts); do
    echo "Building $tag (attempt $attempt/$max_attempts)..."
    if docker build -t "$tag" -f "$dockerfile" "$PROJECT_ROOT"; then
      return 0
    fi
    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "Build failed, retrying in 5s..."
      sleep 5
    fi
  done
  echo "ERROR: Failed to build $tag after $max_attempts attempts"
  return 1
}
build_with_retry kais-operator:e2e "$PROJECT_ROOT/docker/Dockerfile.operator"
build_with_retry kais-cell:e2e "$PROJECT_ROOT/docker/Dockerfile.cell"

echo "--- Loading images into kind ---"
kind load docker-image kais-operator:e2e --name="${KIND_CLUSTER_NAME:-kais-test}"
kind load docker-image kais-cell:e2e --name="${KIND_CLUSTER_NAME:-kais-test}"

# 3. Deploy infrastructure via helmfile
echo "--- Deploying infrastructure ---"
if command -v helmfile &>/dev/null; then
  cd "$PROJECT_ROOT" && helmfile -f deploy/helmfile.yaml apply
else
  echo "helmfile not found — deploying manually"
  # Postgres
  helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
  helm upgrade --install kais-postgres bitnami/postgresql \
    --set auth.postgresPassword=kais \
    --set auth.database=kais \
    --set primary.persistence.size=1Gi \
    --wait --timeout 120s

  # NATS
  helm repo add nats https://nats-io.github.io/k8s/helm/charts/ 2>/dev/null || true
  helm upgrade --install kais-nats nats/nats \
    --set config.jetstream.enabled=true \
    --set config.jetstream.memoryStore.enabled=true \
    --set config.jetstream.memoryStore.maxSize=256Mi \
    --wait --timeout 120s
fi

# 4. Deploy Ollama and pull model
echo "--- Deploying Ollama ---"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
      containers:
        - name: ollama
          image: ollama/ollama:latest
          ports:
            - containerPort: 11434
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2"
---
apiVersion: v1
kind: Service
metadata:
  name: ollama
  namespace: default
spec:
  selector:
    app: ollama
  ports:
    - port: 11434
      targetPort: 11434
EOF

echo "--- Waiting for Ollama pod ---"
kubectl wait --for=condition=ready pod -l app=ollama --timeout=120s

echo "--- Pulling qwen2.5:0.5b model ---"
OLLAMA_POD=$(kubectl get pods -l app=ollama -o jsonpath='{.items[0].metadata.name}')
kubectl exec "$OLLAMA_POD" -- ollama pull qwen2.5:0.5b

# 5. Deploy kAIs operator with RBAC
echo "--- Setting up operator RBAC ---"
kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kais-operator
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kais-operator
rules:
  # CRDs: cells, formations, missions
  - apiGroups: ["kais.io"]
    resources: ["cells", "cells/status", "formations", "formations/status", "missions", "missions/status"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Pods managed by operator
  - apiGroups: [""]
    resources: ["pods", "pods/status", "pods/exec"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # ConfigMaps for topology routes
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # PVCs for workspace storage
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Events for operator status reporting
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["create", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kais-operator
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kais-operator
subjects:
  - kind: ServiceAccount
    name: kais-operator
    namespace: default
EOF

echo "--- Deploying kAIs operator ---"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kais-operator
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kais-operator
  template:
    metadata:
      labels:
        app: kais-operator
    spec:
      serviceAccountName: kais-operator
      containers:
        - name: operator
          image: kais-operator:e2e
          imagePullPolicy: Never
          env:
            - name: NAMESPACE
              value: default
            - name: CELL_IMAGE
              value: kais-cell:e2e
            - name: CELL_IMAGE_PULL_POLICY
              value: Never
            - name: NATS_URL
              value: nats://kais-nats:4222
            - name: POSTGRES_URL
              value: postgresql://postgres:kais@kais-postgres-postgresql:5432/kais
            - name: OLLAMA_URL
              value: http://ollama:11434
EOF

echo "--- Waiting for operator pod ---"
kubectl wait --for=condition=ready pod -l app=kais-operator --timeout=120s

# 6. Wait for all infrastructure to be ready
echo "--- Verifying all pods ---"
kubectl get pods

echo "=== E2E Setup Complete ==="
