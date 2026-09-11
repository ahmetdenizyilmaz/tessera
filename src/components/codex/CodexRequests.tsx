import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CodexRequest } from "../../types/codex";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  McpForm,
  mcpFormContent,
  supportedMcpSchema,
  type McpSchema,
} from "./McpForm";

type Question = {
  id: string;
  header?: string;
  question: string;
  isSecret?: boolean;
  options?: { label: string; description: string }[];
};
function RequestCard({
  request,
  instanceId,
}: {
  request: CodexRequest;
  instanceId: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const p = request.params;
  const schema = (p.requestedSchema ?? {}) as McpSchema;
  const supportedForm = supportedMcpSchema(schema);
  const respond = async (response: unknown) => {
    setPending(true);
    setError("");
    try {
      await invoke("codex_respond", {
        id: instanceId,
        requestId: request.id,
        response,
      });
    } catch (e) {
      setError(String(e));
      setPending(false);
    }
  };
  const questions = (p.questions ?? []) as Question[];
  const approval =
    request.method.endsWith("/requestApproval") &&
    !request.method.includes("/permissions/");
  const decisions = (
    Array.isArray(p.availableDecisions)
      ? p.availableDecisions
      : ["accept", "decline", "cancel"]
  ).filter((d) => typeof d === "string") as string[];
  const titles: Record<string, string> = {
    accept: "Allow once",
    acceptForSession: "Allow for session",
    decline: "Deny",
    cancel: "Cancel turn",
  };
  return (
    <section className="control-card codex-request" aria-label="Codex request" tabIndex={-1}>
      <strong className="control-card__title">
        {request.method.includes("commandExecution")
          ? "Command approval"
          : request.method.includes("fileChange")
            ? "File change approval"
            : request.method.includes("permissions")
              ? "Additional access"
              : request.method.includes("requestUserInput")
                ? "Codex needs your input"
                : "MCP request"}
      </strong>
      {!!p.reason && <p>{String(p.reason)}</p>}
      {!!p.message && <p>{String(p.message)}</p>}
      {!!p.command && <pre className="control-card__input">{String(p.command)}</pre>}
      {!!p.cwd && <small>Folder: {String(p.cwd)}</small>}
      {!!p.networkApprovalContext && (
        <pre>{JSON.stringify(p.networkApprovalContext, null, 2)}</pre>
      )}
      {!!p.grantRoot && <p>Requested folder: {String(p.grantRoot)}</p>}
      {approval && (
        <div className="control-card__actions">
          {decisions
            .filter((d) => titles[d])
            .map((d) => (
              <button
                className={`control-btn ${d === "accept" || d === "acceptForSession" ? "control-btn--allow" : "control-btn--deny"}`}
                key={d}
                disabled={pending}
                onClick={() => void respond({ decision: d })}
              >
                {titles[d]}
              </button>
            ))}
        </div>
      )}
      {request.method === "item/permissions/requestApproval" && (
        <>
          <pre>{JSON.stringify(p.permissions, null, 2)}</pre>
          <div className="form-row">
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={() =>
                void respond({ permissions: p.permissions, scope: "turn" })
              }
            >
              Allow requested access for this turn
            </button>
            <button
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => void respond({ permissions: {}, scope: "turn" })}
            >
              Deny
            </button>
          </div>
        </>
      )}
      {request.method === "item/tool/requestUserInput" && (
        <>
          {questions.map((q) => (
            <div className="control-question" key={q.id}>
              {q.header && <div className="control-question__header">{q.header}</div>}
              <div className="control-question__text">{q.question}</div>
              <div className="control-question__options">
              {q.options?.map((o) => (
                <button
                  className={`control-option${answers[q.id] === o.label ? " control-option--selected" : ""}`}
                  aria-pressed={answers[q.id] === o.label}
                  type="button"
                  key={o.label}
                  disabled={pending}
                  title={o.description}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.label }))}
                >
                  <span className="control-option__label">{o.label}</span>
                  {o.description && <span className="control-option__description">{o.description}</span>}
                </button>
              ))}
              </div>
              <input
                className="control-question__freetext"
                aria-label={q.question}
                placeholder="Or type your own answer…"
                disabled={pending}
                type={q.isSecret ? "password" : "text"}
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                }
              />
            </div>
          ))}
          <button
            className="control-btn control-btn--allow"
            disabled={pending || questions.some((q) => !answers[q.id]?.trim())}
            onClick={() =>
              void respond({
                answers: Object.fromEntries(
                  questions.map((q) => [q.id, { answers: [answers[q.id]] }]),
                ),
              })
            }
          >
            Submit answers
          </button>
        </>
      )}
      {request.method === "mcpServer/elicitation/request" && (
        <>
          {p.mode === "url" ? (
            <>
              <p>
                Complete this step in your browser: <code>{String(p.url)}</code>
              </p>
              {/^https?:\/\//i.test(String(p.url)) && (
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    openExternal(String(p.url)).catch((e) =>
                      setError(String(e)),
                    )
                  }
                >
                  Open link
                </button>
              )}
            </>
          ) : supportedForm ? (
            <McpForm
              schema={schema}
              values={form}
              onChange={setForm}
              disabled={pending}
            />
          ) : (
            <p>
              This server requested a form Tessera cannot display yet. Decline
              or cancel this request to continue.
            </p>
          )}
          <div className="form-row">
            <button
              className="btn btn-primary"
              disabled={pending || (p.mode !== "url" && !supportedForm)}
              onClick={() => {
                try {
                  void respond({
                    action: "accept",
                    content:
                      p.mode === "url" ? null : mcpFormContent(schema, form),
                    _meta: null,
                  });
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {p.mode === "url" ? "I completed this step" : "Submit"}
            </button>
            <button
              className="btn btn-secondary"
              disabled={pending}
              onClick={() =>
                void respond({ action: "decline", content: null, _meta: null })
              }
            >
              Decline
            </button>
            <button
              className="btn btn-secondary"
              disabled={pending}
              onClick={() =>
                void respond({ action: "cancel", content: null, _meta: null })
              }
            >
              Cancel
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="codex-error">
          {error}
        </p>
      )}
      {pending && <small>Submitting response…</small>}
    </section>
  );
}
export function CodexRequests({
  requests,
  instanceId,
}: {
  requests: CodexRequest[];
  instanceId: string;
}) {
  return (
    <>
      {requests.map((r) => (
        <RequestCard key={String(r.id)} request={r} instanceId={instanceId} />
      ))}
    </>
  );
}
