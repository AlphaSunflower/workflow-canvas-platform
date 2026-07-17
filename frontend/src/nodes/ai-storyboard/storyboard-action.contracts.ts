export interface StoryboardNodeActionServices {
  arrange: (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
    },
  ) => Promise<void>;
  runShotImage: (
    nodeId: string,
    shotId: string,
    options?: {
      signal?: AbortSignal;
    },
  ) => Promise<void>;
  runShotVideo: (
    nodeId: string,
    shotId: string,
    options?: {
      signal?: AbortSignal;
      suppressNotifications?: boolean;
    },
  ) => Promise<void>;
  runBatchVideo: (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
    },
  ) => Promise<void>;
}
