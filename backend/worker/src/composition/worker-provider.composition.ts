import { LaozhangClient } from "../modules/providers/laozhang/laozhang.client.ts";
import { LaozhangVeoClient } from "../modules/providers/laozhang/laozhang-veo.client.ts";
import { createLaozhangLongTimeoutFetch } from "../modules/providers/laozhang/laozhang-long-timeout-fetch.ts";
import { RunningHubClient } from "../modules/providers/runninghub/runninghub.client.ts";
import { RunningHubWorkflowTemplateService } from "../modules/providers/runninghub/runninghub-workflow-template.service.ts";
import { DbProviderConcurrencyService } from "../modules/queue/db-provider-concurrency.service.ts";
import { ProviderConcurrencyService } from "../modules/queue/provider-concurrency.service.ts";
import type { WorkerCompositionContext } from "./worker-composition.context.ts";

export function composeWorkerProviders(context: WorkerCompositionContext) {
  const workerId = `worker-${process.pid}`;
  const providerConcurrencyService = context.resolve(
    "providerConcurrencyService",
    () => {
      const config = {
        maxConcurrencyByProvider: {
          runninghub: context.env.runninghubMaxConcurrency,
          "ai-video-gen": context.env.laozhangVeoMaxConcurrency,
        },
      };

      return context.env.persistenceMode === "db"
        ? new DbProviderConcurrencyService(context.env.database, {
          ...config,
          workerId,
        })
        : new ProviderConcurrencyService(config);
    },
  );
  const laozhangClient = new LaozhangClient({
    apiKey: context.env.laozhangApiKey,
    apiUrl: context.env.laozhangApiUrl,
    openaiApiBaseUrl: context.env.laozhangOpenaiApiBaseUrl,
    sora2OfficialApiKey: context.env.laozhangSora2OfficialApiKey,
    sora2OfficialApiBaseUrl: context.env.laozhangSora2OfficialApiBaseUrl,
    snapshotDir: context.snapshotDir,
  });
  const laozhangVeoClient = new LaozhangVeoClient({
    apiKey: context.env.laozhangApiKey,
    apiBaseUrl: context.env.laozhangVeoApiBaseUrl,
    snapshotDir: context.snapshotDir,
    fetchImpl: createLaozhangLongTimeoutFetch(),
  });
  const runningHubClient = new RunningHubClient({
    apiKey: context.env.runninghubApiKey,
    apiBaseUrl: context.env.runninghubApiBaseUrl ?? "https://www.runninghub.cn",
    snapshotDir: context.snapshotDir,
  });
  const runningHubWorkflowTemplateService = new RunningHubWorkflowTemplateService({
    backendRoot: context.rootDir,
    snapshotDir: context.snapshotDir,
  });

  return {
    providerConcurrencyService,
    workerId,
    laozhangClient,
    laozhangVeoClient,
    runningHubClient,
    runningHubWorkflowTemplateService,
  };
}
