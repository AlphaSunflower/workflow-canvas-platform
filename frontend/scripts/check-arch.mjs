import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const srcRoot = path.join(projectRoot, 'src');
const exts = new Set(['.ts', '.tsx']);
const mode = resolveMode(process.argv.slice(2));
const enforce = mode === 'enforce';
const aliasRoots = new Map([
  ['@', srcRoot],
]);

const rootBarrelSpecs = new Set([
  '@/services',
  '@/hooks',
  '@/components/context',
  '@/nodes',
]);

const rootBarrelRelativePaths = new Set([
  'services/index.ts',
  'hooks/index.ts',
  'components/context/index.ts',
  'nodes/index.ts',
]);

const layerDefinitions = [
  {
    name: 'tests',
    match: (normalizedPath) => (
      normalizedPath.startsWith('tests/')
      || normalizedPath.startsWith('test-support/')
      || /\.(spec|test)\.(ts|tsx)$/.test(normalizedPath)
    ),
  },
  {
    name: 'components-context',
    match: (normalizedPath) => normalizedPath.startsWith('components/context/'),
  },
  {
    name: 'components',
    match: (normalizedPath) => normalizedPath.startsWith('components/'),
  },
  {
    name: 'hooks',
    match: (normalizedPath) => normalizedPath.startsWith('hooks/'),
  },
  {
    name: 'services',
    match: (normalizedPath) => normalizedPath.startsWith('services/'),
  },
  {
    name: 'execution-runtime',
    match: (normalizedPath) => normalizedPath.startsWith('execution-runtime/'),
  },
  {
    name: 'nodes-ui',
    match: (normalizedPath) => (
      normalizedPath.startsWith('nodes/')
      && normalizedPath.endsWith('.tsx')
    ),
  },
  {
    name: 'nodes',
    match: (normalizedPath) => normalizedPath.startsWith('nodes/'),
  },
  {
    name: 'contracts',
    match: (normalizedPath) => normalizedPath.startsWith('contracts/'),
  },
  {
    name: 'types',
    match: (normalizedPath) => normalizedPath.startsWith('types/'),
  },
  {
    name: 'utils',
    match: (normalizedPath) => normalizedPath.startsWith('utils/'),
  },
  {
    name: 'constants',
    match: (normalizedPath) => normalizedPath.startsWith('constants/'),
  },
];

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
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.tmp') {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
      continue;
    }

    if (exts.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function classifyLayer(relativePath) {
  const normalizedPath = normalizeToPosix(relativePath);
  for (const definition of layerDefinitions) {
    if (definition.match(normalizedPath)) {
      return definition.name;
    }
  }
  return 'other';
}

function isTestFile(relativePath) {
  return classifyLayer(relativePath) === 'tests';
}

function isNonProductionEntry(relativePath) {
  return (
    /\.(spec|test)\.(ts|tsx)$/.test(relativePath)
    || relativePath.endsWith('.d.ts')
    || relativePath.endsWith('.worker.ts')
    || relativePath.endsWith('.worker.tsx')
  );
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

function resolveImport(specifier, importerPath) {
  if (specifier.startsWith('.')) {
    return tryResolveTsPath(path.resolve(path.dirname(importerPath), specifier));
  }

  for (const [alias, aliasRoot] of aliasRoots.entries()) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      const suffix = specifier === alias ? '' : specifier.slice(alias.length + 1);
      return tryResolveTsPath(path.join(aliasRoot, suffix));
    }
  }

  return null;
}

function pushImportMatches(imports, content, pattern, kind, source) {
  pattern.lastIndex = 0;
  let match = pattern.exec(content);
  while (match) {
    const specifier = match[1];
    if (specifier) {
      imports.push({
        specifier,
        kind,
        source,
      });
    }
    match = pattern.exec(content);
  }
}

function collectImports(content) {
  const imports = [];

  pushImportMatches(
    imports,
    content,
    /^\s*import\s+type\b[\s\S]*?\bfrom\s+["']([^"']+)["']/gm,
    'type-only',
    'import-type',
  );
  pushImportMatches(
    imports,
    content,
    /^\s*export\s+type\b[\s\S]*?\bfrom\s+["']([^"']+)["']/gm,
    'type-only',
    'export-type',
  );
  pushImportMatches(
    imports,
    content,
    /^\s*import\b(?!\s+type\b)[\s\S]*?(?:\bfrom\s+)?["']([^"']+)["']/gm,
    'runtime',
    'import',
  );
  pushImportMatches(
    imports,
    content,
    /^\s*export\b(?!\s+type\b)[\s\S]*?\bfrom\s+["']([^"']+)["']/gm,
    'runtime',
    'export',
  );
  pushImportMatches(
    imports,
    content,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    'runtime',
    'dynamic-import',
  );
  pushImportMatches(
    imports,
    content,
    /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
    'runtime',
    'import-meta-url',
  );

  return imports;
}

function createViolation(rule, fromFile, toFile, reason) {
  return {
    rule,
    from: normalizeToPosix(path.relative(projectRoot, fromFile)),
    to: normalizeToPosix(path.relative(projectRoot, toFile)),
    reason,
  };
}

function createGraph(nodes) {
  return new Map(nodes.map((filePath) => [filePath, new Set()]));
}

function createReverseGraph(graphMap) {
  const reverseGraph = new Map([...graphMap.keys()].map((filePath) => [filePath, new Set()]));
  for (const [fromFile, targets] of graphMap.entries()) {
    for (const toFile of targets) {
      reverseGraph.get(toFile)?.add(fromFile);
    }
  }
  return reverseGraph;
}

function filterGraph(graphMap, predicate) {
  const filteredEntries = [...graphMap.entries()]
    .filter(([filePath]) => predicate(filePath))
    .map(([filePath, targets]) => [
      filePath,
      new Set([...targets].filter((target) => predicate(target))),
    ]);
  return new Map(filteredEntries);
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

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function hasTopLevelIndexSideEffects(relativePath, content) {
  if (!/(^|\/)index\.(ts|tsx)$/.test(relativePath)) {
    return false;
  }

  const sanitized = stripComments(content);
  return sanitized.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }

    if (
      /^(import|export)\b/.test(trimmed)
      || /^(type|interface)\b/.test(trimmed)
      || /^return\b/.test(trimmed)
    ) {
      return false;
    }

    if (/^(const|let|var)\s+\w+\s*=\s*(?:new\s+[A-Z]\w*|[A-Za-z_$][\w$.]*\s*\()/u.test(trimmed)) {
      return true;
    }

    return /^(?:await\s+)?[A-Za-z_$][\w$.]*\s*\(/u.test(trimmed);
  });
}

function hasSingletonService(relativePath, content) {
  if (
    !relativePath.startsWith('services/')
    && !relativePath.startsWith('execution-runtime/')
    && !relativePath.startsWith('api/')
  ) {
    return false;
  }

  const sanitized = stripComments(content);
  return /^\s*export\s+const\s+\w+\s*=\s*(?:new\s+[A-Z]\w*|create[A-Z]\w*|[A-Za-z_$][\w$]*\.create[A-Z]\w*)/mu.test(sanitized);
}

function isStronglyConnected(graphMap, reverseGraph, component) {
  if (component.length <= 1) {
    return false;
  }

  const componentSet = new Set(component);
  const start = component[0];

  function traverse(source, adjacencyMap) {
    const visited = new Set();
    const queue = [source];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      for (const neighbor of adjacencyMap.get(current) ?? []) {
        if (componentSet.has(neighbor) && !visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return visited;
  }

  return (
    traverse(start, graphMap).size === component.length
    && traverse(start, reverseGraph).size === component.length
  );
}

function getCyclePriority(classification, riskMarkers) {
  if (classification === 'runtime') {
    if (
      riskMarkers.rootBarrelParticipants.length > 0
      || riskMarkers.sideEffectIndexParticipants.length > 0
      || riskMarkers.singletonServiceParticipants.length > 0
    ) {
      return 'highest';
    }
    return 'high';
  }

  if (classification === 'mixed') {
    return 'medium';
  }

  return 'low';
}

function sortCycleRecords(records) {
  const priorityOrder = new Map([
    ['highest', 0],
    ['high', 1],
    ['medium', 2],
    ['low', 3],
  ]);

  return records.sort((left, right) => (
    (priorityOrder.get(left.priority) ?? 99) - (priorityOrder.get(right.priority) ?? 99)
    || right.files.length - left.files.length
    || left.files.join('|').localeCompare(right.files.join('|'))
  ));
}

function toProjectRelativePath(filePath) {
  return normalizeToPosix(path.relative(projectRoot, filePath));
}

const allFiles = walk(srcRoot);
const fullGraph = createGraph(allFiles);
const runtimeGraph = createGraph(allFiles);
const metadata = new Map();
const importsByFile = new Map();
const edgeKinds = new Map();

for (const filePath of allFiles) {
  const relativePath = normalizeToPosix(path.relative(srcRoot, filePath));
  const content = fs.readFileSync(filePath, 'utf8');

  metadata.set(filePath, {
    relativePath,
    layer: classifyLayer(relativePath),
    content,
    hasTopLevelIndexSideEffects: hasTopLevelIndexSideEffects(relativePath, content),
    hasSingletonService: hasSingletonService(relativePath, content),
  });
  importsByFile.set(filePath, collectImports(content));
  edgeKinds.set(filePath, new Map());
}

for (const filePath of allFiles) {
  const imports = importsByFile.get(filePath) ?? [];

  for (const importEntry of imports) {
    const resolvedPath = resolveImport(importEntry.specifier, filePath);
    if (!resolvedPath || !fullGraph.has(resolvedPath)) {
      continue;
    }

    fullGraph.get(filePath)?.add(resolvedPath);
    if (importEntry.kind === 'runtime') {
      runtimeGraph.get(filePath)?.add(resolvedPath);
    }

    const currentKinds = edgeKinds.get(filePath)?.get(resolvedPath) ?? {
      runtime: false,
      typeOnly: false,
      sources: new Set(),
    };
    currentKinds[importEntry.kind === 'runtime' ? 'runtime' : 'typeOnly'] = true;
    currentKinds.sources.add(importEntry.source);
    edgeKinds.get(filePath)?.set(resolvedPath, currentKinds);
  }
}

const reverseGraph = createReverseGraph(fullGraph);
const runtimeReverseGraph = createReverseGraph(runtimeGraph);

const productionFileSet = new Set(
  allFiles.filter((filePath) => metadata.get(filePath)?.layer !== 'tests'),
);
const productionFullGraph = filterGraph(fullGraph, (filePath) => productionFileSet.has(filePath));
const productionRuntimeGraph = filterGraph(runtimeGraph, (filePath) => productionFileSet.has(filePath));
const productionReverseGraph = createReverseGraph(productionFullGraph);
const productionRuntimeReverseGraph = createReverseGraph(productionRuntimeGraph);

const reverseDependencyViolations = [];
const crossLayerViolations = [];

for (const [fromFile, targets] of productionFullGraph.entries()) {
  const fromMeta = metadata.get(fromFile);
  if (!fromMeta) {
    continue;
  }

  for (const toFile of targets) {
    const toMeta = metadata.get(toFile);
    if (!toMeta) {
      continue;
    }

    const toRelative = toMeta.relativePath;

    if (
      ['nodes', 'execution-runtime', 'services', 'utils'].includes(fromMeta.layer)
      && toMeta.layer === 'components-context'
    ) {
      reverseDependencyViolations.push(
        createViolation(
          'frontend-no-reverse-dependency-to-components-context',
          fromFile,
          toFile,
          `${fromMeta.layer} must not depend on components/context`,
        ),
      );
    }

    if (
      ['nodes', 'execution-runtime', 'services', 'utils'].includes(fromMeta.layer)
      && toRelative.startsWith('components/')
      && !toRelative.startsWith('components/ui/')
    ) {
      crossLayerViolations.push(
        createViolation(
          'frontend-restricted-components-import',
          fromFile,
          toFile,
          `${fromMeta.layer} should not depend on non-UI components`,
        ),
      );
    }

    if (
      fromMeta.layer === 'nodes'
      && (toRelative.startsWith('components/canvas/') || toRelative.startsWith('components/node/'))
    ) {
      crossLayerViolations.push(
        createViolation(
          'frontend-nodes-must-not-own-renderer-dependencies',
          fromFile,
          toFile,
          'nodes layer should not directly depend on canvas or node component implementations',
        ),
      );
    }

    if (
      ['nodes', 'execution-runtime'].includes(fromMeta.layer)
      && toMeta.layer === 'hooks'
    ) {
      crossLayerViolations.push(
        createViolation(
          'frontend-runtime-should-not-depend-on-hooks',
          fromFile,
          toFile,
          `${fromMeta.layer} should avoid importing hook-layer contracts directly`,
        ),
      );
    }
  }
}

for (const filePath of productionFileSet) {
  const fileImports = importsByFile.get(filePath) ?? [];
  const fromMeta = metadata.get(filePath);
  if (!fromMeta) {
    continue;
  }

  for (const importEntry of fileImports) {
    if (!rootBarrelSpecs.has(importEntry.specifier)) {
      continue;
    }

    crossLayerViolations.push(
      createViolation(
        'frontend-root-barrel-imports-are-restricted',
        filePath,
        path.join(srcRoot, importEntry.specifier.replace('@/', ''), 'index.ts'),
        'Use precise module imports instead of frontend root barrel exports',
      ),
    );
  }
}

const cycleComponents = tarjan(productionFullGraph)
  .sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));

const cycleRecords = sortCycleRecords(cycleComponents.map((component) => {
  const componentSet = new Set(component);
  let runtimeRelations = 0;
  let typeOnlyRelations = 0;
  let hybridRelations = 0;

  for (const fromFile of component) {
    for (const toFile of productionFullGraph.get(fromFile) ?? []) {
      if (!componentSet.has(toFile)) {
        continue;
      }

      const relation = edgeKinds.get(fromFile)?.get(toFile);
      if (!relation) {
        continue;
      }

      if (relation.runtime && relation.typeOnly) {
        hybridRelations += 1;
      } else if (relation.runtime) {
        runtimeRelations += 1;
      } else if (relation.typeOnly) {
        typeOnlyRelations += 1;
      }
    }
  }

  const runtimeStronglyConnected = (
    (runtimeRelations + hybridRelations) > 0
    && isStronglyConnected(
      productionRuntimeGraph,
      productionRuntimeReverseGraph,
      component,
    )
  );

  let classification = 'mixed';
  if (runtimeRelations === 0 && hybridRelations === 0) {
    classification = 'type-only';
  } else if (runtimeStronglyConnected) {
    classification = 'runtime';
  }

  const files = component
    .map((filePath) => toProjectRelativePath(filePath))
    .sort((left, right) => left.localeCompare(right));

  const rootBarrelParticipants = component
    .filter((filePath) => rootBarrelRelativePaths.has(metadata.get(filePath)?.relativePath ?? ''))
    .map((filePath) => toProjectRelativePath(filePath))
    .sort((left, right) => left.localeCompare(right));

  const sideEffectIndexParticipants = component
    .filter((filePath) => metadata.get(filePath)?.hasTopLevelIndexSideEffects === true)
    .map((filePath) => toProjectRelativePath(filePath))
    .sort((left, right) => left.localeCompare(right));

  const singletonServiceParticipants = component
    .filter((filePath) => metadata.get(filePath)?.hasSingletonService === true)
    .map((filePath) => toProjectRelativePath(filePath))
    .sort((left, right) => left.localeCompare(right));

  const riskMarkers = {
    rootBarrelParticipants,
    sideEffectIndexParticipants,
    singletonServiceParticipants,
  };

  return {
    classification,
    priority: getCyclePriority(classification, riskMarkers),
    files,
    relationCounts: {
      runtime: runtimeRelations,
      typeOnly: typeOnlyRelations,
      hybrid: hybridRelations,
    },
    riskMarkers,
  };
}));

const runtimeCycles = cycleRecords.filter((record) => record.classification === 'runtime');
const typeOnlyCycles = cycleRecords.filter((record) => record.classification === 'type-only');
const mixedCycles = cycleRecords.filter((record) => record.classification === 'mixed');

const inboundCounts = [...productionFullGraph.keys()].map((filePath) => ({
  file: toProjectRelativePath(filePath),
  layer: metadata.get(filePath)?.layer ?? 'other',
  inbound: [...(productionReverseGraph.get(filePath) ?? [])].length,
  outbound: [...(productionFullGraph.get(filePath) ?? [])].length,
}))
  .sort((left, right) => right.inbound - left.inbound || right.outbound - left.outbound)
  .slice(0, 20);

const orphanCandidates = [...productionFullGraph.keys()].map((filePath) => ({
  file: toProjectRelativePath(filePath),
  layer: metadata.get(filePath)?.layer ?? 'other',
  inbound: [...(productionReverseGraph.get(filePath) ?? [])].length,
  outbound: [...(productionFullGraph.get(filePath) ?? [])].length,
}))
  .filter((entry) => (
    entry.layer !== 'tests'
    && entry.inbound === 0
    && !isNonProductionEntry(entry.file.replace(/^src\//, ''))
    && !entry.file.endsWith('/index.ts')
    && !entry.file.endsWith('/index.tsx')
    && entry.file !== 'src/main.tsx'
    && entry.file !== 'src/App.tsx'
  ))
  .sort((left, right) => left.file.localeCompare(right.file));

const summary = {
  generatedAt: new Date().toISOString(),
  mode,
  project: 'frontend',
  rules: {
    reverseDependencyRule: 'nodes/execution-runtime/services/utils must not depend on components/context',
    restrictedComponentsRule: 'nodes/execution-runtime/services/utils should not depend on non-UI components',
    nodeRendererRule: 'nodes should not own canvas/node renderer implementation imports',
    hooksRule: 'nodes/execution-runtime should avoid hook-layer contract imports',
    rootBarrelRule: 'frontend source should avoid root barrel imports such as @/services, @/hooks, @/components/context, @/nodes',
    cycleClassificationRule: 'dependency cycles are classified as runtime, type-only, or mixed based on import edge kinds',
    highRiskCycleMarkers: 'root barrel participants, side-effect index participants, and singleton service participants are flagged as higher-risk cycle markers',
    nodeUiClassification: 'nodes/**/*.tsx is treated as node UI adapter surface and excluded from core node-layer import restrictions',
  },
  totals: {
    files: productionFullGraph.size,
    reverseDependencyViolations: reverseDependencyViolations.length,
    crossLayerViolations: crossLayerViolations.length,
    cycles: cycleRecords.length,
    runtimeCycles: runtimeCycles.length,
    typeOnlyCycles: typeOnlyCycles.length,
    mixedCycles: mixedCycles.length,
    orphanCandidates: orphanCandidates.length,
  },
  topInboundFiles: inboundCounts,
  orphanCandidates,
  reverseDependencyViolations,
  crossLayerViolations,
  cycles: cycleRecords.map((record) => record.files),
  runtimeCycles,
  typeOnlyCycles,
  mixedCycles,
};

console.log(JSON.stringify(summary, null, 2));

const blockingViolationCount =
  reverseDependencyViolations.length
  + crossLayerViolations.length
  + runtimeCycles.length
  + mixedCycles.length;

if (enforce && blockingViolationCount > 0) {
  process.exitCode = 1;
}
