import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UploadCloud, File, Layers, CheckCircle2, AlertCircle, ArrowRight, Activity, Terminal, ShieldCheck, RefreshCw } from 'lucide-react';
import { api, formatBytes } from '../services/api';

export default function UploadModel() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [replicationFactor, setReplicationFactor] = useState(3);
  
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [uploadedModel, setUploadedModel] = useState(null);

  const addLog = (msg) => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      if (!name) {
        // Pre-fill model name from filename
        const baseName = selected.name.replace(/\.[^/.]+$/, "");
        setName(baseName);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a model file to upload.');
      return;
    }
    if (!name.trim()) {
      setError('Please provide a name for the model.');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError(null);
    setLogs([]);
    setUploadedModel(null);

    addLog(`Initiating distributed upload for "${name}" (${formatBytes(file.size)})...`);
    addLog(`Configured Replication Factor: ${replicationFactor}`);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name.trim());
      formData.append('version', version.trim());
      formData.append('description', description.trim());
      formData.append('replicationFactor', replicationFactor);

      addLog(`Streaming chunks to Coordinator Server via HTTP stream...`);

      const res = await api.uploadModel(formData, (percent) => {
        setProgress(percent);
        if (percent === 100) {
          addLog(`All chunks transmitted to Coordinator. Coordinator streaming to Primary Node via gRPC...`);
        }
      });

      if (res.success) {
        addLog(`Primary storage node successfully stored model chunks.`);
        addLog(`SHA-256 Checksum verified: ${res.data.checksum}`);
        addLog(`PostgreSQL metadata updated with model and primary replica records.`);
        addLog(`NATS event MODEL_UPLOADED published.`);
        addLog(`P2P gRPC replication triggered to replica storage nodes: [${res.data.replicaNodes.join(', ')}]`);
        addLog(`Distributed upload completed successfully!`);

        setUploadedModel(res.data.model);
      } else {
        throw new Error(res.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Upload error:', err);
      const errMsg = err.response?.data?.error || err.message;
      setError(errMsg);
      addLog(`ERROR: ${errMsg}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
          <UploadCloud className="w-6 h-6 text-emerald-400" />
          Upload Model / LLM Weights
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Stream model chunks to primary storage node with automatic P2P gRPC replication
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Form Column */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSubmit} className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
            {/* File Dropzone */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Model / Weight File
              </label>
              <div className="relative border-2 border-dashed border-slate-700 hover:border-emerald-500/60 rounded-2xl p-6 text-center transition cursor-pointer bg-slate-950/40">
                <input
                  type="file"
                  onChange={handleFileChange}
                  disabled={uploading}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <File className="w-6 h-6" />
                  </div>
                  {file ? (
                    <div>
                      <span className="font-semibold text-sm text-slate-200 block">{file.name}</span>
                      <span className="text-xs text-emerald-400 font-mono mt-0.5">{formatBytes(file.size)}</span>
                    </div>
                  ) : (
                    <div>
                      <span className="text-sm font-medium text-slate-300 block">
                        Drop model file here or click to browse
                      </span>
                      <span className="text-xs text-slate-500">
                        Supports .bin, .gguf, .safetensors, .pt, or any test file
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Model Name & Version */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Model Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. TinyLlama-1.1B-Chat"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={uploading}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Version
                </label>
                <input
                  type="text"
                  placeholder="1.0.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  disabled={uploading}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition font-mono"
                />
              </div>
            </div>

            {/* Replication Factor */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Replication Factor (Copies)
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((factor) => (
                  <button
                    key={factor}
                    type="button"
                    onClick={() => setReplicationFactor(factor)}
                    disabled={uploading}
                    className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition flex items-center justify-center space-x-2 ${
                      replicationFactor === factor
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{factor} {factor === 1 ? 'Node (No Rep)' : `Nodes (${factor}x)`}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Description (Optional)
              </label>
              <textarea
                rows="2"
                placeholder="Model architecture notes, quantization info, or test metadata..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={uploading}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition font-sans"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={uploading || !file}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Streaming & Replicating ({progress}%)...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Start Distributed Upload</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Progress & Live Logs Column */}
        <div className="lg:col-span-5 space-y-6">
          {/* Progress Card */}
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-400" />
                Upload Progress
              </span>
              <span className="font-mono text-emerald-400">{progress}%</span>
            </h3>

            <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>

            {uploadedModel && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-2">
                <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Model successfully uploaded & replicated!</span>
                </div>
                <div className="font-mono text-[11px] text-slate-300">
                  ID: {uploadedModel.id}
                </div>
                <Link
                  to={`/models/${uploadedModel.id}`}
                  className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium pt-1"
                >
                  View Model Details <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>

          {/* Live Distributed Log Console */}
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-indigo-400" />
              Distributed Execution Console
            </h3>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 h-64 overflow-y-auto space-y-1.5">
              {logs.length === 0 ? (
                <div className="text-slate-600 text-center py-12">
                  Console will display streaming upload steps, gRPC traces, and P2P replication events.
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex space-x-2">
                    <span className="text-slate-500">[{log.time}]</span>
                    <span className={log.msg.startsWith('ERROR') ? 'text-rose-400' : 'text-slate-300'}>
                      {log.msg}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
