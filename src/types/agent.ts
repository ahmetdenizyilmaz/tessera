export interface Agent {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  tools: string; // JSON array
  mcp_servers: string; // JSON array
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: number;
  agent_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: string;
  output: string;
  started_at: string | null;
  completed_at: string | null;
  token_usage: string; // JSON
}

export interface AgentConfig {
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  tools: string[];
  mcp_servers: number[]; // MCP server IDs
}
