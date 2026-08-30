import React, { useState, useEffect } from 'react';
import { Box, Server, HardDrive, Copy, Activity, Terminal, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatBytes, formatDate, truncateHash } from '../services/api';
import StatCard from '../components/StatCard';
import TopologyDiagram from '../components/TopologyDiagram';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = async () => {
    try {
      const data = await api.getDashboardStats();
      setStats(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load dashboard stats:', err);
      setError('Could not connect to Coordinator. Please ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm">Connecting to Distributed Cluster...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
            System Dashboard
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Real-time telemetry for Distributed LLM Model Repository & Storage Mesh
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            to="/upload"
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition flex items-center gap-2 shadow-lg shadow-emerald-600/20"
          >
            Upload Model
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title="Total Models"
          value={stats?.totalModels || 0}
          subtitle="Registered LLM weights"
          icon={Box}
          color="emerald"
        />
        <StatCard
          title="Storage Nodes"
          value={`${stats?.onlineNodes || 0} / ${stats?.totalNodes || 3}`}
          subtitle={`${stats?.offlineNodes || 0} offline`}
          icon={HardDrive}
          color="indigo"
          badge={stats?.onlineNodes === stats?.totalNodes ? 'Optimal' : 'Degraded'}
        />
        <StatCard
          title="Active Replicas"
          value={`${stats?.syncedReplicas || 0}`}
          subtitle={`Across ${stats?.onlineNodes || 0} independent nodes`}
          icon={Copy}
          color="amber"
        />
        <StatCard
          title="Cluster Storage"
          value={formatBytes(stats?.usedStorageBytes || 0)}
          subtitle={`Available: ${formatBytes(stats?.availableStorageBytes || 0)}`}
          icon={Server}
          color="violet"
        />
      </div>

      {/* Live Topology Diagram */}
      <TopologyDiagram nodes={stats?.nodes || []} />

      {/* Two Column Section: Recent Events & Communication Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Events Feed */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-200 flex items-center gap-2 text-sm">
              <Activity className="w-4 h-4 text-emerald-400" />
              NATS Distributed Events
            </h3>
            <Link to="/requests" className="text-xs text-emerald-400 hover:text-emerald-300 font-medium">
              View all
            </Link>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-80 pr-1">
            {stats?.recentEvents && stats.recentEvents.length > 0 ? (
              stats.recentEvents.map((evt, idx) => (
                <div
                  key={evt.id || idx}
                  className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 transition text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {evt.event_type}
                    </span>
                    <span className="text-slate-500 font-mono text-[11px] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(evt.created_at)}
                    </span>
                  </div>
                  <div className="text-slate-300">
                    Source: <span className="font-mono text-slate-200">{evt.source}</span>
                  </div>
                  {evt.payload && (
                    <pre className="font-mono text-[11px] text-slate-400 bg-slate-950 p-2 rounded-lg overflow-x-auto">
                      {JSON.stringify(evt.payload, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-slate-500 text-xs">
                No system events recorded yet. Upload a model to see distributed events!
              </div>
            )}
          </div>
        </div>

        {/* Communication Operations Preview */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-200 flex items-center gap-2 text-sm">
              <Terminal className="w-4 h-4 text-indigo-400" />
              Recent Distributed Operations (gRPC)
            </h3>
            <Link to="/requests" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
              Inspect logs
            </Link>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-80 pr-1">
            {stats?.recentLogs && stats.recentLogs.length > 0 ? (
              stats.recentLogs.map((log, idx) => (
                <div
                  key={log.id || idx}
                  className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 transition text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 font-mono">
                      <span className="text-indigo-400 font-semibold">{log.source}</span>
                      <span className="text-slate-500">➔</span>
                      <span className="text-emerald-400 font-semibold">{log.target}</span>
                    </div>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}>
                      {log.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400 pt-1">
                    <span className="font-mono font-medium text-slate-300">{log.operation} ({log.protocol})</span>
                    <span className="text-[11px] text-slate-500">{formatDate(log.timestamp)}</span>
                  </div>
                  {log.details && (
                    <div className="text-[11px] text-slate-400 truncate pt-0.5 font-mono">
                      {log.details}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-slate-500 text-xs">
                No communication traces yet. Operations will stream here in realtime.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
