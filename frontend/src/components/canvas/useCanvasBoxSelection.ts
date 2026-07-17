import { useCallback, useEffect, useRef, useState } from 'react';
import { recordCanvasTraceEvent } from '@/utils/performance';

interface UseCanvasBoxSelectionResult {
  isBoxSelecting: boolean;
  handleBoxSelectionStart: () => void;
  handleBoxSelectionEnd: () => void;
}

export function useCanvasBoxSelection(): UseCanvasBoxSelectionResult {
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const boxSelectionActiveRef = useRef(false);

  const clearBoxSelectionState = useCallback((): void => {
    boxSelectionActiveRef.current = false;
    setIsBoxSelecting(false);
  }, []);

  const handleBoxSelectionStart = useCallback((): void => {
    boxSelectionActiveRef.current = true;
    recordCanvasTraceEvent({
      type: 'operation.boxSelect',
      phase: 'start',
    });
    setIsBoxSelecting(true);
  }, []);

  const handleBoxSelectionEnd = useCallback((): void => {
    recordCanvasTraceEvent({
      type: 'operation.boxSelect',
      phase: 'end',
    });
    clearBoxSelectionState();
  }, [clearBoxSelectionState]);

  useEffect(() => {
    if (!isBoxSelecting) {
      return;
    }

    const handlePointerRelease = (): void => {
      if (!boxSelectionActiveRef.current) {
        return;
      }

      clearBoxSelectionState();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        handlePointerRelease();
      }
    };

    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    window.addEventListener('mouseup', handlePointerRelease);
    window.addEventListener('blur', handlePointerRelease);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return (): void => {
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
      window.removeEventListener('mouseup', handlePointerRelease);
      window.removeEventListener('blur', handlePointerRelease);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearBoxSelectionState, isBoxSelecting]);

  useEffect(() => {
    document.body.classList.toggle('canvas-box-selecting', isBoxSelecting);

    return (): void => {
      document.body.classList.remove('canvas-box-selecting');
    };
  }, [isBoxSelecting]);

  return {
    isBoxSelecting,
    handleBoxSelectionStart,
    handleBoxSelectionEnd,
  };
}
