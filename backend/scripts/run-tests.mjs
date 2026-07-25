import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const tempRoot = path.join(backendRoot, '.tmp', 'test-temp');
const requiredDbOnlyGateTests = [
  path.join(backendRoot, 'tests', 'db', 'db-only-no-json-store.e2e.spec.ts'),
  path.join(backendRoot, 'tests', 'db', 'db-only-no-json-static.spec.ts'),
];
const sharedPackageName = '@newworkflow/backend-shared';
const sharedEntryPoints = {
  [sharedPackageName]: ['shared', 'src', 'index'],
  [`${sharedPackageName}/api`]: ['shared', 'src', 'public', 'api'],
  [`${sharedPackageName}/auth`]: ['shared', 'src', 'public', 'auth'],
  [`${sharedPackageName}/execution`]: ['shared', 'src', 'public', 'execution'],
};
const requestedScope = readOption('--scope', process.env.BACKEND_TEST_SCOPE ?? 'local');
const requestedFile = readOption('--file', process.env.BACKEND_TEST_FILE ?? '').trim();
const shouldList = hasFlag('--list');
const validScopes = new Set(['local', 'env', 'db', 'all']);

if (!validScopes.has(requestedScope)) {
  console.error(`Unsupported backend test scope "${requestedScope}". Use one of: local, env, db, all.`);
  process.exit(1);
}

const localTests = collectLocalTestFiles();
const envTests = collectEnvironmentTestFiles();
const dbTests = collectDbTestFiles();
const selectedTests = selectTests();

if (shouldList) {
  printTestList(selectedTests);
  process.exit(0);
}

if (selectedTests.length === 0) {
  if (requestedFile.length > 0) {
    console.error(`No backend test file matched "${requestedFile}" in scope "${requestedScope}".`);
    process.exit(1);
  }

  console.log(`No backend tests registered for scope "${requestedScope}".`);
  process.exit(0);
}

ensureDbTestDatabaseUrlWhenNeeded();
ensureRequiredDbOnlyGateTestsWhenNeeded();

mkdirSync(tempRoot, { recursive: true });

const tempDir = mkdtempSync(path.join(tempRoot, 'backend-tests-'));
const outDir = path.join(tempDir, 'dist');
const tscCli = resolveTypescriptCli();

mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2),
);
mirrorRuntimeDependencies(outDir);

const tsconfigPath = path.join(tempDir, 'tsconfig.tests.json');
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    resolveJsonModule: true,
    declaration: false,
    sourceMap: false,
    noEmit: false,
    outDir,
    rootDir: backendRoot,
    types: ['node'],
    typeRoots: [
      toTsconfigPath(path.join(backendRoot, 'api', 'node_modules', '@types')),
      toTsconfigPath(path.join(backendRoot, 'worker', 'node_modules', '@types')),
      toTsconfigPath(path.join(backendRoot, 'shared', 'node_modules', '@types')),
    ],
    baseUrl: backendRoot,
    paths: {
      '@newworkflow/backend-shared': ['shared/src/index.ts'],
      '@newworkflow/backend-shared/api': ['shared/src/public/api.ts'],
      '@newworkflow/backend-shared/auth': ['shared/src/public/auth.ts'],
      '@newworkflow/backend-shared/execution': ['shared/src/public/execution.ts'],
    },
  },
  files: [
    toTsconfigPath(path.join(backendRoot, 'tests', 'bootstrap.ts')),
    ...selectedTests.map(toTsconfigPath),
  ],
}, null, 2));

const compileResult = spawnSync(process.execPath, [tscCli, '-p', tsconfigPath], {
  cwd: backendRoot,
  stdio: 'inherit',
  shell: false,
});

if (compileResult.error) {
  console.error(compileResult.error);
}

if ((compileResult.status ?? 1) !== 0) {
  rmSync(tempDir, { recursive: true, force: true });
  process.exit(compileResult.status ?? 1);
}

rewriteImports(outDir, outDir);

const bootstrapFile = pathToFileURL(path.join(outDir, 'tests', 'bootstrap.js')).href;

console.log(`Backend test scope: ${requestedScope}`);
console.log(`Backend test files: ${selectedTests.length}`);

let exitCode = 0;

for (const sourceTestFile of selectedTests) {
  const compiledTestFile = path.join(
    outDir,
    path.relative(backendRoot, sourceTestFile),
  ).replace(/\.ts$/u, '.js');
  const relativePath = path.relative(backendRoot, sourceTestFile).replaceAll('\\', '/');

  if (!existsSync(compiledTestFile)) {
    console.error(`Compiled backend test file not found: ${relativePath}`);
    exitCode = 1;
    break;
  }

  console.log('');
  console.log(`Running backend test: ${relativePath}`);

  const nodeRun = spawnSync(process.execPath, ['--import', bootstrapFile, compiledTestFile], {
    cwd: outDir,
    env: {
      ...process.env,
      BACKEND_TEST_SOURCE_ROOT: backendRoot,
    },
    stdio: 'inherit',
    shell: false,
  });

  if (nodeRun.error) {
    console.error(nodeRun.error);
  }

  if ((nodeRun.status ?? 1) !== 0) {
    exitCode = nodeRun.status ?? 1;
    break;
  }
}

rmSync(tempDir, { recursive: true, force: true });
process.exit(exitCode);

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return fallback;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`Missing value for ${name}.`);
    process.exit(1);
  }

  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveTypescriptCli() {
  const candidates = [
    path.join(backendRoot, 'api', 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(backendRoot, 'worker', 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(backendRoot, 'shared', 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));

  if (!resolved) {
    console.error('Cannot find TypeScript CLI. Run npm install in backend/api, backend/worker, or backend/shared first.');
    process.exit(1);
  }

  return resolved;
}

function collectLocalTestFiles() {
  return [
    ...collectSpecFiles(path.join(backendRoot, 'tests'), new Set(['db'])),
    ...collectSpecFiles(path.join(backendRoot, 'api', 'src')),
    ...collectSpecFiles(path.join(backendRoot, 'worker', 'src')),
    ...collectSpecFiles(path.join(backendRoot, 'shared', 'src')),
  ].sort((left, right) => left.localeCompare(right));
}

function collectEnvironmentTestFiles() {
  return [];
}

function collectDbTestFiles() {
  return collectSpecFiles(path.join(backendRoot, 'tests', 'db'))
    .sort((left, right) => left.localeCompare(right));
}

function collectSpecFiles(rootDir, excludedDirectoryNames = new Set()) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const result = [];
  for (const entryName of readdirSync(rootDir)) {
    const absolutePath = path.join(rootDir, entryName);
    const entryStat = statSync(absolutePath);

    if (entryStat.isDirectory()) {
      if (
        entryName === 'node_modules'
        || entryName === 'manual'
        || entryName === '.tmp'
        || entryName === '.npm-cache'
        || excludedDirectoryNames.has(entryName)
      ) {
        continue;
      }

      result.push(...collectSpecFiles(absolutePath, excludedDirectoryNames));
      continue;
    }

    if (entryStat.isFile() && entryName.endsWith('.spec.ts')) {
      result.push(absolutePath);
    }
  }

  return result;
}

function selectTests() {
  const candidates = requestedScope === 'local'
    ? localTests
    : requestedScope === 'env'
      ? envTests
      : requestedScope === 'db'
        ? dbTests
        : [...localTests, ...envTests, ...dbTests].sort((left, right) => left.localeCompare(right));

  if (requestedFile.length === 0) {
    return candidates;
  }

  const normalizedRequest = requestedFile.replaceAll('\\', '/');
  return candidates.filter((testFile) => {
    const relativePath = path.relative(backendRoot, testFile).replaceAll('\\', '/');
    return path.basename(testFile) === requestedFile || relativePath === normalizedRequest;
  });
}

function printTestList(testFiles) {
  console.log(`Backend test scope: ${requestedScope}`);
  if (testFiles.length === 0) {
    console.log('(none)');
    return;
  }

  for (const testFile of testFiles) {
    console.log(path.relative(backendRoot, testFile).replaceAll('\\', '/'));
  }
}

function ensureDbTestDatabaseUrlWhenNeeded() {
  const includesDbTests = selectedTests.some((testFile) => {
    const relativePath = path.relative(backendRoot, testFile).replaceAll('\\', '/');
    return relativePath.startsWith('tests/db/');
  });

  if (!includesDbTests) {
    return;
  }

  const configuredDatabaseUrl = process.env.BACKEND_TEST_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim();

  if (configuredDatabaseUrl) {
    return;
  }

  console.error(
    'DB_TEST_DATABASE_URL_REQUIRED: set BACKEND_TEST_DATABASE_URL or DATABASE_URL before running DB tests. '
      + 'DB tests are required to fail when no PostgreSQL test database is configured; they are never skipped.',
  );
  process.exit(1);
}

function ensureRequiredDbOnlyGateTestsWhenNeeded() {
  if (requestedFile.length > 0 || (requestedScope !== 'db' && requestedScope !== 'all')) {
    return;
  }

  const selectedTestSet = new Set(selectedTests.map((testFile) => path.resolve(testFile)));
  const missingTests = requiredDbOnlyGateTests.filter((testFile) => !selectedTestSet.has(path.resolve(testFile)));

  if (missingTests.length === 0) {
    return;
  }

  console.error(
    'DB_ONLY_GATE_TESTS_MISSING: verify:db must include the DB Only no-JSON runtime and static gates:\n'
      + missingTests.map((testFile) => `- ${path.relative(backendRoot, testFile).replaceAll('\\', '/')}`).join('\n'),
  );
  process.exit(1);
}

function rewriteImports(targetDir, compiledRoot) {
  if (!existsSync(targetDir)) {
    return;
  }

  for (const entryName of readdirSync(targetDir)) {
    const absolutePath = path.join(targetDir, entryName);
    const entryStat = statSync(absolutePath);

    if (entryStat.isDirectory()) {
      rewriteImports(absolutePath, compiledRoot);
      continue;
    }

    if (!entryStat.isFile() || !absolutePath.endsWith('.js')) {
      continue;
    }

    const currentDir = path.dirname(absolutePath);
    const source = readFileSync(absolutePath, 'utf8');
    const rewrittenRelativeImports = rewriteModuleSpecifiers(
      source,
      /from\s+['"](\.\.?\/[^'"]+)['"]/g,
      currentDir,
      compiledRoot,
    );
    const rewrittenDynamicImports = rewriteModuleSpecifiers(
      rewrittenRelativeImports,
      /import\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
      currentDir,
      compiledRoot,
    );
    const rewrittenAliasImports = rewriteModuleSpecifiers(
      rewrittenDynamicImports,
      /from\s+['"](@newworkflow\/backend-shared(?:\/[^'"]+)?)['"]/g,
      currentDir,
      compiledRoot,
    );
    const rewritten = rewriteModuleSpecifiers(
      rewrittenAliasImports,
      /import\(\s*['"](@newworkflow\/backend-shared(?:\/[^'"]+)?)['"]\s*\)/g,
      currentDir,
      compiledRoot,
    );

    if (rewritten !== source) {
      writeFileSync(absolutePath, rewritten);
    }
  }
}

function rewriteModuleSpecifiers(source, pattern, currentDir, compiledRoot) {
  return source.replace(pattern, (fullMatch, rawSpecifier) => {
    const rewrittenSpecifier = resolveSpecifier(rawSpecifier, currentDir, compiledRoot);
    if (!rewrittenSpecifier || rewrittenSpecifier === rawSpecifier) {
      return fullMatch;
    }

    return fullMatch.replace(rawSpecifier, rewrittenSpecifier);
  });
}

function resolveSpecifier(specifier, currentDir, compiledRoot) {
  const sharedEntryPath = sharedEntryPoints[specifier];
  if (sharedEntryPath) {
    const resolvedPath = resolveCompiledModulePath(
      path.join(compiledRoot, ...sharedEntryPath),
    );
    return resolvedPath ? toRelativeSpecifier(currentDir, resolvedPath) : specifier;
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const normalizedSpecifier = specifier.replace(/\.tsx?$/u, '.js');
    if (normalizedSpecifier !== specifier) {
      return normalizedSpecifier;
    }

    const resolvedPath = resolveCompiledModulePath(path.resolve(currentDir, specifier));
    return resolvedPath ? toRelativeSpecifier(currentDir, resolvedPath) : specifier;
  }

  return specifier;
}

function resolveCompiledModulePath(basePath) {
  const withJs = basePath.endsWith('.js') ? basePath : `${basePath}.js`;
  if (existsSync(withJs)) {
    return withJs;
  }

  const indexPath = path.join(basePath, 'index.js');
  if (existsSync(indexPath)) {
    return indexPath;
  }

  return null;
}

function toRelativeSpecifier(fromDir, targetFile) {
  const relativePath = path.relative(fromDir, targetFile).replaceAll('\\', '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function toTsconfigPath(filePath) {
  return path.resolve(filePath).replaceAll('\\', '/');
}

function mirrorRuntimeDependencies(compiledRoot) {
  const dependencyRoots = ['api', 'worker', 'shared'];

  for (const entryName of dependencyRoots) {
    const sourceNodeModules = path.join(backendRoot, entryName, 'node_modules');
    if (!existsSync(sourceNodeModules)) {
      continue;
    }

    const targetNodeModules = path.join(compiledRoot, entryName, 'node_modules');
    mkdirSync(path.dirname(targetNodeModules), { recursive: true });
    cpSync(sourceNodeModules, targetNodeModules, { recursive: true, force: true, dereference: true });
  }
}
