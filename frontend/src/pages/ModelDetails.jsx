import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Box,
  ArrowLeft,
  Download,
  Trash2,
  HardDrive,
  ShieldCheck,
  Server,
  Layers,
  Copy,
  Check,
  Clock,
  ArrowLeftRight,
  AlertCircle
} from 'lucide-react';
import { api, formatBytes, formatDate, truncateHash } from '../services/api';

export default function ModelDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const fetchModel = async () => {
    try {
      setLoading(true);
      const [modelData, replicasData] = await Promise.all([
        api.getModelById(id),
        api.getReplicas().catch(() => []),
      ]);
      const reps = (modelData.replicas && modelData.replicas.length > 0)
        ? modelData.replicas
        : (replicasData || []).filter((r) => r.model_id === id);
      setModel({ ...modelData, replicas: reps });
      setError(null);
    } catch (err) {
      console.error('Failed to load model:', err);
      setError('Model not found or could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModel();
    const interval = setInterval(fetchModel, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const handleCopyChecksum = () => {
    if (!model?.checksum) return;
    navigator.clipboard.writeText(model.checksum);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete model "${model.name}" and clean up all replica storage nodes?`)) {
      return;
    }
    try {
      await api.deleteModel(id);
      navigate('/models');
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  if (loading && !model) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading model details...</span>
        </div>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
        <h3 className="text-lg font-semibold text-slate-200">{error || 'Model not found'}</h3>
        <Link to="/models" className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300">
          <ArrowLeft className="w-4 h-4" /> Back to Models
        </Link>
      </div>
    );
  }

  const replicas = model.replicas || [];

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Top Nav & Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            to="/models"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center space-x-3">
              <h2 className="text-2xl font-bold text-slate-100 tracking-tight">{model.name}</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                v{model.version}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {model.id}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <a
            href={api.getDownloadUrl(model.id)}
            download={model.filename}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition flex items-center gap-2 shadow-lg shadow-emerald-600/20"
          >
            <Download className="w-4 h-4" />
            Stream Download ({formatBytes(model.size_bytes)})
          </a>

          <button
            onClick={handleDelete}
            className="px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-medium text-sm transition flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Model
          </button>
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Box className="w-4 h-4 text-emerald-400" />
            File Details
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Filename:</span>
              <span className="text-slate-200 font-mono font-medium">{model.filename}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Size:</span>
              <span className="text-slate-200 font-mono font-semibold">{formatBytes(model.size_bytes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Primary Node:</span>
              <span className="text-emerald-400 font-mono font-medium">{model.primary_node_id || 'node-1'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Registered:</span>
              <span className="text-slate-300">{formatDate(model.created_at)}</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            Replication Factor
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Required Factor:</span>
              <span className="text-slate-200 font-mono font-medium">{model.replication_factor || 3} Replicas</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Synced Nodes:</span>
              <span className="text-emerald-400 font-mono font-semibold">{replicas.length} Active Copies</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Replication Protocol:</span>
              <span className="text-slate-300 font-mono">gRPC Stream (P2P)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Replication Status:</span>
              <span className="text-emerald-400 font-medium">HEALTHY</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Cryptographic Integrity
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Algorithm:</span>
              <span className="text-slate-300 font-mono">SHA-256</span>
            </div>
            <div className="space-y-1 pt-1">
              <div className="text-slate-400 text-[11px]">Hash Checksum:</div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-emerald-400 break-all">
                <span>{model.checksum}</span>
                <button onClick={handleCopyChecksum} className="ml-2 text-slate-400 hover:text-white p-1">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Replicas Storage Nodes Matrix */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-200 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            Storage Node Replicas Distribution
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {replicas.length} / {model.replication_factor || 3} copies active
          </span>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-lg">
          <table className="w-full text-left text-xs font-mono text-slate-300">
            <thead className="bg-slate-900/80 uppercase font-semibold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Node ID</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Address / Port</th>
                <th className="px-6 py-4">Sync Status</th>
                <th className="px-6 py-4">Replica Size</th>
                <th className="px-6 py-4 text-right">Synced Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {replicas.map((rep, idx) => {
                const isPrimary = rep.role === 'PRIMARY' || rep.node_id === model.primary_node_id;
                const isSynced = rep.status === 'SYNCED';

                return (
                  <tr key={rep.id || idx} className="hover:bg-slate-800/40 transition font-mono">
                    <td className="px-6 py-4 font-semibold text-slate-100 flex items-center gap-2">
                      <Server className="w-4 h-4 text-slate-400" />
                      <span>{rep.node_id}</span>
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        isPrimary
                          ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {isPrimary ? 'PRIMARY' : 'REPLICA (P2P)'}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-slate-400">
                      {rep.host || 'localhost'}:{rep.port || (rep.node_id === 'node-1' ? 5001 : rep.node_id === 'node-2' ? 5002 : 5003)}
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        isSynced
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}>
                        {rep.status || 'SYNCED'}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-slate-200">
                      {formatBytes(rep.size_bytes || model.size_bytes)}
                    </td>

                    <td className="px-6 py-4 text-right text-slate-400 font-sans">
                      {formatDate(rep.synced_at || rep.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
