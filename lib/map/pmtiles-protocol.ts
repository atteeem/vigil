import { Protocol } from "pmtiles";

// PMTiles support for MapLibre: the official `pmtiles://` protocol handler, registered EXACTLY ONCE per page.
// The registration lives on globalThis so hot reloads and several maps (the world map, the editors, the country
// map) share one Protocol instance and can never register the handler twice.

type Handler = (params: { url: string }, abortController: AbortController) => Promise<unknown>;
export type AddProtocol = (name: string, handler: Handler) => void;

const g = globalThis as unknown as { __vigilPmtiles?: { protocol: Protocol; registrations: number } };

/** Registers `pmtiles://` once. Returns true only on the call that actually registered it. */
export function ensurePmtilesProtocol(addProtocol: AddProtocol): boolean {
  if (g.__vigilPmtiles) return false;
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile as unknown as Handler);
  g.__vigilPmtiles = { protocol, registrations: 1 };
  return true;
}

export const pmtilesRegistrationCount = () => g.__vigilPmtiles?.registrations ?? 0;

/** Test helper: forget the registration (a real page never does this). */
export function resetPmtilesProtocolForTests(): void {
  delete g.__vigilPmtiles;
}

export interface ArchiveProbe {
  ok: boolean;
  status: number | null;
  /** Range requests honoured (206 / Content-Range): required for PMTiles over HTTP. */
  rangeSupported: boolean | null;
  magicOk: boolean;
  version: number | null;
  reason: string | null;
}

/** Reads the first 127 bytes of an archive with a Range request and validates the PMTiles header. Never throws. */
export async function probeArchive(url: string, fetchImpl: typeof fetch = fetch): Promise<ArchiveProbe> {
  try {
    const res = await fetchImpl(url, { headers: { Range: "bytes=0-126" } });
    if (!res.ok) return { ok: false, status: res.status, rangeSupported: null, magicOk: false, version: null, reason: `HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const magicOk = new TextDecoder().decode(bytes.slice(0, 7)) === "PMTiles";
    const rangeSupported = res.status === 206 || !!res.headers.get("content-range");
    const version = magicOk ? (bytes[7] ?? null) : null;
    const reason = !magicOk ? "not a PMTiles archive (bad magic bytes)" : !rangeSupported ? "server ignored the Range header (needs HTTP Range support)" : version !== 3 ? `unsupported PMTiles version ${version}` : null;
    return { ok: magicOk && rangeSupported && version === 3, status: res.status, rangeSupported, magicOk, version, reason };
  } catch (err) {
    return { ok: false, status: null, rangeSupported: null, magicOk: false, version: null, reason: err instanceof Error ? err.message.slice(0, 160) : "fetch failed" };
  }
}
