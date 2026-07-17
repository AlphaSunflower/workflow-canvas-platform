import React from 'react';
import type { StoryboardShotData } from '@/types';
import {
  getStoryboardImageStatusText,
  getStoryboardVideoStatusText,
} from './shot-card.shared';
import type { StoryboardShotCollectionViewProps } from './ShotListView';
import { StoryboardShotPreview } from './StoryboardShotPreview';
import { StoryboardStatusBadge } from './StoryboardStatusBadge';

function hasReferenceImage(shot: StoryboardShotData): boolean {
  return Boolean(shot.imageFileId || shot.sourceImageFileId || shot.sourceFileId);
}

export const ShotGridView: React.FC<StoryboardShotCollectionViewProps> = ({
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
          + 添加空白镜头
        </button>
      </div>
    );
  }

  return (
    <div className="ai-storyboard-shot-grid">
      {shots.map((shot) => {
        const preview = previews.get(shot.id);
        const canGenerateImage = shot.prompt.trim().length > 0 && hasReferenceImage(shot) && shot.imageGenStatus !== 'generating';
        const canGenerateVideo = shot.prompt.trim().length > 0 && hasReferenceImage(shot) && shot.videoGenStatus !== 'generating';
        const imageStatusText = getStoryboardImageStatusText(shot);
        const videoStatusText = getStoryboardVideoStatusText(shot);

        return (
          <article
            key={shot.id}
            className="ai-storyboard-shot-grid-card"
          >
            <div className="ai-storyboard-shot-grid-card__preview">
              <div className="ai-storyboard-shot-grid-card__image-wrap">
                <StoryboardShotPreview
                  src={preview?.url}
                  sourceNode={preview?.sourceNode}
                  alt={preview?.label ?? `Shot ${shot.order}`}
                  className="storyboard-shot-card__image ai-storyboard-shot-preview__image"
                  fallback={(
                    <div className="ai-storyboard-shot-preview__fallback">
                      无预览图
                    </div>
                  )}
                />
              </div>

              <div className="ai-storyboard-shot-grid-card__topbar">
                <span className="ai-storyboard-shot-chip">
                  Shot {shot.order}
                </span>
                <div className="ai-storyboard-shot-grid-card__badges">
                  <StoryboardStatusBadge kind="image" status={shot.imageGenStatus} text={imageStatusText} compact />
                  <StoryboardStatusBadge kind="video" status={shot.videoGenStatus} text={videoStatusText} compact />
                </div>
              </div>

              <div className="ai-storyboard-shot-grid-card__overlay-actions">
                <button
                  type="button"
                  className="ai-storyboard-shot-grid-action ai-storyboard-shot-grid-action--image nodrag nopan"
                  disabled={!canGenerateImage}
                  onClick={() => onGenerateShotImage(shot.id)}
                >
                  出图
                </button>
                <button
                  type="button"
                  className="ai-storyboard-shot-grid-action ai-storyboard-shot-grid-action--video nodrag nopan"
                  disabled={!canGenerateVideo}
                  onClick={() => onGenerateShotVideo(shot.id)}
                >
                  视频
                </button>
                <button
                  type="button"
                  className="ai-storyboard-shot-grid-action ai-storyboard-shot-grid-action--danger nodrag nopan"
                  onClick={() => onDeleteShot(shot.id)}
                >
                  删除
                </button>
              </div>
            </div>

            <div className="ai-storyboard-shot-grid-card__body">
              <div className="ai-storyboard-shot-grid-card__meta">
                <div title={preview?.label}>{preview?.label ?? '空白镜头'}</div>
                <div>Grid {shot.row + 1}-{shot.col + 1}</div>
              </div>
              <textarea
                className="ai-storyboard-shot-field__control ai-storyboard-shot-field__textarea ai-storyboard-shot-grid-card__prompt nodrag nopan"
                value={shot.prompt}
                onChange={(event) => onPatchShot(shot.id, { prompt: event.target.value })}
                placeholder="运镜提示词"
                rows={4}
              />
            </div>
          </article>
        );
      })}

      <button
        type="button"
        className="ai-storyboard-shot-grid-add nodrag nopan"
        onClick={onAddBlankShot}
      >
        + 添加空白镜头
      </button>
    </div>
  );
};

ShotGridView.displayName = 'ShotGridView';
