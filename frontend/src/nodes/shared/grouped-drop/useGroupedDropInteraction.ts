import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent, HTMLAttributes } from 'react';
import { shouldIgnoreGlobalKeyboardShortcut } from '@/utils';
import { resolveGroupedDropMode } from '../drop';
import {
  type GroupedDropPanelTargetDataset,
  type GroupedDropRegionDataset,
  type GroupedDropSlotTargetDataset,
  createGroupedDropRegionDataset,
  createGroupedPanelTargetDataset,
  createGroupedSlotTargetDataset,
} from './dom';
import {
  getGroupedDropModeSemantics,
  isGroupedDropBatchMode,
  type GroupedDropMode,
  type GroupedDropModeSemantics,
} from './types';

type GroupedDropElementProps = HTMLAttributes<HTMLElement>;
type GroupedDropRegionProps = GroupedDropElementProps & GroupedDropRegionDataset;
type GroupedDropPanelProps = GroupedDropElementProps & GroupedDropPanelTargetDataset;
type GroupedDropSlotProps = GroupedDropElementProps & GroupedDropSlotTargetDataset & {
  'data-drop-side'?: string;
};

function resolveDragKeyboardState(options: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): GroupedDropMode {
  return resolveGroupedDropMode(options);
}

export interface UseGroupedDropInteractionResult<TSide extends string> {
  dragMode: GroupedDropMode;
  displayMode: GroupedDropModeSemantics['displayMode'];
  modeSemantics: GroupedDropModeSemantics;
  isBatchMode: boolean;
  inputRegionProps: GroupedDropRegionProps;
  getPanelTargetProps: (options: {
    nodeId: string;
    side: TSide;
    panelLabel?: string;
  }) => GroupedDropPanelProps;
  getSlotTargetProps: (options: {
    nodeId: string;
    groupId: string;
    portId: string;
    side?: string;
  }) => GroupedDropSlotProps;
}

export function useGroupedDropInteraction<TSide extends string>(): UseGroupedDropInteractionResult<TSide> {
  const [dragMode, setDragMode] = useState<GroupedDropMode>('normal');

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    setDragMode(resolveDragKeyboardState({
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    }));
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    setDragMode('normal');
    event.preventDefault();
  }, []);

  useEffect(() => {
    const handleKeyStateChange = (event: KeyboardEvent): void => {
      if (shouldIgnoreGlobalKeyboardShortcut(event)) {
        return;
      }

      setDragMode(resolveDragKeyboardState({
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      }));
    };

    const resetDragMode = (): void => {
      setDragMode('normal');
    };

    window.addEventListener('keydown', handleKeyStateChange);
    window.addEventListener('keyup', handleKeyStateChange);
    window.addEventListener('drop', resetDragMode);
    window.addEventListener('dragend', resetDragMode);

    return () => {
      window.removeEventListener('keydown', handleKeyStateChange);
      window.removeEventListener('keyup', handleKeyStateChange);
      window.removeEventListener('drop', resetDragMode);
      window.removeEventListener('dragend', resetDragMode);
    };
  }, []);

  const inputRegionProps = useMemo<GroupedDropRegionProps>(() => ({
    ...createGroupedDropRegionDataset(dragMode),
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  }), [dragMode, handleDragOver, handleDrop]);
  const modeSemantics = useMemo(() => getGroupedDropModeSemantics(dragMode), [dragMode]);
  const isBatchMode = useMemo(() => isGroupedDropBatchMode(dragMode), [dragMode]);

  const getPanelTargetProps = useCallback((options: {
    nodeId: string;
    side: TSide;
    panelLabel?: string;
  }): GroupedDropPanelProps => {
    return {
      ...createGroupedPanelTargetDataset(options),
    };
  }, []);

  const getSlotTargetProps = useCallback((options: {
    nodeId: string;
    groupId: string;
    portId: string;
    side?: string;
  }): GroupedDropSlotProps => {
    return {
      ...createGroupedSlotTargetDataset(options),
      'data-drop-side': options.side,
    };
  }, []);

  return {
    dragMode,
    displayMode: modeSemantics.displayMode,
    modeSemantics,
    isBatchMode,
    inputRegionProps,
    getPanelTargetProps,
    getSlotTargetProps,
  };
}
