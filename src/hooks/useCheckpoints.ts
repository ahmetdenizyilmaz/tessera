import { useCallback, useEffect } from 'react';
import { useCheckpointStore } from '../store/checkpointStore';
import type { Checkpoint } from '../types/checkpoint';

export function useCheckpoints(instanceId: string) {
  const {
    checkpoints,
    activeBranch,
    autoCheckpoint,
    loading,
    error,
    fetchCheckpoints,
    createCheckpoint,
    deleteCheckpoint,
    branchFromCheckpoint,
    getCheckpoint,
    setActiveBranch,
    setAutoCheckpoint,
  } = useCheckpointStore();

  useEffect(() => {
    fetchCheckpoints(instanceId);
  }, [instanceId, fetchCheckpoints]);

  const items: Checkpoint[] = checkpoints.get(instanceId) ?? [];
  const currentBranch = activeBranch.get(instanceId) ?? 'main';

  const filteredByBranch = items.filter((cp) => cp.branch_name === currentBranch);

  const branches = Array.from(new Set(items.map((cp) => cp.branch_name)));
  if (branches.length === 0) branches.push('main');

  const create = useCallback(
    (sessionId: string, label: string, messagesSnapshot: string, branchName?: string, parentId?: number) =>
      createCheckpoint(instanceId, sessionId, label, messagesSnapshot, branchName ?? currentBranch, parentId),
    [instanceId, currentBranch, createCheckpoint],
  );

  const restore = useCallback(
    (checkpointId: number) => getCheckpoint(checkpointId),
    [getCheckpoint],
  );

  const remove = useCallback(
    (checkpointId: number) => deleteCheckpoint(checkpointId, instanceId),
    [instanceId, deleteCheckpoint],
  );

  const branch = useCallback(
    (checkpointId: number, newBranchName: string) => branchFromCheckpoint(checkpointId, newBranchName, instanceId),
    [instanceId, branchFromCheckpoint],
  );

  const switchBranch = useCallback(
    (branchName: string) => setActiveBranch(instanceId, branchName),
    [instanceId, setActiveBranch],
  );

  return {
    checkpoints: filteredByBranch,
    allCheckpoints: items,
    branches,
    currentBranch,
    loading,
    error,
    autoCheckpoint,
    create,
    restore,
    remove,
    branch,
    switchBranch,
    setAutoCheckpoint,
    refresh: () => fetchCheckpoints(instanceId),
  };
}
