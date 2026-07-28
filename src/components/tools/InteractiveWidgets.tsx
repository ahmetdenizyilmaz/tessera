import React, { useState } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';

/**
 * Read-only transcript rendering for AskUserQuestion: shows the questions,
 * highlights the chosen answers once the tool_result lands.
 */
export const AskUserQuestionWidget: React.FC<ToolWidgetProps> = ({ input, result }) => {
  const questions = Array.isArray(input.questions)
    ? (input.questions as Array<{
        question: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>)
    : [];
  const answers = (input.answers ?? {}) as Record<string, string>;

  return (
    <div className="tool-widget tool-widget--question">
      <div className="tool-widget__header tool-widget__header--static">
        <span className="tool-widget__icon">{'❓'}</span>
        <span className="tool-widget__label">Question</span>
      </div>
      <div className="tool-widget__body">
        {questions.map((q) => {
          const answer = answers[q.question];
          const answerParts = answer ? answer.split(',').map((s) => s.trim()) : [];
          return (
            <div key={q.question} className="question-widget__item">
              <div className="question-widget__question">{q.question}</div>
              <div className="question-widget__options">
                {(q.options ?? []).map((opt) => {
                  const chosen = answerParts.includes(opt.label);
                  return (
                    <span
                      key={opt.label}
                      className={`question-widget__option${chosen ? ' question-widget__option--chosen' : ''}`}
                    >
                      {chosen ? '✓ ' : ''}{opt.label}
                    </span>
                  );
                })}
              </div>
              {answer && !(q.options ?? []).some((o) => answerParts.includes(o.label)) && (
                <div className="question-widget__free-answer">→ {answer}</div>
              )}
            </div>
          );
        })}
        {!questions.length && result && <pre className="tool-widget__json">{result}</pre>}
      </div>
    </div>
  );
};

/**
 * Read-only transcript rendering for ExitPlanMode: collapsible plan markdown.
 */
export const ExitPlanModeWidget: React.FC<ToolWidgetProps> = ({ input, result, isError }) => {
  const [expanded, setExpanded] = useState(true);
  const plan = typeof input.plan === 'string' ? input.plan : '';
  const approved = result != null && !isError;

  return (
    <div className="tool-widget tool-widget--plan">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">{'📋'}</span>
        <span className="tool-widget__label">
          Plan{result != null ? (approved ? ' — approved' : ' — revision requested') : ''}
        </span>
        <span className="tool-widget__chevron">{expanded ? '▴' : '▾'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          <div className="plan-widget__content">
            <MarkdownRenderer content={plan} />
          </div>
        </div>
      )}
    </div>
  );
};
