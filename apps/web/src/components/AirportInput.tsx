"use client";

import { useEffect, useId, useState } from "react";
import { api, type AirportSuggestion } from "@/lib/api";

// Shared across inputs: identical queries are only fetched once per page load.
const cache = new Map<string, AirportSuggestion[]>();

const MAX_SHOWN = 6;

/** "John F. Kennedy International Airport" → "John F. Kennedy Intl" */
function shortName(name: string) {
  return name.replace(/\s+Airport$/i, "").replace(/\bInternational\b/g, "Intl").replace(/\bRegional\b/g, "Rgnl");
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
  const [query, setQuery] = useState<string | null>(null); // null = not typing
  const [suggestions, setSuggestions] = useState<AirportSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Debounced lookup while the user is typing.
  useEffect(() => {
    if (query === null) return;
    const q = query.trim();
    if (q.length < 2 && !/^[a-z]{1,3}$/i.test(q)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const hit = cache.get(q.toLowerCase());
        const list = hit ?? (await api.searchAirports(q)).suggestions.slice(0, MAX_SHOWN);
        if (!hit) cache.set(q.toLowerCase(), list);
        if (cancelled) return;
        setSuggestions(list);
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
            setSuggestions([]);
          }
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length && query !== null && setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <ul id={listId} role="listbox" className="combo-list" aria-label={`${label} suggestions`}>
          {suggestions.map((s, i) => (
            <li
              key={s.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              // mousedown keeps focus in the input; click picks the option
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="combo-text">
                <span className="combo-label">{s.label}</span>
                {s.kind === "airport" && <span className="combo-detail">{shortName(s.detail)}</span>}
              </span>
              <span className="combo-code">{s.kind === "metro" ? s.codes.join(" ") : s.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
