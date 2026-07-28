import React from 'react';
import ReadWidget from './ReadWidget';
import WriteWidget from './WriteWidget';
import EditWidget from './EditWidget';
import BashWidget from './BashWidget';
import GlobWidget from './GlobWidget';
import GrepWidget from './GrepWidget';
import WebSearchWidget from './WebSearchWidget';
import WebFetchWidget from './WebFetchWidget';
import TodoWidget from './TodoWidget';
import GenericWidget from './GenericWidget';
import LSWidget from './LSWidget';
import MCPWidget from './MCPWidget';
import NotebookEditWidget from './NotebookEditWidget';
import AgentWidget from './AgentWidget';

export interface ToolWidgetProps {
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

const registry: Record<string, React.ComponentType<ToolWidgetProps>> = {
  Read: ReadWidget,
  Write: WriteWidget,
  Edit: EditWidget,
  Bash: BashWidget,
  Glob: GlobWidget,
  Grep: GrepWidget,
  WebSearch: WebSearchWidget,
  WebFetch: WebFetchWidget,
  TodoRead: TodoWidget,
  TodoWrite: TodoWidget,
  LS: LSWidget,
  ListDirectory: LSWidget,
  NotebookEdit: NotebookEditWidget,
  Agent: AgentWidget,
  TaskCreate: AgentWidget,
  TaskUpdate: AgentWidget,
};

export function getToolWidget(toolName: string): React.ComponentType<ToolWidgetProps> {
  if (toolName.startsWith('mcp__')) return MCPWidget;
  return registry[toolName] ?? GenericWidget;
}
