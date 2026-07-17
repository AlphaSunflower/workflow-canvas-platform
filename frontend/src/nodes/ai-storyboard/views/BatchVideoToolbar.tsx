import React from 'react';

import {
  AI_VIDEO_GEN_ASPECT_RATIO_OPTIONS,
  AI_VIDEO_GEN_MODEL_OPTIONS,
  AI_VIDEO_GEN_RESOLUTION_OPTIONS,
} from '@/nodes/ai-video-gen/constants';

interface BatchVideoToolbarProps {
  model: string;
  duration: 8;
  aspectRatio: string;
  resolution: string;
  disabled?: boolean;
  onModelChange: (value: string) => void;
  onDurationChange: (value: 8) => void;
  onAspectRatioChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
  onApply: () => void;
}

const VIDEO_DURATION_OPTIONS = [
  { value: 8 as const, label: '8s' },
] as const;

function renderSelectField(
  label: string,
  value: string,
  disabled: boolean,
  onChange: (value: string) => void,
  options: ReadonlyArray<{ value: string | number; label: string }>,
  isOptionDisabled?: (value: string | number) => boolean,
): React.ReactElement {
  return (
    <label className="ai-storyboard-workbench__field">
      <span className="ai-storyboard-workbench__label">{label}</span>
      <select
        className="ai-storyboard-workbench__select nodrag nopan"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={String(option.value)}
            disabled={isOptionDisabled?.(option.value) ?? false}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const BatchVideoToolbar: React.FC<BatchVideoToolbarProps> = ({
  model,
  duration,
  aspectRatio,
  resolution,
  disabled = false,
  onModelChange,
  onDurationChange,
  onAspectRatioChange,
  onResolutionChange,
  onApply,
}) => (
  <div className="ai-storyboard-workbench ai-storyboard-workbench--batch-video">
    <div className="ai-storyboard-workbench__fields">
      {renderSelectField('Video model', model, disabled, onModelChange, AI_VIDEO_GEN_MODEL_OPTIONS)}
      {renderSelectField('Duration', String(duration), disabled, (value) => onDurationChange(Number(value) as 8), VIDEO_DURATION_OPTIONS)}
      {renderSelectField('Aspect', aspectRatio, disabled, onAspectRatioChange, AI_VIDEO_GEN_ASPECT_RATIO_OPTIONS, (value) => (
        resolution === '4k' && value !== '16:9'
      ))}
      {renderSelectField('Resolution', resolution, disabled, onResolutionChange, AI_VIDEO_GEN_RESOLUTION_OPTIONS, (value) => (
        aspectRatio === '9:16' && value === '4k'
      ))}
    </div>

    <div className="ai-storyboard-workbench__end">
      <button
        type="button"
        className="ai-storyboard-workbench__button nodrag nopan"
        disabled={disabled}
        onClick={onApply}
      >
        Apply to all shots
      </button>
    </div>
  </div>
);

BatchVideoToolbar.displayName = 'BatchVideoToolbar';
