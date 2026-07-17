import { memo, useMemo } from 'react';

type CanvasHintMode = 'idle' | 'selection' | 'multi-select' | 'connecting' | 'drag-import';

interface CanvasActionHintsProps {
  mode: CanvasHintMode;
}

interface HintContent {
  label: string;
  title: string;
  detail: string;
}

const HINT_CONTENT: Record<CanvasHintMode, HintContent> = {
  idle: {
    label: '空闲',
    title: '拖动画布或开始选择节点',
    detail: '右键打开创建菜单，拖入文件导入素材，滚轮配合 Ctrl 缩放画布。',
  },
  selection: {
    label: '节点选中',
    title: '可以移动、连线或继续编辑当前节点',
    detail: '拖动节点改变位置，从节点把手拉出连线，Delete 可删除当前选中节点。',
  },
  'multi-select': {
    label: '多选',
    title: '正在批量操作多个节点',
    detail: '继续拖动可整体移动，空白处拖拽可重新框选，Delete 可批量删除选中内容。',
  },
  connecting: {
    label: '连线中',
    title: '拖到目标节点或目标组完成连接',
    detail: '释放到合法把手上创建连线，移回空白区域则取消当前连接操作。',
  },
  'drag-import': {
    label: '导入中',
    title: '拖入文件到画布指定位置',
    detail: '松手后会在当前位置批量创建素材节点，导入进度会显示在右下角。',
  },
};

export const CanvasActionHints = memo(({ mode }: CanvasActionHintsProps) => {
  const hint = useMemo(() => HINT_CONTENT[mode], [mode]);

  return (
    <div className="canvas-action-hints" aria-live="polite">
      <div className="canvas-action-hints__label">{hint.label}</div>
      <div className="canvas-action-hints__title">{hint.title}</div>
      <div className="canvas-action-hints__detail">{hint.detail}</div>
    </div>
  );
});

CanvasActionHints.displayName = 'CanvasActionHints';

export type { CanvasHintMode };
