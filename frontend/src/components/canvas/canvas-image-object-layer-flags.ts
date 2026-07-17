export function isCanvasImageObjectLayerEnabled(
  envValue: string | undefined = import.meta.env?.VITE_CANVAS_IMAGE_OBJECT_LAYER,
): boolean {
  return envValue !== 'false';
}
