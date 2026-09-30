import { MarkdownRenderer } from "../chat/MarkdownRenderer";
import { ProviderIcon } from "../icons/ProviderIcons";
import { stripForkPreamble } from "../../lib/forkTranscript";
import type { CodexItem } from "../../types/codex";

export function CodexItemView({ item }: { item: CodexItem }) {
  if (item.type === "userMessage")
    return (
      <article className="msg msg--user codex-message-user">
        <div className="msg-header msg-header--user">
          <span className="msg-label">You</span>
        </div>
        <div className="msg-body msg-body--user">
          {item.content?.map((c, i) =>
            c.type === "text" ? (
              <p className="msg-user-text" key={i}>
                {stripForkPreamble(c.text ?? "")}
              </p>
            ) : c.type === "image" && c.url?.startsWith("data:image/") ? (
              <img
                className="codex-attachment"
                key={i}
                src={c.url}
                alt="Attached"
              />
            ) : null,
          )}
        </div>
      </article>
    );
  if (item.type === "agentMessage")
    return (
      <article className="msg msg--assistant codex-message">
        <div className="msg-header">
          <ProviderIcon provider="openai" size={14} />
          <span className="msg-label">Codex</span>
        </div>
        <div className="msg-body">
          <MarkdownRenderer content={item.text ?? ""} />
        </div>
      </article>
    );
  if (item.type === "reasoning")
    return (
      <details className="codex-tool">
        <summary>Reasoning summary</summary>
        <MarkdownRenderer
          content={item.summary?.join("\n") || item.text || ""}
        />
      </details>
    );
  if (item.type === "commandExecution")
    return (
      <details className="codex-tool" open={item.status === "inProgress"}>
        <summary>Command · {item.status ?? "running"}</summary>
        <pre>{item.command}</pre>
        <pre>{item.aggregatedOutput}</pre>
      </details>
    );
  if (item.type === "fileChange")
    return (
      <details className="codex-tool" open>
        <summary>File changes · {item.status}</summary>
        {item.changes?.map((c, i) => (
          <div key={i}>
            <strong>{c.path}</strong>
            <pre>{c.diff}</pre>
          </div>
        ))}
      </details>
    );
  if (item.type === "plan")
    return (
      <article className="codex-message">
        <small>Plan</small>
        <MarkdownRenderer content={item.text ?? ""} />
      </article>
    );
  return (
    <details className="codex-tool">
      <summary>
        {item.type} {item.status ? "· " + item.status : ""}
      </summary>
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}
