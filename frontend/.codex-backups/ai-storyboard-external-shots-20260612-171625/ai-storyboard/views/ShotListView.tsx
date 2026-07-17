import React from 'react';
import type { StoryboardShotData } from '@/types';
import type { StoryboardShotImagePreview } from './shot-card.shared';
import { ShotCard } from './ShotCard';

export interface StoryboardShotCollectionViewProps {
  shots: StoryboardShotData[];
  previews: Map<string, StoryboardShotImagePreview>;
  emptyStateText: string;
  onPatchShot: (shotId: string, patch: Partial<StoryboardShotData>) => void;
  onDeleteShot: (shotId: string) => void;
  onGenerateShotImage: (shotId: string) => void;
  onGenerateShotVideo: (shotId: string) => void;
  onAddBlankShot: () => void;
}

export const ShotListView: React.FC<StoryboardShotCollectionViewProps> = ({
  shots,
  previews,
  emptyStateText,
  onPatchShot,
  onDeleteShot,
  onGenerateShotImage,
  onGenerateShotVideo,
  onAddBlankShot,
}) => {
  if (shots.length === 0) {
    return (
      <div className="ai-storyboard-shot-empty-state">
        <div className="ai-storyboard-shot-empty-state__text">{emptyStateText}</div>
        <button
          type="button"
          className="ai-storyboard-shot-empty-state__button nodrag nopan"
          onClick={onAddBlankShot}
        >
          添加空白镜头
        </button>
      </div>
    );
  }

  return (
    <div className="ai-storyboard-shot-list">
      {shots.map((shot) => (
        <ShotCard
          key={shot.id}
          shot={shot}
          preview={previews.get(shot.id)}
          onPatch={onPatchShot}
          onDelete={onDeleteShot}
          onGenerateImage={onGenerateShotImage}
          onGenerateVideo={onGenerateShotVideo}
        />
      ))}

      <button
        type="button"
        className="ai-storyboard-shot-add-card nodrag nopan"
        onClick={onAddBlankShot}
      >
        + 添加空白镜头
      </button>
    </div>
  );
};

ShotListView.displayName = 'ShotListView';
