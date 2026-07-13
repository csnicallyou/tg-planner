// Storage abstraction. Adapters share one async key-value interface,
// so swapping CloudStorage for Supabase later means adding one class.

const tg = window.Telegram?.WebApp;

class CloudAdapter {
  constructor() { this.cs = tg.CloudStorage; }
  getItem(key) {
    return new Promise((res, rej) => this.cs.getItem(key, (e, v) => e ? rej(e) : res(v || null)));
  }
  getItems(keys) {
    if (!keys.length) return Promise.resolve({});
    return new Promise((res, rej) => this.cs.getItems(keys, (e, v) => e ? rej(e) : res(v || {})));
  }
  setItem(key, value) {
    return new Promise((res, rej) => this.cs.setItem(key, value, (e, ok) => e ? rej(e) : res(ok)));
  }
  removeItems(keys) {
    if (!keys.length) return Promise.resolve(true);
    return new Promise((res, rej) => this.cs.removeItems(keys, (e, ok) => e ? rej(e) : res(ok)));
  }
}

class LocalAdapter {
  async getItem(key) { return localStorage.getItem(key); }
  async getItems(keys) {
    const out = {};
    for (const k of keys) { const v = localStorage.getItem(k); if (v !== null) out[k] = v; }
    return out;
  }
  async setItem(key, value) { localStorage.setItem(key, value); return true; }
  async removeItems(keys) { keys.forEach(k => localStorage.removeItem(k)); return true; }
}

export let cloudAvailable = !!(tg && tg.initData && tg.CloudStorage && tg.isVersionAtLeast?.('6.9'));
let adapter = cloudAvailable ? new CloudAdapter() : new LocalAdapter();

// CloudStorage callbacks can hang on some clients; never let that freeze the app.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('storage timeout')), ms)),
  ]);
}
function demoteToLocal(reason) {
  if (!(adapter instanceof LocalAdapter)) {
    console.warn('cloud storage unavailable, falling back to localStorage:', reason);
    adapter = new LocalAdapter();
    cloudAvailable = false;
  }
}

// CloudStorage limits: 4096 chars per value, 1024 keys.
// Collections are stored as JSON split into chunks: m:<name> = count, c:<name>:<i> = chunk.
const CHUNK = 3500;
const chunkCounts = {};

export async function loadCollection(name, fallback) {
  try {
    const meta = await withTimeout(adapter.getItem(`m:${name}`), 4000);
    if (!meta) return fallback;
    const n = parseInt(meta, 10);
    chunkCounts[name] = n;
    const keys = Array.from({ length: n }, (_, i) => `c:${name}:${i}`);
    const parts = await withTimeout(adapter.getItems(keys), 4000);
    const json = keys.map(k => parts[k] || '').join('');
    return json ? JSON.parse(json) : fallback;
  } catch (e) {
    console.error(`load ${name} failed`, e);
    if (String(e?.message).includes('timeout')) {
      demoteToLocal(e.message);
      return loadCollection(name, fallback); // retry once against localStorage
    }
    return fallback;
  }
}

export async function saveCollection(name, data) {
  const json = JSON.stringify(data);
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
  if (!chunks.length) chunks.push('');
  for (let i = 0; i < chunks.length; i++) await adapter.setItem(`c:${name}:${i}`, chunks[i]);
  await adapter.setItem(`m:${name}`, String(chunks.length));
  const old = chunkCounts[name] || 0;
  if (old > chunks.length) {
    const stale = [];
    for (let i = chunks.length; i < old; i++) stale.push(`c:${name}:${i}`);
    await adapter.removeItems(stale);
  }
  chunkCounts[name] = chunks.length;
}

// Debounced save queue: frequent UI toggles collapse into one write.
const pending = {};
export function queueSave(name, getData) {
  if (pending[name]) clearTimeout(pending[name].timer);
  pending[name] = {
    getData,
    timer: setTimeout(() => {
      delete pending[name];
      saveCollection(name, getData()).catch(e => console.error(`save ${name} failed`, e));
    }, 500),
  };
}

// On page hide: fire pending writes immediately instead of losing them.
export function flushSaves() {
  for (const name of Object.keys(pending)) {
    clearTimeout(pending[name].timer);
    const { getData } = pending[name];
    delete pending[name];
    saveCollection(name, getData()).catch(e => console.error(`flush ${name} failed`, e));
  }
}
