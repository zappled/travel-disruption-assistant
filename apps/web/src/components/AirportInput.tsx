"use client";

import type MarkJs from "mark.js";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api, type AirportSuggestion } from "@/lib/api";

// Shared across inputs: identical queries are only fetched once per page load.
const cache = new Map<string, AirportSuggestion[]>();

// mark.js touches the DOM, so load it in the browser only, once.
let markModule: Promise<{ default: typeof MarkJs }> | null = null;
const loadMark = () => (markModule ??= import("mark.js"));

/** "John F. Kennedy International Airport" → "John F. Kennedy Intl" */
function shortName(name: string) {
  return name.replace(/\s+Airport$/i, "").replace(/\bInternational\b/g, "Intl").replace(/\bRegional\b/g, "Rgnl");
}

/**
 * Give a suggestion row a hover tooltip with the full, unabbreviated text, but
 * only when its text is actually cut off. `title` isn't a React-managed prop
 * here, so setting it directly doesn't fight React (or mark.js).
 */
function showFullNameIfTruncated(row: HTMLElement, s: AirportSuggestion) {
  const text = row.querySelector<HTMLElement>(".combo-text");
  const truncated = !!text && text.scrollWidth > text.clientWidth;
  const full = s.kind === "metro" ? `${s.label} (${s.codes.join(", ")})` : `${s.value}: ${s.label} (${s.detail})`;
  if (truncated) row.title = full;
  else row.removeAttribute("title");
}

interface Results {
  term: string; // the search term these suggestions were fetched for
  list: AirportSuggestion[];
  seq: number; // bumps on every new result set; used as the list's React key
}

/**
 * Text input with airport/city suggestions (ARIA combobox pattern).
 * Free text is still allowed: the API resolves whatever is typed.
 */
export function AirportInput({
  label,
  value,
  onChange,
  placeholder = "City or airport code",
  className = "field",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState<string | null>(null); // null = not typing
  const [results, setResults] = useState<Results>({ term: "", list: [], seq: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = results.list;

  // Debounced lookup while the user is typing.
  useEffect(() => {
    if (query === null) return;
    const q = query.trim();
    if (q.length < 2 && !/^[a-z]{1,3}$/i.test(q)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const hit = cache.get(q.toLowerCase());
        const list = hit ?? (await api.searchAirports(q)).suggestions;
        if (!hit) cache.set(q.toLowerCase(), list);
        if (cancelled) return;
        setResults((r) => ({ term: q, list, seq: r.seq + 1 }));
        setActive(list.length ? 0 : -1);
        setOpen(list.length > 0);
      } catch {
        // Suggestions are a convenience; typing still works without them.
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Highlight the search term in codes, cities and airport names. The list is
  // keyed by `results.seq`, so React rebuilds it for each new result set and
  // never has to reconcile text that mark.js has split into <mark> elements.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!open || !el || !results.term) return;
    let cancelled = false;
    loadMark().then(({ default: Mark }) => {
      if (cancelled || !el.isConnected) return;
      const marker = new Mark(el);
      marker.unmark({
        done: () =>
          marker.mark(results.term, {
            className: "combo-hit",
            separateWordSearch: false, // "new y" highlights "New Y", not every "y"
            diacritics: true,
          }),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, results]);

  // Fit the dropdown to the space between the field and the bottom of the
  // window; anything beyond that scrolls inside the list. Set directly on the
  // element (not React state) so resizing doesn't re-render the list.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const fit = () => {
      const top = list.getBoundingClientRect().top;
      const available = window.innerHeight - top - 16;
      list.style.maxHeight = `${Math.max(140, Math.min(available, 420))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open, results]);

  // With up to 20 results the list scrolls; keep the keyboard-highlighted row visible.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function choose(s: AirportSuggestion) {
    onChange(s.value);
    setQuery(null);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "ArrowDown" && suggestions.length) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault(); // pick the suggestion instead of submitting the form
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className={`combo ${className}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        required
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          if (e.target.value.trim().length === 0) {
            setOpen(false);
            setResults((r) => ({ term: "", list: [], seq: r.seq + 1 }));
          }
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length && query !== null && setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <ul key={results.seq} ref={listRef} id={listId} role="listbox" className="combo-list" aria-label={`${label} suggestions`}>
          {suggestions.map((s, i) => (
            <li
              key={s.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`${s.kind === "metro" ? "metro" : ""}${i === active ? " active" : ""}`.trim() || undefined}
              // mousedown keeps focus in the input; click picks the option
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              onMouseEnter={(e) => {
                setActive(i);
                showFullNameIfTruncated(e.currentTarget, s);
              }}
            >
              <span className="combo-code">{s.kind === "metro" ? s.codes.join(" ") : s.value}</span>
              <span className="combo-text">
                <span className="combo-label">{s.label}</span>
                {s.kind === "airport" && <span className="combo-detail">{shortName(s.detail)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
