import React, { useState } from 'react';
import { Handle, Position } from 'reactflow';
import type { StoryboardShotData } from '@/types';
import {
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeModel,
} from '@/nodes/ai-image-gen/constants';
import { getAIStoryboardShotOutputHandle } from '../groups';
import { resolveAIStoryboardShotImageAvailability } from '../shot-image-execution';
import { resolveAIStoryboardShotVideoAvailability } from '../shot-video-execution';
import { StoryboardShotPreview } from './StoryboardShotPreview';
import { StoryboardStatusBadge } from './StoryboardStatusBadge';
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

export interface StoryboardShotTimelineViewProps {
  shots: StoryboardShotData[];
  previews: Map<string, StoryboardShotImagePreview>;
  nodeColor: string;
  onPatchShot: (shotId: string, patch: Partial<StoryboardShotData>) => void;
  onDeleteShot: (shotId: string) => void;
  onGenerateShotImage: (shotId: string) => void;
  onGenerateShotVideo: (shotId: string) => void;
}

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

export const ShotTimelineView: React.FC<StoryboardShotTimelineViewProps> = ({
  shots,
  previews,
  nodeColor,
  onPatchShot,
  onDeleteShot,
  onGenerateShotImage,
  onGenerateShotVideo,
}) => {
  const [expandedShotIds, setExpandedShotIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpandedShot = (shotId: string): void => {
    setExpandedShotIds((current) => {
      const next = new Set(current);
      if (next.has(shotId)) {
        next.delete(shotId);
      } else {
        next.add(shotId);
      }
      return next;
    });
  };

  if (shots.length === 0) {
    return null;
  }

  return (
    <div className="ai-storyboard-shot-timeline">
      {shots.map((shot) => {
        const preview = previews.get(shot.id);
        const imageAvailability = resolveAIStoryboardShotImageAvailability({ shot });
        const videoAvailability = resolveAIStoryboardShotVideoAvailability({ shot });
        const imageStatusText = getStoryboardImageStatusText(shot);
        const videoStatusText = getStoryboardVideoStatusText(shot);
        const imageRatioOptions = getStoryboardImageAspectRatioOptions(shot.imageModel);
        const videoResolutionOptions = getStoryboardVideoResolutionOptionsForAspectRatio(shot.videoAspectRatio);
        const showImageParameterControls = !isAIImageGenNodeParameterlessModel(
          normalizeAIImageGenNodeModel(shot.imageModel),
        );
        const isExpanded = expandedShotIds.has(shot.id);

        return (
          <article
            key={shot.id}
            className={[
              'ai-storyboard-shot-row',
              isExpanded ? 'ai-storyboard-shot-row--expanded' : '',
            ].filter(Boolean).join(' ')}
          >
            <Handle
              id={getAIStoryboardShotOutputHandle(shot.id)}
              type="source"
              position={Position.Right}
              className="react-flow__handle ai-image-gen-node__group-output-handle ai-storyboard-shot-row__output-handle nodrag nopan"
              style={{
                background: nodeColor,
                top: '50%',
                right: -7,
                transform: 'translateY(-50%)',
              }}
            />

            <div className="ai-storyboard-shot-row__preview">
              <StoryboardShotPreview
                src={preview?.url}
                sourceNode={preview?.sourceNode}
                alt={preview?.label ?? `Shot ${shot.order}`}
                className="storyboard-shot-card__image ai-storyboard-shot-preview__image"
                fallback={(
                  <div className="ai-storyboard-shot-preview__fallback">
                    无预览
                  </div>
                )}
              />
              <span className="ai-storyboard-shot-chip">Shot {shot.order}</span>
            </div>

            <div className="ai-storyboard-shot-row__editor">
              <div className="ai-storyboard-shot-row__titlebar">
                <div className="ai-storyboard-shot-row__identity">
                  <strong>Shot {shot.order}</strong>
                  <span title={preview?.label}>{preview?.label ?? '空白镜头'}</span>
                </div>
                <div className="ai-storyboard-shot-row__status">
                  <StoryboardStatusBadge kind="image" status={shot.imageGenStatus} text={imageStatusText} compact />
                  <StoryboardStatusBadge kind="video" status={shot.videoGenStatus} text={videoStatusText} compact />
                </div>
              </div>

              <textarea
                className="ai-storyboard-shot-field__control ai-storyboard-shot-field__textarea ai-storyboard-shot-row__prompt nodrag nopan"
                value={shot.prompt}
                onChange={(event) => onPatchShot(shot.id, { prompt: event.target.value })}
                placeholder="描述这个镜头的画面、运镜和动作"
                rows={3}
              />

              {(imageAvailability.reason || videoAvailability.reason) ? (
                <div className="ai-storyboard-shot-row__hint">
                  {imageAvailability.reason ?? videoAvailability.reason}
                </div>
              ) : null}

              {isExpanded ? (
                <div className="ai-storyboard-shot-row__advanced">
                  <div className="ai-storyboard-shot-row__advanced-group">
                    {renderSelectField('图像模型', shot.imageModel, STORYBOARD_IMAGE_MODEL_OPTIONS, (value) => onPatchShot(shot.id, { imageModel: value }))}
                    {showImageParameterControls ? renderSelectField('图像比例', shot.imageAspectRatio, imageRatioOptions, (value) => onPatchShot(shot.id, { imageAspectRatio: value })) : null}
                    {showImageParameterControls ? renderSelectField('图像尺寸', shot.imageSize, STORYBOARD_IMAGE_SIZE_OPTIONS, (value) => onPatchShot(shot.id, { imageSize: value })) : null}
                  </div>
                  <div className="ai-storyboard-shot-row__advanced-group">
                    {renderSelectField('视频模型', shot.videoModel, STORYBOARD_VIDEO_MODEL_OPTIONS, (value) => onPatchShot(shot.id, { videoModel: value }))}
                    {renderSelectField('时长', String(shot.videoDuration), ['8'], () => onPatchShot(shot.id, { videoDuration: 8 }))}
                    {renderSelectField('视频比例', shot.videoAspectRatio, STORYBOARD_VIDEO_ASPECT_RATIO_OPTIONS, (value) => onPatchShot(shot.id, { videoAspectRatio: value }))}
                    {renderSelectField('视频分辨率', shot.videoResolution, videoResolutionOptions, (value) => onPatchShot(shot.id, { videoResolution: value }))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="ai-storyboard-shot-row__actions">
              <button
                type="button"
                className="ai-storyboard-shot-action ai-storyboard-shot-action--image nodrag nopan"
                onClick={() => onGenerateShotImage(shot.id)}
                disabled={!imageAvailability.enabled}
              >
                {shot.imageGenStatus === 'generating' ? '出图中' : '出图'}
              </button>
              <button
                type="button"
                className="ai-storyboard-shot-action ai-storyboard-shot-action--video nodrag nopan"
                onClick={() => onGenerateShotVideo(shot.id)}
                disabled={!videoAvailability.enabled}
              >
                {shot.videoGenStatus === 'generating' ? '视频中' : '视频'}
              </button>
              <button
                type="button"
                className="ai-storyboard-shot-action nodrag nopan"
                onClick={() => toggleExpandedShot(shot.id)}
              >
                {isExpanded ? '收起参数' : '参数'}
              </button>
              <button
                type="button"
                className="ai-storyboard-shot-action ai-storyboard-shot-action--danger nodrag nopan"
                onClick={() => onDeleteShot(shot.id)}
              >
                删除
              </button>
            </div>
          </article>
        );
      })}

    </div>
  );
};

ShotTimelineView.displayName = 'ShotTimelineView';
