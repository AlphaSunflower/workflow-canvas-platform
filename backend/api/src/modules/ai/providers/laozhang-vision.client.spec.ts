import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_REFERENCE_SYSTEM_PROMPT,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_SYSTEM_PROMPT,
} from "../prompt-optimize.constants.ts";
import { buildPromptOptimizeMessages } from "../prompt-optimize.messages.ts";
import {
  AI_STORYBOARD_ARRANGE_IMAGE_INFO_TEXT_TEMPLATE,
  buildStoryboardArrangeUserPrompt,
} from "../storyboard-arrange.constants.ts";
import { buildStoryboardArrangeMessages } from "../storyboard-arrange.messages.ts";
import { LaozhangVisionClient } from "./laozhang-vision.client.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function buildShotInfoText(shotId: string): string {
  return AI_STORYBOARD_ARRANGE_IMAGE_INFO_TEXT_TEMPLATE.replace("{{shotId}}", shotId);
}

test("buildPromptOptimizeMessages preserves fixed system prompt and image order", () => {
  const messages = buildPromptOptimizeMessages({
    prompt: "改成欧式风格",
    images: [
      { dataUrl: "data:image/jpeg;base64,image-1" },
      { dataUrl: "data:image/jpeg;base64,image-2" },
    ],
  });

  assert.equal(messages.length, 2);
  assert.equal(
    messages[0]?.content,
    `${AI_IMAGE_GEN_PROMPT_OPTIMIZE_SYSTEM_PROMPT}\n\n${AI_IMAGE_GEN_PROMPT_OPTIMIZE_REFERENCE_SYSTEM_PROMPT}`,
  );

  const userContent = messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  assert.equal(userContent[0]?.type, "text");
  assert.equal(userContent[1]?.type, "image_url");
  assert.equal(userContent[2]?.type, "image_url");
  assert.equal(userContent[1]?.image_url.url, "data:image/jpeg;base64,image-1");
  assert.equal(userContent[2]?.image_url.url, "data:image/jpeg;base64,image-2");
});

test("buildPromptOptimizeMessages supports text-only prompt optimization", () => {
  const messages = buildPromptOptimizeMessages({
    prompt: "设计一个赛博朋克风格的咖啡杯商品主图",
    images: [],
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.content, AI_IMAGE_GEN_PROMPT_OPTIMIZE_SYSTEM_PROMPT);

  const userContent = messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  assert.equal(userContent.length, 1);
  assert.equal(userContent[0]?.type, "text");
});

test("LaozhangVisionClient sends chat completions payload with text plus ordered image urls and cleans response text", async () => {
  const requests: Array<{
    url: string;
    payload: {
      model: string;
      stream: boolean;
      messages: Array<{
        role: string;
        content: unknown;
      }>;
    };
  }> = [];

  const client = new LaozhangVisionClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/v1/chat/completions",
    model: "gemini-2.5-flash",
    timeoutMs: 3000,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        payload: JSON.parse(String(init?.body)) as {
          model: string;
          stream: boolean;
          messages: Array<{
            role: string;
            content: unknown;
          }>;
        },
      });

      return createJsonResponse({
        choices: [
          {
            message: {
              content: "```text\n这是最终提示词\n```",
            },
          },
        ],
      });
    },
  });

  const result = await client.optimizePrompt({
    prompt: "保留主体，改成欧式风格",
    imageDataUrls: [
      "data:image/jpeg;base64,AAA",
      "data:image/jpeg;base64,BBB",
    ],
  });

  assert.equal(result.optimizedPrompt, "这是最终提示词");
  assert.equal(result.model, "gemini-2.5-flash");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/v1/chat/completions");
  assert.equal(requests[0]?.payload.model, "gemini-2.5-flash");
  assert.equal(requests[0]?.payload.stream, false);
  assert.equal(
    requests[0]?.payload.messages[0]?.content,
    `${AI_IMAGE_GEN_PROMPT_OPTIMIZE_SYSTEM_PROMPT}\n\n${AI_IMAGE_GEN_PROMPT_OPTIMIZE_REFERENCE_SYSTEM_PROMPT}`,
  );

  const userContent = requests[0]?.payload.messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  assert.equal(userContent[0]?.type, "text");
  assert.equal(userContent[1]?.image_url.url, "data:image/jpeg;base64,AAA");
  assert.equal(userContent[2]?.image_url.url, "data:image/jpeg;base64,BBB");
});

test("LaozhangVisionClient optimizes text-only prompts without requiring reference images", async () => {
  const requests: Array<{
    payload: {
      messages: Array<{
        role: string;
        content: unknown;
      }>;
    };
  }> = [];

  const client = new LaozhangVisionClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/v1/chat/completions",
    model: "gemini-2.5-flash",
    timeoutMs: 3000,
    fetchImpl: async (_input, init) => {
      requests.push({
        payload: JSON.parse(String(init?.body)) as {
          messages: Array<{
            role: string;
            content: unknown;
          }>;
        },
      });

      return createJsonResponse({
        choices: [
          {
            message: {
              content: "赛博朋克风格咖啡杯商品主图，霓虹灯光，金属材质，黑色背景，高级商业摄影",
            },
          },
        ],
      });
    },
  });

  const result = await client.optimizePrompt({
    prompt: "咖啡杯主图",
    imageDataUrls: [],
  });

  assert.equal(result.optimizedPrompt, "赛博朋克风格咖啡杯商品主图，霓虹灯光，金属材质，黑色背景，高级商业摄影");
  const userContent = requests[0]?.payload.messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  assert.equal(userContent.length, 1);
  assert.equal(userContent[0]?.type, "text");
});

test("LaozhangVisionClient maps empty content response to invalid response error", async () => {
  const client = new LaozhangVisionClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/v1/chat/completions",
    model: "gemini-2.5-flash",
    timeoutMs: 3000,
    fetchImpl: async () => createJsonResponse({
      choices: [
        {
          message: {
            content: "```markdown\n```",
          },
        },
      ],
    }),
  });

  await assert.rejects(
    () => client.optimizePrompt({
      prompt: "测试",
      imageDataUrls: ["data:image/jpeg;base64,AAA"],
    }),
    (error: unknown) => Boolean(
      error
      && typeof error === "object"
      && (error as { code?: string }).code === "INVALID_RESPONSE",
    ),
  );
});

test("buildStoryboardArrangeMessages uses one user multimodal message without system prompt", () => {
  const messages = buildStoryboardArrangeMessages({
    shots: [
      { shotId: "shot-a", imageDataUrl: "data:image/jpeg;base64,AAA" },
      { shotId: "shot-b", imageDataUrl: "data:image/jpeg;base64,BBB" },
    ],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "user");

  const content = messages[0]?.content;
  assert.ok(Array.isArray(content));
  assert.equal(content.length, 5);
  assert.equal(content[0]?.type, "text");
  assert.equal(content[0]?.text, buildStoryboardArrangeUserPrompt(2));
  assert.equal(content[1]?.type, "text");
  assert.equal(content[1]?.text, buildShotInfoText("shot-a"));
  assert.equal(content[2]?.type, "image_url");
  assert.equal(content[2]?.image_url.url, "data:image/jpeg;base64,AAA");
  assert.equal(content[3]?.type, "text");
  assert.equal(content[3]?.text, buildShotInfoText("shot-b"));
  assert.equal(content[4]?.type, "image_url");
  assert.equal(content[4]?.image_url.url, "data:image/jpeg;base64,BBB");
});

test("LaozhangVisionClient.complete sends storyboard multimodal messages unchanged", async () => {
  const requests: Array<{
    url: string;
    payload: {
      model: string;
      stream: boolean;
      messages: Array<{
        role: string;
        content: unknown;
      }>;
    };
  }> = [];

  const client = new LaozhangVisionClient({
    apiKey: "sk-test",
    apiUrl: "https://example.test/v1/chat/completions",
    model: "gemini-3-flash-preview",
    timeoutMs: 3000,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        payload: JSON.parse(String(init?.body)) as {
          model: string;
          stream: boolean;
          messages: Array<{
            role: string;
            content: unknown;
          }>;
        },
      });

      return createJsonResponse({
        choices: [
          {
            message: {
              content: "[{\"shotId\":\"shot-b\",\"order\":1,\"prompt\":\"中文运镜提示词\"}]",
            },
          },
        ],
      });
    },
  });

  const messages = buildStoryboardArrangeMessages({
    shots: [
      { shotId: "shot-a", imageDataUrl: "data:image/jpeg;base64,AAA" },
      { shotId: "shot-b", imageDataUrl: "data:image/jpeg;base64,BBB" },
    ],
  });
  const result = await client.complete({ messages });

  assert.equal(result.contentText, "[{\"shotId\":\"shot-b\",\"order\":1,\"prompt\":\"中文运镜提示词\"}]");
  assert.equal(result.model, "gemini-3-flash-preview");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/v1/chat/completions");
  assert.equal(requests[0]?.payload.model, "gemini-3-flash-preview");
  assert.equal(requests[0]?.payload.stream, false);
  assert.deepEqual(requests[0]?.payload.messages, messages);
  assert.equal(requests[0]?.payload.messages.some((message) => message.role === "system"), false);
});
