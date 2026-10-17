/**
 * HTTP + SSE client for the Obspec Bridge. Runs inside the plugin UI iframe
 * (the only place a Figma plugin can use fetch).
 */
import type { BridgeError, HashesResponse, HealthResponse, Note, NoteListItem, PatchNoteRequest, SearchResponse, SetVaultResponse, VaultEvent, VaultsResponse, WriteNoteRequest, WriteNoteResponse } from '../shared/protocol';

export class BridgeClientError extends Error {
  constructor(message: string, public code: BridgeError['code'] | 'NETWORK' | 'ABORTED', public status = 0) { super(message); }
}

export class BridgeClient {
  private es?: EventSource;
  private listeners = new Set<(ev: VaultEvent) => void>();
  private statusListeners = new Set<(online: boolean) => void>();
  private reconnectTimer?: number;
  private _online = false;

  constructor(public baseUrl: string, public token = '') {}

  get online(): boolean { return this._online; }

  configure(baseUrl: string, token: string): void {
    const changed = baseUrl !== this.baseUrl || token !== this.token;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    if (changed) this.disconnect();
    this.connect();
  }

  // ── REST ──
  health(signal?: AbortSignal): Promise<HealthResponse> { return this.req('GET', '/health', undefined, signal); }
  search(q: string, limit = 50, signal?: AbortSignal): Promise<SearchResponse> {
    return this.req('GET', `/search?q=${encodeURIComponent(q)}&limit=${limit}`, undefined, signal);
  }
  note(path: string, signal?: AbortSignal): Promise<Note> { return this.req('GET', `/note?path=${encodeURIComponent(path)}`, undefined, signal); }
  list(limit = 20): Promise<{ notes: NoteListItem[] }> { return this.req('GET', `/notes?limit=${limit}`); }
  write(body: WriteNoteRequest): Promise<WriteNoteResponse> { return this.req('PUT', '/note', body); }
  patch(body: PatchNoteRequest): Promise<WriteNoteResponse> { return this.req('PATCH', '/note', body); }

  /** Current hashes for several notes in one round trip. Missing notes map to undefined. */
  async hashes(paths: string[]): Promise<Map<string, string | undefined>> {
    const unique = [...new Set(paths)];
    if (!unique.length) return new Map();
    const qs = unique.map((p) => `path=${encodeURIComponent(p)}`).join('&');
    const r = await this.req<HashesResponse>('GET', `/hashes?${qs}`);
    return new Map(unique.map((p) => [p, r.hashes[p] ?? undefined]));
  }

  // ── vault selection (onboarding) ──
  vaults(): Promise<VaultsResponse> { return this.req('GET', '/vaults'); }
  setVault(path: string): Promise<SetVaultResponse> { return this.req('POST', '/vault', { path }); }
  /** Opens the OS folder dialog on the bridge's machine; resolves null when the user cancels. */
  async pickVault(): Promise<SetVaultResponse | null> {
    try { return await this.req<SetVaultResponse>('POST', '/vault/pick', {}); }
    catch (e) { if ((e as BridgeClientError).code === 'CANCELLED') return null; throw e; }
  }

  // ── live events ──
  onEvent(fn: (ev: VaultEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onStatus(fn: (online: boolean) => void): () => void { this.statusListeners.add(fn); fn(this._online); return () => this.statusListeners.delete(fn); }

  connect(): void {
    if (this.es || typeof EventSource === 'undefined') return;
    const url = `${this.baseUrl}/events${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
    try { this.es = new EventSource(url); } catch { this.scheduleReconnect(); return; }
    this.es.addEventListener('vault', (e) => {
      this.setOnline(true);
      try { const ev = JSON.parse((e as MessageEvent).data) as VaultEvent; this.listeners.forEach((l) => l(ev)); } catch { /* ignore malformed */ }
    });
    this.es.onerror = () => { this.setOnline(false); this.disconnect(); this.scheduleReconnect(); };
  }

  disconnect(): void { this.es?.close(); this.es = undefined; window.clearTimeout(this.reconnectTimer); }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
  }

  private setOnline(v: boolean): void {
    if (this._online === v) return;
    this._online = v;
    this.statusListeners.forEach((l) => l(v));
  }

  private async req<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new BridgeClientError('aborted', 'ABORTED');
      this.setOnline(false);
      throw new BridgeClientError('Can’t reach the Obspec Bridge', 'NETWORK');
    }
    this.setOnline(true);
    const data = (await res.json().catch(() => ({}))) as T | BridgeError;
    if (!res.ok) {
      const err = data as BridgeError;
      throw new BridgeClientError(err.error || res.statusText, err.code || 'INTERNAL', res.status);
    }
    return data as T;
  }
}
