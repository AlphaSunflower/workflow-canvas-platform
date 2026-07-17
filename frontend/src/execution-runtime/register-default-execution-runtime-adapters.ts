import { registerExecutionRuntimeNodeAdapter } from './node-execution-adapter.registry';
import { aiImageGenExecutionRuntimeAdapter } from './adapters/ai-image-gen.adapter';
import { aiImageInpaintExecutionRuntimeAdapter } from './adapters/ai-image-inpaint.adapter';
import { aiImageToPlyExecutionRuntimeAdapter } from './adapters/ai-image-to-ply.adapter';
import { aiMultiViewRestoreExecutionRuntimeAdapter } from './adapters/ai-multi-view-restore.adapter';
import { aiStoryboardExecutionRuntimeAdapter } from './adapters/ai-storyboard.adapter';
import { aiVideoGenExecutionRuntimeAdapter } from './adapters/ai-video-gen.adapter';
import { whiteModelRenderExecutionRuntimeAdapter } from './adapters/white-model-render.adapter';

let defaultsRegistered = false;

export function registerDefaultExecutionRuntimeAdapters(): void {
  if (defaultsRegistered) {
    return;
  }

  registerExecutionRuntimeNodeAdapter(aiImageGenExecutionRuntimeAdapter, {
    override: true,
  });
  registerExecutionRuntimeNodeAdapter(aiImageInpaintExecutionRuntimeAdapter, {
    override: true,
  });
  registerExecutionRuntimeNodeAdapter(aiImageToPlyExecutionRuntimeAdapter, {
    override: true,
  });
  registerExecutionRuntimeNodeAdapter(aiMultiViewRestoreExecutionRuntimeAdapter, {
    override: true,
  });
  registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, {
    override: true,
  });
  registerExecutionRuntimeNodeAdapter(aiVideoGenExecutionRuntimeAdapter, {
    override: true,
  });
  registerExecutionRuntimeNodeAdapter(whiteModelRenderExecutionRuntimeAdapter, {
    override: true,
  });

  defaultsRegistered = true;
}

export function resetDefaultExecutionRuntimeAdapterRegistrationForTests(): void {
  defaultsRegistered = false;
}
