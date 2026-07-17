import React from 'react';
import type { StoryboardShotData } from '@/types';
import {
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeModel,
} from '@/nodes/ai-image-gen/constants';
import { resolveAIStoryboardShotImageAvailability } from '../shot-image-execution';
import { resolveAIStoryboardShotVideoAvailability } from '../shot-video-execution';
import { StoryboardShotPreview } from './StoryboardShotPreview';
import {
  STORYBOARD_IMAGE_MODEL_OPTIONS,
  STORYBOARD_IMAGE_SIZE_OPTIONS,
  STORYBOARD_VIDEO_ASPECT_RATIO_OPTIONS,
  STORYBOARD_VIDEO_MODEL_OPTIONS,
  getStoryboardImageAspectRatioOptions,
  getStoryboardImageStatusText,
  getStoryboardVideoResolutionOptionsForAspectRatio,
  getStoryboardVideoStatusText,
  type StoryboardShotImagePreview,
} from './shot-card.shared';

interface ShotCardProps {
  shot: StoryboardShotData;
  preview?: StoryboardShotImagePreview;
  onPatch: (shotId: string, patch: Partial<StoryboardShotData>) => void;
  onDelete: (shotId: string) => void;
  onGenerateImage: (shotId: string) => void;
  onGenerateVideo: (shotId: string) => void;
}

const IMAGE_SIZE_OPTIONS = STORYBOARD_IMAGE_SIZE_OPTIONS;
const VIDEO_ASPECT_RATIO_OPTIONS = STORYBOARD_VIDEO_ASPECT_RATIO_OPTIONS;

function renderSelectField(
  label: string,
  value: string | undefined,
  options: readonly string[],
  onChange: (value: string) => void,
): React.ReactElement {
  return (
    <label className="ai-storyboard-shot-field">
      <span className="ai-storyboard-shot-field__label">{label}</span>
      <select
        className="ai-storyboard-shot-field__control nodrag nopan"
        value={value ?? options[0]}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export const ShotCard: React.FC<ShotCardProps> = ({
  shot,
  preview,
  onPatch,
  onDelete,
  onGenerateImage,
  onGenerateVideo,
}) => {
  const imageAvailability = resolveAIStoryboardShotImageAvailability({ shot });
  const videoAvailability = resolveAIStoryboardShotVideoAvailability({ shot });
  const imageStatusText = getStoryboardImageStatusText(shot);
  const videoStatusText = getStoryboardVideoStatusText(shot);
  const imageRatioOptions = getStoryboardImageAspectRatioOptions(shot.imageModel);
  const videoResolutionOptions = getStoryboardVideoResolutionOptionsForAspectRatio(shot.videoAspectRatio);
  const showImageParameterControls = !isAIImageGenNodeParameterlessModel(
    normalizeAIImageGenNodeModel(shot.imageModel),
  );

  return (
    <article className="ai-storyboard-shot-card">
      <div className="ai-storyboard-shot-card__media-column">
        <div className="ai-storyboard-shot-preview">
          <StoryboardShotPreview
            src={preview?.url}
            sourceNode={preview?.sourceNode}
            alt={preview?.label ?? `Shot ${shot.order}`}
            className="storyboard-shot-card__image ai-storyboard-shot-preview__image"
            fallback={(
              <div className="ai-storyboard-shot-preview__fallback">
                No image
              </div>
            )}
          />
          <span className="ai-storyboard-shot-chip">
            Shot {shot.order}
          </span>
        </div>

        <div className="ai-storyboard-shot-card__meta">
          <div className="ai-storyboard-shot-card__meta-title" title={preview?.label}>
            {preview?.label ?? 'Unlinked shot'}
          </div>
          <div>Grid {shot.row + 1}-{shot.col + 1}</div>
        </div>
      </div>

      <div className="ai-storyboard-shot-card__body">
        <div className="ai-storyboard-shot-card__header">
          <strong className="ai-storyboard-shot-card__title">Shot {shot.order}</strong>
          <div className="ai-storyboard-shot-card__actions">
            <button
              type="button"
              className="ai-storyboard-shot-action ai-storyboard-shot-action--image nodrag nopan"
              onClick={() => onGenerateImage(shot.id)}
              disabled={!imageAvailability.enabled}
            >
              {shot.imageGenStatus === 'generating' ? 'Generating image' : 'Generate image'}
            </button>
            <button
              type="button"
              className="ai-storyboard-shot-action ai-storyboard-shot-action--video nodrag nopan"
              onClick={() => onGenerateVideo(shot.id)}
              disabled={!videoAvailability.enabled}
            >
              {shot.videoGenStatus === 'generating' ? 'Generating video' : 'Generate video'}
            </button>
            <button
              type="button"
              className="ai-storyboard-shot-action ai-storyboard-shot-action--danger nodrag nopan"
              onClick={() => onDelete(shot.id)}
            >
              Delete shot
            </button>
          </div>
        </div>

        {!imageAvailability.enabled ? (
          <div className="ai-storyboard-shot-card__hint">
            {imageAvailability.reason}
          </div>
        ) : null}

        {!videoAvailability.enabled ? (
          <div className="ai-storyboard-shot-card__hint">
            {videoAvailability.reason}
          </div>
        ) : null}

        {imageStatusText ? (
          <div className={`ai-storyboard-status-message ai-storyboard-status-message--image ai-storyboard-status-message--${shot.imageGenStatus}`}>
            {imageStatusText}
          </div>
        ) : null}

        {videoStatusText ? (
          <div className={`ai-storyboard-status-message ai-storyboard-status-message--video ai-storyboard-status-message--${shot.videoGenStatus}`}>
            {videoStatusText}
          </div>
        ) : null}

        <label className="ai-storyboard-shot-field">
          <span className="ai-storyboard-shot-field__label">Prompt</span>
          <textarea
            className="ai-storyboard-shot-field__control ai-storyboard-shot-field__textarea nodrag nopan"
            value={shot.prompt}
            onChange={(event) => onPatch(shot.id, { prompt: event.target.value })}
            placeholder="Describe this shot"
            rows={4}
          />
        </label>

        <div className="ai-storyboard-shot-field-grid ai-storyboard-shot-field-grid--image">
          {renderSelectField('Image model', shot.imageModel, STORYBOARD_IMAGE_MODEL_OPTIONS, (value) => onPatch(shot.id, { imageModel: value }))}
          {showImageParameterControls ? renderSelectField('Image aspect ratio', shot.imageAspectRatio, imageRatioOptions, (value) => onPatch(shot.id, { imageAspectRatio: value })) : null}
          {showImageParameterControls ? renderSelectField('Image size', shot.imageSize, IMAGE_SIZE_OPTIONS, (value) => onPatch(shot.id, { imageSize: value })) : null}
        </div>

        <div className="ai-storyboard-shot-field-grid ai-storyboard-shot-field-grid--video">
          {renderSelectField('Video model', shot.videoModel, STORYBOARD_VIDEO_MODEL_OPTIONS, (value) => onPatch(shot.id, { videoModel: value }))}
          {renderSelectField('Duration', String(shot.videoDuration), ['8'], () => onPatch(shot.id, { videoDuration: 8 }))}
          {renderSelectField('Video aspect ratio', shot.videoAspectRatio, VIDEO_ASPECT_RATIO_OPTIONS, (value) => onPatch(shot.id, { videoAspectRatio: value }))}
          {renderSelectField('Video resolution', shot.videoResolution, videoResolutionOptions, (value) => onPatch(shot.id, { videoResolution: value }))}
        </div>
      </div>
    </article>
  );
};

ShotCard.displayName = 'ShotCard';
