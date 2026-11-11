/**
 * Builds apps/api/data/airports.json from the OurAirports CSV
 * (https://davidmegginson.github.io/ourairports-data/airports.csv).
 *
 * Usage: npx tsx scripts/build-airports.ts <path-to-airports.csv>
 *
 * Keeps only US (incl. territories) airports with scheduled passenger service
 * and an IATA code — the airports a business traveller could actually fly to.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const US_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP"]);
const TYPES = new Set(["large_airport", "medium_airport", "small_airport"]);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("usage: tsx scripts/build-airports.ts <airports.csv>");
  process.exit(1);
}

const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]);
const col = (name: string) => header.indexOf(name);

const airports = [];
for (const line of lines.slice(1)) {
  const r = parseCsvLine(line);
  const iata = r[col("iata_code")];
  if (!iata || iata.length !== 3) continue;
  if (!US_COUNTRIES.has(r[col("iso_country")])) continue;
  if (r[col("scheduled_service")] !== "yes") continue;
  const type = r[col("type")];
  if (!TYPES.has(type)) continue;
  airports.push({
    iata,
    icao: r[col("icao_code")] || r[col("gps_code")] || null,
    name: r[col("name")],
    city: r[col("municipality")],
    // US states as "NY"; territories (PR, GU, ...) use their country code.
    region:
      r[col("iso_country")] === "US"
        ? r[col("iso_region")].replace(/^US-/, "")
        : r[col("iso_country")],
    country: r[col("iso_country")],
    size: type.replace("_airport", ""),
    lat: Number(r[col("latitude_deg")]),
    lon: Number(r[col("longitude_deg")]),
  });
}

airports.sort((a, b) => a.iata.localeCompare(b.iata));
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "airports.json"), JSON.stringify(airports) + "\n");
console.log(`wrote ${airports.length} airports`);
