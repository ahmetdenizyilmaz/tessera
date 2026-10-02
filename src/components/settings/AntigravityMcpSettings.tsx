import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AntigravityMcpStatus } from '../../types/antigravity';

/** agy has one MCP list for every session. Nothing here changes it until a button is pressed. */
export function AntigravityMcpSettings({ executablePath }: { executablePath: string }) {
  const [status, setStatus] = useState<AntigravityMcpStatus | null>(null);
  const [allowInChat, setAllowInChat] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const next = await invoke<AntigravityMcpStatus>('antigravity_mcp_status');
    setStatus(next);
    if (next.panelTools.registered) setAllowInChat(next.panelTools.allowedInChat);
  }, []);
  useEffect(() => { load().catch(e => setMessage(String(e))); }, [load]);
  const act = async (label: string, command: string, args: Record<string, unknown>, done: string) => {
    setBusy(label); setMessage('');
    try { await invoke(command, { executablePath, ...args }); await load(); setMessage(done); }
    catch (e) { setMessage(String(e)); await load().catch(() => {}); }
    finally { setBusy(''); }
  };
  const panel = status?.panelTools;
  const others = status?.servers.filter(s => !s.tessera) ?? [];
  return <section className="antigravity-mcp" aria-label="Antigravity MCP tools">
    <h4>MCP tools for Antigravity</h4>
    <p className="opencode-hint">agy keeps a single MCP list for every agy session on this PC (<code>~/.gemini/config/mcp_config.json</code>), inside and outside Tessera. Tessera changes it only when you press a button here, through agy's own <code>agy mcp add</code> / <code>remove</code>. Antigravity panels that are already open pick up changes on their own.</p>

    <h5>Panel messaging</h5>
    <p className="opencode-hint">Lets the Antigravity agent list, message and read your other panels (<code>list_panels</code>, <code>send_to_panel</code>, <code>read_panel</code>), like Claude and Codex panels can. It adds one entry that starts this Tessera executable as a small local bridge; outside a Tessera panel that entry offers no tools.</p>
    {panel && <p role="status" className="opencode-hint antigravity-mcp-state">
      <strong>{!panel.registered ? 'Not enabled' : panel.current ? 'Enabled' : 'Enabled for a different Tessera install'}</strong>
      {panel.registered && !panel.current && ' · the entry points at another Tessera executable. Press Update to point it at this one.'}
      {panel.registered && panel.current && (panel.allowedInChat ? ' · chat and terminal panels can use it.' : ' · terminal panels can use it (agy asks you). Chat panels cannot: calls are auto-denied until you allow them below.')}
    </p>}
    <label className="form-checkbox-label"><input type="checkbox" checked={allowInChat} disabled={!!busy} onChange={e => setAllowInChat(e.target.checked)} /> Let chat panels call these three tools without a prompt</label>
    <p className="opencode-hint">Chat runs agy headless, which cannot show its approval prompt and refuses instead. This adds exactly these rules to <code>permissions.allow</code> in agy's <code>settings.json</code>, and removes them again when you turn it off: {panel?.rules.map(rule => <code key={rule} style={{ marginRight: 6 }}>{rule}</code>)}</p>
    <div className="form-row">
      <button type="button" className="btn btn-primary" disabled={!!busy || !panel} onClick={() => void act('panel', 'antigravity_mcp_panel_tools', { enable: true, allowInChat }, 'Panel messaging is set up for Antigravity. Restart an open Antigravity panel if its agent does not see the tools.')}>
        {busy === 'panel' ? 'Applying…' : !panel?.registered ? 'Enable panel messaging' : panel.current ? 'Apply' : 'Update'}
      </button>
      {panel?.registered && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act('panel-off', 'antigravity_mcp_panel_tools', { enable: false, allowInChat: false }, 'Panel messaging was removed from Antigravity, including its allow rules.')}>Remove</button>}
    </div>

    <h5>Your other MCP servers</h5>
    <p className="opencode-hint">Servers you already use in Tessera's MCP manager or Claude Code. Adding one copies its command, arguments and environment (or URL and headers) into agy. In chat, agy auto-denies each tool call unless you add a rule <code>mcp(server/tool)</code> to its <code>permissions.allow</code> or choose Allow everything; in a terminal panel agy asks you.</p>
    {status && !status.candidates.length && <p className="opencode-hint">No MCP servers were found in Tessera's MCP manager or Claude Code's user settings.</p>}
    <ul className="antigravity-mcp-list">
      {status?.candidates.map(server => <li key={server.name}>
        <span><strong>{server.name}</strong> · {server.source}<br /><small>{server.target}</small>{server.problem && <><br /><small className="antigravity-mcp-problem">Cannot be added: it {server.problem}</small></>}</span>
        {server.added
          ? <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act(server.name, 'antigravity_mcp_remove', { name: server.name }, `${server.name} was removed from Antigravity.`)}>{busy === server.name ? 'Removing…' : 'Remove from Antigravity'}</button>
          : <button type="button" className="btn btn-secondary" disabled={!!busy || !!server.problem} onClick={() => void act(server.name, 'antigravity_mcp_import', { name: server.name }, `${server.name} was added to Antigravity.`)}>{busy === server.name ? 'Adding…' : 'Add to Antigravity'}</button>}
      </li>)}
    </ul>
    {!!others.filter(s => !status?.candidates.some(c => c.name === s.name)).length && <>
      <h5>Also configured in agy</h5>
      <ul className="antigravity-mcp-list">{others.filter(s => !status?.candidates.some(c => c.name === s.name)).map(server => <li key={server.name}><span><strong>{server.name}</strong>{server.disabled ? ' · disabled' : ''}<br /><small>{server.target}</small></span></li>)}</ul>
    </>}
    {message && <p className="opencode-hint" role="status">{message}</p>}
  </section>;
}
