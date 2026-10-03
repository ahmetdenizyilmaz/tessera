/** Mirrors `sessions::usage_report` in Rust. Token counts are de-duplicated per
 *  message; `cost` is USD at Anthropic list prices for the priced models only. */
export interface Tokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
  /** Tokens of models with no known list price; never costed. */
  unpriced: number;
}
export interface PeriodRow extends Tokens { period: string; models: string[]; messages: number }
export interface ModelRow extends Tokens { model: string; priced: boolean; messages: number }
export interface SessionRow extends Tokens { sessionId: string; project: string; models: string[]; firstAt: number; lastAt: number; messages: number }
export interface ProjectRow extends Tokens { project: string; sessions: number; messages: number }
/** Other agents from Activity records: tokens only. */
export interface AgentRow { period: string; provider: string; model: string; turns: number; input: number; output: number; cacheRead: number; cacheWrite: number }
export interface UsageReport {
  daily: PeriodRow[];
  monthly: PeriodRow[];
  models: ModelRow[];
  sessions: SessionRow[];
  projects: ProjectRow[];
  agents: AgentRow[];
  totals: Tokens;
  messages: number;
  files: number;
  timezone: string;
}
