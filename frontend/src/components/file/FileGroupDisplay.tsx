import React, { memo, useMemo } from 'react';
import { FileThumbnail } from './FileThumbnail';
import { MAX_GROUP_FILES } from '../../constants';
import { createModuleLogger } from '../../utils';
import type { FileInfo } from '../../types';

const log = createModuleLogger('file-group-display');

interface FileGroupDisplayProps {
  files: FileInfo[];
  maxDisplay?: number;
  size?: number;
  className?: string;
  onClick?: () => void;
}

const FileGroupDisplayInner: React.FC<FileGroupDisplayProps> = ({ files, maxDisplay = MAX_GROUP_FILES, size = 60, className = '', onClick }) => {
  const displayFiles = useMemo(() => files.slice(0, maxDisplay), [files, maxDisplay]);
  const remainingCount = useMemo(() => Math.max(0, files.length - maxDisplay), [files, maxDisplay]);

  const getLayoutPositions = (count: number): Array<{ x: number; y: number; scale: number }> => {
    const positions: Array<{ x: number; y: number; scale: number }> = [];
    const offset = 4;
    const scale = count === 1 ? 1 : count === 2 ? 0.7 : 0.5;

    switch (count) {
      case 1:
        positions.push({ x: 0, y: 0, scale: 1 });
        break;
      case 2:
        positions.push({ x: 0, y: 0, scale });
        positions.push({ x: size * scale + offset, y: 0, scale });
        break;
      case 3:
        positions.push({ x: size * 0.25, y: 0, scale });
        positions.push({ x: 0, y: size * 0.5 + offset, scale });
        positions.push({ x: size * 0.5 + offset, y: size * 0.5 + offset, scale });
        break;
      case 4:
        positions.push({ x: 0, y: 0, scale });
        positions.push({ x: size * 0.5 + offset, y: 0, scale });
        positions.push({ x: 0, y: size * 0.5 + offset, scale });
        positions.push({ x: size * 0.5 + offset, y: size * 0.5 + offset, scale });
        break;
      default:
        for (let i = 0; i < Math.min(count, 5); i++) {
          const row = Math.floor(i / 3);
          const col = i % 3;
          positions.push({ x: col * (size * 0.33 + offset), y: row * (size * 0.33 + offset), scale: 0.33 });
        }
        break;
    }

    return positions;
  };

  const positions = getLayoutPositions(displayFiles.length);

  const handleClick = (): void => {
    onClick?.();
    log.debug('handleClick', `File group clicked, files: ${files.length}`);
  };

  if (files.length === 0) {
    return <div className={`file-group-display file-group-display--empty ${className}`} onClick={handleClick}><span className="file-group-display__empty-icon">📁</span></div>;
  }

  return (
    <div className={`file-group-display ${className}`} onClick={handleClick} style={{ width: size, height: size }}>
      {displayFiles.map((file, index) => {
        const pos = positions[index];
        if (!pos) return null;

        const thumbnailSize = size * pos.scale;
        return (
          <div key={file.id} className="file-group-display__item" style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, width: thumbnailSize, height: thumbnailSize, zIndex: displayFiles.length - index }}>
            <FileThumbnail src={file.thumbnailPath} alt={file.name} fileType={file.fileType} width={thumbnailSize} height={thumbnailSize} />
          </div>
        );
      })}
      {remainingCount > 0 && <div className="file-group-display__remaining">+{remainingCount}</div>}
    </div>
  );
};

FileGroupDisplayInner.displayName = 'FileGroupDisplayInner';
export const FileGroupDisplay = memo(FileGroupDisplayInner);
FileGroupDisplay.displayName = 'FileGroupDisplay';
