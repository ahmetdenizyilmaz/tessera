import { useEffect, useMemo, useState } from 'react';
import { useCheckpointStore } from '../../store/checkpointStore';
import { GitBranch, Plus } from 'lucide-react';

interface BranchSelectorProps {
  instanceId: string;
  onBranchChange: (branch: string) => void;
}

export default function BranchSelector({ instanceId, onBranchChange }: BranchSelectorProps) {
  const { checkpoints, activeBranch, setActiveBranch, branchFromCheckpoint, fetchCheckpoints } = useCheckpointStore();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchCheckpoints(instanceId);
  }, [instanceId, fetchCheckpoints]);

  const items = checkpoints.get(instanceId) ?? [];
  const current = activeBranch.get(instanceId) ?? 'main';

  const branches = useMemo(() => {
    const set = new Set<string>();
    items.forEach((cp) => set.add(cp.branch_name));
    if (set.size === 0) set.add('main');
    return Array.from(set);
  }, [items]);

  const handleChange = (branch: string) => {
    setActiveBranch(instanceId, branch);
    onBranchChange(branch);
  };

  const handleNewBranch = async () => {
    const name = newName.trim();
    if (!name) return;
    // Branch from latest checkpoint
    const latest = items[items.length - 1];
    if (latest) {
      await branchFromCheckpoint(latest.id, name, instanceId);
    }
    setActiveBranch(instanceId, name);
    onBranchChange(name);
    setNewName('');
    setShowNew(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <GitBranch size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />

      <select
        className="form-select"
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        style={{ minWidth: 120, maxWidth: 200 }}
      >
        {branches.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>

      {showNew ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            className="form-input"
            placeholder="Branch name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNewBranch()}
            style={{ width: 140, padding: '3px 8px', fontSize: 12 }}
            autoFocus
          />
          <button className="btn btn-primary btn-sm" onClick={handleNewBranch}>OK</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setShowNew(false); setNewName(''); }}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowNew(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <Plus size={12} /> New Branch
        </button>
      )}
    </div>
  );
}
