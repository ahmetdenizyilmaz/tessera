import React, { useEffect, useRef } from 'react';
import { FileText, Folder } from 'lucide-react';

interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  extension: string;
  size: number;
}

interface FileMentionPopupProps {
  files: FileEntry[];
  selectedIndex: number;
  onSelect: (file: FileEntry) => void;
  visible: boolean;
}

export const FileMentionPopup: React.FC<FileMentionPopupProps> = ({
  files,
  selectedIndex,
  onSelect,
  visible,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.children[selectedIndex] as HTMLElement;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!visible || files.length === 0) return null;

  return (
    <div className="file-mention-popup">
      <div className="file-mention-popup__header">Files</div>
      <div className="file-mention-popup__list" ref={listRef}>
        {files.map((file, i) => (
          <button
            key={file.path}
            className={`file-mention-item ${i === selectedIndex ? 'file-mention-item--selected' : ''}`}
            onClick={() => onSelect(file)}
            type="button"
          >
            {file.is_dir ? (
              <Folder size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            ) : (
              <FileText size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            )}
            <span className="file-mention-item__name">{file.name}</span>
            <span className="file-mention-item__path">{file.path}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
