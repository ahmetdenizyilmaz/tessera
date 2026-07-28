import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  extension: string;
  size: number;
}

export function useProjectFiles(cwd: string) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!cwd || cwd === '.') {
        setFiles([]);
        return;
      }
      setLoading(true);
      try {
        const result = await invoke<FileEntry[]>('list_project_files', {
          cwd,
          query,
          limit: 20,
        });
        setFiles(result);
      } catch {
        setFiles([]);
      }
      setLoading(false);
    }, 150);
  }, [cwd]);

  const clear = useCallback(() => {
    setFiles([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return { files, loading, search, clear };
}
