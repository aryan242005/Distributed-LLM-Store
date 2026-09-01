/**
 * Concurrency control primitives for the coordinator.
 *
 * The coordinator is a single Node.js process handling many overlapping async
 * requests (uploads, downloads, deletes, background replication). Without
 * explicit coordination, interleaved async operations on the same shared
 * state (a model's replicas, a node's load counters) can race - e.g. two
 * concurrent uploads both reading a storage node's "least loaded" counter
 * before either write lands, causing both to pick the same node. These
 * primitives serialize access to shared keys the way a lock manager would
 * in a distributed database, scoped to a single process.
 */

// Mutual exclusion: only one runExclusive(key, fn) body executes at a time
// for a given key. Callers queue in FIFO order behind the current holder.
class Mutex {
  constructor() {
    this.tails = new Map();
  }

  runExclusive(key, fn) {
    const prevTail = this.tails.get(key) || Promise.resolve();
    const run = () => Promise.resolve().then(fn);
    const result = prevTail.then(run, run);
    // Keep the chain alive even if this call fails, so the next queued
    // caller still runs; never let a rejection poison future callers.
    this.tails.set(key, result.catch(() => {}));
    return result;
  }
}

// Readers-writer lock: any number of readers may hold the lock
// concurrently, but a writer requires exclusive access (no readers, no
// other writer). Used to let concurrent downloads of a model proceed in
// parallel while a delete or replication (which mutate model/replica
// state) get exclusive access.
class RWLock {
  constructor() {
    this.states = new Map();
  }

  _getState(key) {
    let state = this.states.get(key);
    if (!state) {
      state = { readers: 0, writing: false, queue: [] };
      this.states.set(key, state);
    }
    return state;
  }

  _cleanup(key) {
    const state = this.states.get(key);
    if (state && state.readers === 0 && !state.writing && state.queue.length === 0) {
      this.states.delete(key);
    }
  }

  _processQueue(key) {
    const state = this._getState(key);
    while (state.queue.length > 0) {
      const next = state.queue[0];
      if (next.type === 'write') {
        if (state.writing || state.readers > 0) break;
        state.queue.shift();
        state.writing = true;
        next.grant();
        break; // writer now holds exclusive access; stop granting
      } else {
        if (state.writing) break;
        state.queue.shift();
        state.readers++;
        next.grant();
        // keep looping - more readers behind this one can also be granted
      }
    }
  }

  acquireRead(key) {
    const state = this._getState(key);
    return new Promise((resolve) => {
      const release = () => {
        state.readers--;
        this._processQueue(key);
        this._cleanup(key);
      };
      if (!state.writing && state.queue.length === 0) {
        state.readers++;
        resolve(release);
      } else {
        state.queue.push({ type: 'read', grant: () => resolve(release) });
      }
    });
  }

  acquireWrite(key) {
    const state = this._getState(key);
    return new Promise((resolve) => {
      const release = () => {
        state.writing = false;
        this._processQueue(key);
        this._cleanup(key);
      };
      if (!state.writing && state.readers === 0 && state.queue.length === 0) {
        state.writing = true;
        resolve(release);
      } else {
        state.queue.push({ type: 'write', grant: () => resolve(release) });
      }
    });
  }

  async withReadLock(key, fn) {
    const release = await this.acquireRead(key);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async withWriteLock(key, fn) {
    const release = await this.acquireWrite(key);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

module.exports = {
  Mutex,
  RWLock,
  mutex: new Mutex(),
  rwLock: new RWLock(),
};
