import React, { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { InstanceConfig } from '../../types/instance';

interface NewInstanceDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewInstanceDialog: React.FC<NewInstanceDialogProps> = ({ isOpen, onClose }) => {
  const { addInstance } = useInstanceStore();
  const { addPanel, setActiveTab } = useLayoutStore();
  const { settings } = useSettingsStore();
  const instanceCount = useInstanceStore((s) => s.instances.size);

  const [name, setName] = useState(() => `Claude ${instanceCount + 1}`);
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState(settings.defaultModel);
  const [permissionMode, setPermissionMode] = useState(settings.defaultPermissionMode);
  const [skipPermissions, setSkipPermissions] = useState(settings.defaultSkipPermissions);
  const [allowedTools, setAllowedTools] = useState('');
  const [maxBudget, setMaxBudget] = useState(0);
  const [systemPrompt, setSystemPrompt] = useState('');

  // BUG-1: Close dialog on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) setCwd(selected as string);
    } catch (err) {
      console.error('Failed to open directory picker:', err);
    }
  };

  const handleCreate = () => {
    const config: InstanceConfig = {
      cwd: cwd || '.',
      model,
      dangerouslySkipPermissions: skipPermissions,
      permissionMode,
      allowedTools: allowedTools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      maxBudget,
      systemPrompt,
      agentMode: false,
    };

    const id = addInstance(config, name || undefined);
    addPanel(id);
    setActiveTab(id);
    // Register in current group if inside one
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    if (currentGroupId) {
      useGroupStore.getState().addToGroup(currentGroupId, id);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="dialog-header">
          <h3 className="dialog-title">New Claude Instance</h3>
          <button className="dialog-close-btn" onClick={onClose}>{'\u00D7'}</button>
        </div>

        <div className="dialog-body" style={{ overflowY: 'auto', flex: 1 }}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Instance name"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Working Directory</label>
            <div className="form-row">
              <input
                className="form-input form-input-grow"
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="Path to working directory"
              />
              <button className="btn btn-secondary" onClick={handleBrowse}>
                Browse
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Model</label>
            <select className="form-select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="sonnet">Sonnet (default)</option>
              <option value="opus">Opus</option>
              <option value="fable">Fable</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Permission Mode</label>
            <select className="form-select" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)}>
              <option value="default">default</option>
              <option value="plan">plan</option>
              <option value="acceptEdits">acceptEdits</option>
              <option value="bypassPermissions">bypassPermissions</option>
              <option value="dontAsk">dontAsk</option>
              <option value="auto">auto</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={() => setSkipPermissions(!skipPermissions)}
              />
              Skip Permissions
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">Allowed Tools</label>
            <textarea
              className="form-textarea"
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              placeholder="Read, Write, Bash, ..."
              rows={2}
            />
            <span className="form-hint">Comma-separated list of allowed tools</span>
          </div>

          <div className="form-group">
            <label className="form-label">Max Budget</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={maxBudget}
              onChange={(e) => setMaxBudget(parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">System Prompt</label>
            <textarea
              className="form-textarea"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional system prompt..."
              rows={3}
            />
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
