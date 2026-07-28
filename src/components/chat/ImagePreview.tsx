import React, { useEffect } from 'react';

interface ImagePreviewProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ src, alt, onClose }) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="image-preview-overlay" onClick={onClose}>
      <img
        src={src}
        alt={alt ?? 'Preview'}
        className="image-preview-overlay__img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};
