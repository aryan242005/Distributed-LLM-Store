# Distributed Model Repository and LLM Weight Storage with Replication System

A production-grade distributed file storage and replication system for large Machine Learning / Large Language Model (LLM) weights. Built with **Node.js** (Coordinator & Storage Nodes), **React + Vite** (Dashboard Frontend), **PostgreSQL** (Metadata Store), **gRPC** (RPC & Chunk Streaming), and **NATS** (Message-oriented Event Bus).

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
         │ • system_events        │  └──────────────────┘  │  │ Node 1       │ (Port 5001)     │
         │ • communication_logs   │                        │  │ storage/node-1│                │
         └────────────────────────┘                        │  └──────┬───────┘                 │
                                                           │         │ gRPC P2P Replication    │
                                                           │         ▼                         │
                                                           │  ┌──────────────┐  ┌────────────┐ │
                                                           │  │ Storage      │  │ Storage    │ │
                                                           │  │ Node 2       │  │ Node 3     │ │
                                                           │  │ (Port 5002)  │  │ (Port 5003)│ │
                                                           │  └──────────────┘  └────────────┘ │
                                                           └───────────────────────────────────┘
```

---

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

---

## Distributed Systems Concepts Map (Unit 1 & Unit 2 Syllabus Mapping)

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
│   │   │   └── requestRouter.js       # Download routing algorithm
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
│   └── seed-sample-model.js           # Generates 5MB LLM weights & tests upload
├── docker-compose.yml                 # Full cluster container orchestration
└── README.md
```

---

## Quick Start (Two Ways to Run)

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
