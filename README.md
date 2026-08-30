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
