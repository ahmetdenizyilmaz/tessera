import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { ProviderIcon } from '../icons/ProviderIcons';
import type { OpenCodeMessage } from '../../types/opencode';

export function OpenCodeMessageView({ message }: { message: OpenCodeMessage }) {
  const user = message.info.role === 'user';
  return <article className={`msg ${user ? 'msg--user codex-message-user' : 'msg--assistant codex-message'}`}>
    <div className={`msg-header${user ? ' msg-header--user' : ''}`}>
      {!user && <ProviderIcon provider="opencode" size={14} />}<span className="msg-label">{user ? 'You' : 'OpenCode'}</span>
    </div>
    <div className={`msg-body${user ? ' msg-body--user' : ''}`}>
      {message.parts.map(part => {
        if (part.type === 'text') return user ? <p key={part.id} className="msg-user-text">{part.text}</p> : <MarkdownRenderer key={part.id} content={part.text ?? ''} />;
        if (part.type === 'reasoning') return <details key={part.id} className="codex-tool"><summary>Reasoning</summary><MarkdownRenderer content={part.text ?? ''} /></details>;
        if (part.type === 'tool') return <details key={part.id} className="codex-tool" open={part.state?.status === 'running' || part.state?.status === 'error'}>
          <summary>{part.tool} · {part.state?.status} {part.state?.title && `· ${part.state.title}`}</summary>
          {part.state?.input && <pre>{JSON.stringify(part.state.input, null, 2)}</pre>}
          {part.state?.output && <pre>{part.state.output}</pre>}
          {part.state?.error && <p role="alert">{part.state.error}</p>}
        </details>;
        if (part.type === 'file') return <p key={part.id}>Attachment: {part.filename || part.mime || 'file'}</p>;
        return null;
      })}
      {message.info.error && <p role="alert" className="codex-error">{message.info.error.data?.message || message.info.error.name || 'The model request failed.'}</p>}
    </div>
  </article>;
}
