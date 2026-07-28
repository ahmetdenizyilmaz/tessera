import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { ControlResponsePayload, PendingControlRequest } from '../../types/stream';

interface ControlRequestAreaProps {
  instanceId: string;
  requests: PendingControlRequest[];
  respond: (requestId: string, response: ControlResponsePayload) => Promise<void>;
}

/**
 * Renders the oldest pending control request from the CLI as an interactive
 * card: tool permission prompts, AskUserQuestion options, plan approval.
 * Answers travel back over the control protocol (stdin of the CLI process).
 */
export const ControlRequestArea: React.FC<ControlRequestAreaProps> = ({
  instanceId,
  requests,
  respond,
}) => {
  const head = requests[0];
  if (!head || head.request.subtype !== 'can_use_tool') return null;

  const toolName = head.request.tool_name ?? '';
  if (toolName === 'AskUserQuestion') {
    return <AskUserQuestionCard key={head.requestId} req={head} respond={respond} />;
  }
  if (toolName === 'ExitPlanMode') {
    return <ExitPlanModeCard key={head.requestId} instanceId={instanceId} req={head} respond={respond} />;
  }
  return <PermissionRequestCard key={head.requestId} req={head} respond={respond} />;
};

// ─── Generic tool permission prompt ─────────────────────────────────────────

const PermissionRequestCard: React.FC<{
  req: PendingControlRequest;
  respond: ControlRequestAreaProps['respond'];
}> = ({ req, respond }) => {
  const { request, requestId } = req;
  const input = request.input ?? {};
  const inputJson = JSON.stringify(input, null, 2);
  const suggestions = Array.isArray(request.permission_suggestions)
    ? request.permission_suggestions
    : [];
  const [busy, setBusy] = useState(false);

  const answer = (response: ControlResponsePayload) => {
    if (busy) return;
    setBusy(true);
    respond(requestId, response).catch(() => setBusy(false));
  };

  return (
    <div className="control-card">
      <div className="control-card__title">
        <span className="control-card__icon">{'🔐'}</span>
        <span>
          Claude wants to use <strong>{request.display_name || request.tool_name}</strong>
        </span>
      </div>
      {request.description && (
        <div className="control-card__description">{request.description}</div>
      )}
      <pre className="control-card__input">{inputJson}</pre>
      <div className="control-card__actions">
        <button
          className="control-btn control-btn--allow"
          disabled={busy}
          onClick={() => answer({ behavior: 'allow', updatedInput: input })}
        >
          Allow
        </button>
        {suggestions.length > 0 && (
          <button
            className="control-btn control-btn--allow-always"
            disabled={busy}
            title="Allow and remember this permission for the session"
            onClick={() =>
              answer({ behavior: 'allow', updatedInput: input, updatedPermissions: suggestions })
            }
          >
            Always allow
          </button>
        )}
        <button
          className="control-btn control-btn--deny"
          disabled={busy}
          onClick={() => answer({ behavior: 'deny', message: 'User denied this tool use' })}
        >
          Deny
        </button>
      </div>
    </div>
  );
};

// ─── AskUserQuestion ────────────────────────────────────────────────────────

interface AskQuestion {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

const AskUserQuestionCard: React.FC<{
  req: PendingControlRequest;
  respond: ControlRequestAreaProps['respond'];
}> = ({ req, respond }) => {
  const { request, requestId } = req;
  const input = request.input ?? {};
  const questions: AskQuestion[] = Array.isArray((input as Record<string, unknown>).questions)
    ? ((input as Record<string, unknown>).questions as AskQuestion[])
    : [];

  // question text → selected labels (multi-select) / single label / free text
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const toggle = (q: AskQuestion, label: string) => {
    setSelected((prev) => {
      const cur = prev[q.question] ?? [];
      if (q.multiSelect) {
        return {
          ...prev,
          [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
        };
      }
      return { ...prev, [q.question]: [label] };
    });
  };

  const buildAnswers = (): Record<string, string> => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const chosen = selected[q.question] ?? [];
      const typed = (freeText[q.question] ?? '').trim();
      const parts = [...chosen];
      if (typed) parts.push(typed);
      if (parts.length > 0) {
        answers[q.question] = parts.join(', ');
      }
    }
    return answers;
  };

  const canSubmit = questions.every((q) => {
    const chosen = selected[q.question] ?? [];
    const typed = (freeText[q.question] ?? '').trim();
    return chosen.length > 0 || typed.length > 0;
  });

  const submit = () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    respond(requestId, {
      behavior: 'allow',
      updatedInput: { ...(input as Record<string, unknown>), answers: buildAnswers() },
    }).catch(() => setBusy(false));
  };

  const skip = () => {
    if (busy) return;
    setBusy(true);
    respond(requestId, {
      behavior: 'deny',
      message: 'User skipped the question',
    }).catch(() => setBusy(false));
  };

  return (
    <div className="control-card control-card--question">
      <div className="control-card__title">
        <span className="control-card__icon">{'❓'}</span>
        <span>Claude is asking</span>
      </div>
      {questions.map((q) => (
        <div key={q.question} className="control-question">
          {q.header && <div className="control-question__header">{q.header}</div>}
          <div className="control-question__text">{q.question}</div>
          <div className="control-question__options">
            {(q.options ?? []).map((opt) => {
              const isSelected = (selected[q.question] ?? []).includes(opt.label);
              return (
                <button
                  key={opt.label}
                  className={`control-option${isSelected ? ' control-option--selected' : ''}`}
                  disabled={busy}
                  onClick={() => toggle(q, opt.label)}
                >
                  <span className="control-option__label">
                    {q.multiSelect && (
                      <span className="control-option__check">{isSelected ? '☑' : '☐'}</span>
                    )}
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span className="control-option__description">{opt.description}</span>
                  )}
                </button>
              );
            })}
          </div>
          <input
            className="control-question__freetext"
            type="text"
            placeholder="Or type your own answer…"
            value={freeText[q.question] ?? ''}
            disabled={busy}
            onChange={(e) =>
              setFreeText((prev) => ({ ...prev, [q.question]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
            }}
          />
        </div>
      ))}
      <div className="control-card__actions">
        <button
          className="control-btn control-btn--allow"
          disabled={busy || !canSubmit}
          onClick={submit}
        >
          Answer
        </button>
        <button className="control-btn control-btn--neutral" disabled={busy} onClick={skip}>
          Skip
        </button>
      </div>
    </div>
  );
};

// ─── ExitPlanMode (plan approval) ───────────────────────────────────────────

const ExitPlanModeCard: React.FC<{
  instanceId: string;
  req: PendingControlRequest;
  respond: ControlRequestAreaProps['respond'];
}> = ({ instanceId, req, respond }) => {
  const { request, requestId } = req;
  const input = request.input ?? {};
  const plan = typeof (input as Record<string, unknown>).plan === 'string'
    ? ((input as Record<string, unknown>).plan as string)
    : '';
  const [busy, setBusy] = useState(false);

  const approve = () => {
    if (busy) return;
    setBusy(true);
    respond(requestId, { behavior: 'allow', updatedInput: input })
      .then(() =>
        // Approved plans proceed with auto-accepted edits, matching the CLI's
        // own plan-mode approval flow.
        invoke('stream_control_request', {
          id: instanceId,
          subtype: 'set_permission_mode',
          payload: { mode: 'acceptEdits' },
        }).catch(() => {}),
      )
      .catch(() => setBusy(false));
  };

  const reject = () => {
    if (busy) return;
    setBusy(true);
    respond(requestId, {
      behavior: 'deny',
      message: 'User wants to keep iterating on the plan',
    }).catch(() => setBusy(false));
  };

  return (
    <div className="control-card control-card--plan">
      <div className="control-card__title">
        <span className="control-card__icon">{'📋'}</span>
        <span>Claude has a plan ready</span>
      </div>
      <div className="control-card__plan">
        <MarkdownRenderer content={plan} />
      </div>
      <div className="control-card__actions">
        <button className="control-btn control-btn--allow" disabled={busy} onClick={approve}>
          Approve &amp; start coding
        </button>
        <button className="control-btn control-btn--neutral" disabled={busy} onClick={reject}>
          Keep planning
        </button>
      </div>
    </div>
  );
};

export default ControlRequestArea;
