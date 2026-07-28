import React, { useState } from 'react';
import { ImagePreview } from './ImagePreview';

interface ImageChipProps {
  src: string;
  name?: string;
  onRemove: () => void;
}

export const ImageChip: React.FC<ImageChipProps> = ({ src, name, onRemove }) => {
  const [showPreview, setShowPreview] = useState(false);
  const displayName = name || src.split(/[\\/]/).pop() || 'image';

  return (
    <>
      <div className="image-chip">
        <img
          src={src}
          alt={displayName}
          className="image-chip-thumbnail"
          onClick={() => setShowPreview(true)}
          style={{ cursor: 'pointer' }}
        />
        <span className="image-chip-name" title={displayName}>
          {displayName}
        </span>
        <button
          className="image-chip-remove"
          onClick={onRemove}
          title="Remove image"
        >
          &times;
        </button>
      </div>
      {showPreview && (
        <ImagePreview
          src={src}
          alt={displayName}
          onClose={() => setShowPreview(false)}
        />
      )}
    </>
  );
};

export default ImageChip;
