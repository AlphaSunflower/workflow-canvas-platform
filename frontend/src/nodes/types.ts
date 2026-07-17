import type {
  AINodeData,
  AIConfig,
  AIImageInputGroup,
  AnyNodeData,
  Connection,
  FileSource,
  FileNodeData,
  NodeId,
  Position,
  Workflow,
} from '@/types';
import type { WorkflowConnectionInput } from '@/contracts/workflow';
import type { AITaskType, AIProvider } from '@/types';

export type RegisteredAINodeType = AINodeData['type'];
export type AIPlaceholderNodeType = RegisteredAINodeType;
export type AllowedFileNodeType = FileNodeData['type'];
export type NodeDefinitionStage = 'placeholder' | 'full';
export type NodeExecutionMode = 'mock' | 'legacy-single-task' | 'legacy-grouped-task' | 'node-action-only';
export type NodeActionOnlyExecutionMode = Extract<NodeExecutionMode, 'node-action-only'>;
export type NodeInputGroupMode = 'none' | 'fixed' | 'dynamic';
export type NodePortOrderMode = 'unordered' | 'ordered';
export type NodeHandleStyle = 'group-port';
export type NodeMenuContext = 'canvas';

export interface NodeMenuDefinition {
  order: number;
  group: 'ai';
  visible?: boolean;
  contexts?: NodeMenuContext[];
}

export interface NodePortDefinition {
  id: string;
  label: string;
  accepts: AllowedFileNodeType[];
  required?: boolean;
  maxConnections?: number;
  orderMode?: NodePortOrderMode;
}

export interface NodeInputGroupDefinition {
  id: string;
  label: string;
  ports: NodePortDefinition[];
}

export interface NodeResolvedPortInput<TNode extends AnyNodeData = FileNodeData> {
  groupId: string;
  portId: string;
  handle: string;
  connection: Connection;
  sourceNode: TNode;
}

export interface NodeResolvedPortState<TNode extends AnyNodeData = FileNodeData> {
  port: NodePortDefinition;
  handle: string;
  inputs: NodeResolvedPortInput<TNode>[];
}

export interface NodeResolvedInputGroupState<TNode extends AnyNodeData = FileNodeData> {
  group: AIImageInputGroup;
  ports: NodeResolvedPortState<TNode>[];
}

export interface NodeValidationResult {
  valid: boolean;
  reason?: string;
}

export interface NodeActionOptions {
  signal?: AbortSignal;
  suppressNotifications?: boolean;
  [key: string]: unknown;
}

export interface NodeActionContext<TOptions extends NodeActionOptions = NodeActionOptions> {
  workflow: Workflow;
  node: AINodeData;
  inputs: WorkflowConnectionInput[];
  targetId?: string;
  options: TOptions;
  services?: unknown;
}

export interface NodeActionDefinition<TOptions extends NodeActionOptions = NodeActionOptions> {
  id: string;
  label: string;
  description?: string;
  targetRequired?: boolean;
  validate?: (context: NodeActionContext<TOptions>) => NodeValidationResult;
  run: (context: NodeActionContext<TOptions>) => Promise<void> | void;
}

export interface NodeConnectionValidationContext {
  sourceNode: AnyNodeData;
  targetNode: AnyNodeData;
  sourceHandle?: string;
  targetHandle?: string;
  existingInputs: WorkflowConnectionInput[];
}

export interface NodeConnectionBuildContext extends NodeConnectionValidationContext {
  existingConnections: Connection[];
}

export type NodeDropTargetType = 'body' | 'group';

export interface NodeDropTarget {
  nodeId: string;
  nodeType: NodeDropTargetType;
  groupId?: string;
}

export interface NodeDropKeyboardState {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface NodeDropTargetContext {
  target: NodeDropTarget;
  draggedNodes: AnyNodeData[];
  keyboard: NodeDropKeyboardState;
  workflow: Workflow;
}

export interface NodeDropPreview {
  valid: boolean;
  reason?: string;
}

export interface NodeDropPlan {
  nextTargetNode: AINodeData;
  nextConnections: Connection[];
}

export interface NodeExecutionPlan {
  files: string[];
  references: string[];
  config: AIConfig;
  prompt?: string;
  negativePrompt?: string;
}

export interface NodeExecutionGroupPlan {
  groupId: string;
  groupLabel?: string;
  order: number;
  outputHandle?: string;
  plan: NodeExecutionPlan;
}

export interface MockOutputDescriptor {
  fileType: AllowedFileNodeType;
  fileName: string;
  mimeType: string;
  source?: FileSource;
  sourceHandle?: string;
  order?: number;
}

export interface MockExecutionContext {
  node: AINodeData;
  workflow: Workflow;
  inputs: WorkflowConnectionInput[];
}

export interface GroupedExecutionContext {
  workflow: Workflow;
  node: AINodeData;
  inputs: WorkflowConnectionInput[];
}

export interface NodeInputGroupCapability {
  mode: NodeInputGroupMode;
  minGroups?: number;
  maxGroups?: number;
  ordered?: boolean;
  supportsAdd?: boolean;
  supportsRemove?: boolean;
  handleStyle: NodeHandleStyle;
}

export interface NodeNoDropCapability {
  mode: 'none';
}

export interface NodeCustomDropCapability {
  mode: 'custom';
  acceptDraggedNodes: (nodes: AnyNodeData[]) => boolean;
  validateTarget: (context: NodeDropTargetContext) => NodeDropPreview;
  buildPlan: (context: NodeDropTargetContext) => NodeDropPlan | null;
}

export type NodeDropCapability = NodeNoDropCapability | NodeCustomDropCapability;

export interface NodeExecutionAdapterBase {
  mode: NodeExecutionMode;
  taskType: AITaskType;
  provider: AIProvider;
  canRun: (node: AINodeData, inputs: WorkflowConnectionInput[]) => NodeValidationResult;
}

export interface NodeMockExecutionAdapter extends NodeExecutionAdapterBase {
  mode: 'mock';
  buildPlan: (node: AINodeData, inputs: WorkflowConnectionInput[]) => NodeExecutionPlan;
  mockProgressMessages?: string[];
  getMockOutputs?: (context: MockExecutionContext) => MockOutputDescriptor[];
}

export interface NodeSingleTaskExecutionAdapter extends NodeExecutionAdapterBase {
  mode: 'legacy-single-task';
  buildPlan: (node: AINodeData, inputs: WorkflowConnectionInput[]) => NodeExecutionPlan;
}

export interface NodeGroupedTaskExecutionAdapter extends NodeExecutionAdapterBase {
  mode: 'legacy-grouped-task';
  buildGroupPlans: (context: GroupedExecutionContext) => NodeExecutionGroupPlan[];
}

export interface NodeActionOnlyExecutionAdapter extends NodeExecutionAdapterBase {
  mode: NodeActionOnlyExecutionMode;
}

export type NodeExecutionAdapter =
  | NodeMockExecutionAdapter
  | NodeSingleTaskExecutionAdapter
  | NodeGroupedTaskExecutionAdapter
  | NodeActionOnlyExecutionAdapter;

export interface NodeDefinition {
  type: RegisteredAINodeType;
  stage: NodeDefinitionStage;
  displayName: string;
  icon: string;
  color: string;
  description: string;
  menu: NodeMenuDefinition;
  defaultSize: {
    width: number;
    height: number;
  };
  defaultConfig: AIConfig;
  defaultInputGroups?: AIImageInputGroup[];
  inputGroups?: NodeInputGroupCapability;
  drop?: NodeDropCapability;
  actions?: NodeActionDefinition[];
  resolveInputGroups?: (node: AINodeData) => NodeInputGroupDefinition[];
  validateConnection: (context: NodeConnectionValidationContext) => NodeValidationResult;
  execution: NodeExecutionAdapter;
  createNodeData?: (id: NodeId, position: Position) => AINodeData;
}
