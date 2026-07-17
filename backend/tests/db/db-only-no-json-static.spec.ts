import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveBackendSourceRoot } from "./bootstrap-db.ts";

const legacyRepositoryConstructors = [
  "IntermediateArtifactRepository",
  "JsonAccountRepository",
  "JsonAuditRepository",
  "JsonExecutionsRepository",
  "JsonFilesRepository",
  "JsonSessionRepository",
  "WorkflowFilesRepository",
  "WorkflowGroupsRepository",
  "WorkflowRepository",
] as const;

const expectedLegacyFallbackConstructors = new Map<string, string[]>([
  [
    "api/src/composition/auth.composition.ts",
    [
      "JsonAccountRepository",
      "JsonAuditRepository",
      "JsonSessionRepository",
    ],
  ],
  ["api/src/composition/files.composition.ts", ["JsonFilesRepository"]],
  ["api/src/composition/executions.composition.ts", ["JsonExecutionsRepository"]],
  [
    "api/src/composition/workflows.composition.ts",
    [
      "WorkflowFilesRepository",
      "WorkflowGroupsRepository",
      "WorkflowRepository",
    ],
  ],
  [
    "worker/src/composition/worker-core.composition.ts",
    [
      "JsonExecutionsRepository",
      "JsonFilesRepository",
    ],
  ],
  ["worker/src/composition/worker-executor.composition.ts", ["IntermediateArtifactRepository"]],
]);

interface ConstructorOccurrence {
  constructorName: string;
  line: number;
}

async function run(): Promise<void> {
  const rootDir = resolveBackendSourceRoot();
  const compositionFiles = await collectCompositionFiles(rootDir);

  for (const relativePath of compositionFiles) {
    const source = await fs.readFile(path.join(rootDir, relativePath), "utf8");
    assertNoLegacyRepositoryInDbModeBranches(relativePath, source);
    assertLegacyRepositoryAllowList(relativePath, source);
  }

  await assertWorkflowTaskHistoryUsesDbMode(rootDir);
  await assertVerifyDbIncludesDbOnlyGates(rootDir);
}

async function collectCompositionFiles(rootDir: string): Promise<string[]> {
  const roots = [
    path.join(rootDir, "api", "src", "composition"),
    path.join(rootDir, "worker", "src", "composition"),
  ];
  const files: string[] = [];

  for (const compositionRoot of roots) {
    const collected = await collectTypeScriptFiles(compositionRoot);
    files.push(...collected.map((filePath) => toSourceRelativePath(rootDir, filePath)));
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function collectTypeScriptFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function assertNoLegacyRepositoryInDbModeBranches(relativePath: string, source: string): void {
  const dbModeBlocks = [
    ...extractDbModeIfBlocks(source),
    ...extractDbModeTernaryTrueArms(source),
  ];

  for (const block of dbModeBlocks) {
    const occurrences = findLegacyRepositoryConstructors(block.source);
    assert.deepEqual(
      occurrences,
      [],
      `DB mode branch must not instantiate legacy JSON repositories in ${relativePath}:${block.line}`,
    );
  }
}

function assertLegacyRepositoryAllowList(relativePath: string, source: string): void {
  const expected = [...(expectedLegacyFallbackConstructors.get(relativePath) ?? [])].sort();
  const actual = findLegacyRepositoryConstructors(source)
    .map((occurrence) => occurrence.constructorName)
    .sort();

  assert.deepEqual(
    actual,
    expected,
    `Unexpected legacy JSON repository constructor in composition file: ${relativePath}`,
  );
}

async function assertWorkflowTaskHistoryUsesDbMode(rootDir: string): Promise<void> {
  const relativePath = "api/src/composition/executions.composition.ts";
  const source = await fs.readFile(path.join(rootDir, relativePath), "utf8");

  assert.match(
    source,
    /input\.env\?\.persistenceMode === "db"[\s\S]*\{ databaseConfig: input\.env\.database, mode: "db" \}/u,
    "Workflow task history composition must pass DB mode when persistence.mode=db.",
  );
}

async function assertVerifyDbIncludesDbOnlyGates(rootDir: string): Promise<void> {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const verifyDb = packageJson.scripts?.["verify:db"] ?? "";
  const testDb = packageJson.scripts?.["test:db"] ?? "";

  assert.match(verifyDb, /\btypecheck\b/u, "verify:db must keep typecheck in the DB Only gate.");
  assert.match(verifyDb, /\btest:db\b/u, "verify:db must run test:db.");
  assert.match(testDb, /run-tests\.mjs --scope db/u, "test:db must run the DB test scope.");

  const runTestsSource = await fs.readFile(path.join(rootDir, "scripts", "run-tests.mjs"), "utf8");
  assert.match(
    runTestsSource,
    /db-only-no-json-store\.e2e\.spec\.ts/u,
    "run-tests must keep the runtime no-JSON DB Only gate required.",
  );
  assert.match(
    runTestsSource,
    /db-only-no-json-static\.spec\.ts/u,
    "run-tests must keep the static no-JSON DB Only gate required.",
  );
  assert.match(
    runTestsSource,
    /DB_ONLY_GATE_TESTS_MISSING/u,
    "run-tests must fail if the DB Only gate tests are missing from verify:db.",
  );
}

function extractDbModeIfBlocks(source: string): Array<{ line: number; source: string }> {
  const blocks: Array<{ line: number; source: string }> = [];
  const ifPattern = /if\s*\([^)]*persistenceMode\s*={2,3}\s*"db"[^)]*\)\s*\{/gu;
  let match: RegExpExecArray | null;

  while ((match = ifPattern.exec(source)) !== null) {
    const blockStart = source.indexOf("{", match.index);
    const blockEnd = findMatchingDelimiter(source, blockStart, "{", "}");
    blocks.push({
      line: lineNumberAt(source, match.index),
      source: source.slice(blockStart, blockEnd + 1),
    });
  }

  return blocks;
}

function extractDbModeTernaryTrueArms(source: string): Array<{ line: number; source: string }> {
  const blocks: Array<{ line: number; source: string }> = [];
  const conditionPattern = /persistenceMode\s*={2,3}\s*"db"/gu;
  let match: RegExpExecArray | null;

  while ((match = conditionPattern.exec(source)) !== null) {
    const questionIndex = skipWhitespace(source, match.index + match[0].length);
    if (source[questionIndex] !== "?") {
      continue;
    }

    const colonIndex = findTernaryColon(source, questionIndex);
    blocks.push({
      line: lineNumberAt(source, match.index),
      source: source.slice(questionIndex + 1, colonIndex),
    });
  }

  return blocks;
}

function findLegacyRepositoryConstructors(source: string): ConstructorOccurrence[] {
  const constructors = legacyRepositoryConstructors.join("|");
  const pattern = new RegExp(`\\bnew\\s+(${constructors})\\b`, "gu");
  const occurrences: ConstructorOccurrence[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    occurrences.push({
      constructorName: match[1]!,
      line: lineNumberAt(source, match.index),
    });
  }

  return occurrences;
}

function findMatchingDelimiter(
  source: string,
  openingIndex: number,
  opening: string,
  closing: string,
): number {
  let depth = 0;

  for (let index = openingIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === opening) {
      depth += 1;
      continue;
    }

    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error(`MATCHING_DELIMITER_NOT_FOUND:${openingIndex}`);
}

function findTernaryColon(source: string, questionIndex: number): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let nestedTernaryDepth = 0;

  for (let index = questionIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth -= 1;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth -= 1;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
      continue;
    }

    const isTopLevel = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
    if (!isTopLevel) {
      continue;
    }

    if (char === "?") {
      nestedTernaryDepth += 1;
      continue;
    }

    if (char === ":") {
      if (nestedTernaryDepth === 0) {
        return index;
      }
      nestedTernaryDepth -= 1;
    }
  }

  throw new Error(`TERNARY_COLON_NOT_FOUND:${questionIndex}`);
}

function skipWhitespace(source: string, startIndex: number): number {
  let index = startIndex;
  while (index < source.length && /\s/u.test(source[index]!)) {
    index += 1;
  }
  return index;
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function toSourceRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

await run();
