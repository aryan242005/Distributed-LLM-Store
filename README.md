# Distributed Model Repository and LLM Weight Storage with Replication System

A production-grade distributed file storage and replication system for large Machine Learning / Large Language Model (LLM) weights. Built with **Node.js** (Coordinator & Storage Nodes), **React + Vite** (Dashboard Frontend), **PostgreSQL** (Metadata Store), **gRPC** (RPC & Chunk Streaming), and **NATS** (Message-oriented Event Bus).

The storage nodes also run a **synchronization layer** (beacons, Bully election, Berkeley clock sync, Lamport & vector clocks, Ricart-Agrawala mutual exclusion, Chandy-Lamport snapshots), and the whole cluster can be **deployed across 4 EC2 machines in 3 AWS Availability Zones** with one script.

---

## Architecture Overview

```
                      ┌───────────────────────────────────────────────┐
                      │          React + Vite Dashboard (Port 3000)   │
                      └───────────────────────┬───────────────────────┘
                                              │ HTTP REST / Upload / Download
                                              ▼
                      ┌───────────────────────────────────────────────┐
                      │          Coordinator Server (Port 4000)       │
                      │  • Node Selector & Load Balancer              │
                      │  • Model Metadata & Replica Tracker           │
                      │  • gRPC Stream Coordinator & Router           │
                      └───────┬───────────────┬───────────────┬───────┘
                              │               │               │
            PostgreSQL Query  │               │ NATS Events   │ gRPC Control Stream
                              ▼               ▼               ▼
         ┌────────────────────────┐  ┌──────────────────┐  ┌───────────────────────────────────┐
         │ PostgreSQL (Port 5432) │  │ NATS (Port 4222) │  │ Storage Nodes Mesh (P2P gRPC)     │
         │ • models               │  │ • NODE_REGISTERED│  │                                   │
         │ • storage_nodes        │  │ • MODEL_UPLOADED │  │  ┌──────────────┐                 │
         │ • replicas             │  │ • REPLICATION_*  │  │  │ Storage      │                 │
         │ • system_events        │  │ • cluster.p2p    │  │  │ Node 1       │ (Port 5001)     │
         │ • communication_logs   │  │ • sync.*         │  │  │ storage/node-1│                │
         └────────────────────────┘  └──────────────────┘  │  └──────┬───────┘                 │
                                                           │         │ gRPC P2P Replication    │
                                                           │         ▼                         │
                                                           │  ┌──────────────┐  ┌────────────┐ │
                                                           │  │ Storage      │  │ Storage    │ │
                                                           │  │ Node 2       │  │ Node 3     │ │
                                                           │  │ (Port 5002)  │  │ (Port 5003)│ │
                                                           │  └──────────────┘  └────────────┘ │
                                                           └───────────────────────────────────┘
```

Two kinds of traffic flow between the storage nodes:
- **Data plane (gRPC):** model chunks are streamed node-to-node during replication.
- **Synchronization plane (NATS `cluster.p2p`):** beacons, election, clock-sync, mutex and snapshot messages, each stamped with Lamport and vector timestamps. Nodes report their state to the Coordinator on `sync.*` subjects, and the Coordinator only observes.

---

## Run on Kubernetes (local cluster)

The basic Kubernetes deployment is in `deploy/kubernetes.yaml`. It starts PostgreSQL, NATS, the coordinator, three persistent storage nodes, and the dashboard. It expects a local Kubernetes cluster with a default StorageClass (for example Docker Desktop Kubernetes or Minikube) and Docker images built on the same machine/cluster.

From the project root, build the images and apply the manifest:

```bash
docker build -t ds-project-backend:local -f backend/Dockerfile .
docker build -t ds-project-frontend:local --build-arg VITE_API_URL=http://localhost:30400/api -f frontend/Dockerfile .
kubectl apply -f deploy/kubernetes.yaml
kubectl rollout status deployment/postgres
kubectl rollout status deployment/nats
kubectl rollout status deployment/coordinator
kubectl rollout status deployment/node-1
kubectl rollout status deployment/node-2
kubectl rollout status deployment/node-3
kubectl rollout status deployment/frontend
```

Open the dashboard at `http://localhost:30300` and check the coordinator at `http://localhost:30400/api/health`. The frontend image embeds the coordinator URL at build time; if the cluster is reached through a different host, rebuild it with `VITE_API_URL` set to that host's port `30400`.

The database password in this starter manifest is `postgres`; change the `dmr-postgres` Secret before using it beyond a local demo. Model files are stored in separate 20Gi claims for each node, and PostgreSQL uses its own 2Gi claim. Remove the deployment with `kubectl delete -f deploy/kubernetes.yaml` (PVCs are retained by Kubernetes unless explicitly deleted).

## Key Distributed Systems Concepts Demonstrated

1. **Coordinator-Worker Architecture**:
   - A central Coordinator service provides REST endpoints to clients, maintains PostgreSQL metadata, and makes placement decisions using load-aware node selection.
2. **Single Generic Storage Node Codebase**:
   - One generic storage node implementation (`backend/src/storage/`) runs across multiple isolated instances (`node-1` on port 5001, `node-2` on port 5002, `node-3` on port 5003). Each instance receives its own storage folder, identity, and port.
3. **Peer-to-Peer (P2P) Replication**:
   - When a model is uploaded, chunks stream to a selected Primary Storage Node. The Primary Node then acts as a peer and streams replicas directly to other Storage Nodes using gRPC (`Node 1 ➔ Node 2`).
4. **Stream-Oriented Transfer & Memory Efficiency**:
   - Large LLM weights are transferred using Node.js streaming pipelines and gRPC client/server streams (64KB chunks), preventing memory exhaustion.
5. **Cryptographic Data Integrity**:
   - End-to-end streaming SHA-256 calculation and verification across all storage nodes during upload and replication.
6. **Message-Oriented Asynchronous Communication**:
   - NATS event bus publishes and subscribes to system lifecycle events (`NODE_REGISTERED`, `NODE_STATUS_UPDATED`, `MODEL_UPLOADED`, `REPLICATION_STARTED`, `REPLICATION_COMPLETED`).
7. **Distributed Communication Trace Inspector**:
   - All inter-service gRPC RPCs and NATS events are logged and visualized in real time on the frontend Requests & Logs page.
8. **Concurrency Control**:
   - A keyed mutex (`backend/src/utils/concurrency.js`) serializes node-placement decisions so concurrent uploads can't race onto the same "least loaded" node before real storage stats update (`backend/src/coordinator/nodeSelector.js`).
   - A per-model readers-writer lock lets concurrent downloads of the same model proceed in parallel, while delete and replication (which mutate model/replica state) acquire exclusive access (`backend/src/coordinator/coordinator.js`).
9. **Synchronization Between Nodes** (`backend/src/sync/`):
   - Nodes track each other with a **beacon protocol**, elect a leader with the **Bully algorithm**, and the leader keeps clocks in agreement with the **Berkeley algorithm**.
   - Every node-to-node message carries **Lamport and vector timestamps**. A cluster-wide maintenance task is guarded by **Ricart-Agrawala** distributed mutual exclusion, and **Chandy-Lamport** snapshots capture a consistent global state. All of it is live on the dashboard's **Synchronization** page.
10. **Multi-Machine Cloud Deployment & Fault Tolerance** (`deploy/aws/`):
    - One script deploys the coordinator and 3 storage nodes on separate EC2 instances in 3 Availability Zones. A demo script powers machines off to show failure detection, re-routed downloads, re-election and recovery.

---

## Distributed Systems Concepts Map (Units 1–4 Syllabus Mapping)

This section names the textbook concept explicitly and points at the exact mechanism/file that demonstrates it, for viva/evaluation reference.

### Unit 1 — Introduction to Distributed Systems

| Concept | How it's demonstrated here |
| :--- | :--- |
| **Definition & Goals of a DS** | Multiple independent nodes (Coordinator + 3 Storage Nodes) present a single, unified model repository to the client — resource sharing and collaborative storage across autonomous processes. |
| **Types of DS** | Hybrid: **client-server** (Frontend ↔ Coordinator over REST) layered on top of **coordinator-worker** (Coordinator ↔ Storage Nodes over gRPC) layered on top of **peer-to-peer** (Storage Node ↔ Storage Node direct replication). |
| **Architecture style** | Not a single style — a layered composition: presentation tier (React dashboard) → logical/coordination tier (Coordinator: placement, routing, metadata) → data tier (Storage Nodes + PostgreSQL). Replication path breaks out of the strict layering into direct P2P (`storageNode.js` `handleReplicateToNode`). |
| **Design Issue — Access Transparency** | Clients call `GET/POST /api/models/...`; they never issue gRPC calls or know a protocol switch happens underneath (`coordinator.js`). |
| **Design Issue — Location Transparency** | Clients never specify *which* physical node holds a model; the Coordinator resolves this via `RequestRouter.routeDownload()`. |
| **Design Issue — Replication Transparency** | Uploads/downloads don't expose the replication factor or replica set to the caller; replicas are created and read from transparently. |
| **Design Issue — Failure Transparency (partial)** | Round-robin download routing skips `OFFLINE` nodes and unsynced replicas (`requestRouter.js`), masking a single dead replica from the client. *Known limitation:* there is no automatic re-replication when a node goes permanently offline — this is flagged as a gap, not solved. |
| **Design Issue — Scalability** | Chunked (64KB) streaming means memory use per transfer is constant regardless of model size (`fileManager.js` uses `fs.createReadStream`/`createWriteStream`, never buffers a full file); adding a node is a config change, not a code change. |
| **Design Issue — Concurrency Control** | `backend/src/utils/concurrency.js` — a keyed `Mutex` serializes the node-selection race (see below), and a keyed `RWLock` gives concurrent downloads shared access while delete/replication get exclusive access per model. |
| **Design Issue — Heterogeneity** | All three storage nodes run the *exact same* generic code (`backend/src/storage/`), parameterized only by env vars (`NODE_ID`, `NODE_PORT`, `STORAGE_PATH`) — demonstrating that the node role is decoupled from any specific machine identity. gRPC/Protobuf as the wire contract means nodes could in principle be reimplemented in another language without changing the protocol. |
| **Middleware** | The gRPC/Protobuf layer (RPC middleware) and the NATS client (message-oriented middleware, with automatic fallback to a local `EventEmitter` if the broker is unreachable) both sit between application logic and the network, hiding transport details from callers. `database/connection.js` is a small data-access middleware layer that transparently switches between PostgreSQL and an in-memory store. |
| **Overview of DS / Model of Distributed Computation** *(self-study)* | Upload/replicate/download map onto the classic request-response and stream models of distributed computation: unary RPC (`HealthCheck`, `GetStatus`), client-streaming (`StoreChunkStream`), and server-streaming (`RetrieveChunkStream`). |
| **Distributed Multimedia Systems** | **Not implemented.** This system streams LLM weight binaries (`.bin` files), not audio/video; flagged as an explicit syllabus gap rather than stretched to fit. |
| **Virtualization** *(self-study)* | `docker-compose.yml` runs the Coordinator, 3 Storage Nodes, PostgreSQL, and NATS as isolated containers — each storage node is a virtualized instance of the same image, differing only by injected environment variables/ports. |

### Unit 2 — Communication

| Concept | How it's demonstrated here |
| :--- | :--- |
| **Fundamentals of Communication** | Every cross-process call is logged with source, target, protocol, operation, and status (`communication/logger.js`), and rendered as a trace on the Requests page — making the protocol layering (HTTP → gRPC → TCP) and message flow directly observable. |
| **Remote Procedure Call (RPC)** | `proto/storage.proto` defines `StorageService` (`StoreChunkStream`, `RetrieveChunkStream`, `ReplicateToNode`, `GetStatus`, `DeleteModelFile`, `HealthCheck`) implemented with gRPC — both unary and streaming RPC styles are used. |
| **Message-Oriented Communication** | NATS pub/sub (`communication/nats/natsClient.js`) decouples publishers from subscribers via named subjects (`node.events`, `system.events`, `replication.events`) — the Coordinator reacts to node/replication events without a direct call into the component that raised them. |
| **Stream-Oriented Communication** | Model files are transferred as a sequence of ordered 64KB chunks over gRPC client/server streams (`chunkManager.js`, `storageNode.js`), not as one atomic message — the defining trait of stream-oriented vs. request-reply communication. |
| **Peer-to-Peer (P2P) Messaging** | Once the Coordinator selects a primary and replica set, replication traffic flows **directly** node-to-node (`Node 1 ➔ Node 2`) via gRPC — the Coordinator is not in the data path, only in the control path (`handleReplicateToNode` in `storageNode.js`). *Known limitation:* peer addresses are statically configured, not dynamically discovered (no gossip/DHT), so this is P2P data transfer without P2P discovery. |
| **WebRTC** | **Not implemented.** No `RTCPeerConnection`/data channel anywhere in the codebase; flagged as an explicit syllabus gap rather than claimed. |
| **Names, Identifiers & Addresses** *(self-study)* | Models are identified by a UUID (`modelId`, location-independent identifier) separate from their human-readable `name`/`version`; nodes are identified by a logical `nodeId` (e.g. `node-1`) distinct from their physical `host:port` address, which can change without changing identity. |
| **Fault Tolerance** *(self-study)* | Heartbeat-based failure detection: the Coordinator polls every node's `HealthCheck`/`GetStatus` RPC every 5s and marks it `OFFLINE` on failure (`coordinator.js` `startHealthCheckPoller`); each node also announces liveness proactively over NATS (`storage/index.js`). Combined with replication, a single node failure doesn't lose data or block reads of already-synced replicas. |

### Unit 3 — Synchronization

All Unit 3 algorithms run **peer-to-peer between the storage nodes** (`backend/src/sync/`), over one NATS subject (`cluster.p2p`) that gives FIFO channels between every pair of nodes. The Coordinator only observes them (`coordinator/syncMonitor.js`) and relays operator commands; it is not a participant. Everything is visible live on the dashboard's **Synchronization** page (`/sync`), and `npm run test:sync` checks every algorithm automatically.

| Concept | How it's demonstrated here |
| :--- | :--- |
| **Clock Synchronization** | **Berkeley algorithm** (`sync/berkeley.js`): the elected leader acts as time daemon. Every 30 s (or on demand) it polls every node's clock, estimates each reading **Cristian-style as `reading + RTT/2`**, discards outliers (fault-tolerant average), and sends every node the correction that moves it to the average. EC2 clocks are already NTP-synced to within milliseconds, so skew can be injected per node from the UI (or via `CLOCK_SKEW_MS` / `CLOCK_DRIFT_PPM`) to make the correction visible. The algorithm gives *agreement*, not accuracy: clocks converge on their mean, not on UTC. |
| **Logical Clocks / Lamport's Algorithm** | `sync/clocks.js` `LamportClock`, applied by `sync/peerBus.js` to every node-to-node message: tick on send/local event, `max(local, msg) + 1` on receive. `(timestamp, nodeId)` gives a total order that Ricart-Agrawala uses to order requests. The trace view can sort events by Lamport time or by (skewed) physical time to show that physical timestamps can contradict causality, while Lamport order cannot. |
| **Vector Algorithm (Vector Clocks)** | `sync/clocks.js` `VectorClock`, carried on every message alongside the Lamport time. Selecting two events in the trace shows whether one **happened-before** the other or whether they are **concurrent**, which Lamport timestamps alone cannot tell. |
| **Global State** | **Chandy-Lamport snapshot** (`sync/snapshot.js`): the initiator records its state and sends MARKERs; each node records its state on its first marker and records each incoming channel until that channel's marker arrives. The result (local states + in-flight channel messages) is checked by the Coordinator for a **consistent cut** (`V_i[j] ≤ V_j[j]` for all i, j). |
| **Election Algorithms** | **Bully algorithm** (`sync/election.js`): the highest-ranked live node becomes leader. Elections start at node startup, when the leader's beacons stop, or on operator request. A recovered higher-ranked node "bullies" its way back. The leader is the Berkeley time daemon. |
| **Mutual Exclusion Algorithms** | **Ricart-Agrawala** (`sync/mutex.js`), with no central lock server: a node broadcasts a Lamport-stamped REQUEST and enters once all live peers have replied. Peers defer their reply while they hold the lock or have an older request. The protected critical section is a cluster-wide **integrity scrub** (re-hash every stored file), run one node at a time so the other nodes keep full disk throughput for downloads. The dashboard checks the safety property (at most one holder) live. Peers declared dead by the beacon protocol are not waited for. *(Compare: the Coordinator's existing keyed `Mutex`/`RWLock` in `utils/concurrency.js` is a centralized mutual exclusion scheme.)* |
| **Beacon Protocol** | `sync/beacon.js`: every node broadcasts a sequence-numbered beacon every 2 s, and each node builds **its own** membership view (ALIVE → SUSPECT → DEAD after 3 missed beacons) instead of relying on the Coordinator. Failure detection uses the monotonic clock, so clock skew/corrections can't cause false suspicions. A DEAD leader triggers re-election, and a DEAD peer is dropped from mutex/snapshot waits. |
| **Lodha & Kshemkalyani's fair mutual exclusion** *(self-study)* | **Not implemented; described for comparison.** It refines Ricart-Agrawala: each node keeps a local queue of concurrent requests ordered by timestamp. A REQUEST received from a concurrently requesting node with a later timestamp itself counts as that node's permission, and a FLUSH message sent on exit can stand in for several replies. This cuts messages per critical-section entry from exactly 2(N−1) to between N−1 and 2(N−1) while granting requests in the same timestamp order (fairness). Our implementation is the baseline it improves on. |
| **Knapp's classification of distributed deadlock detection** *(self-study)* | **Not implemented; analysed.** Knapp classifies detectors as *path-pushing*, *edge-chasing* (e.g. Chandy-Misra-Haas probes), *diffusing computation* and *global state detection*. The last of these is exactly what the Chandy-Lamport snapshot above provides: a wait-for graph recorded in a consistent cut could be checked for cycles. In this system there is no deadlock to detect, because Ricart-Agrawala guards a single resource and the Coordinator's locks are per-model and never nested, so no hold-and-wait cycle can form. |

### Unit 4 — Emerging Distributed Paradigms

| Concept | How it's demonstrated here |
| :--- | :--- |
| **Distributed File System** | The system itself: files are split into 64 KB chunks, stored on multiple storage nodes, replicated 3×, located through a metadata service (Coordinator + PostgreSQL), and integrity-checked with SHA-256. |
| **Apache Hadoop (HDFS) case study** | The architecture mirrors HDFS: Coordinator ≈ **NameNode** (metadata, placement, routing), Storage Nodes ≈ **DataNodes** (store blocks and report via heartbeats), default **replication factor 3**, and pipelined replica copying between DataNodes (our P2P replication). |
| **Distributed Object-Based Systems** | Each storage node exposes a remote object interface (`StorageService` in `proto/storage.proto`) invoked through generated gRPC stubs, the same pattern as Java RMI/CORBA remote method invocation. |
| **Distributed Web-Based Systems** | Browser (React SPA) → REST/HTTP API → back-end services, a multi-tier web architecture. |
| **AWS case study** | `deploy/aws/up.sh` deploys the cluster on AWS: 4 EC2 instances in **3 Availability Zones** of one VPC, a security group that allows cluster-internal traffic only, an Elastic IP, and a reserved ENI. `deploy/aws/demo-fault-tolerance.sh` powers instances off to demonstrate failure masking and recovery. |
| **Kubernetes** | **Not used**, but the deployment uses the same building blocks: containerized services (Docker), declarative composition (`docker-compose`), restart policies (self-healing), and stateless coordinator vs stateful storage nodes. |
| **Serverless, Megaport, Cloudflare** | **Not implemented**; case-study topics only. |
| **Trade-offs in distributed databases** *(self-study)* | CAP in practice: reads are served by any live synced replica (availability), while replica status is tracked centrally, so a new upload needs the Coordinator and PostgreSQL to be reachable (consistency of metadata over partition tolerance). |

---

## Directory Structure

```text
distributed-model-repository/
├── proto/
│   └── storage.proto                  # Protobuf contracts for StorageService
├── backend/
│   ├── src/
│   │   ├── config/config.js           # Environment & cluster configuration
│   │   ├── coordinator/
│   │   │   ├── coordinator.js         # Core coordinator & stream manager
│   │   │   ├── nodeSelector.js        # Node selection & balancing logic
│   │   │   ├── requestRouter.js       # Download routing algorithm
│   │   │   └── syncMonitor.js         # Observes the nodes' Unit 3 sync layer
│   │   ├── sync/                      # Unit 3: runs inside every storage node
│   │   │   ├── clocks.js              # Physical, Lamport and vector clocks
│   │   │   ├── peerBus.js             # Clock-stamped node-to-node messaging (NATS)
│   │   │   ├── beacon.js              # Beacon protocol & membership
│   │   │   ├── election.js            # Bully election
│   │   │   ├── berkeley.js            # Berkeley clock synchronization
│   │   │   ├── mutex.js               # Ricart-Agrawala mutual exclusion
│   │   │   ├── snapshot.js            # Chandy-Lamport global snapshot
│   │   │   └── syncAgent.js           # Wires the above into a storage node
│   │   ├── storage/
│   │   │   ├── storageNode.js         # Generic gRPC storage server
│   │   │   ├── fileManager.js         # Local disk storage & directory isolation
│   │   │   ├── chunkManager.js        # Chunking utilities & payload definitions
│   │   │   ├── checksum.js            # Streaming SHA-256 integrity utility
│   │   │   └── index.js               # Storage node CLI runner
│   │   ├── replication/
│   │   │   └── replicationManager.js  # P2P replication orchestrator
│   │   ├── communication/
│   │   │   ├── grpc/grpcClient.js     # gRPC connection pool & client wrappers
│   │   │   ├── nats/natsClient.js     # NATS pub/sub client
│   │   │   └── logger.js              # Distributed communication logger
│   │   ├── database/
│   │   │   ├── connection.js          # PostgreSQL pool + offline fallback
│   │   │   ├── schema.sql             # Relational schema DDL
│   │   │   └── models/                # Model, StorageNode, Replica, Event models
│   │   └── api/
│   │       ├── routes/                # REST endpoints (models, nodes, replicas, logs)
│   │       └── server.js              # Coordinator HTTP entrypoint
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/                     # Dashboard, Models, Details, Upload, Nodes, Replication, Requests
│   │   ├── components/                # Navbar, Sidebar, StatCard, TopologyDiagram
│   │   ├── services/api.js            # Axios client & formatters
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
├── storage/
│   ├── node-1/                        # Physical storage directory for Node 1
│   ├── node-2/                        # Physical storage directory for Node 2
│   └── node-3/                        # Physical storage directory for Node 3
├── scripts/
│   ├── start-local.js                 # Starts Coordinator + 3 Nodes + UI locally
│   ├── stop-local.js                  # Terminates cluster processes
│   ├── seed-sample-model.js           # Generates 5MB LLM weights & tests upload
│   └── test-sync.js                   # Automated checks of every Unit 3 algorithm
├── deploy/
│   ├── docker-compose.control.yml     # Control plane for the multi-machine deployment
│   └── aws/                           # up.sh, down.sh, demo-fault-tolerance.sh
├── docker-compose.yml                 # Full cluster container orchestration
└── README.md
```

---

## Quick Start (Three Ways to Run)

| Method | Best for | Synchronization page |
| :--- | :--- | :--- |
| 1. Native local run | Quick development, no Docker | ✗ No NATS broker, so nodes can't talk to each other |
| 2. Docker Compose | Full feature set on one machine | ✓ |
| 3. AWS (4 EC2 machines, 3 AZs) | Real distribution, fault-tolerance demo, viva | ✓ |

### Method 1: Native Local Run (Zero-Config)

You can run the entire cluster natively on your machine using Node.js:

1. **Install dependencies**:
   ```bash
   npm run install:all
   ```

2. **Start the complete cluster** (Coordinator + 3 Storage Nodes + Frontend):
   ```bash
   npm start
   ```

3. **Open the Dashboard**:
   - Open your browser at: **`http://localhost:3000`**

4. **Upload a test model with synthetic LLM weights** (in a new terminal):
   ```bash
   npm run seed
   ```

5. **Stop the cluster**:
   - Press `Ctrl + C` in the terminal, or run:
   ```bash
   npm run stop
   ```

---

### Method 2: Docker Compose

To start everything (Coordinator, 3 Storage Nodes, PostgreSQL, NATS, and React Frontend) inside Docker containers:

```bash
docker compose up --build
```

Access:
- **Frontend Dashboard**: `http://localhost:3000`
- **Coordinator REST API**: `http://localhost:4000/api/health`
- **NATS Management**: `http://localhost:8222`

To tear down:
```bash
docker compose down -v
```

---

### Method 3: Deploy on AWS (Multi-Machine)

`deploy/aws/up.sh` builds the whole cluster with one command. Each storage node gets its own machine, in its own Availability Zone:

```
                 Browser ──► :3000 dashboard / :4000 API   (Elastic IP)
                         │
        ┌────────────────▼──────────────────┐
        │ dmr-control (t3.medium, AZ a)     │
        │ coordinator · postgres · nats ·   │
        │ frontend                          │
        └──────┬──────────────┬─────────────┘
               │  private IPs, one security group
   ┌───────────▼──┐  ┌────────▼─────┐  ┌──────────────┐
   │ dmr-node-1   │◄─►│ dmr-node-2   │◄─►│ dmr-node-3   │   P2P gRPC replication
   │ AZ a  :5001  │  │ AZ b  :5002  │  │ AZ c  :5003  │   + NATS sync messages
   └──────────────┘  └──────────────┘  └──────────────┘
```

**Prerequisites:** an AWS account with EC2 permissions, and this repository pushed to a **public** GitHub repo (the instances `git clone` it, so unpushed changes are not deployed).

**Steps (AWS CloudShell, where the AWS CLI is already logged in):**
1. Open the AWS Console, pick a region with at least 3 AZs (e.g. Mumbai `ap-south-1`), and open **CloudShell** (`>_` icon).
2. Deploy:
   ```bash
   git clone https://github.com/aryan242005/Distributed-LLM-Store.git
   cd Distributed-LLM-Store
   bash deploy/aws/up.sh
   ```
   After about 10 minutes the script prints the dashboard URL (`http://<elastic-ip>:3000`), each machine's IP and AZ, and SSH commands.
3. Run the fault-tolerance demo. It uploads a test model, powers off the primary node's EC2 instance and then a second one, verifies every download by SHA-256, shows beacon-based re-election, then brings the nodes back:
   ```bash
   bash deploy/aws/demo-fault-tolerance.sh          # pauses between steps
   AUTO=1 bash deploy/aws/demo-fault-tolerance.sh   # runs straight through
   ```
4. Delete everything (instances, disks, Elastic IP, network interface, security group, key pair). Use the **same region**:
   ```bash
   bash deploy/aws/down.sh
   ```

**What `up.sh` creates:** a security group that exposes only ports 22 (your IP), 3000 and 4000, with all other traffic allowed only between cluster members; an SSH key saved as `deploy/aws/dmr-key.pem` (git-ignored); an Elastic IP; and 4 Ubuntu 24.04 instances that install Docker and start their role via user-data. Bootstrap logs are in `/var/log/dmr-bootstrap.log` on each instance, and node replicas are in `/opt/dmr-data`.

**Cost:** roughly $55/month if left running. Stopping the instances still bills the disks and Elastic IP; only `down.sh` brings the cost to zero.

---

## Testing

```bash
npm run test:sync     # Unit 3 algorithms: 3 nodes in-process over an in-memory FIFO network
npm run test:system   # End-to-end upload/replication/download test (starts its own nodes in-process)
```

`test:sync` checks Bully election, Berkeley convergence, Ricart-Agrawala safety and Lamport ordering, Chandy-Lamport consistency (including rejecting an inconsistent cut), re-election after a leader crash, and the leader returning after recovery.

---

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/dashboard/stats` | Aggregated cluster telemetry & topology stats |
| `GET` | `/api/models` | List all models with replica counts |
| `GET` | `/api/models/:id` | Model details and exact replica breakdown |
| `POST` | `/api/models/upload` | Multipart streamed model upload |
| `GET` | `/api/models/:id/download` | Streamed model download from active replica node |
| `DELETE`| `/api/models/:id` | Delete model and physical files across all nodes |
| `GET` | `/api/nodes` | List storage nodes with health and storage capacity |
| `POST` | `/api/nodes/:id/ping` | Ping node health via gRPC |
| `GET` | `/api/replicas` | List all replica mappings |
| `GET` | `/api/logs` | Query distributed communication traces (gRPC & P2P) |
| `GET` | `/api/events` | Query NATS system events |
| `GET` | `/api/sync/status` | Per-node clocks, Lamport/vector time, leader, membership, mutex state |
| `GET` | `/api/sync/trace` | Send/receive/internal events with Lamport + vector timestamps |
| `GET` | `/api/sync/compare?a=&b=` | Happened-before / concurrent relation of two trace events |
| `GET` | `/api/sync/clock-rounds` | Recent Berkeley rounds (offsets, RTTs, corrections) |
| `POST` | `/api/sync/skew` | Inject clock skew into a node `{ nodeId, deltaMs }` |
| `POST` | `/api/sync/clock-sync` | Ask the leader to run a Berkeley round now |
| `POST` | `/api/sync/election` | Start a Bully election `{ nodeId? }` |
| `POST` | `/api/sync/mutex` | Nodes request the critical section `{ nodeId? }` |
| `POST` | `/api/sync/snapshot` | Start a Chandy-Lamport snapshot `{ nodeId? }` |
| `GET` | `/api/sync/snapshots` | Recent snapshots with consistency check |

---

## Protobuf Specification (`proto/storage.proto`)

```protobuf
syntax = "proto3";
package storage;

service StorageService {
  rpc StoreChunkStream (stream Chunk) returns (StoreResponse);
  rpc RetrieveChunkStream (RetrieveRequest) returns (stream Chunk);
  rpc ReplicateToNode (ReplicateRequest) returns (ReplicateResponse);
  rpc GetStatus (StatusRequest) returns (NodeStatusResponse);
  rpc DeleteModelFile (DeleteRequest) returns (DeleteResponse);
  rpc HealthCheck (PingRequest) returns (PingResponse);
}
```

---

## Viva & Demonstration Guide

During evaluation or presentation:

1. **Demonstrate Node Identity & Single Codebase**:
   - Point out that `storage/node-1/`, `storage/node-2/`, and `storage/node-3/` are all running the exact same generic storage code (`backend/src/storage/`).
2. **Demonstrate Peer-to-Peer Replication**:
   - Upload a model from the **Upload Model** page (`/upload`).
   - Check the **Requests & Logs** page (`/requests`) to show:
     - `Coordinator ➔ Node 1 : STORE_MODEL`
     - `Node 1 ➔ Node 2 : REPLICATE_MODEL (gRPC P2P)`
     - `Node 1 ➔ Node 3 : REPLICATE_MODEL (gRPC P2P)`
3. **Demonstrate File System Verification**:
   - Inspect the physical directories:
     - `storage/node-1/models/`
     - `storage/node-2/models/`
     - `storage/node-3/models/`
   - Notice that identical chunk-streamed files with matching SHA-256 checksums exist across all 3 nodes.
4. **Demonstrate Streamed Download**:
   - Download the model from the UI or API. The Coordinator queries the RequestRouter and streams the file chunks directly from an active node back to the client without buffering the full file into memory.
5. **Demonstrate Synchronization (Unit 3)** on the **Synchronization** page (`/sync`). It needs NATS, so run it with Docker Compose or on AWS; the native local run has no NATS broker.
   - **Election:** the leader card shows the highest-ranked node. Click *Elect from here* on `node-1` and follow ELECTION → ANSWER → COORDINATOR in the trace.
   - **Clock sync:** click *+5 s skew* on a node and watch "vs coordinator" jump. Then click *Run Berkeley sync*: the round table shows each measured offset and RTT, and all clocks converge on the average.
   - **Logical clocks:** with skew injected, switch the trace between *Lamport order* and *Physical-time order*. Select a SEND and its RECV (happened-before), then two events from different nodes with no messages between them (concurrent).
   - **Mutual exclusion:** click *All nodes request now*. The log shows deferred replies and entries strictly in Lamport order, and the banner confirms at most one holder.
   - **Global state:** click *Take snapshot* and show the local states, channel states, and the CONSISTENT CUT check.
   - **Beacons + re-election on AWS:** run `deploy/aws/demo-fault-tolerance.sh`. When the leader's EC2 instance is powered off, the other nodes mark it DEAD after 3 missed beacons and elect a new leader; when it returns, it reclaims leadership.
