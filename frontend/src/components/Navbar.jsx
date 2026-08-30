import React, { useState, useEffect } from 'react';
import { Layers, Activity, RefreshCw, Database, Server } from 'lucide-react';
import { api } from '../services/api';

export default function Navbar({ onRefresh }) {
  const [health, setHealth] = useState({ status: 'CHECKING', natsConnected: false });
  const [loading, setLoading] = useState(false);

  const checkHealth = async () => {
    try {
      setLoading(true);
      const res = await api.getHealth();
      setHealth(res);
    } catch (err) {
      setHealth({ status: 'OFFLINE', natsConnected: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Brand */}
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-slate-100 tracking-tight flex items-center gap-2">
            Distributed Model Repository
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              v1.0
            </span>
          </h1>
          <p className="text-xs text-slate-400">LLM Weight Storage & P2P Replication</p>
        </div>
      </div>

      {/* Right Controls & Health */}
      <div className="flex items-center space-x-4">
        {/* NATS status */}
        <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 text-xs">
          <Activity className={`w-3.5 h-3.5 ${health.natsConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className="text-slate-300">NATS Event Bus:</span>
          <span className={`font-semibold ${health.natsConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
            {health.natsConnected ? 'ONLINE' : 'FALLBACK'}
          </span>
        </div>

        {/* Coordinator status */}
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 text-xs">
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              health.status === 'HEALTHY' ? 'bg-emerald-400' : 'bg-rose-400'
            }`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${
              health.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-rose-500'
            }`}></span>
          </span>
          <span className="text-slate-300">Coordinator:</span>
          <span className={`font-semibold ${health.status === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {health.status}
          </span>
        </div>

        {/* Refresh button */}
        <button
          onClick={() => {
            checkHealth();
            if (onRefresh) onRefresh();
          }}
          disabled={loading}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition disabled:opacity-50"
          title="Refresh cluster state"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      </div>
    </header>
  );
}
