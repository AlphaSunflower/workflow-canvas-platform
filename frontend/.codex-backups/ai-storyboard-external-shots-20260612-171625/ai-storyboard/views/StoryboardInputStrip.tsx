import React from 'react';

import type { StoryboardResolvedInputImage } from '../types';
import { StoryboardShotPreview } from './StoryboardShotPreview';

interface StoryboardInputStripProps {
  inputImages: StoryboardResolvedInputImage[];
  onArrangeShots: () => void;
  arrangeDisabled?: boolean;
  isArranging?: boolean;
}

export const StoryboardInputStrip: React.FC<StoryboardInputStripProps> = ({
  inputImages,
  onArrangeShots,
  arrangeDisabled = false,
  isArranging = false,
}) => (
  <section className="ai-storyboard-input-strip">
    <div className="ai-storyboard-input-strip__header">
      <div>
        <div className="ai-storyboard-input-strip__title">输入素材</div>
        <div className="ai-storyboard-input-strip__meta">
          {inputImages.length > 0 ? `${inputImages.length} 张图片已接入` : '拖入图片后可自动建立镜头'}
        </div>
      </div>
      <button
        type="button"
        className="ai-storyboard-workbench__button ai-storyboard-workbench__button--accent nodrag nopan"
        disabled={arrangeDisabled}
        onClick={onArrangeShots}
      >
        {isArranging ? 'AI 编排中...' : 'AI 编排'}
      </button>
    </div>

    {inputImages.length > 0 ? (
      <div className="ai-storyboard-input-strip__items">
        {inputImages.map((input, index) => (
          <div
            key={`${input.sourceNodeId}:${input.sourceFileId}:${index}`}
            className="ai-storyboard-input-strip__item"
            title={input.fileName}
          >
            <StoryboardShotPreview
              sourceNode={input.sourceNode}
              alt={input.fileName}
              className="ai-storyboard-input-strip__image"
              fallback={(
                <div className="ai-storyboard-input-strip__fallback">
                  {index + 1}
                </div>
              )}
            />
            <span className="ai-storyboard-input-strip__index">{index + 1}</span>
          </div>
        ))}
      </div>
    ) : (
      <div className="ai-storyboard-input-strip__empty">
        将上游图片连接或拖入此节点
      </div>
    )}
  </section>
);

StoryboardInputStrip.displayName = 'StoryboardInputStrip';
