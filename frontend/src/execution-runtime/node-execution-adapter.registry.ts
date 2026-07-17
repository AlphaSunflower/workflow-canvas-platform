import type { AINodeData } from '@/types';
import type { ExecutionRuntimeNodeAdapter } from './node-execution-adapter.types';

export interface ExecutionRuntimeNodeAdapterRegisterOptions {
  override?: boolean;
}

export class ExecutionRuntimeNodeAdapterRegistry {
  private readonly adapters = new Map<AINodeData['type'], ExecutionRuntimeNodeAdapter>();

  register(
    adapter: ExecutionRuntimeNodeAdapter,
    options: ExecutionRuntimeNodeAdapterRegisterOptions = {},
  ): void {
    const existing = this.adapters.get(adapter.nodeType);
    if (existing && !options.override) {
      throw new Error(`Execution runtime adapter already registered for node type: ${adapter.nodeType}`);
    }

    this.adapters.set(adapter.nodeType, adapter);
  }

  registerMany(
    adapters: readonly ExecutionRuntimeNodeAdapter[],
    options: ExecutionRuntimeNodeAdapterRegisterOptions = {},
  ): void {
    adapters.forEach((adapter) => this.register(adapter, options));
  }

  get(nodeType: AINodeData['type']): ExecutionRuntimeNodeAdapter | null {
    return this.adapters.get(nodeType) ?? null;
  }

  require(nodeType: AINodeData['type']): ExecutionRuntimeNodeAdapter {
    const adapter = this.get(nodeType);
    if (!adapter) {
      throw new Error(`Execution runtime adapter is not registered for node type: ${nodeType}`);
    }

    return adapter;
  }

  has(nodeType: AINodeData['type']): boolean {
    return this.adapters.has(nodeType);
  }

  list(): ExecutionRuntimeNodeAdapter[] {
    return Array.from(this.adapters.values());
  }

  clear(): void {
    this.adapters.clear();
  }
}

let globalExecutionRuntimeNodeAdapterRegistry: ExecutionRuntimeNodeAdapterRegistry | null = null;

export function createExecutionRuntimeNodeAdapterRegistry(
  adapters: readonly ExecutionRuntimeNodeAdapter[] = [],
): ExecutionRuntimeNodeAdapterRegistry {
  const registry = new ExecutionRuntimeNodeAdapterRegistry();
  registry.registerMany(adapters);
  return registry;
}

export function getExecutionRuntimeNodeAdapterRegistry(): ExecutionRuntimeNodeAdapterRegistry {
  if (!globalExecutionRuntimeNodeAdapterRegistry) {
    globalExecutionRuntimeNodeAdapterRegistry = createExecutionRuntimeNodeAdapterRegistry();
  }

  return globalExecutionRuntimeNodeAdapterRegistry;
}

export function setExecutionRuntimeNodeAdapterRegistry(
  registry: ExecutionRuntimeNodeAdapterRegistry,
): void {
  globalExecutionRuntimeNodeAdapterRegistry = registry;
}

export function registerExecutionRuntimeNodeAdapter(
  adapter: ExecutionRuntimeNodeAdapter,
  options: ExecutionRuntimeNodeAdapterRegisterOptions = {},
): void {
  getExecutionRuntimeNodeAdapterRegistry().register(adapter, options);
}

export function getExecutionRuntimeNodeAdapter(
  nodeType: AINodeData['type'],
): ExecutionRuntimeNodeAdapter | null {
  return getExecutionRuntimeNodeAdapterRegistry().get(nodeType);
}

export function requireExecutionRuntimeNodeAdapter(
  nodeType: AINodeData['type'],
): ExecutionRuntimeNodeAdapter {
  return getExecutionRuntimeNodeAdapterRegistry().require(nodeType);
}

export const executionRuntimeNodeAdapterRegistry = getExecutionRuntimeNodeAdapterRegistry();
