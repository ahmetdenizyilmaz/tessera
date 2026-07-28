export type McpTransport = 'stdio' | 'sse' | 'streamable-http';

export interface McpServer {
  id: number;
  name: string;
  transport: McpTransport;
  command: string;
  args: string; // JSON array
  env: string; // JSON object
  url: string;
  scope: string;
  is_default: boolean;
  enabled: boolean;
  created_at: string;
}

export type McpConnectionStatus = 'connected' | 'disconnected' | 'error' | 'unknown';
