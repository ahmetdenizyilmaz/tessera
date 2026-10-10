// Native-session regression fixture. No network, credentials, or real model calls.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const requested = args.includes('--conversation') ? args[args.indexOf('--conversation') + 1] : null;
const mode = process.env.TESSERA_AGY_RESUME_FIXTURE;
const emit = value => console.log(JSON.stringify(value));
if (mode === 'startup-error' || mode === 'login-error') {
  emit({ event: 'result', result: { status: 'ERROR', error: mode === 'login-error'
    ? 'You are not logged into Antigravity.' : 'Network unavailable during conversation startup.' } });
  process.exit(2);
}
const conversation = mode === 'missing' ? 'different-conversation' : requested || 'fixture-conversation';
const file = join(process.cwd(), `${conversation}.json`);
let messages = [];
try { messages = JSON.parse(readFileSync(file, 'utf8')); } catch {}
emit({ event: 'init', conversation_id: conversation, init: { cwd: process.cwd(), tools: [], permission_mode: 'request-review' } });
for await (const line of createInterface({ input: process.stdin })) {
  const event = JSON.parse(line);
  messages.push(event.message.content);
  writeFileSync(file, JSON.stringify(messages));
  const response = messages.length === 1 ? 'Remembered.' : `Remembered: ${messages[0]}`;
  emit({ event: 'step_update', step_update: { conversation_id: conversation, step_index: messages.length * 2,
    step_type: 'agent_response', state: 'DONE', text_delta: response } });
  emit({ event: 'result', result: { conversation_id: conversation, status: 'SUCCESS', response, num_turns: messages.length } });
}
