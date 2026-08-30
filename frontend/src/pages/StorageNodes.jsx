import React, { useState, useEffect } from 'react';
import { HardDrive, Server, Activity, RefreshCw, CheckCircle2, ShieldAlert, Wifi, Cpu, Layers } from 'lucide-react';
import { api, formatBytes, formatDate } from '../services/api';

export default function StorageNodes() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pingingNode, setPingingNode] = useState(null);
  const [pingResults, setPingResults] = useState({});

  const fetchNodes = async () => {
    try {
      setLoading(true);
      const data = await api.getNodes();
      setNodes(data || []);
    } catch (err) {
      console.error('Failed to load nodes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
    const interval = setInterval(fetchNodes, 5000);
    return () => clearInterval(interval);
  }, []);

  const handlePingNode = async (nodeId) => {
    try {
      setPingingNode(nodeId);
      const res = await api.pingNode(nodeId);
      setPingResults((prev) => ({
        ...prev,
        [nodeId]: { success: true, message: `Responsive (Pong: ${res.data?.pong?.timestamp || 'OK'})` },
      }));
      fetchNodes();
    } catch (err) {
      setPingResults((prev) => ({
        ...prev,
        [nodeId]: { success: false, message: `Ping Failed: ${err.message}` },
      }));
    } finally {
      setPingingNode(null);
      setTimeout(() => {
        setPingResults((prev) => {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
      }, 5000);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <HardDrive className="w-6 h-6 text-emerald-400" />
            Storage Nodes Mesh
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Generic storage node instances participating in the distributed LLM storage cluster
          </p>
        </div>

        <button
          onClick={fetchNodes}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white font-medium text-sm transition flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          Refresh Nodes
        </button>
      </div>

      {/* Nodes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {nodes.map((node) => {
          const isOnline = node.status === 'ONLINE';
          const usedBytes = Number(node.used_storage_bytes) || 0;
          const totalBytes = Number(node.total_storage_bytes) || 107374182400; // 100 GB
          const usagePercent = Math.min(100, Math.round((usedBytes / totalBytes) * 100)) || 0;
          const pingStatus = pingResults[node.id];

          return (
            <div
              key={node.id}
              className={`p-6 rounded-2xl border transition-all ${
                isOnline
                  ? 'bg-slate-900/60 border-slate-800 hover:border-emerald-500/30 shadow-lg'
                  : 'bg-slate-900/30 border-rose-500/30'
              } flex flex-col justify-between space-y-5`}
            >
              {/* Header */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2.5 rounded-xl ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-slate-100">{node.id}</h3>
                      <div className="font-mono text-xs text-slate-400">
                        {node.host}:{node.port}
                      </div>
                    </div>
                  </div>

                  <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold border ${
                    isOnline
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  }`}>
                    {node.status || 'ONLINE'}
                  </span>
                </div>

                {/* Storage directory indicator */}
                <div className="mt-4 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                  <span className="text-slate-500">Storage Root:</span>
                  <span className="text-slate-300 truncate max-w-[180px]">storage/{node.id}/</span>
                </div>
              </div>

              {/* Capacity Bar & Stored Models */}
              <div className="space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Storage Allocated:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
                  </span>
                </div>

                <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      usagePercent > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.max(3, usagePercent)}%` }}
                  ></div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    Stored Models:
                  </span>
                  <span className="font-mono font-semibold text-slate-200">
                    {node.stored_models_count || 0}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Heartbeat:</span>
                  <span className="text-slate-400 text-[11px] font-mono">
                    {formatDate(node.last_heartbeat)}
                  </span>
                </div>
              </div>

              {/* Ping Action & Feedback */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <button
                  onClick={() => handlePingNode(node.id)}
                  disabled={pingingNode === node.id}
                  className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs transition flex items-center justify-center space-x-1.5 border border-slate-700/60"
                >
                  <Wifi className={`w-3.5 h-3.5 ${pingingNode === node.id ? 'animate-pulse text-emerald-400' : ''}`} />
                  <span>{pingingNode === node.id ? 'Pinging Node...' : 'Ping Node (gRPC HealthCheck)'}</span>
                </button>

                {pingStatus && (
                  <div className={`p-2 rounded-lg text-[11px] font-mono flex items-center gap-1.5 ${
                    pingStatus.success ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'
                  }`}>
                    {pingStatus.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <ShieldAlert className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate">{pingStatus.message}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
