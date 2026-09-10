import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CodexThread } from "../../types/codex";
import { findCodexPanel } from "../../lib/codexSessions";

export function CodexHistory({
  onSelect,
  executablePath = "",
  currentThreadId,
}: {
  onSelect: (thread: CodexThread) => void;
  executablePath?: string;
  currentThreadId?: string;
}) {
  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = async (next: string | null) => {
    const version = ++request.current;
    setLoading(true);
    setError("");
    try {
      const page = await invoke<{
        data: CodexThread[];
        nextCursor: string | null;
      }>("codex_history", {
        cursor: next,
        search: query || null,
        executablePath: executablePath || null,
      });
      if (version !== request.current) return;
      setThreads((old) => (next ? [...old, ...page.data] : page.data));
      setCursor(page.nextCursor);
    } catch (e) {
      if (version === request.current) setError(String(e));
    } finally {
      if (version === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(null);
    return () => {
      request.current++;
    };
  }, [executablePath]);
  return (
    <section className="codex-history">
      <div className="form-row">
        <input
          className="form-input form-input-grow"
          aria-label="Search Codex history"
          placeholder="Search Codex conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load(null);
          }}
        />
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => void load(null)}
        >
          Search
        </button>
      </div>
      {error && (
        <p role="alert" className="codex-error">
          {error}
        </p>
      )}
      <div className="codex-history-list">
        {threads.map((t) => {
          const open = findCodexPanel(t.id);
          const active =
            t.status?.type === "active" && t.id !== currentThreadId;
          return (
            <button
              className="codex-history-row"
              key={t.id}
              disabled={active && !open}
              onClick={() => onSelect(t)}
            >
              <strong>{t.name || t.preview || t.id}</strong>
              <small>
                {t.cwd} · {new Date(t.updatedAt * 1000).toLocaleString()}
              </small>
              <small>
                {open
                  ? "Already open in Tessera"
                  : active
                    ? "Active elsewhere — finish that session first"
                    : "Codex"}
              </small>
            </button>
          );
        })}
        {!loading && !error && !threads.length && (
          <p>No Codex conversations found.</p>
        )}
      </div>
      {loading && <p>Loading conversations…</p>}
      {cursor && (
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          Load more
        </button>
      )}
    </section>
  );
}
