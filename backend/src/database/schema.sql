-- Distributed Model Repository & LLM Weight Storage Schema

CREATE TABLE IF NOT EXISTS models (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(64) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum VARCHAR(128) NOT NULL,
    replication_factor INT NOT NULL DEFAULT 3,
    primary_node_id VARCHAR(64),
    description TEXT,
    status VARCHAR(64) NOT NULL DEFAULT 'READY',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS storage_nodes (
    id VARCHAR(64) PRIMARY KEY,
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'ONLINE',
    total_storage_bytes BIGINT DEFAULT 107374182400, -- Default 100 GB
    used_storage_bytes BIGINT DEFAULT 0,
    available_storage_bytes BIGINT DEFAULT 107374182400,
    stored_models_count INT DEFAULT 0,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS replicas (
    id VARCHAR(64) PRIMARY KEY,
    model_id VARCHAR(64) NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'REPLICA', -- 'PRIMARY' or 'REPLICA'
    status VARCHAR(64) NOT NULL DEFAULT 'SYNCED', -- 'SYNCING', 'SYNCED', 'FAILED'
    checksum VARCHAR(128),
    size_bytes BIGINT DEFAULT 0,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    CONSTRAINT fk_node FOREIGN KEY (node_id) REFERENCES storage_nodes(id) ON DELETE CASCADE,
    CONSTRAINT unique_model_node UNIQUE (model_id, node_id)
);

CREATE TABLE IF NOT EXISTS system_events (
    id VARCHAR(64) PRIMARY KEY,
    event_type VARCHAR(128) NOT NULL,
    source VARCHAR(128) NOT NULL,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS communication_logs (
    id VARCHAR(64) PRIMARY KEY,
    source VARCHAR(128) NOT NULL,
    target VARCHAR(128) NOT NULL,
    protocol VARCHAR(32) NOT NULL DEFAULT 'gRPC',
    operation VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    details TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_models_name ON models(name);
CREATE INDEX IF NOT EXISTS idx_replicas_model_id ON replicas(model_id);
CREATE INDEX IF NOT EXISTS idx_replicas_node_id ON replicas(node_id);
CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_logs_timestamp ON communication_logs(timestamp DESC);
