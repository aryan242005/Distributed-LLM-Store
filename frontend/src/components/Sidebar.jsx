import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Box,
  UploadCloud,
  HardDrive,
  Copy,
  Terminal,
  Activity,
  Cpu,
  Clock
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Models', path: '/models', icon: Box },
  { name: 'Upload Model', path: '/upload', icon: UploadCloud },
  { name: 'Storage Nodes', path: '/nodes', icon: HardDrive },
  { name: 'Replication', path: '/replication', icon: Copy },
  { name: 'Requests & Logs', path: '/requests', icon: Terminal },
  { name: 'Synchronization', path: '/sync', icon: Clock },
];

export default function Sidebar() {
  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col justify-between shrink-0 min-h-[calc(100vh-4rem)]">
      <div className="p-4 space-y-6">
        <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase px-3">
          Cluster Navigation
        </div>

        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Cluster Node Summary Footer */}
      <div className="p-4 m-3 rounded-xl bg-slate-900/80 border border-slate-800/80 text-xs text-slate-400 space-y-2">
        <div className="flex items-center justify-between text-slate-300 font-medium">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            Cluster Nodes
          </span>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
            3 Online
          </span>
        </div>
        <div className="space-y-1 font-mono text-[11px] text-slate-400 pt-1">
          <div className="flex justify-between">
            <span>Node 1:</span>
            <span className="text-slate-300">gRPC :5001</span>
          </div>
          <div className="flex justify-between">
            <span>Node 2:</span>
            <span className="text-slate-300">gRPC :5002</span>
          </div>
          <div className="flex justify-between">
            <span>Node 3:</span>
            <span className="text-slate-300">gRPC :5003</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
