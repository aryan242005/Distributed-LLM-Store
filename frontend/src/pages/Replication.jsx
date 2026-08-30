import React, { useState, useEffect } from 'react';
import { Copy, Layers, HardDrive, CheckCircle2, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { api, formatBytes } from '../services/api';

export default function Replication() {
  const [models, setModels] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [allReplicas, setAllReplicas] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [modelsData, nodesData, replicasData] = await Promise.all([
        api.getModels(),
        api.getNodes(),
        api.getReplicas(),
      ]);
      setModels(modelsData || []);
      setNodes(nodesData || []);
      setAllReplicas(replicasData || []);
    } catch (err) {
      console.error('Failed to load replication data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <Copy className="w-6 h-6 text-emerald-400" />
            Distributed Replication Matrix
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Tracking replica locations, P2P sync state, and fault tolerance distribution across storage nodes
          </p>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white font-medium text-sm transition flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          Refresh Matrix
        </button>
      </div>

      {/* Replication Stats Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-indigo-950/40 border border-emerald-500/20 grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="space-y-1">
          <div className="text-xs uppercase font-semibold text-emerald-400">Target Replication Factor</div>
          <div className="text-2xl font-bold text-slate-100 font-mono">3x Replicas</div>
          <div className="text-xs text-slate-400">Default cluster-wide redundancy setting</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs uppercase font-semibold text-indigo-400">Replication Protocol</div>
          <div className="text-2xl font-bold text-slate-100 font-mono">P2P gRPC Stream</div>
          <div className="text-xs text-slate-400">Direct node-to-node chunk streaming</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs uppercase font-semibold text-amber-400">Data Integrity</div>
          <div className="text-2xl font-bold text-slate-100 font-mono">SHA-256 Verified</div>
          <div className="text-xs text-slate-400">End-to-end cryptographic checksum checks</div>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono text-slate-300">
            <thead className="bg-slate-900/80 uppercase font-semibold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Model Name</th>
                <th className="px-6 py-4">Size</th>
                <th className="px-6 py-4 text-center">Req. Factor</th>
                {nodes.map((node) => (
                  <th key={node.id} className="px-6 py-4 text-center">
                    <span className="flex items-center justify-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                      {node.id}
                    </span>
                  </th>
                ))}
                <th className="px-6 py-4 text-right">Cluster Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {models.length === 0 ? (
                <tr>
                  <td colSpan={4 + nodes.length} className="text-center py-12 text-slate-500 font-sans">
                    No models in cluster yet. Upload a model to view replica distribution.
                  </td>
                </tr>
              ) : (
                models.map((model) => {
                  const modelReps = (model.replicas && model.replicas.length > 0)
                    ? model.replicas
                    : allReplicas.filter((r) => r.model_id === model.id);
                  const replicaCount = modelReps.length;
                  const isFullySynced = replicaCount >= (model.replication_factor || 3);

                  return (
                    <tr key={model.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-4 font-sans font-medium text-slate-100">
                        <div>{model.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">v{model.version}</div>
                      </td>

                      <td className="px-6 py-4 text-slate-200">
                        {formatBytes(model.size_bytes)}
                      </td>

                      <td className="px-6 py-4 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {model.replication_factor || 3}
                        </span>
                      </td>

                      {/* Node Columns */}
                      {nodes.map((node) => {
                        const rep = modelReps.find((r) => r.node_id === node.id);
                        const isPrimary = rep && (rep.role === 'PRIMARY' || model.primary_node_id === node.id);

                        if (rep) {
                          return (
                            <td key={node.id} className="px-6 py-4 text-center">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                                isPrimary
                                  ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                              }`}>
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                {isPrimary ? 'PRIMARY' : 'REPLICA'}
                              </span>
                            </td>
                          );
                        }

                        return (
                          <td key={node.id} className="px-6 py-4 text-center text-slate-600">
                            -
                          </td>
                        );
                      })}

                      <td className="px-6 py-4 text-right">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                          isFullySynced
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          {isFullySynced ? 'HEALTHY (100%)' : `PARTIAL (${replicaCount}/${model.replication_factor || 3})`}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
