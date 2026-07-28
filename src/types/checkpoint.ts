export interface Checkpoint {
  id: number;
  instance_id: string;
  session_id: string;
  parent_id: number | null;
  branch_name: string;
  label: string;
  messages_snapshot: string; // JSON array of messages
  metadata: string; // JSON
  created_at: string;
}

export interface CheckpointBranch {
  name: string;
  checkpointCount: number;
  latestCheckpointId: number;
}

export type CheckpointStrategy = 'manual' | 'per_prompt' | 'per_tool_use' | 'smart';
