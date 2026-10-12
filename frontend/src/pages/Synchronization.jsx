import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock, Crown, Vote, Lock, Camera, Radio, RefreshCw, ShieldCheck, ShieldAlert, GitCompare, Timer,
} from 'lucide-react';
import { api, formatBytes } from '../services/api';

const CATEGORIES = {
  election: ['ELECTION', 'ANSWER', 'COORDINATOR', 'ELECTION_START', 'LEADER_ELECTED'],
  clock: ['TIME_REQUEST', 'TIME_REPLY', 'CLOCK_ADJUST', 'CLOCK_ADJUSTED', 'CLOCK_SKEW_INJECTED'],
  mutex: ['MUTEX_REQUEST', 'MUTEX_REPLY', 'MUTEX_DEFER', 'MUTEX_ENTER', 'MUTEX_EXIT', 'MUTEX_PEER_FAILED', 'SCRUB_DONE'],
  snapshot: ['SNAPSHOT_RECORDED'],
  membership: ['PEER_UP', 'PEER_DOWN'],
};

const KIND_STYLE = {
  SEND: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  RECV: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  INTERNAL: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
};

const MUTEX_STYLE = {
  HELD: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  WANTED: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  RELEASED: 'text-slate-400 bg-slate-800 border-slate-700',
};

const MEMBER_STYLE = {
  ALIVE: 'text-emerald-400',
  SUSPECT: 'text-amber-400',
  DEAD: 'text-rose-400',
};

const RELATION_TEXT = {
  before: 'A → B : A happened-before B (causally related)',
  after: 'B → A : B happened-before A (causally related)',
  concurrent: 'A ∥ B : concurrent, neither could have influenced the other',
  equal: 'A = B : same vector timestamp',
};

function formatVector(v = {}) {
  return Object.entries(v)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, n]) => `${id.replace('node-', 'n')}:${n}`)
    .join(' ');
}

function compareVectors(a = {}, b = {}) {
  let aLess = false;
  let bLess = false;
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[id] || 0) < (b[id] || 0)) aLess = true;
    if ((b[id] || 0) < (a[id] || 0)) bLess = true;
  }
  if (aLess && !bLess) return 'before';
  if (bLess && !aLess) return 'after';
  if (!aLess && !bLess) return 'equal';
  return 'concurrent';
}

function formatClock(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.toLocaleTimeString('en-GB', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function signedMs(ms) {
  if (ms === undefined || ms === null) return '-';
  return `${ms >= 0 ? '+' : ''}${Math.round(ms)} ms`;
}

function Panel({ icon: Icon, title, subtitle, children, actions }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 shadow-xl">
      <div className="px-6 py-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Icon className="w-4 h-4 text-emerald-400" />
            {title}
          </h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function ActionButton({ onClick, icon: Icon, children, tone = 'emerald' }) {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20',
    slate: 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white',
  };
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition flex items-center gap-1.5 ${tones[tone]}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}

export default function Synchronization() {
  const [status, setStatus] = useState(null);
  const [trace, setTrace] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [message, setMessage] = useState(null);
  const [sortBy, setSortBy] = useState('lamport');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [s, t, r, snaps] = await Promise.all([
        api.getSyncStatus(),
        api.getSyncTrace(300),
        api.getClockRounds(),
        api.getSnapshots(),
      ]);
      setStatus(s);
      setTrace(t || []);
      setRounds(r || []);
      setSnapshots(snaps || []);
    } catch (err) {
      console.error('Failed to load synchronization state:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  const run = async (fn, label) => {
    try {
      const res = await fn();
      setMessage({ ok: true, text: res.message || label });
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || err.message });
    }
    setTimeout(fetchData, 400);
  };

  const nodes = status?.nodes || [];

  const visibleTrace = useMemo(() => {
    const filtered = category === 'all' ? trace : trace.filter((e) => CATEGORIES[category].includes(e.type));
    const sorted = [...filtered].sort((a, b) => (sortBy === 'lamport'
      ? a.lamport - b.lamport || a.node.localeCompare(b.node, undefined, { numeric: true })
      : a.physicalTime - b.physicalTime));
    return sorted.slice(-150).reverse();
  }, [trace, category, sortBy]);

  const toggleSelect = (seq) => {
    setSelected((prev) => (prev.includes(seq) ? prev.filter((s) => s !== seq) : [...prev, seq].slice(-2)));
  };
  const [selA, selB] = selected.map((seq) => trace.find((e) => e.seq === seq)).filter(Boolean);

  const latestSnapshot = snapshots[0];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <Clock className="w-6 h-6 text-emerald-400" />
            Synchronization
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Clock sync, logical clocks, leader election, mutual exclusion, and global state across the storage nodes
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white font-medium text-sm transition flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          Refresh
        </button>
      </div>

      {message && (
        <div className={`px-4 py-2.5 rounded-xl border text-sm ${message.ok
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}
        >
          {message.text}
        </div>
      )}

      {/* Summary */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-indigo-950/40 border border-emerald-500/20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="space-y-1">
          <div className="text-xs uppercase font-semibold text-emerald-400">Leader (Bully)</div>
          <div className="text-2xl font-bold text-slate-100 font-mono flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-400" />
            {status?.leader || 'none'}
          </div>
          <div className="text-xs text-slate-400">Agreed by {status?.leaderAgreement || '0/0'} live nodes</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase font-semibold text-indigo-400">Clock Spread</div>
          <div className="text-2xl font-bold text-slate-100 font-mono">{Math.round(status?.maxClockSpreadMs || 0)} ms</div>
          <div className="text-xs text-slate-400">Max difference between node clocks</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase font-semibold text-rose-400">Critical Section</div>
          <div className="text-2xl font-bold text-slate-100 font-mono">
            {status?.mutex?.holders?.length ? status.mutex.holders.join(', ') : 'free'}
          </div>
          <div className={`text-xs flex items-center gap-1 ${status?.mutex?.safe === false ? 'text-rose-400' : 'text-slate-400'}`}>
            {status?.mutex?.safe === false
              ? <><ShieldAlert className="w-3.5 h-3.5" /> SAFETY VIOLATED</>
              : <><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> At most one holder</>}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase font-semibold text-amber-400">Reporting Nodes</div>
          <div className="text-2xl font-bold text-slate-100 font-mono">
            {nodes.filter((n) => n.reachable).length} / {nodes.length}
          </div>
          <div className="text-xs text-slate-400">Status received in the last 7 s</div>
        </div>
      </div>

      {/* Nodes */}
      <Panel
        icon={Radio}
        title="Node Clocks & Membership"
        subtitle="Physical clock vs the coordinator, Lamport and vector clocks, and each node's own beacon-based view of its peers"
        actions={(
          <>
            <ActionButton icon={Vote} onClick={() => run(() => api.startElection(nodes[0]?.nodeId), 'Election started')}>
              Election from {nodes[0]?.nodeId || 'lowest node'}
            </ActionButton>
            <ActionButton icon={Timer} onClick={() => run(api.runClockSync, 'Clock sync requested')}>
              Run Berkeley sync
            </ActionButton>
          </>
        )}
      >
        {nodes.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-8">
            No storage node is reporting yet. The sync layer needs NATS: run it with docker compose or on AWS.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {nodes.map((n) => (
              <div
                key={n.nodeId}
                className={`rounded-xl border p-4 space-y-3 text-xs ${n.reachable
                  ? (n.nodeId === status?.leader ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60')
                  : 'border-rose-500/30 bg-rose-500/5 opacity-70'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-100 font-mono">{n.nodeId}</span>
                  <span className="flex gap-1.5">
                    {n.nodeId === status?.leader && (
                      <span className="px-2 py-0.5 rounded-full border text-[10px] font-semibold text-amber-300 bg-amber-500/10 border-amber-500/30 flex items-center gap-1">
                        <Crown className="w-3 h-3" /> LEADER
                      </span>
                    )}
                    {n.electing && (
                      <span className="px-2 py-0.5 rounded-full border text-[10px] font-semibold text-sky-300 bg-sky-500/10 border-sky-500/30">ELECTING</span>
                    )}
                    {!n.reachable && (
                      <span className="px-2 py-0.5 rounded-full border text-[10px] font-semibold text-rose-300 bg-rose-500/10 border-rose-500/30">
                        SILENT {Math.round(n.statusAgeMs / 1000)}s
                      </span>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono">
                  <span className="text-slate-500">Clock</span>
                  <span className="text-slate-200 text-right">{formatClock(n.clockTime)}</span>
                  <span className="text-slate-500">vs coordinator</span>
                  <span className={`text-right ${Math.abs(n.skewVsCoordinatorMs) > 500 ? 'text-rose-300' : 'text-emerald-300'}`}>
                    {signedMs(n.skewVsCoordinatorMs)}
                  </span>
                  <span className="text-slate-500">Last adjust</span>
                  <span className="text-slate-300 text-right">
                    {n.lastAdjustment ? `${signedMs(n.lastAdjustment.adjustMs)} (r${n.lastAdjustment.round})` : '-'}
                  </span>
                  <span className="text-slate-500">Lamport</span>
                  <span className="text-slate-100 text-right font-semibold">{n.lamport}</span>
                  <span className="text-slate-500">Vector</span>
                  <span className="text-slate-100 text-right">[{formatVector(n.vector)}]</span>
                  <span className="text-slate-500">Mutex</span>
                  <span className="text-right">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${MUTEX_STYLE[n.mutex?.state] || ''}`}>
                      {n.mutex?.state}{n.mutex?.requestTs ? ` L=${n.mutex.requestTs}` : ''}
                    </span>
                  </span>
                  <span className="text-slate-500">Beacon seq</span>
                  <span className="text-slate-300 text-right">#{n.beaconSeq}</span>
                </div>

                <div className="border-t border-slate-800 pt-2 space-y-1 font-mono">
                  <div className="text-[10px] uppercase text-slate-500">Peers seen by {n.nodeId}</div>
                  {(n.membership || []).map((p) => (
                    <div key={p.id} className="flex justify-between">
                      <span className="text-slate-400">{p.id}</span>
                      <span className={MEMBER_STYLE[p.status]}>{p.status} · #{p.lastSeq}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <ActionButton tone="amber" onClick={() => run(() => api.injectSkew(n.nodeId, 5000), 'Skew injected')}>+5 s skew</ActionButton>
                  <ActionButton tone="amber" onClick={() => run(() => api.injectSkew(n.nodeId, -3000), 'Skew injected')}>-3 s skew</ActionButton>
                  <ActionButton tone="slate" onClick={() => run(() => api.startElection(n.nodeId), 'Election started')}>Elect from here</ActionButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Berkeley */}
      <Panel
        icon={Timer}
        title="Berkeley Clock Synchronization"
        subtitle="The leader polls every clock, estimates each one as reading + RTT/2 (Cristian), averages them, and sends each node its correction. Runs every 30 s."
      >
        {rounds.length === 0 ? (
          <div className="text-sm text-slate-500">No rounds yet. Inject skew on a node, then run Berkeley sync.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono text-slate-300">
              <thead className="text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-4">Round</th>
                  <th className="py-2 pr-4">Leader</th>
                  <th className="py-2 pr-4">Measured offsets (RTT)</th>
                  <th className="py-2 pr-4">Average</th>
                  <th className="py-2">Corrections sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rounds.slice(0, 6).map((r) => (
                  <tr key={`${r.leader}-${r.round}`}>
                    <td className="py-2 pr-4">#{r.round}</td>
                    <td className="py-2 pr-4 text-amber-300">{r.leader}</td>
                    <td className="py-2 pr-4">
                      {Object.entries(r.samples).map(([id, s]) => (
                        <div key={id}>{id}: {signedMs(s.offsetMs)} <span className="text-slate-500">({s.rttMs} ms)</span></div>
                      ))}
                    </td>
                    <td className="py-2 pr-4">{signedMs(r.averageOffsetMs)}</td>
                    <td className="py-2">
                      {Object.entries(r.adjustments).map(([id, a]) => <div key={id}>{id}: {signedMs(a)}</div>)}
                      {r.excluded?.length > 0 && <div className="text-rose-300">excluded: {r.excluded.join(', ')}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Mutual exclusion + snapshot */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel
          icon={Lock}
          title="Ricart-Agrawala Mutual Exclusion"
          subtitle="Critical section = integrity scrub (re-hash every stored file). Requests are granted in Lamport (timestamp, node) order."
          actions={<ActionButton icon={Lock} onClick={() => run(() => api.requestMutex(), 'Requested')}>All nodes request now</ActionButton>}
        >
          <div className="space-y-1.5 text-xs font-mono max-h-80 overflow-y-auto">
            {trace
              .filter((e) => e.type.startsWith('MUTEX') || e.type === 'SCRUB_DONE')
              .filter((e) => e.kind !== 'RECV')
              .sort((a, b) => a.lamport - b.lamport || a.node.localeCompare(b.node, undefined, { numeric: true }))
              .slice(-30)
              .map((e) => (
                <div key={e.seq} className="flex gap-3">
                  <span className="text-slate-500 w-12 text-right">L={e.lamport}</span>
                  <span className="text-slate-200 w-14">{e.node}</span>
                  <span className={e.type === 'MUTEX_ENTER' ? 'text-rose-300' : e.type === 'MUTEX_DEFER' ? 'text-amber-300' : 'text-slate-300'}>
                    {e.type}{e.peer ? ` → ${e.peer}` : ''}
                  </span>
                  <span className="text-slate-500 truncate">{e.detail}</span>
                </div>
              ))}
            {!trace.some((e) => e.type.startsWith('MUTEX')) && (
              <div className="text-slate-500 font-sans">No requests yet.</div>
            )}
          </div>
        </Panel>

        <Panel
          icon={Camera}
          title="Chandy-Lamport Global Snapshot"
          subtitle="Each node records its state on its first MARKER, then records incoming channels until markers arrive on all of them"
          actions={<ActionButton icon={Camera} onClick={() => run(() => api.takeSnapshot(), 'Snapshot started')}>Take snapshot</ActionButton>}
        >
          {!latestSnapshot ? (
            <div className="text-sm text-slate-500">No snapshot taken yet.</div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <span className="text-slate-400">#{latestSnapshot.snapshotId} · initiator {latestSnapshot.initiator}</span>
                {!latestSnapshot.complete && <span className="text-amber-300">collecting…</span>}
                {latestSnapshot.consistency && (
                  <span className={`px-2 py-0.5 rounded-full border font-semibold ${latestSnapshot.consistency.consistent
                    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                    : 'text-rose-300 bg-rose-500/10 border-rose-500/30'}`}
                  >
                    {latestSnapshot.consistency.consistent ? 'CONSISTENT CUT' : 'INCONSISTENT'} ·{' '}
                    {latestSnapshot.consistency.inFlightMessages} in-flight msg
                  </span>
                )}
              </div>
              <table className="w-full text-left font-mono text-slate-300">
                <thead className="text-slate-400 uppercase border-b border-slate-800">
                  <tr>
                    <th className="py-1.5 pr-2">Node</th>
                    <th className="py-1.5 pr-2">Vector at cut</th>
                    <th className="py-1.5 pr-2">State</th>
                    <th className="py-1.5">Channel states</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {latestSnapshot.parts.map((p) => (
                    <tr key={p.nodeId}>
                      <td className="py-1.5 pr-2 text-slate-100">{p.nodeId}</td>
                      <td className="py-1.5 pr-2">[{formatVector(p.local.vector)}]</td>
                      <td className="py-1.5 pr-2">
                        {p.local.storedModelsCount} models · {formatBytes(p.local.usedStorageBytes)}
                        <div className="text-slate-500">leader {p.local.leader} · mutex {p.local.mutexState}</div>
                      </td>
                      <td className="py-1.5">
                        {Object.entries(p.channels).map(([from, msgs]) => (
                          <div key={from}>
                            {from}→{p.nodeId}: {msgs.length ? msgs.map((m) => m.type).join(', ') : 'empty'}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* Trace */}
      <Panel
        icon={GitCompare}
        title="Event Trace: Lamport & Vector Clocks"
        subtitle="Select two events to test happened-before using their vector timestamps. Sorting by physical time can contradict causality when clocks are skewed; Lamport order never does."
        actions={(
          <>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300"
            >
              <option value="all">All events</option>
              {Object.keys(CATEGORIES).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <ActionButton tone={sortBy === 'lamport' ? 'emerald' : 'slate'} onClick={() => setSortBy('lamport')}>Lamport order</ActionButton>
            <ActionButton tone={sortBy === 'physical' ? 'emerald' : 'slate'} onClick={() => setSortBy('physical')}>Physical-time order</ActionButton>
          </>
        )}
      >
        {selA && selB && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-xs font-mono text-indigo-200 space-y-1">
            <div>A = {selA.node} {selA.kind} {selA.type} [{formatVector(selA.vector)}]</div>
            <div>B = {selB.node} {selB.kind} {selB.type} [{formatVector(selB.vector)}]</div>
            <div className="font-semibold text-indigo-100">{RELATION_TEXT[compareVectors(selA.vector, selB.vector)]}</div>
          </div>
        )}
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-left text-xs font-mono text-slate-300">
            <thead className="text-slate-400 uppercase border-b border-slate-800 sticky top-0 bg-slate-900">
              <tr>
                <th className="py-2 pr-3" />
                <th className="py-2 pr-3">Lamport</th>
                <th className="py-2 pr-3">Vector</th>
                <th className="py-2 pr-3">Node clock</th>
                <th className="py-2 pr-3">Node</th>
                <th className="py-2 pr-3">Event</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {visibleTrace.map((e) => {
                const idx = selected.indexOf(e.seq);
                return (
                  <tr
                    key={e.seq}
                    onClick={() => toggleSelect(e.seq)}
                    className={`cursor-pointer ${idx >= 0 ? 'bg-indigo-500/15' : 'hover:bg-slate-800/40'}`}
                  >
                    <td className="py-1.5 pr-3 text-indigo-300 font-bold w-4">{idx === 0 ? 'A' : idx === 1 ? 'B' : ''}</td>
                    <td className="py-1.5 pr-3 text-slate-100 font-semibold">{e.lamport}</td>
                    <td className="py-1.5 pr-3">[{formatVector(e.vector)}]</td>
                    <td className="py-1.5 pr-3 text-slate-400">{formatClock(e.physicalTime)}</td>
                    <td className="py-1.5 pr-3 text-slate-100">{e.node}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] mr-1.5 ${KIND_STYLE[e.kind]}`}>{e.kind}</span>
                      {e.type}
                      {e.peer && <span className="text-slate-500"> {e.kind === 'RECV' ? '←' : '→'} {e.peer === '*' ? 'all' : e.peer}</span>}
                    </td>
                    <td className="py-1.5 text-slate-500">{e.detail}</td>
                  </tr>
                );
              })}
              {visibleTrace.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-500 font-sans">No events yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
