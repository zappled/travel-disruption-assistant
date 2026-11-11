"use client";

import type { AssessResponse } from "@/lib/api";
import { RISK_LEVELS, headlineWithoutLevel, type RiskLevel } from "@/lib/riskLevels";

type Signal = AssessResponse["signals"][number];
type Recommendation = AssessResponse["assessment"]["recommendations"][number];

const RISK_LABEL = { low: "Low risk", moderate: "Moderate risk", high: "High risk", severe: "Severe risk" } as const;
const CONF_BARS = { low: 1, medium: 2, high: 3 } as const;
const PRIORITY_LABEL: Record<Recommendation["priority"], string> = {
  now: "Now",
  before_travel: "Before you travel",
  day_of_travel: "On the day",
};
const SEVERITY_LABEL = ["Informational", "Minor", "Significant", "Severe"];

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

function EvidenceItem({ s }: { s: Signal }) {
  return (
    <li>
      <div className="evidence-source">
        <span>
          <span className={`sev sev-${s.severity}`} aria-hidden="true" />
          {s.summary}
        </span>
        <span className="muted small">{SEVERITY_LABEL[s.severity]}</span>
      </div>
      <blockquote>{s.evidence.excerpt}</blockquote>
      <div className="small muted" style={{ marginTop: 6 }}>
        {s.evidence.sourceName}, retrieved {formatTime(s.evidence.observedAt)}
        {s.timing === "current" && " (current conditions, not a forecast)"}.{" "}
        <a href={s.evidence.url} target="_blank" rel="noreferrer">
          View source data
        </a>
      </div>
    </li>
  );
}

export function Results({ data }: { data: AssessResponse }) {
  const { route, assessment: a, signals, sources, notices } = data;
  const byId = new Map(signals.map((s) => [s.id, s]));
  const codes = (list: typeof route.origin) => list.map((x) => x.iata);
  const fair = signals.filter((s) => s.kind === "fair_weather");
  const priorities = (["now", "before_travel", "day_of_travel"] as const).filter((p) =>
    a.recommendations.some((r) => r.priority === p),
  );

  return (
    <section aria-live="polite">
      <div className="strip" data-risk={a.overallRisk}>
        <div className="strip-route" aria-label={`From ${codes(route.origin).join(", ")} to ${codes(route.destination).join(", ")}`}>
          <RouteCodes list={codes(route.origin)} />
          <span className="arrow" aria-hidden="true">
            →
          </span>
          <RouteCodes list={codes(route.destination)} />
        </div>
        <div className="strip-meta">
          {formatDate(route.date)}
          {route.daysAhead === 0 ? " (today)" : route.daysAhead === 1 ? " (tomorrow)" : ` (in ${route.daysAhead} days)`}
          {route.travelWindow ? <div>{route.travelWindow.description}</div> : <div>Any time of day</div>}
        </div>

        <div className="verdict">
          <span className="risk-badge">{RISK_LABEL[a.overallRisk]}</span>
          <h2 className="verdict-headline">{headlineWithoutLevel(a.headline)}</h2>
        </div>
        <RiskScale current={a.overallRisk} />
        <p className="verdict-summary">{a.summary}</p>
        <div className="confidence">
          <span className="confidence-meter" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= CONF_BARS[a.confidence] ? "on" : ""} />
            ))}
          </span>
          <span>
            <strong>{a.confidence[0].toUpperCase() + a.confidence.slice(1)} confidence.</strong> {a.confidenceReason}
          </span>
        </div>
      </div>

      {notices.map((n) => (
        <p className="notice" key={n}>
          {n}
        </p>
      ))}

      <h2 className="section-title">What could go wrong</h2>
      {a.risks.length === 0 ? (
        <div>
          <p>Nothing notable found for this trip.</p>
          {fair.length > 0 && (
            <details className="evidence-toggle">
              <summary>What the forecasts say</summary>
              <ul className="evidence">
                {fair.map((s) => (
                  <EvidenceItem key={s.id} s={s} />
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <div>
          {a.risks.map((r) => {
            const ev = r.evidenceIds.map((id) => byId.get(id)).filter((s): s is Signal => Boolean(s));
            return (
              <article className="risk" key={r.title + r.airports.join()}>
                <div className="risk-head">
                  <h3 className="risk-title">{r.title}</h3>
                  <span className="risk-codes">{r.airports.join(" ")}</span>
                  <span className="risk-tag">
                    {r.likelihood[0].toUpperCase() + r.likelihood.slice(1)}, {r.impact} impact
                  </span>
                </div>
                <p>{r.explanation}</p>
                <details className="evidence-toggle">
                  <summary>
                    Evidence from {new Set(ev.map((s) => s.evidence.sourceName)).size} source
                    {new Set(ev.map((s) => s.evidence.sourceName)).size === 1 ? "" : "s"}
                  </summary>
                  <ul className="evidence">
                    {ev.map((s) => (
                      <EvidenceItem key={s.id} s={s} />
                    ))}
                  </ul>
                </details>
              </article>
            );
          })}
        </div>
      )}

      <h2 className="section-title">What to do</h2>
      {priorities.map((p) => (
        <div className="when" key={p}>
          <h3>{PRIORITY_LABEL[p]}</h3>
          <ul>
            {a.recommendations
              .filter((r) => r.priority === p)
              .map((r) => (
                <li key={r.action}>
                  <strong>{r.action}</strong> <span className="muted">{r.reason}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}

      <h2 className="section-title">Sources checked</h2>
      <table className="sources">
        <tbody>
          {sources.map((s) => (
            <tr key={s.source}>
              <td className={`status status-${s.status}`}>
                {{ ok: "Responded", partial: "Partly", error: "Unavailable", skipped: "Not used" }[s.status]}
              </td>
              <td>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                {s.detail && <div className="muted">{s.detail}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="evidence-toggle">
        <summary>All {signals.length} signals</summary>
        <ul className="evidence">
          {signals.map((s) => (
            <EvidenceItem key={s.id} s={s} />
          ))}
        </ul>
      </details>
      <p className="small muted" style={{ marginTop: 16 }}>
        {a.generatedBy === "ai" ? "Summary written by AI from the signals above." : "Summary produced by rules (AI unavailable)."}{" "}
        Checked {formatTime(data.generatedAt)}.
      </p>
    </section>
  );
}

/** Four-step scale with the current level marked, plus an explainer toggle. */
function RiskScale({ current }: { current: RiskLevel }) {
  return (
    <div className="risk-scale-wrap">
      <ol className="risk-scale" aria-label="Risk scale">
        {RISK_LEVELS.map((r) => (
          <li key={r.level} data-level={r.level} aria-current={r.level === current ? "true" : undefined}>
            {r.label}
          </li>
        ))}
      </ol>
      <details className="risk-explainer">
        <summary>What does this mean?</summary>
        <dl>
          {RISK_LEVELS.map((r) => (
            <div key={r.level} className="risk-explainer-row" data-level={r.level} data-current={r.level === current || undefined}>
              <dt>
                {r.label}
                {r.level === current && <span className="risk-explainer-you"> (this trip)</span>}
              </dt>
              <dd>
                <p>{r.meaning}</p>
                <p>
                  <strong>What to do:</strong> {r.todo}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function RouteCodes({ list }: { list: string[] }) {
  if (list.length === 1) return <span>{list[0]}</span>;
  return (
    <span>
      {list[0]} <span className="alt">{list.slice(1).join(" ")}</span>
    </span>
  );
}
