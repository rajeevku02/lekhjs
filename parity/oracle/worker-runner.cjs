'use strict';

// One engine in a worker thread, for the comparison runners: requests with a per-board timeout
// (60 s, verification 02 §A.3 `timeout`), the worker replaced every `recycleEvery` boards, after an
// abort and after a timeout (verification 01 §5 rule 2), and its stdout/stderr (kashi's logger)
// kept out of the report, in a log file when one is given.

const { Worker } = require('node:worker_threads');

class WorkerRunner {
  /**
   * @param {string} file  the worker script
   * @param {object} data  its workerData
   * @param {{ recycleEvery?: number, timeoutMs?: number, log?: NodeJS.WritableStream | null, resourceLimits?: object }} [opts]
   */
  constructor(file, data, opts = {}) {
    this.file = file;
    this.data = data;
    this.recycleEvery = opts.recycleEvery ?? 50;
    this.timeoutMs = opts.timeoutMs ?? 60000;
    this.log = opts.log ?? null;
    this.resourceLimits = opts.resourceLimits;
    /** @type {import('node:worker_threads').Worker | null} */
    this.worker = null;
    /** @type {Promise<any> | null} */
    this.ready = null;
    this.served = 0;
    this.nextId = 1;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    this.instances = 0;
    /** @type {any} */
    this.initValue = null;
  }

  spawn() {
    const w = new Worker(this.file, {
      workerData: this.data,
      stdout: true,
      stderr: true,
      ...(this.resourceLimits ? { resourceLimits: this.resourceLimits } : {}),
    });
    for (const s of [w.stdout, w.stderr]) {
      s.on('data', (chunk) => {
        if (this.log) this.log.write(chunk);
      });
    }
    w.on('message', (m) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.value);
    });
    const failAll = (/** @type {string} */ why) => {
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(Object.assign(new Error(why), { workerExit: true }));
        this.pending.delete(id);
      }
      if (this.worker === w) {
        this.worker = null;
        this.ready = null;
      }
    };
    w.on('error', (e) => failAll('worker error: ' + String((e && e.message) || e)));
    w.on('exit', (code) => failAll('worker exited with code ' + code));
    this.worker = w;
    this.served = 0;
    this.instances++;
    this.ready = this.request({ op: 'init' }, 120000).then((v) => {
      this.initValue = v;
      return v;
    });
    return this.ready;
  }

  /** @param {Record<string, unknown>} msg @param {number} timeoutMs @returns {Promise<any>} */
  request(msg, timeoutMs) {
    const w = this.worker;
    if (w === null) return Promise.reject(Object.assign(new Error('no worker'), { workerExit: true }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('timeout'), { timeout: true }));
        this.recycle();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      w.postMessage({ ...msg, id });
    });
  }

  async init() {
    if (this.worker === null) await this.spawn();
    else await this.ready;
    return this.initValue;
  }

  /** One board. Rejects with `.timeout` / `.workerExit` set when the worker did not answer. */
  /** @param {Record<string, unknown>} msg @returns {Promise<any>} */
  async call(msg) {
    if (this.worker === null || this.served >= this.recycleEvery) {
      await this.recycle();
      await this.spawn();
    } else {
      await this.ready;
    }
    this.served++;
    return this.request(msg, this.timeoutMs);
  }

  async recycle() {
    const w = this.worker;
    this.worker = null;
    this.ready = null;
    if (w) await w.terminate();
  }

  close() {
    return this.recycle();
  }
}

module.exports = { WorkerRunner };
