import React from 'react';

interface StoryboardMetaBarProps {
  imageCount: number;
  shotCount: number;
}

export const StoryboardMetaBar: React.FC<StoryboardMetaBarProps> = ({
  imageCount,
  shotCount,
}) => (
  <div className="ai-storyboard-workbench ai-storyboard-workbench--meta">
    <div className="ai-storyboard-meta__summary">
      <div className="ai-storyboard-meta__stat">
        <span className="ai-storyboard-workbench__label">输入图片</span>
        <strong>{imageCount}</strong>
      </div>
      <div className="ai-storyboard-meta__stat">
        <span className="ai-storyboard-workbench__label">镜头数</span>
        <strong>{shotCount}</strong>
      </div>
    </div>
  </div>
);

StoryboardMetaBar.displayName = 'StoryboardMetaBar';
