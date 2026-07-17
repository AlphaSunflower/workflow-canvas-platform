import React from 'react';
import type { StoryboardViewMode } from '@/types';

interface StoryboardToolbarProps {
  viewMode: StoryboardViewMode;
  prefixText: string;
  shotCount: number;
  isArranging?: boolean;
  onViewModeChange: (viewMode: StoryboardViewMode) => void;
  onPrefixTextChange: (value: string) => void;
  onApplyPrefix: () => void;
  onArrangeShots: () => void;
  onGenerateAllVideos: () => void;
  arrangeDisabled?: boolean;
  generateAllVideosDisabled?: boolean;
}

const VIEW_MODE_OPTIONS: Array<{ value: StoryboardViewMode; label: string }> = [
  { value: 'list', label: '列表' },
  { value: 'grid', label: '宫格' },
  { value: 'table', label: '表格' },
];

export const StoryboardToolbar: React.FC<StoryboardToolbarProps> = ({
  viewMode,
  prefixText,
  shotCount,
  isArranging = false,
  onViewModeChange,
  onPrefixTextChange,
  onApplyPrefix,
  onArrangeShots,
  onGenerateAllVideos,
  arrangeDisabled = false,
  generateAllVideosDisabled = false,
}) => {
  const canApplyPrefix = shotCount > 0 && prefixText.trim().length > 0;

  return (
    <div className="ai-storyboard-workbench ai-storyboard-workbench--toolbar">
      <div className="ai-storyboard-workbench__main">
        <div className="ai-storyboard-toolbar__actions">
          <button
            type="button"
            className="ai-storyboard-workbench__button ai-storyboard-workbench__button--accent nodrag nopan"
            disabled={arrangeDisabled}
            onClick={onArrangeShots}
            title={arrangeDisabled ? '当前条件不足，无法执行 AI 智能排序与写运镜' : '一键 AI 智能排序与写运镜'}
          >
            {isArranging ? 'AI 编排中...' : '一键 AI 智能排序与写运镜'}
          </button>

          <div className="ai-storyboard-toolbar__prefix">
            <input
              className="ai-storyboard-workbench__input nodrag nopan"
              value={prefixText}
              onChange={(event) => onPrefixTextChange(event.target.value)}
              placeholder="批量添加前缀"
            />
            <button
              type="button"
              className="ai-storyboard-workbench__button nodrag nopan"
              disabled={!canApplyPrefix}
              onClick={onApplyPrefix}
            >
              批量加前缀
            </button>
          </div>

          <button
            type="button"
            className="ai-storyboard-workbench__button nodrag nopan"
            disabled={generateAllVideosDisabled}
            onClick={onGenerateAllVideos}
            title={generateAllVideosDisabled ? '当前没有可派发的视频镜头' : '一键生成视频'}
          >
            一键生成视频
          </button>
        </div>
      </div>

      <label className="ai-storyboard-toolbar__view-switcher">
        <span className="ai-storyboard-workbench__label">视图</span>
        <select
          className="ai-storyboard-workbench__select nodrag nopan"
          value={viewMode}
          onChange={(event) => onViewModeChange(event.target.value as StoryboardViewMode)}
        >
          {VIEW_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};

StoryboardToolbar.displayName = 'StoryboardToolbar';
