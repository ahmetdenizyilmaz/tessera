export interface ActivityActor {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  device: string | null;
}
export interface ActivityUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Already included in output. */
  reasoning: number;
}
export interface ActivityRecord {
  id: string;
  kind: 'turn' | 'handoff';
  actor: ActivityActor;
  target: ActivityActor | null;
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  status: string;
  prompt: string;
  response: string;
  usage: ActivityUsage | null;
  parentId: string | null;
  usageNote: string | null;
  origin: string;
  promptParts?: Array<{ id: string; text: string; at: number }>;
}
export interface ActivityPage {
  records: ActivityRecord[];
  hasMore: boolean;
  health: { error: string | null; lastScan: number };
}
