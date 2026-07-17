import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const projectTempRoot = path.join(projectRoot, '.test-temp');
mkdirSync(projectTempRoot, { recursive: true });
const tempDir = mkdtempSync(path.join(projectTempRoot, 'workflow-canvas-tests-'));
const outDir = path.join(tempDir, 'dist-tests');
const compatibilityOutDir = path.join(projectRoot, 'dist-tests');
const tscCli = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const requestedTestScope = process.env.TEST_SCOPE?.trim() ?? '';
const requestedTestFile = process.env.TEST_FILE?.trim() ?? '';
const SOURCE_SPEC_ENTRY_SUFFIX = '.spec.js';
const SOURCE_TEST_SUPPORT_SUFFIX = '.test.js';
const ROOT_NODE_TEST_SUFFIX = '.test.mjs';

const defaultIncludePatterns = [
  path.join(projectRoot, 'src/test-support/**/*.d.ts'),
  path.join(projectRoot, 'src/execution-runtime/**/*.ts'),
  path.join(projectRoot, 'src/execution-runtime/**/*.tsx'),
  path.join(projectRoot, 'src/services/**/*.ts'),
  path.join(projectRoot, 'src/services/image/**/*.ts'),
  path.join(projectRoot, 'src/services/file/**/*.ts'),
  path.join(projectRoot, 'src/nodes/shared/**/*.ts'),
  path.join(projectRoot, 'src/nodes/shared/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-model-render-transfer/**/*.ts'),
  path.join(projectRoot, 'src/nodes/ai-model-render-transfer/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-image-gen/**/*.ts'),
  path.join(projectRoot, 'src/nodes/ai-image-gen/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-image-inpaint/**/*.ts'),
  path.join(projectRoot, 'src/nodes/ai-image-inpaint/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-storyboard/**/*.ts'),
  path.join(projectRoot, 'src/nodes/ai-storyboard/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-image-gen/drop-config.ts'),
  path.join(projectRoot, 'src/nodes/ai-image-gen/groups.ts'),
  path.join(projectRoot, 'src/nodes/ai-video-gen/**/*.ts'),
  path.join(projectRoot, 'src/nodes/ai-video-gen/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-floorplan-colorize/**/*.ts'),
  path.join(projectRoot, 'src/nodes/ai-floorplan-colorize/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-image-hd/**/*.ts'),
  path.join(projectRoot, 'src/nodes/ai-image-hd/**/*.tsx'),
  path.join(projectRoot, 'src/nodes/ai-image-hd/constants.ts'),
  path.join(projectRoot, 'src/nodes/ai-image-hd/drop-config.ts'),
  path.join(projectRoot, 'src/nodes/ai-image-hd/groups.ts'),
  path.join(projectRoot, 'src/nodes/ai-model-render-transfer/constants.ts'),
  path.join(projectRoot, 'src/nodes/ai-model-render-transfer/drop-config.ts'),
  path.join(projectRoot, 'src/nodes/ai-model-render-transfer/groups.ts'),
  path.join(projectRoot, 'src/nodes/types.ts'),
  path.join(projectRoot, 'src/components/node/file/file-node-equality.ts'),
  path.join(projectRoot, 'src/components/node/file/file-node-property-sections.ts'),
  path.join(projectRoot, 'src/components/node/file/FileNodeExportButton.tsx'),
  path.join(projectRoot, 'src/components/node/file/FileNode.thumbnail-display.spec.tsx'),
  path.join(projectRoot, 'src/components/node/file/FileNode.save.spec.tsx'),
  path.join(projectRoot, 'src/components/node/file/FileNode.runtime-sync.spec.tsx'),
  path.join(projectRoot, 'src/components/node/file/FileNode.stress.spec.tsx'),
  path.join(projectRoot, 'src/components/node/file/FileNodeProxy.spec.tsx'),
  path.join(projectRoot, 'src/components/node/file/FileNodePropertyDialog.tsx'),
  path.join(projectRoot, 'src/components/canvas/**/*.ts'),
  path.join(projectRoot, 'src/components/canvas/**/*.tsx'),
  path.join(projectRoot, 'src/components/workflow/**/*.ts'),
  path.join(projectRoot, 'src/components/workflow/**/*.tsx'),
  path.join(projectRoot, 'src/components/context/**/*.ts'),
  path.join(projectRoot, 'src/components/context/**/*.tsx'),
  path.join(projectRoot, 'src/components/user/**/*.ts'),
  path.join(projectRoot, 'src/components/user/**/*.tsx'),
  path.join(projectRoot, 'src/components/context/workflow-context.types.ts'),
  path.join(projectRoot, 'src/auth/**/*.ts'),
  path.join(projectRoot, 'src/auth/**/*.tsx'),
  path.join(projectRoot, 'src/hooks/canvas/**/*.ts'),
  path.join(projectRoot, 'src/hooks/canvas/**/*.tsx'),
  path.join(projectRoot, 'src/hooks/image/**/*.ts'),
  path.join(projectRoot, 'src/hooks/image/**/*.tsx'),
  path.join(projectRoot, 'src/hooks/file/**/*.ts'),
  path.join(projectRoot, 'src/hooks/file/**/*.tsx'),
  path.join(projectRoot, 'src/hooks/workflow/**/*.ts'),
  path.join(projectRoot, 'src/api/client/**/*.ts'),
  path.join(projectRoot, 'src/api/websocket/**/*.ts'),
  path.join(projectRoot, 'src/api/services/task-query.ts'),
  path.join(projectRoot, 'src/api/services/**/*.ts'),
  path.join(projectRoot, 'src/types/**/*.ts'),
  path.join(projectRoot, 'src/utils/**/*.ts'),
  path.join(projectRoot, 'tools/canvas-performance-recorder/**/*.ts'),
  path.join(projectRoot, 'src/vite-env.d.ts'),
];

const scopedTestConfigs = {
  'node-id': {
    include: [
      path.join(projectRoot, 'src/test-support/**/*.d.ts'),
      path.join(projectRoot, 'src/hooks/workflow/**/*.ts'),
      path.join(projectRoot, 'src/constants/**/*.ts'),
      path.join(projectRoot, 'src/types/**/*.ts'),
      path.join(projectRoot, 'src/utils/**/*.ts'),
      path.join(projectRoot, 'src/vite-env.d.ts'),
    ],
    testFiles: new Set([
      'node-id-allocator.spec.js',
      'useWorkflow.node-id.spec.js',
    ]),
  },
};

const activeTestConfig = scopedTestConfigs[requestedTestScope] ?? null;
const includePatterns = activeTestConfig?.include ?? defaultIncludePatterns;

mkdirSync(outDir, { recursive: true });

const tsconfigPath = path.join(tempDir, 'tsconfig.tests.json');
writeFileSync(tsconfigPath, JSON.stringify({
  extends: path.join(projectRoot, 'tsconfig.json'),
  compilerOptions: {
    module: 'ESNext',
    moduleResolution: 'Bundler',
    outDir,
    rootDir: projectRoot,
    noEmit: false,
    declaration: false,
    sourceMap: false,
    allowImportingTsExtensions: false,
  },
  include: includePatterns,
}, null, 2));

const tsc = spawnSync(process.execPath, [tscCli, '-p', tsconfigPath], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

if (tsc.error) {
  console.error(tsc.error);
}

if (tsc.status !== 0) {
  rmSync(tempDir, { recursive: true, force: true });
  process.exit(tsc.status ?? 1);
}

rewriteRelativeImports(outDir);
mkdirSync(compatibilityOutDir, { recursive: true });
cpSync(outDir, compatibilityOutDir, { recursive: true, force: true });

const testDir = path.join(projectRoot, 'tests');
const sourceSpecDir = path.join(outDir, 'src');
const rootNodeTestFiles = (
  existsSync(testDir)
    ? readdirSync(testDir)
      .filter((fileName) => isRootNodeTestFile(fileName))
      .map((fileName) => path.join(testDir, fileName))
    : []
);
const sourceSpecEntryFiles = collectFiles(sourceSpecDir, (fileName) => isSourceSpecEntryFile(fileName));
const sourceTestSupportFiles = collectFiles(sourceSpecDir, (fileName) => isSourceTestSupportModule(fileName));
const sourceTestSupportFileNames = new Set(sourceTestSupportFiles.map((testFile) => path.basename(testFile)));
const testFiles = [
  ...rootNodeTestFiles,
  ...sourceSpecEntryFiles,
]
  .filter((testFile) => {
    if (!activeTestConfig?.testFiles) {
      return requestedTestFile.length === 0 || path.basename(testFile) === requestedTestFile;
    }
    const fileName = path.basename(testFile);
    const matchesScope = activeTestConfig.testFiles.has(fileName);
    if (!matchesScope) {
      return false;
    }
    return requestedTestFile.length === 0 || fileName === requestedTestFile;
  })
  .sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
  if (requestedTestFile.length > 0 && sourceTestSupportFileNames.has(requestedTestFile)) {
    console.error(
      `TEST_FILE "${requestedTestFile}" matches a src/**/*.test.ts[x] support module. `
      + 'Those files are compiled for shared test helpers but are not executed as standalone node:test entries. '
      + 'Use the owning tests/*.test.mjs entrypoint or a src/**/*.spec.ts[x] file instead.'
    );
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }

  rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
}

let exitCode = 0;

for (const testFile of testFiles) {
  console.log(`Running test file: ${path.basename(testFile)}`);
  const nodeTest = spawnSync(process.execPath, [
    '--experimental-specifier-resolution=node',
    '--test',
    '--test-isolation=none',
    '--test-concurrency=1',
    testFile,
  ], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (nodeTest.error) {
    console.error(nodeTest.error);
  }

  if ((nodeTest.status ?? 1) !== 0) {
    exitCode = nodeTest.status ?? 1;
    break;
  }
}

rmSync(tempDir, { recursive: true, force: true });
process.exit(exitCode);

function rewriteRelativeImports(targetDir) {
  if (!existsSync(targetDir)) {
    return;
  }

  for (const entryName of readdirSync(targetDir)) {
    const absolutePath = path.join(targetDir, entryName);
    const entryStat = statSync(absolutePath);

    if (entryStat.isDirectory()) {
      rewriteRelativeImports(absolutePath);
      continue;
    }

    if (!absolutePath.endsWith('.js')) {
      continue;
    }

    const source = readFileSync(absolutePath, 'utf8');
    const rewrittenRelativeImports = source.replace(
      /from\s+['"](\.\.?\/[^'"]+)['"]/g,
      (fullMatch, specifier) => {
        if (specifier.endsWith('.js') || specifier.endsWith('.json') || specifier.endsWith('.mjs')) {
          return fullMatch;
        }
        const currentDir = path.dirname(absolutePath);
        const directTarget = path.resolve(currentDir, `${specifier}.js`);
        const indexTarget = path.resolve(currentDir, specifier, 'index.js');
        const resolvedSpecifier = existsSync(directTarget)
          ? `${specifier}.js`
          : (
            specifier.startsWith('../')
              ? `${specifier}/index.js`
              : `./${path.join(specifier.slice(2), 'index.js').replaceAll('\\', '/')}`
          );
        return fullMatch.replace(specifier, resolvedSpecifier);
      }
    );
    const rewritten = rewrittenRelativeImports.replace(
      /from\s+['"]@\/([^'"]+)['"]/g,
      (fullMatch, specifier) => {
        const currentDir = path.dirname(absolutePath);
        const directTarget = path.join(outDir, 'src', `${specifier}.js`);
        const indexTarget = path.join(outDir, 'src', specifier, 'index.js');
        const resolvedTarget = existsSync(directTarget) ? directTarget : indexTarget;
        const relativePath = path.relative(currentDir, resolvedTarget).replaceAll('\\', '/');
        const normalizedSpecifier = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
        return fullMatch.replace(`@/${specifier}`, normalizedSpecifier);
      }
    );

    if (rewritten !== source) {
      writeFileSync(absolutePath, rewritten);
    }
  }
}

function collectFiles(targetDir, predicate) {
  if (!existsSync(targetDir)) {
    return [];
  }

  const files = [];

  for (const entryName of readdirSync(targetDir)) {
    const absolutePath = path.join(targetDir, entryName);
    const entryStat = statSync(absolutePath);

    if (entryStat.isDirectory()) {
      files.push(...collectFiles(absolutePath, predicate));
      continue;
    }

    if (predicate(entryName, absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function isRootNodeTestFile(fileName) {
  return fileName.endsWith(ROOT_NODE_TEST_SUFFIX);
}

function isSourceSpecEntryFile(fileName) {
  return fileName.endsWith(SOURCE_SPEC_ENTRY_SUFFIX);
}

function isSourceTestSupportModule(fileName) {
  return fileName.endsWith(SOURCE_TEST_SUPPORT_SUFFIX);
}
