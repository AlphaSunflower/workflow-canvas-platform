import React from 'react';
import type { StoryboardShotData } from '@/types';
import {
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeModel,
} from '@/nodes/ai-image-gen/constants';
import {
  STORYBOARD_IMAGE_MODEL_OPTIONS,
  STORYBOARD_IMAGE_SIZE_OPTIONS,
  STORYBOARD_VIDEO_ASPECT_RATIO_OPTIONS,
  STORYBOARD_VIDEO_MODEL_OPTIONS,
  getStoryboardImageAspectRatioOptions,
  getStoryboardImageStatusText,
  getStoryboardVideoResolutionOptionsForAspectRatio,
  getStoryboardVideoStatusText,
} from './shot-card.shared';
import type { StoryboardShotCollectionViewProps } from './ShotListView';
import { StoryboardStatusBadge } from './StoryboardStatusBadge';

function renderCellSelect(
  value: string | undefined,
  options: readonly string[],
  onChange: (value: string) => void,
): React.ReactElement {
  return (
    <select
      className="ai-storyboard-shot-table__control nodrag nopan"
      value={value ?? options[0]}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function hasReferenceImage(shot: StoryboardShotData): boolean {
  return Boolean(shot.imageFileId || shot.sourceImageFileId || shot.sourceFileId);
}

export const ShotTableView: React.FC<StoryboardShotCollectionViewProps> = ({
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
          + Add shot
        </button>
      </div>
    );
  }

  return (
    <div className="ai-storyboard-shot-table-shell">
      <table className="ai-storyboard-shot-table">
        <thead>
          <tr>
            {['Shot', 'Asset', 'Prompt', 'Image params', 'Video params', 'Status', 'Actions'].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shots.map((shot) => {
            const preview = previews.get(shot.id);
            const hasPreview = Boolean(preview?.sourceNode || preview?.url);
            const canGenerateImage = shot.prompt.trim().length > 0 && hasReferenceImage(shot) && shot.imageGenStatus !== 'generating';
            const canGenerateVideo = shot.prompt.trim().length > 0 && hasReferenceImage(shot) && shot.videoGenStatus !== 'generating';
            const imageStatusText = getStoryboardImageStatusText(shot);
            const videoStatusText = getStoryboardVideoStatusText(shot);
            const imageRatioOptions = getStoryboardImageAspectRatioOptions(shot.imageModel);
            const videoResolutionOptions = getStoryboardVideoResolutionOptionsForAspectRatio(shot.videoAspectRatio);
            const showImageParameterControls = !isAIImageGenNodeParameterlessModel(
              normalizeAIImageGenNodeModel(shot.imageModel),
            );

            return (
              <tr key={shot.id}>
                <td>
                  <div className="ai-storyboard-shot-table__shot-title">Shot {shot.order}</div>
                  <div className="ai-storyboard-shot-table__muted">
                    Grid {shot.row + 1}-{shot.col + 1}
                  </div>
                </td>
                <td className="ai-storyboard-shot-table__asset-cell">
                  <div className="ai-storyboard-shot-table__asset">
                    <div title={preview?.label}>{preview?.label ?? 'Unlinked shot'}</div>
                    <div className="ai-storyboard-shot-table__muted">
                      {hasPreview ? 'Preview ready' : 'No preview'}
                    </div>
                  </div>
                </td>
                <td className="ai-storyboard-shot-table__prompt-cell">
                  <textarea
                    className="ai-storyboard-shot-table__control ai-storyboard-shot-table__textarea nodrag nopan"
                    value={shot.prompt}
                    onChange={(event) => onPatchShot(shot.id, { prompt: event.target.value })}
                    rows={4}
                  />
                </td>
                <td className="ai-storyboard-shot-table__params-cell">
                  <div className="ai-storyboard-shot-table__stack">
                    {renderCellSelect(shot.imageModel, STORYBOARD_IMAGE_MODEL_OPTIONS, (value) => onPatchShot(shot.id, { imageModel: value }))}
                    {showImageParameterControls ? renderCellSelect(shot.imageAspectRatio, imageRatioOptions, (value) => onPatchShot(shot.id, { imageAspectRatio: value })) : null}
                    {showImageParameterControls ? renderCellSelect(shot.imageSize, STORYBOARD_IMAGE_SIZE_OPTIONS, (value) => onPatchShot(shot.id, { imageSize: value })) : null}
                  </div>
                </td>
                <td className="ai-storyboard-shot-table__params-cell">
                  <div className="ai-storyboard-shot-table__stack">
                    {renderCellSelect(shot.videoModel, STORYBOARD_VIDEO_MODEL_OPTIONS, (value) => onPatchShot(shot.id, { videoModel: value }))}
                    {renderCellSelect(String(shot.videoDuration), ['8'], () => onPatchShot(shot.id, { videoDuration: 8 }))}
                    {renderCellSelect(shot.videoAspectRatio, STORYBOARD_VIDEO_ASPECT_RATIO_OPTIONS, (value) => onPatchShot(shot.id, { videoAspectRatio: value }))}
                    {renderCellSelect(shot.videoResolution, videoResolutionOptions, (value) => onPatchShot(shot.id, { videoResolution: value }))}
                  </div>
                </td>
                <td className="ai-storyboard-shot-table__status-cell">
                  <div className="ai-storyboard-shot-table__stack">
                    <StoryboardStatusBadge kind="image" status={shot.imageGenStatus} text={imageStatusText} />
                    <StoryboardStatusBadge kind="video" status={shot.videoGenStatus} text={videoStatusText} />
                  </div>
                </td>
                <td className="ai-storyboard-shot-table__actions-cell">
                  <div className="ai-storyboard-shot-table__stack">
                    <button
                      type="button"
                      className="ai-storyboard-shot-action ai-storyboard-shot-action--image nodrag nopan"
                      disabled={!canGenerateImage}
                      onClick={() => onGenerateShotImage(shot.id)}
                    >
                      Generate image
                    </button>
                    <button
                      type="button"
                      className="ai-storyboard-shot-action ai-storyboard-shot-action--video nodrag nopan"
                      disabled={!canGenerateVideo}
                      onClick={() => onGenerateShotVideo(shot.id)}
                    >
                      Generate video
                    </button>
                    <button
                      type="button"
                      className="ai-storyboard-shot-action ai-storyboard-shot-action--danger nodrag nopan"
                      onClick={() => onDeleteShot(shot.id)}
                    >
                      Delete shot
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

ShotTableView.displayName = 'ShotTableView';
