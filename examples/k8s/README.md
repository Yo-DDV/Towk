# Towk Kubernetes Example

This example deploys a clustered Towk setup on Kubernetes with:

- **NATS** - StatefulSet with persistent storage
- **Towk** - Deployment with 3 replicas
- **Ingress** - For external access with TLS

## Prerequisites

- Kubernetes cluster (1.19+)
- A CNI that enforces Kubernetes NetworkPolicy
- kubectl configured
- An Ingress controller (e.g., ingress-nginx, Traefik)
- Optional: cert-manager for automatic TLS

## Quick Start: Single-Node Cluster with k3s

If you don't have a Kubernetes cluster, you can set one up on a single VM using [k3s](https://k3s.io/):

```bash
# Install k3s (includes kubectl, Traefik ingress, and local-path storage)
curl -sfL https://get.k3s.io | sh -

# Verify installation
sudo k3s kubectl get nodes

# Copy kubeconfig for regular kubectl usage
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER ~/.kube/config
chmod 600 ~/.kube/config

# Now kubectl works without sudo
kubectl get nodes
```

k3s includes:

- **Traefik** as the default Ingress controller (the manifests already use this)
- **local-path-provisioner** for persistent volumes
- **CoreDNS** for service discovery

## Setting Up Let's Encrypt with cert-manager

Install cert-manager for automatic TLS certificates:

```bash
# Install cert-manager (check for newer versions!)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.19.2/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl -n cert-manager rollout status deployment/cert-manager
kubectl -n cert-manager rollout status deployment/cert-manager-webhook
```

Create a ClusterIssuer for Let's Encrypt:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com  # Change this!
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik  # or nginx
EOF
```

The included `ingress.yaml` is already configured to use cert-manager. After applying it, verify the certificate:


```bash
# Check certificate status
kubectl -n towk get certificate
kubectl -n towk describe certificate towk-tls
```

## Files

| File             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `namespace.yaml` | Dedicated namespace for Towk                     |
| `secrets.yaml`   | **Central config** - all environment variables     |
| `nats.yaml`      | NATS StatefulSet (sources token from secret)       |
| `towk.yaml`    | Towk Deployment (sources all config from secret) |
| `network-policy.yaml` | Default-deny and least-access network policies |
| `ingress.yaml`   | Ingress for external access                        |

## Configuration

All configuration lives in manifest files. Copy and edit them for your environment:

```bash
cp secrets.yaml secrets.local.yaml
cp ingress.yaml ingress.local.yaml
```

### secrets.local.yaml

Update these values (generate secrets with `openssl rand -hex 32`):

- `NATS_TOKEN` and `CHATTO_NATS_CLIENT_TOKEN` - Must match
- `CHATTO_WEBSERVER_URL` - Your domain (e.g., `https://chat.example.com`)
- `CHATTO_WEBSERVER_COOKIE_SIGNING_SECRET` - Session signing secret
- `CHATTO_WEBSERVER_COOKIE_ENCRYPTION_SECRET` - Session encryption secret
- `CHATTO_CORE_SECRET_KEY` - Bearer-token and account-flow verifier key
- `CHATTO_CORE_ASSETS_SIGNING_SECRET` - Asset URL signing secret

### Performance policy and pod resources

The pod's `resources.limits`, CPU affinity and optional
`CHATTO_PERFORMANCE_MAX_*` values form the operator-owned envelope.
`CHATTO_PERFORMANCE_DEFAULT_PROFILE=balanced` selects the initial runtime media
policy for new deployments. Server owners can later choose economy, balanced,
performance, or bounded custom concurrency in **Server administration →
System** without changing the Deployment.

Effective worker counts never exceed the pod's detected cgroup envelope or the
optional `CHATTO_PERFORMANCE_MAX_*` caps in `secrets.local.yaml`. Changing pod
resources or operator caps requires a rollout; changing only the owner profile
applies live to newly admitted work. Different replicas can report different
effective values when their node or pod envelopes differ. The example sets a
memory limit but deliberately leaves CPU as a request; add a CPU limit only
when a hard CPU ceiling is appropriate for the cluster's scheduling and
throttling policy.

Resource examples are starting points rather than capacity guarantees. Measure
CPU, memory, storage latency and call quality with the intended workload before
raising limits, and size NATS independently for retained media and events.

### NATS TLS secret

The manifests require a TLS certificate for the internal DNS name `nats` and
the CA that issued it. Create the secret before deploying the workloads:

```bash
kubectl -n towk create secret generic nats-tls \
  --from-file=tls.crt=./nats-server.crt \
  --from-file=tls.key=./nats-server.key \
  --from-file=ca.crt=./nats-ca.crt
```

The NATS monitoring listener binds only to loopback and is not exposed by a
Service. Health probes execute inside the container.

### Network policy labels

Label the namespace that runs your ingress controller before applying the
policies. For the default k3s Traefik installation:

```bash
kubectl label namespace kube-system \
  networking.towk.io/ingress=true \
  networking.towk.io/dns=true
```

On clusters where DNS and the ingress controller run in different namespaces,
apply only the matching label to each namespace.

The default egress policy permits NATS, cluster DNS and public HTTPS only. Add
explicit destinations for private SMTP, OIDC, S3 or other services required by
your deployment. Do not remove the default-deny policy as a shortcut.

### ingress.local.yaml

Update these values:

- `host` and `tls.hosts` - Your domain
- `ingressClassName` - Your ingress controller (default: `traefik`)

## Deployment

```bash
kubectl apply -f namespace.yaml
kubectl apply -f secrets.local.yaml
kubectl apply -f network-policy.yaml
kubectl apply -f nats.yaml
kubectl apply -f towk.yaml
kubectl apply -f ingress.local.yaml
```

## Management

```bash
# Check status
kubectl -n towk get pods
kubectl -n towk get svc
kubectl -n towk get ingress

# View logs
kubectl -n towk logs -f deployment/towk

# Scale replicas
kubectl -n towk scale deployment/towk --replicas=5

# Rolling restart
kubectl -n towk rollout restart deployment/towk

# Watch rollout status
kubectl -n towk rollout status deployment/towk
```

## Updating

Before changing the image, create a Towk backup using the
[Backup & Restore guide](../../apps/docs-website/src/content/docs/guides/operations/backup-restore.mdx)
and keep a copy of the exact manifests and secrets you are about to replace.
The owner-selected performance profile is part of Towk's event stream; pod
resources, `CHATTO_PERFORMANCE_MAX_*` operator caps, TLS material, and external
object-storage buckets are cluster/operator configuration and must be backed up
separately.

```bash
# Update to a new image
kubectl -n towk set image deployment/towk towk=ghcr.io/yo-ddv/towk:<immutable-tag>@sha256:<digest>
kubectl -n towk rollout status deployment/towk

# Or update the manifest and apply
kubectl apply -f towk.yaml
kubectl -n towk rollout status deployment/towk
```

The deployment uses a rolling update strategy with `maxUnavailable: 0` to ensure zero-downtime updates.

After the rollout, verify the ingress, sign in, send a text message, exercise
an attachment or video flow that matters to your deployment, and check
**Server administration → System** for the requested performance profile and
effective limits.

To roll back application code, either reapply the previous manifest with the
previous immutable image reference or use the deployment rollout history when it
matches the version you want to return to:

```bash
kubectl -n towk rollout undo deployment/towk
kubectl -n towk rollout status deployment/towk
```

Only restore Towk data when you intentionally need to return NATS state to an
older backup snapshot.

## Storage

NATS uses a PersistentVolumeClaim for data persistence. The default request is 10Gi. Adjust in `nats.yaml` if needed.

## Troubleshooting

**Pods not starting**: Check events and logs:

```bash
kubectl -n towk describe pod <pod-name>
kubectl -n towk logs <pod-name>
```

**Towk can't connect to NATS**: Ensure NATS is running and the token matches:

```bash
kubectl -n towk get pods -l app=nats
kubectl -n towk logs statefulset/nats
```

**Ingress not working**: Verify your Ingress controller is installed and check the ingress status:

```bash
kubectl -n towk describe ingress towk
```

**TLS issues**: If using cert-manager, check certificate status:

```bash
kubectl -n towk get certificate
kubectl -n towk describe certificate towk-tls
```
