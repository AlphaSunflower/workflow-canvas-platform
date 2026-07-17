function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error('Failed to load image'));
    image.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = (): void => resolve(video);
    video.onerror = (): void => reject(new Error('Failed to load video'));
    video.src = url;
  });
}

export async function probeImageMetadata(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function probeVideoMetadata(file: File): Promise<{ width: number; height: number; duration: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = await loadVideo(objectUrl);
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
