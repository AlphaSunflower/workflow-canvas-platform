import fs from 'node:fs';
import path from 'node:path';

const backendRoot = path.resolve(import.meta.dirname, '..');
const apiRoot = path.join(backendRoot, 'api', 'src');
const workerRoot = path.join(backendRoot, 'worker', 'src');
const exts = new Set(['.ts', '.tsx']);
const mode = resolveMode(process.argv.slice(2));
const enforce = mode === 'enforce';

function resolveMode(argv) {
  if (argv.includes('--enforce')) {
    return 'enforce';
  }

  const inlineModeArg = argv.find((arg) => arg.startsWith('--mode='));
  if (inlineModeArg) {
    return inlineModeArg.slice('--mode='.length) === 'enforce'
      ? 'enforce'
      : 'report-only';
  }

  const modeFlagIndex = argv.indexOf('--mode');
  if (modeFlagIndex >= 0 && argv[modeFlagIndex + 1] === 'enforce') {
    return 'enforce';
  }

  return 'report-only';
}

function normalizeToPosix(targetPath) {
  return targetPath.split(path.sep).join('/');
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.tmp') {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    if (exts.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function tryResolveTsPath(basePath) {
  if (path.extname(basePath) && fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }

  const candidates = [
    ...['.ts', '.tsx'].map((ext) => `${basePath}${ext}`),
    ...['.ts', '.tsx'].map((ext) => path.join(basePath, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function collectImports(content) {
  const imports = [];
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let match = importPattern.exec(content);
  while (match) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      imports.push(specifier);
    }
    match = importPattern.exec(content);
  }
  return imports;
}

function classifyApiLayer(relativePath) {
  const normalizedPath = normalizeToPosix(relativePath);
  if (/\.spec\.ts$/.test(normalizedPath)) {
    return 'tests';
  }
  if (/\.controller\.ts$/.test(normalizedPath)) {
    return 'controller';
  }
  if (/\.service\.ts$/.test(normalizedPath)) {
    return 'service';
  }
  if (/\.repository\.ts$/.test(normalizedPath)) {
    return 'repository';
  }
  if (/\.dto\.ts$/.test(normalizedPath)) {
    return 'dto';
  }
  if (normalizedPath === 'main.ts' || normalizedPath.startsWith('composition/')) {
    return 'composition';
  }
  return 'other';
}

function classifyWorkerLayer(relativePath) {
  const normalizedPath = normalizeToPosix(relativePath);
  if (/\.spec\.ts$/.test(normalizedPath)) {
    return 'tests';
  }
  if (normalizedPath === 'main.ts' || normalizedPath === 'app.ts' || normalizedPath.startsWith('composition/')) {
    return 'composition';
  }
  if (/\.service\.ts$/.test(normalizedPath)) {
    return 'service';
  }
  if (/\.repository\.ts$/.test(normalizedPath)) {
    return 'repository';
  }
  if (/\.types\.ts$/.test(normalizedPath)) {
    return 'types';
  }
  return 'other';
}

function buildGraph(rootDir, classifier) {
  const files = walk(rootDir);
  const graph = new Map();
  const metadata = new Map();

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath);
    metadata.set(filePath, {
      relativePath: normalizeToPosix(relativePath),
      layer: classifier(relativePath),
    });
    graph.set(filePath, new Set());
  }

  function resolveImport(specifier, importerPath) {
    if (!specifier.startsWith('.')) {
      return null;
    }
    return tryResolveTsPath(path.resolve(path.dirname(importerPath), specifier));
  }

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const imports = collectImports(content);
    for (const specifier of imports) {
      const resolvedPath = resolveImport(specifier, filePath);
      if (!resolvedPath || !graph.has(resolvedPath)) {
        continue;
      }
      graph.get(filePath).add(resolvedPath);
    }
  }

  return {
    graph,
    metadata,
    files,
  };
}

function tarjan(graphMap) {
  let index = 0;
  const stack = [];
  const state = new Map();
  const components = [];

  function strongConnect(filePath) {
    state.set(filePath, {
      index,
      lowlink: index,
      onStack: true,
    });
    index += 1;
    stack.push(filePath);

    for (const neighbor of graphMap.get(filePath) ?? []) {
      if (!state.has(neighbor)) {
        strongConnect(neighbor);
        state.get(filePath).lowlink = Math.min(
          state.get(filePath).lowlink,
          state.get(neighbor).lowlink,
        );
      } else if (state.get(neighbor).onStack) {
        state.get(filePath).lowlink = Math.min(
          state.get(filePath).lowlink,
          state.get(neighbor).index,
        );
      }
    }

    if (state.get(filePath).lowlink === state.get(filePath).index) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        state.get(current).onStack = false;
        component.push(current);
      } while (current !== filePath);

      if (component.length > 1) {
        components.push(component);
      }
    }
  }

  for (const filePath of graphMap.keys()) {
    if (!state.has(filePath)) {
      strongConnect(filePath);
    }
  }

  return components;
}

function createViolation(rootDir, rule, fromFile, toFile, reason) {
  return {
    rule,
    from: normalizeToPosix(path.relative(rootDir, fromFile)),
    to: normalizeToPosix(path.relative(rootDir, toFile)),
    reason,
  };
}

function analyzeApi() {
  const { graph, metadata, files } = buildGraph(apiRoot, classifyApiLayer);
  const reverseGraph = new Map([...graph.keys()].map((filePath) => [filePath, new Set()]));
  for (const [fromFile, targets] of graph.entries()) {
    for (const toFile of targets) {
      reverseGraph.get(toFile).add(fromFile);
    }
  }

  const crossLayerViolations = [];
  const sourceCodeViolations = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileMeta = metadata.get(filePath);
    if (!fileMeta || fileMeta.layer === 'tests') {
      continue;
    }

    if (content.includes('shared/src/')) {
      sourceCodeViolations.push({
        rule: 'backend-no-shared-src-penetration',
        file: normalizeToPosix(path.relative(apiRoot, filePath)),
        reason: 'API source must not import shared/src internals directly',
      });
    }
  }

  for (const [fromFile, targets] of graph.entries()) {
    const fromMeta = metadata.get(fromFile);
    if (!fromMeta || fromMeta.layer === 'tests') {
      continue;
    }

    for (const toFile of targets) {
      const toMeta = metadata.get(toFile);
      if (!toMeta || toMeta.layer === 'tests') {
        continue;
      }

      if (fromMeta.layer === 'service' && toMeta.layer === 'dto') {
        crossLayerViolations.push(
          createViolation(
            apiRoot,
            'backend-service-must-not-depend-on-dto',
            fromFile,
            toFile,
            'service layer must not depend on dto layer',
          ),
        );
      }

      if (fromMeta.layer === 'service' && toMeta.layer === 'controller') {
        crossLayerViolations.push(
          createViolation(
            apiRoot,
            'backend-service-must-not-depend-on-controller',
            fromFile,
            toFile,
            'service layer must not depend on controller layer',
          ),
        );
      }
    }
  }

  const cycles = tarjan(graph)
    .map((component) => component
      .filter((filePath) => metadata.get(filePath)?.layer !== 'tests')
      .map((filePath) => normalizeToPosix(path.relative(apiRoot, filePath))))
    .filter((component) => component.length > 1)
    .sort((a, b) => b.length - a.length);

  const inboundCounts = files.map((filePath) => ({
    file: normalizeToPosix(path.relative(apiRoot, filePath)),
    layer: metadata.get(filePath)?.layer ?? 'other',
    inbound: [...(reverseGraph.get(filePath) ?? [])].filter((importer) => metadata.get(importer)?.layer !== 'tests').length,
    outbound: [...(graph.get(filePath) ?? [])].filter((target) => metadata.get(target)?.layer !== 'tests').length,
  }))
    .filter((entry) => entry.layer !== 'tests')
    .sort((a, b) => b.inbound - a.inbound || b.outbound - a.outbound)
    .slice(0, 20);

  return {
    files: files.length,
    rules: {
      dependencyDirection: 'composition -> controller -> service -> repository/shared-contracts',
      forbiddenDependencies: [
        'service -> dto',
        'service -> controller',
        'api source -> shared/src/**',
      ],
    },
    topInboundFiles: inboundCounts,
    crossLayerViolations,
    sourceCodeViolations,
    cycles,
  };
}

function analyzeWorker() {
  const { graph, metadata, files } = buildGraph(workerRoot, classifyWorkerLayer);
  const reverseGraph = new Map([...graph.keys()].map((filePath) => [filePath, new Set()]));
  for (const [fromFile, targets] of graph.entries()) {
    for (const toFile of targets) {
      reverseGraph.get(toFile).add(fromFile);
    }
  }

  const sourceCodeViolations = [];
  const cycles = tarjan(graph)
    .map((component) => component
      .filter((filePath) => metadata.get(filePath)?.layer !== 'tests')
      .map((filePath) => normalizeToPosix(path.relative(workerRoot, filePath))))
    .filter((component) => component.length > 1)
    .sort((a, b) => b.length - a.length);

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileMeta = metadata.get(filePath);
    if (!fileMeta || fileMeta.layer === 'tests') {
      continue;
    }

    if (content.includes('shared/src/')) {
      sourceCodeViolations.push({
        rule: 'backend-no-shared-src-penetration',
        file: normalizeToPosix(path.relative(workerRoot, filePath)),
        reason: 'Worker source must not import shared/src internals directly',
      });
    }
  }

  const inboundCounts = files.map((filePath) => ({
    file: normalizeToPosix(path.relative(workerRoot, filePath)),
    layer: metadata.get(filePath)?.layer ?? 'other',
    inbound: [...(reverseGraph.get(filePath) ?? [])].filter((importer) => metadata.get(importer)?.layer !== 'tests').length,
    outbound: [...(graph.get(filePath) ?? [])].filter((target) => metadata.get(target)?.layer !== 'tests').length,
  }))
    .filter((entry) => entry.layer !== 'tests')
    .sort((a, b) => b.inbound - a.inbound || b.outbound - a.outbound)
    .slice(0, 20);

  return {
    files: files.length,
    rules: {
      dependencyDirection: 'composition -> service -> repository/shared-contracts',
      forbiddenDependencies: [
        'worker source -> shared/src/**',
      ],
    },
    topInboundFiles: inboundCounts,
    sourceCodeViolations,
    cycles,
  };
}

const apiSummary = analyzeApi();
const workerSummary = analyzeWorker();

const summary = {
  generatedAt: new Date().toISOString(),
  mode,
  project: 'backend',
  api: {
    totals: {
      files: apiSummary.files,
      crossLayerViolations: apiSummary.crossLayerViolations.length,
      sourceCodeViolations: apiSummary.sourceCodeViolations.length,
      cycles: apiSummary.cycles.length,
    },
    ...apiSummary,
  },
  worker: {
    totals: {
      files: workerSummary.files,
      sourceCodeViolations: workerSummary.sourceCodeViolations.length,
      cycles: workerSummary.cycles.length,
    },
    ...workerSummary,
  },
};

console.log(JSON.stringify(summary, null, 2));

const blockingViolationCount = (
  apiSummary.crossLayerViolations.length
  + apiSummary.sourceCodeViolations.length
  + apiSummary.cycles.length
  + workerSummary.sourceCodeViolations.length
  + workerSummary.cycles.length
);

if (enforce && blockingViolationCount > 0) {
  process.exitCode = 1;
}
