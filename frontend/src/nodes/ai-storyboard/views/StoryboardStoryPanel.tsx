import React from 'react';

import type { StoryboardCreationType } from '@/api';

const CREATION_TYPE_OPTIONS: ReadonlyArray<{ value: StoryboardCreationType; label: string }> = [
  { value: 'architecture', label: '建筑漫游' },
  { value: 'product', label: '产品展示' },
  { value: 'narrative', label: '故事叙述' },
  { value: 'custom', label: '自定义' },
] as const;

interface StoryboardStoryPanelProps {
  storyText: string;
  creationType: StoryboardCreationType;
  isGenerating: boolean;
  generateDisabled: boolean;
  generateDisabledReason: string | null;
  onStoryTextChange: (value: string) => void;
  onCreationTypeChange: (value: StoryboardCreationType) => void;
  onGenerate: () => void;
}

export const StoryboardStoryPanel: React.FC<StoryboardStoryPanelProps> = ({
  storyText,
  creationType,
  isGenerating,
  generateDisabled,
  generateDisabledReason,
  onStoryTextChange,
  onCreationTypeChange,
  onGenerate,
}) => {
  return (
    <div className="ai-storyboard-story-panel">
      <div className="ai-storyboard-story-panel__header">
        <span className="ai-storyboard-story-panel__title">剧情驱动分镜</span>
      </div>

      <div className="ai-storyboard-story-panel__fields">
        <label className="ai-storyboard-story-panel__field">
          <span className="ai-storyboard-story-panel__label">创作类型</span>
          <select
            className="ai-storyboard-story-panel__select nodrag nopan"
            value={creationType}
            disabled={isGenerating}
            onChange={(event) => onCreationTypeChange(event.target.value as StoryboardCreationType)}
          >
            {CREATION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="ai-storyboard-story-panel__field ai-storyboard-story-panel__field--full">
          <span className="ai-storyboard-story-panel__label">剧情描述</span>
          <textarea
            className="ai-storyboard-story-panel__textarea nodrag nopan"
            value={storyText}
            disabled={isGenerating}
            placeholder="输入剧情文本，AI 将自动拆分为 6-12 个分镜镜头，并生成专业的视频提示词..."
            rows={4}
            onChange={(event) => onStoryTextChange(event.target.value)}
          />
        </label>
      </div>

      {generateDisabled && generateDisabledReason && !isGenerating && (
        <div className="ai-storyboard-story-panel__hint">
          {generateDisabledReason}
        </div>
      )}

      <div className="ai-storyboard-story-panel__actions">
        <button
          className="ai-storyboard-story-panel__generate-btn"
          type="button"
          disabled={generateDisabled || isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? '生成中...' : 'AI 生成分镜'}
        </button>
      </div>
    </div>
  );
};
