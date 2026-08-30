import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Box, Download, Trash2, ExternalLink, Search, Copy, Check, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { api, formatBytes, formatDate, truncateHash } from '../services/api';

export default function Models() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedHash, setCopiedHash] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const [modelsData, replicasData] = await Promise.all([
        api.getModels(),
        api.getReplicas().catch(() => []),
      ]);
      const merged = (modelsData || []).map((m) => {
        const reps = (m.replicas && m.replicas.length > 0)
          ? m.replicas
          : (replicasData || []).filter((r) => r.model_id === m.id);
        return { ...m, replicas: reps, replica_count: reps.length };
      });
      setModels(merged);
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleCopyHash = (hash) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete model "${name}" and all its physical replicas across the cluster?`)) {
      return;
    }

    try {
      await api.deleteModel(id);
      setActionMessage({ type: 'success', text: `Model "${name}" deleted from cluster.` });
      fetchModels();
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err) {
      setActionMessage({ type: 'error', text: `Failed to delete model: ${err.message}` });
    }
  };

  const filteredModels = models.filter((m) =>
    m.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.filename?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.version?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <Box className="w-6 h-6 text-emerald-400" />
            Model Repository
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Distributed LLM weights catalog with automatic replication and chunk verification
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchModels}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition"
            title="Refresh models"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
          <Link
            to="/upload"
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition flex items-center gap-2 shadow-lg shadow-emerald-600/20"
          >
            Upload New Model
          </Link>
        </div>
      </div>

      {actionMessage && (
        <div className={`p-4 rounded-xl border text-sm flex items-center gap-2 ${
          actionMessage.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          {actionMessage.text}
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex items-center space-x-4 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <Search className="w-4 h-4 text-slate-400 ml-2" />
        <input
          type="text"
          placeholder="Search by model name, filename, or version..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full placeholder:text-slate-500 font-sans"
        />
        <div className="text-xs text-slate-500 font-mono whitespace-nowrap mr-2">
          {filteredModels.length} models
        </div>
      </div>

      {/* Models Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase font-semibold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Model Name</th>
                <th className="px-6 py-4">Version</th>
                <th className="px-6 py-4">File Size</th>
                <th className="px-6 py-4">SHA-256 Checksum</th>
                <th className="px-6 py-4 text-center">Replicas</th>
                <th className="px-6 py-4">Uploaded</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {loading && models.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-12 text-slate-500">
                    <div className="flex flex-col items-center space-y-2 font-sans">
                      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                      <span>Loading model repository...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredModels.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-12 text-slate-500 font-sans">
                    <div className="max-w-sm mx-auto space-y-3">
                      <Box className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-sm font-medium text-slate-400">No models found</p>
                      <p className="text-xs text-slate-500">Upload an LLM model weight file to start distributed replication.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredModels.map((model) => {
                  const replicaCount = model.replica_count || (model.replicas ? model.replicas.length : 1);
                  const isFullyReplicated = replicaCount >= (model.replication_factor || 3);

                  return (
                    <tr key={model.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-4 font-sans font-medium text-slate-100">
                        <Link to={`/models/${model.id}`} className="hover:text-emerald-400 flex items-center gap-2">
                          <Box className="w-4 h-4 text-emerald-500" />
                          <span>{model.name}</span>
                        </Link>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{model.filename}</div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          v{model.version}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-slate-200 font-semibold">
                        {formatBytes(model.size_bytes)}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-1.5 text-slate-400">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-[11px]" title={model.checksum}>
                            {truncateHash(model.checksum, 8)}
                          </span>
                          <button
                            onClick={() => handleCopyHash(model.checksum)}
                            className="p-1 hover:text-slate-200 transition"
                            title="Copy SHA-256"
                          >
                            {copiedHash === model.checksum ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3 text-slate-500 hover:text-slate-300" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                          isFullyReplicated
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          {replicaCount} / {model.replication_factor || 3}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-slate-400 text-[11px] font-sans">
                        {formatDate(model.created_at)}
                      </td>

                      <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                        {/* Details */}
                        <Link
                          to={`/models/${model.id}`}
                          className="inline-flex items-center p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                          title="View Details & Replicas"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>

                        {/* Download Stream */}
                        <a
                          href={api.getDownloadUrl(model.id)}
                          download={model.filename}
                          className="inline-flex items-center p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition"
                          title="Stream Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(model.id, model.name)}
                          className="inline-flex items-center p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition"
                          title="Delete Model & Replicas"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
