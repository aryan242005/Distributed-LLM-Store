/**
 * Clocks used by the synchronization layer (Unit 3).
 *
 * - PhysicalClock: this node's wall clock. Real EC2 clocks are NTP-disciplined to
 *   within milliseconds, so skew/drift can be injected to make clock synchronization
 *   observable; the Berkeley algorithm then corrects it via adjust().
 * - LamportClock: scalar logical clock (happened-before => smaller timestamp).
 * - VectorClock: one counter per process; captures causality exactly, so it can tell
 *   "a happened before b" apart from "a and b are concurrent".
 */

class PhysicalClock {
  constructor({ skewMs = 0, driftPpm = 0 } = {}) {
    this.offsetMs = skewMs;
    this.driftPpm = driftPpm;
    this.startedAt = Date.now();
  }

  now() {
    const real = Date.now();
    const drift = ((real - this.startedAt) * this.driftPpm) / 1e6;
    return Math.round(real + this.offsetMs + drift);
  }

  // Used both for injecting skew and for applying a Berkeley correction
  adjust(deltaMs) {
    this.offsetMs += deltaMs;
  }

  // How far this clock is from the host's real clock (for display)
  errorMs() {
    return this.now() - Date.now();
  }
}

class LamportClock {
  constructor() {
    this.time = 0;
  }

  // Local or send event
  tick() {
    this.time += 1;
    return this.time;
  }

  // Receive event: L = max(L, L_msg) + 1
  receive(remoteTime) {
    this.time = Math.max(this.time, remoteTime || 0) + 1;
    return this.time;
  }
}

class VectorClock {
  constructor(selfId) {
    this.selfId = selfId;
    this.v = { [selfId]: 0 };
  }

  tick() {
    this.v[this.selfId] = (this.v[this.selfId] || 0) + 1;
    return this.snapshot();
  }

  // Receive event: V = max(V, V_msg) element-wise, then V[self] += 1
  receive(remote = {}) {
    for (const [id, count] of Object.entries(remote)) {
      this.v[id] = Math.max(this.v[id] || 0, count);
    }
    return this.tick();
  }

  snapshot() {
    return { ...this.v };
  }

  /**
   * Compares two vector timestamps.
   * Returns 'before' (a -> b), 'after' (b -> a), 'equal', or 'concurrent' (a || b).
   */
  static compare(a = {}, b = {}) {
    let aLess = false;
    let bLess = false;
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[id] || 0;
      const y = b[id] || 0;
      if (x < y) aLess = true;
      if (y < x) bLess = true;
    }
    if (aLess && !bLess) return 'before';
    if (bLess && !aLess) return 'after';
    if (!aLess && !bLess) return 'equal';
    return 'concurrent';
  }
}

// Total order on process ids ("node-2" < "node-10"), used for Bully ranks and
// Lamport tie-breaking
function compareIds(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// Lamport total order: (timestamp, processId)
function lamportLess(tsA, idA, tsB, idB) {
  return tsA < tsB || (tsA === tsB && compareIds(idA, idB) < 0);
}

module.exports = { PhysicalClock, LamportClock, VectorClock, compareIds, lamportLess };
