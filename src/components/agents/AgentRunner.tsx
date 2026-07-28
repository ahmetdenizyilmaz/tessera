import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Agent } from '../../types/agent';
import { Play, Square, Bot } from 'lucide-react';

interface AgentRunnerProps {
  agent: Agent;
}

export default function AgentRunner({ agent }: AgentRunnerProps) {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleRun = async () => {
    if (!input.trim() || running) return;
    setRunning(true);
    setOutput('');

    try {
      const result = await invoke<string>('agent_run', {
        agentId: agent.id,
        input: input.trim(),
      });
      setOutput(result);
    } catch (e) {
      setOutput(`Error: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const handleStop = async () => {
    try {
      await invoke('agent_stop', { agentId: agent.id });
    } catch {
      // ignore
    }
    setRunning(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
      }}>
        <Bot size={16} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{agent.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{agent.model}</span>
      </div>

      {/* Output area */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <pre
          ref={outputRef}
          style={{
            flex: 1, margin: 0, padding: 16, overflowY: 'auto',
            background: 'var(--bg-primary)', color: 'var(--text-secondary)',
            fontFamily: "'Consolas', 'Fira Code', monospace", fontSize: 13,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {output || (running
            ? 'Running...'
            : 'Output will appear here.'
          )}
          {running && (
            <span style={{
              display: 'inline-block', width: 8, height: 14,
              background: 'var(--accent)', marginLeft: 2,
              animation: 'blink 1s step-end infinite',
            }} />
          )}
        </pre>
      </div>

      {/* Input area */}
      <div style={{
        padding: 12, borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8,
      }}>
        <textarea
          className="form-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter your message..."
          rows={3}
          style={{ flex: 1, resize: 'none', minHeight: 60 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleRun();
            }
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {running ? (
            <button
              className="btn btn-danger"
              onClick={handleStop}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleRun}
              disabled={!input.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Play size={14} /> Run
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
