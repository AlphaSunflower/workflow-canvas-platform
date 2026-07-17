import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEnv } from "../shared/src/env.ts";

async function writeConfigFile(rootDir: string, config: Record<string, unknown>): Promise<string> {
  const configPath = path.join(rootDir, "backend.config.json");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

async function run(): Promise<void> {
  const originalConfigPath = process.env.BACKEND_CONFIG_PATH;
  const originalVisionTimeout = process.env.LAOZHANG_VISION_TIMEOUT_MS;
  const tempRoots: string[] = [];

  try {
    delete process.env.LAOZHANG_VISION_TIMEOUT_MS;

    const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "env-laozhang-vision-default-"));
    tempRoots.push(defaultRoot);
    process.env.BACKEND_CONFIG_PATH = await writeConfigFile(defaultRoot, {
      runtime: {
        host: "127.0.0.1",
      },
      services: {
        api: {
          port: 0,
        },
      },
      providers: {
        laozhang: {
          vision: {
            apiUrl: "https://example.test/v1/chat/completions",
            model: "gemini-2.5-flash",
          },
        },
      },
    });

    const defaultEnv = createEnv("api");
    assert.equal(defaultEnv.laozhangVisionTimeoutMs, 180000);

    const configuredRoot = await fs.mkdtemp(path.join(os.tmpdir(), "env-laozhang-vision-configured-"));
    tempRoots.push(configuredRoot);
    process.env.BACKEND_CONFIG_PATH = await writeConfigFile(configuredRoot, {
      runtime: {
        host: "127.0.0.1",
      },
      services: {
        api: {
          port: 0,
        },
      },
      providers: {
        laozhang: {
          vision: {
            apiUrl: "https://example.test/v1/chat/completions",
            model: "gemini-2.5-flash",
            timeoutMs: 45000,
          },
        },
      },
    });

    const configuredEnv = createEnv("api");
    assert.equal(configuredEnv.laozhangVisionTimeoutMs, 45000);

    process.env.LAOZHANG_VISION_TIMEOUT_MS = "60000";
    const overriddenEnv = createEnv("api");
    assert.equal(overriddenEnv.laozhangVisionTimeoutMs, 60000);
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.BACKEND_CONFIG_PATH;
    } else {
      process.env.BACKEND_CONFIG_PATH = originalConfigPath;
    }

    if (originalVisionTimeout === undefined) {
      delete process.env.LAOZHANG_VISION_TIMEOUT_MS;
    } else {
      process.env.LAOZHANG_VISION_TIMEOUT_MS = originalVisionTimeout;
    }

    await Promise.all(
      tempRoots.map(async (rootDir) => fs.rm(rootDir, { recursive: true, force: true })),
    );
  }
}

void run();
