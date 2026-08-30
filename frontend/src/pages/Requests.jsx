import React, { useState, useEffect } from 'react';
import { Terminal, Activity, ArrowRight, ArrowLeftRight, Filter, Search, RefreshCw, Layers, CheckCircle2, ShieldAlert, Clock } from 'lucide-react';
import { api, formatDate } from '../services/api';

export default function Requests() {
  const [logs, setLogs] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'grpc', 'nats'
  const [searchTerm, setSearchTerm] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = async () => {
    try {
      const [logsData, eventsData] = await Promise.all([
        api.getLogs(150),
        api.getEvents(50),
      ]);
      setLogs(logsData || []);
      setEvents(eventsData || []);
    } catch (err) {
      console.error('Failed to load communication logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    let interval = null;
    if (autoRefresh) {
      interval = setInterval(fetchData, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  // Combine and format logs and events into unified trace list
  const combinedTraces = [
    ...logs.map((l) => ({
      id: l.id,
      type: 'COMM',
      source: l.source,
      target: l.target,
      protocol: l.protocol || 'gRPC',
      operation: l.operation,
      status: l.status,
      details: l.details,
      timestamp: l.timestamp,
    })),
    ...events.map((e) => ({
      id: e.id,
      type: 'EVENT',
      source: e.source,
      target: 'NATS Bus (Broadcast)',
      protocol: 'NATS',
      operation: e.event_type,
      status: 'PUBLISHED',
      details: typeof e.payload === 'object' ? JSON.stringify(e.payload) : e.payload,
      timestamp: e.created_at,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const filteredTraces = combinedTraces.filter((trace) => {
    // Protocol Tab filter
    if (activeTab === 'grpc' && !trace.protocol.toLowerCase().includes('grpc')) return false;
    if (activeTab === 'nats' && trace.protocol !== 'NATS') return false;

    // Text search
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        trace.source?.toLowerCase().includes(s) ||
        trace.target?.toLowerCase().includes(s) ||
        trace.operation?.toLowerCase().includes(s) ||
        trace.details?.toLowerCase().includes(s)
      );
    }

    return true;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <Terminal className="w-6 h-6 text-indigo-400" />
            Distributed Communication & Trace Inspector
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Realtime visibility into inter-service RPCs, P2P replications, and asynchronous NATS events
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition flex items-center gap-2 ${
              autoRefresh
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`}></span>
            Auto-Refresh: {autoRefresh ? '3s' : 'Paused'}
          </button>

          <button
            onClick={fetchData}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition"
            title="Refresh traces"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        {/* Protocol tabs */}
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          {[
            { id: 'all', label: 'All Protocols' },
            { id: 'grpc', label: 'gRPC & P2P Stream' },
            { id: 'nats', label: 'NATS Events' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Filter operations or nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent border-none text-xs text-slate-200 focus:outline-none w-full placeholder:text-slate-500 font-sans"
          />
        </div>
      </div>

      {/* Trace Log Timeline */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono text-slate-300">
            <thead className="bg-slate-900/80 uppercase font-semibold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Protocol</th>
                <th className="px-6 py-4">Flow (Source ➔ Target)</th>
                <th className="px-6 py-4">Operation</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Details / Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredTraces.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-12 text-slate-500 font-sans">
                    No distributed operations recorded matching current filter.
                  </td>
                </tr>
              ) : (
                filteredTraces.map((trace, idx) => {
                  const isSuccess = trace.status === 'SUCCESS' || trace.status === 'PUBLISHED';
                  const isP2P = trace.protocol?.includes('P2P');

                  return (
                    <tr key={trace.id || idx} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-4 text-slate-400 text-[11px] whitespace-nowrap">
                        {formatDate(trace.timestamp)}
                      </td>

                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          trace.protocol === 'NATS'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                            : isP2P
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                            : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                        }`}>
                          {trace.protocol}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2 font-semibold">
                          <span className="text-indigo-400">{trace.source}</span>
                          <span className="text-slate-500">➔</span>
                          <span className="text-emerald-400">{trace.target}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4 font-bold text-slate-100">
                        {trace.operation}
                      </td>

                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          isSuccess
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}>
                          {trace.status}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-slate-400 text-[11px] max-w-xs truncate" title={trace.details}>
                        {trace.details || '-'}
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
