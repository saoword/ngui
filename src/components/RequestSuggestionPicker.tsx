import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { RequestSimulationInput } from "../parser";

interface RequestSuggestionPickerProps {
  suggestions: RequestSimulationInput[];
  label: string;
  placeholder: string;
  onSelect: (suggestion: RequestSimulationInput) => void;
}

const maxVisibleOptions = 200;
const dropdownGap = 4;

function formatSuggestion(suggestion: RequestSimulationInput) {
  return `${suggestion.host || "(any host)"}${suggestion.path} · ${suggestion.scheme}:${suggestion.port ?? ""}`;
}

export function RequestSuggestionPicker({ suggestions, label, placeholder, onSelect }: RequestSuggestionPickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLLabelElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? suggestions.filter((suggestion) => formatSuggestion(suggestion).toLowerCase().includes(needle))
      : suggestions;
    return matches.slice(0, maxVisibleOptions);
  }, [query, suggestions]);

  const reposition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.bottom + dropdownGap, width: rect.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (suggestion: RequestSimulationInput) => {
    onSelect(suggestion);
    setQuery("");
    setOpen(false);
  };

  const dropdown = open && filtered.length > 0
    ? createPortal(
      <ul
        className="request-suggestion__list"
        id={listId}
        role="listbox"
        aria-label={label}
        ref={listRef}
        style={anchor ? { left: anchor.left, top: anchor.top, width: anchor.width } : { visibility: "hidden" }}
      >
        {filtered.map((suggestion, index) => (
          <li
            key={`${suggestion.host}|${suggestion.path}|${suggestion.scheme}|${suggestion.port ?? ""}`}
            id={`${listId}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            className={`request-suggestion__option${index === activeIndex ? " active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(suggestion)}
          >
            {formatSuggestion(suggestion)}
          </li>
        ))}
      </ul>,
      document.body
    )
    : null;

  return (
    <label className="request-suggestion" ref={rootRef}>
      <span>{label}</span>
      <Search className="request-suggestion__icon" size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            const suggestion = filtered[activeIndex];
            if (open && suggestion) {
              event.preventDefault();
              choose(suggestion);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {dropdown}
    </label>
  );
}
