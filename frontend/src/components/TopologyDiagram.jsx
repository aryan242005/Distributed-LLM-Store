import React from 'react';
import { Server, Database, Activity, HardDrive, ArrowRight, ArrowLeftRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { formatBytes } from '../services/api';

export default function TopologyDiagram({ nodes = [] }) {
  const node1 = nodes.find(n => n.id === 'node-1') || { id: 'node-1', port: 5001, status: 'ONLINE', used_storage_bytes: 0 };
  const node2 = nodes.find(n => n.id === 'node-2') || { id: 'node-2', port: 5002, status: 'ONLINE', used_storage_bytes: 0 };
  const node3 = nodes.find(n => n.id === 'node-3') || { id: 'node-3', port: 5003, status: 'ONLINE', used_storage_bytes: 0 };

  const renderNodeCard = (node, index) => {
    const isOnline = node.status === 'ONLINE';
    return (
      <div className={`p-4 rounded-xl border ${
        isOnline ? 'bg-slate-900/90 border-emerald-500/30 shadow-lg shadow-emerald-500/5' : 'bg-slate-900/40 border-rose-500/30'
      } flex flex-col justify-between space-y-3 relative overflow-hidden transition-all hover:scale-[1.02]`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className={`p-1.5 rounded-lg ${isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-sm text-slate-200">Storage Node {index}</div>
              <div className="font-mono text-[11px] text-slate-400">:{node.port}</div>
            </div>
          </div>
          <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${
            isOnline 
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          }`}>
            {node.status || 'ONLINE'}
          </span>
        </div>

        <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Used: <strong className="text-slate-200 font-mono">{formatBytes(node.used_storage_bytes)}</strong></span>
          <span className="text-emerald-400 flex items-center gap-1">
            <ArrowLeftRight className="w-3 h-3" /> P2P gRPC
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-200 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            Live Distributed Topology
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">Realtime view of Coordinator, Storage Nodes, Database, and Message Bus</p>
        </div>
        <div className="flex items-center space-x-4 text-xs">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            gRPC Streaming Enabled
          </span>
        </div>
      </div>

      {/* Architecture Layout */}
      <div className="space-y-6">
        {/* Top Tier: Coordinator, Postgres, NATS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Coordinator */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-indigo-500/30 shadow-lg shadow-indigo-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm text-slate-200">Coordinator Server</div>
                  <div className="font-mono text-[11px] text-indigo-400">REST :4000</div>
                </div>
              </div>
              <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                MASTER
              </span>
            </div>
            <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-800">
              Orchestrates storage node selection, replication triggers & download routing.
            </p>
          </div>

          {/* PostgreSQL */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-sky-500/30 shadow-lg shadow-sky-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm text-slate-200">PostgreSQL Metadata</div>
                  <div className="font-mono text-[11px] text-sky-400">:5432</div>
                </div>
              </div>
              <span className="text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded-full">
                STORAGE
              </span>
            </div>
            <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-800">
              Stores models, replica locations, logs, and system events.
            </p>
          </div>

          {/* NATS */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/30 shadow-lg shadow-amber-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm text-slate-200">NATS Message Broker</div>
                  <div className="font-mono text-[11px] text-amber-400">:4222</div>
                </div>
              </div>
              <span className="text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                PUB/SUB
              </span>
            </div>
            <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-800">
              Asynchronous event bus for node health & replication triggers.
            </p>
          </div>
        </div>

        {/* Middle connector visual */}
        <div className="flex items-center justify-center space-x-2 text-xs font-mono text-slate-400 py-1">
          <span>↓ gRPC Control & Data Plane ↓</span>
        </div>

        {/* Bottom Tier: Storage Nodes (1, 2, 3) */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
            <span>Storage Nodes Mesh (Generic Node Application)</span>
            <span className="text-emerald-400 font-mono text-[11px]">Replication Factor: 3</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {renderNodeCard(node1, 1)}
            {renderNodeCard(node2, 2)}
            {renderNodeCard(node3, 3)}
          </div>
        </div>
      </div>
    </div>
  );
}
