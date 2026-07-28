export interface PtySpawnArgs {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  claudeSessionId?: string;
  permissionMode?: string;
  allowedTools?: string[];
  maxTurnsBudget?: number;
  systemPrompt?: string;
}

export interface SystemUpdatePayload {
  cpuPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  memoryPercent: number;
}

export interface HistoryChatMessage {
  role: string;
  content: string;
  timestamp?: number;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number;
  messageCount: number;
}
