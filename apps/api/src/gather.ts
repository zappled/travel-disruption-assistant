/**
 * Fetch every source for every airport in parallel. A failing source never
 * fails the request — it is reported in `sources` so the assessment can lower
 * its confidence and the UI can show what's missing.
 */
import type { Store } from "./store.js";
import type { Airport, SourceStatus } from "./types.js";
import { extractSignals, type SignalInput } from "./signals.js";
import { FAA_NAME, FAA_URL, fetchFaa } from "./sources/faa.js";
import { NWS_NAME, fetchNwsForAirport, type NwsAirportData } from "./sources/nws.js";
import { AWC_NAME, fetchTafs } from "./sources/awc.js";
import { OPEN_METEO_NAME, fetchOpenMeteoDay, type OpenMeteoDay } from "./sources/openMeteo.js";
import { errorMessage } from "./sources/http.js";

export interface GatherResult {
  signals: ReturnType<typeof extractSignals>;
  sources: SourceStatus[];
}

/** Settle per-airport fetches and summarise them into one SourceStatus. */
function perAirportStatus<T>(
  base: Omit<SourceStatus, "status" | "fetchedAt" | "detail">,
  airports: Airport[],
  results: PromiseSettledResult<T>[],
): { status: SourceStatus; ok: Map<string, T> } {
  const ok = new Map<string, T>();
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok.set(airports[i].iata, r.value);
    else failed.push(`${airports[i].iata} (${errorMessage(r.reason)})`);
  });
  const status: SourceStatus = {
    ...base,
    status: ok.size === 0 ? "error" : failed.length ? "partial" : "ok",
    fetchedAt: new Date().toISOString(),
    detail: failed.length ? `Unavailable for ${failed.join(", ")}` : undefined,
  };
  return { status, ok };
}

export async function gather(
  store: Store,
  airports: Airport[],
  date: string,
  daysAhead: number,
): Promise<GatherResult> {
  const [faaR, tafR, nwsR, omR] = await Promise.all([
    fetchFaa(store).then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e })),
    fetchTafs(store, airports).then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e })),
    Promise.allSettled(airports.map((a) => fetchNwsForAirport(store, a))),
    Promise.allSettled(airports.map((a) => fetchOpenMeteoDay(store, a, date))),
  ]);

  const sources: SourceStatus[] = [];
  const now = new Date().toISOString();

  sources.push({
    source: "faa",
    name: FAA_NAME,
    url: FAA_URL,
    status: faaR.ok ? "ok" : "error",
    fetchedAt: faaR.ok ? faaR.v.fetchedAt : now,
    detail: faaR.ok
      ? `Live status updated ${faaR.v.data.updated}${daysAhead > 1 ? " — reflects conditions now, not your travel date" : ""}`
      : errorMessage(faaR.e),
  });

  const nws = perAirportStatus<NwsAirportData>(
    { source: "nws", name: NWS_NAME, url: "https://api.weather.gov" },
    airports,
    nwsR,
  );
  sources.push(nws.status);

  // TAFs only cover ~24–30h ahead.
  const tafRelevant = daysAhead <= 1;
  sources.push({
    source: "awc",
    name: AWC_NAME,
    url: tafR.ok ? tafR.v.url : "https://aviationweather.gov",
    status: !tafRelevant ? "skipped" : tafR.ok ? "ok" : "error",
    fetchedAt: tafR.ok ? tafR.v.fetchedAt : now,
    detail: !tafRelevant
      ? "TAFs only cover the next ~30 hours; not used for this date"
      : tafR.ok
        ? `${tafR.v.data.size}/${airports.length} airports have a TAF`
        : errorMessage(tafR.e),
  });

  const om = perAirportStatus<OpenMeteoDay>(
    { source: "openMeteo", name: OPEN_METEO_NAME, url: "https://open-meteo.com" },
    airports,
    omR,
  );
  sources.push(om.status);

  const input: SignalInput = {
    date,
    daysAhead,
    airports,
    faa: faaR.ok ? faaR.v : undefined,
    tafs: tafR.ok && tafRelevant ? tafR.v : undefined,
    nws: nws.ok,
    openMeteo: om.ok,
  };
  return { signals: extractSignals(input), sources };
}
