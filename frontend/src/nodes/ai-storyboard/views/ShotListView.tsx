import React from 'react';
import type { StoryboardShotData } from '@/types';
import type { StoryboardShotImagePreview } from './shot-card.shared';
import { ShotCard } from './ShotCard';

export interface StoryboardShotCollectionViewProps {
  shots: StoryboardShotData[];
  previews: Map<string, StoryboardShotImagePreview>;
  onPatchShot: (shotId: string, patch: Partial<StoryboardShotData>) => void;
  onDeleteShot: (shotId: string) => void;
  onGenerateShotImage: (shotId: string) => void;
  onGenerateShotVideo: (shotId: string) => void;
}

export const ShotListView: React.FC<StoryboardShotCollectionViewProps> = ({
  shots,
  previews,
  onPatchShot,
  onDeleteShot,
  onGenerateShotImage,
  onGenerateShotVideo,
}) => {
  if (shots.length === 0) {
    return null;
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
    </div>
  );
};

ShotListView.displayName = 'ShotListView';
