/**
 * Workflow validators.
 * @module utils/validators/workflow-validators
 */

import type {
  AutoSaveConfig,
  Connection,
  ConnectionStyle,
  LayoutConfig,
  Viewport,
  Workflow,
  WorkflowMetadata,
  WorkflowState,
} from '@/types/workflow.types';
import type { WorkflowRelatedTaskRef } from '@/types/snapshot.types';
import type { Position } from '@/types/base.types';
import {
  ensureAIImageInputGroups,
  normalizeAIImageGenInputHandle,
  normalizeAIImageGenOutputHandle,
} from '@/utils/node/create';
import { createGroupPortHandle } from '@/nodes/shared/group-port-handle';
import {
  AI_IMAGE_INPAINT_GROUP_ID,
  AI_IMAGE_INPAINT_INPUT_PORT_ID,
  AI_IMAGE_INPAINT_RESULT_PORT_ID,
  getAIImageInpaintInputHandle,
  getAIImageInpaintOutputHandle,
} from '@/nodes/ai-image-inpaint/groups';
import { normalizeWorkflowData } from '@/utils/workflow/runtime';
import { isAINodeData, isFileNodeData } from '../common';
import { validateNodeData } from './node-validators';
import { CANVAS_DEFAULTS } from '@/constants/canvas.constants';
import { AUTO_SAVE_DEFAULTS, CONNECTION_STYLE_DEFAULTS } from '@/constants/workflow.constants';

const COLOR_HEX_PATTERN = /^#([0-9A-Fa-f]{3}){1,2}$/;
const COLOR_RGB_PATTERN = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/;
const COLOR_RGBA_PATTERN = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/;
const AI_IMAGE_INPUT_PORT_ID = 'images';
const AI_IMAGE_RESULT_PORT_ID = 'result';

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export function createValidResult(): ValidationResult {
  return { valid: true, message: '' };
}

export function createInvalidResult(message: string): ValidationResult {
  return { valid: false, message };
}

export function validateViewport(viewport: unknown): ValidationResult {
  if (typeof viewport !== 'object' || viewport === null) {
    return createInvalidResult('Viewport must be an object.');
  }

  const vp = viewport as Partial<Viewport>;
  if (typeof vp.x !== 'number' || !Number.isFinite(vp.x)) {
    return createInvalidResult('Viewport x must be a finite number.');
  }

  if (typeof vp.y !== 'number' || !Number.isFinite(vp.y)) {
    return createInvalidResult('Viewport y must be a finite number.');
  }

  if (typeof vp.zoom !== 'number' || !Number.isFinite(vp.zoom)) {
    return createInvalidResult('Viewport zoom must be a finite number.');
  }

  if (vp.zoom < CANVAS_DEFAULTS.minZoom) {
    return createInvalidResult(`Viewport zoom cannot be less than ${CANVAS_DEFAULTS.minZoom}.`);
  }

  if (vp.zoom > CANVAS_DEFAULTS.maxZoom) {
    return createInvalidResult(`Viewport zoom cannot be greater than ${CANVAS_DEFAULTS.maxZoom}.`);
  }

  return createValidResult();
}

export function validateZoom(zoom: number): ValidationResult {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom)) {
    return createInvalidResult('Zoom must be a finite number.');
  }

  if (zoom < CANVAS_DEFAULTS.minZoom) {
    return createInvalidResult(`Zoom cannot be less than ${CANVAS_DEFAULTS.minZoom}.`);
  }

  if (zoom > CANVAS_DEFAULTS.maxZoom) {
    return createInvalidResult(`Zoom cannot be greater than ${CANVAS_DEFAULTS.maxZoom}.`);
  }

  return createValidResult();
}

export function validateCanvasPosition(position: Position): ValidationResult {
  if (typeof position !== 'object' || position === null) {
    return createInvalidResult('Position must be an object.');
  }

  const pos = position as Partial<Position>;
  if (typeof pos.x !== 'number' || !Number.isFinite(pos.x)) {
    return createInvalidResult('Position x must be a finite number.');
  }

  if (typeof pos.y !== 'number' || !Number.isFinite(pos.y)) {
    return createInvalidResult('Position y must be a finite number.');
  }

  const halfWidth = CANVAS_DEFAULTS.width / 2;
  const halfHeight = CANVAS_DEFAULTS.height / 2;
  if (Math.abs(pos.x) > halfWidth) {
    return createInvalidResult(`Position x(${pos.x}) is outside the canvas bounds.`);
  }

  if (Math.abs(pos.y) > halfHeight) {
    return createInvalidResult(`Position y(${pos.y}) is outside the canvas bounds.`);
  }

  return createValidResult();
}

export function validateConnection(connection: unknown): ValidationResult {
  if (typeof connection !== 'object' || connection === null) {
    return createInvalidResult('Connection must be an object.');
  }

  const conn = connection as Partial<Connection>;
  if (typeof conn.id !== 'string' || conn.id.length === 0) {
    return createInvalidResult('Connection id must be a non-empty string.');
  }

  if (conn.type !== 'file-reference' && conn.type !== 'output-link') {
    return createInvalidResult('Connection type must be file-reference or output-link.');
  }

  if (typeof conn.sourceId !== 'string' || conn.sourceId.length === 0) {
    return createInvalidResult('Connection sourceId must be a non-empty string.');
  }

  if (typeof conn.targetId !== 'string' || conn.targetId.length === 0) {
    return createInvalidResult('Connection targetId must be a non-empty string.');
  }

  if (conn.sourceId === conn.targetId) {
    return createInvalidResult('Connection source and target cannot be the same node.');
  }

  return createValidResult();
}

export function validateAutoSaveConfig(config: unknown): ValidationResult {
  if (typeof config !== 'object' || config === null) {
    return createInvalidResult('Auto save config must be an object.');
  }

  const cfg = config as Partial<AutoSaveConfig>;
  if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
    return createInvalidResult('Auto save enabled must be a boolean.');
  }

  if (cfg.idleSaveEnabled !== undefined && typeof cfg.idleSaveEnabled !== 'boolean') {
    return createInvalidResult('Auto save idleSaveEnabled must be a boolean.');
  }

  if (cfg.interval !== undefined) {
    if (typeof cfg.interval !== 'number' || cfg.interval <= 0 || !Number.isFinite(cfg.interval)) {
      return createInvalidResult('Auto save interval must be a positive finite number.');
    }
    if (cfg.interval < 1000) {
      return createInvalidResult('Auto save interval cannot be less than 1000ms.');
    }
    if (cfg.interval > 300000) {
      return createInvalidResult('Auto save interval cannot be greater than 300000ms.');
    }
  }

  if (cfg.fallbackIntervalMs !== undefined) {
    if (typeof cfg.fallbackIntervalMs !== 'number' || cfg.fallbackIntervalMs <= 0 || !Number.isFinite(cfg.fallbackIntervalMs)) {
      return createInvalidResult('Auto save fallbackIntervalMs must be a positive finite number.');
    }
    if (cfg.fallbackIntervalMs < 60_000) {
      return createInvalidResult('Auto save fallbackIntervalMs cannot be less than 60000ms.');
    }
    if (cfg.fallbackIntervalMs > 3_600_000) {
      return createInvalidResult('Auto save fallbackIntervalMs cannot be greater than 3600000ms.');
    }
  }

  if (cfg.debounceMs !== undefined) {
    if (typeof cfg.debounceMs !== 'number' || cfg.debounceMs <= 0 || !Number.isFinite(cfg.debounceMs)) {
      return createInvalidResult('Auto save debounceMs must be a positive finite number.');
    }
    if (cfg.debounceMs > 10000) {
      return createInvalidResult('Auto save debounceMs cannot be greater than 10000ms.');
    }
  }

  return createValidResult();
}

export function validateConnectionStyle(style: unknown): ValidationResult {
  if (typeof style !== 'object' || style === null) {
    return createInvalidResult('Connection style must be an object.');
  }

  const s = style as Partial<ConnectionStyle>;
  if (s.type !== undefined && s.type !== 'bezier' && s.type !== 'straight' && s.type !== 'step') {
    return createInvalidResult('Connection style type must be bezier, straight, or step.');
  }

  if (s.animated !== undefined && typeof s.animated !== 'boolean') {
    return createInvalidResult('Connection style animated must be a boolean.');
  }

  if (s.color !== undefined && (typeof s.color !== 'string' || !isValidColor(s.color))) {
    return createInvalidResult('Connection style color must be a valid color string.');
  }

  if (s.strokeWidth !== undefined) {
    if (typeof s.strokeWidth !== 'number' || s.strokeWidth <= 0 || !Number.isFinite(s.strokeWidth)) {
      return createInvalidResult('Connection style strokeWidth must be a positive finite number.');
    }
    if (s.strokeWidth > 20) {
      return createInvalidResult('Connection style strokeWidth cannot be greater than 20.');
    }
  }

  return createValidResult();
}

export function isValidColor(color: string): boolean {
  return COLOR_HEX_PATTERN.test(color) || COLOR_RGB_PATTERN.test(color) || COLOR_RGBA_PATTERN.test(color);
}

export function validateLayoutConfig(config: unknown): ValidationResult {
  if (typeof config !== 'object' || config === null) {
    return createInvalidResult('Layout config must be an object.');
  }

  const cfg = config as Partial<LayoutConfig>;
  if (cfg.type !== undefined && cfg.type !== 'grid' && cfg.type !== 'smart' && cfg.type !== 'force-directed') {
    return createInvalidResult('Layout type must be grid, smart, or force-directed.');
  }

  if (cfg.spacing !== undefined) {
    if (typeof cfg.spacing !== 'number' || cfg.spacing < 0 || !Number.isFinite(cfg.spacing)) {
      return createInvalidResult('Layout spacing must be a non-negative finite number.');
    }
    if (cfg.spacing > 500) {
      return createInvalidResult('Layout spacing cannot be greater than 500.');
    }
  }

  if (cfg.padding !== undefined && (typeof cfg.padding !== 'number' || cfg.padding < 0 || !Number.isFinite(cfg.padding))) {
    return createInvalidResult('Layout padding must be a non-negative finite number.');
  }

  return createValidResult();
}

export function validateWorkflowName(name: unknown): ValidationResult {
  if (typeof name !== 'string') {
    return createInvalidResult('Workflow name must be a string.');
  }

  if (name.length === 0) {
    return createInvalidResult('Workflow name cannot be empty.');
  }

  if (name.length > 200) {
    return createInvalidResult('Workflow name cannot exceed 200 characters.');
  }

  return createValidResult();
}

export function validateWorkflow(workflow: unknown): ValidationResult {
  if (typeof workflow !== 'object' || workflow === null) {
    return createInvalidResult('Workflow must be an object.');
  }

  const legacyMetadata = (workflow as { metadata?: { relatedTaskIds?: unknown } }).metadata;
  if (legacyMetadata && 'relatedTaskIds' in legacyMetadata) {
    return createInvalidResult('Workflow metadata relatedTaskIds is no longer supported. Use relatedTasks.');
  }

  if (hasInvalidRawRelatedTasks(workflow)) {
    return createInvalidResult('Workflow metadata relatedTasks must contain valid task references only.');
  }

  const wf = normalizeWorkflowData(workflow as Workflow);

  if (typeof wf.id !== 'string' || wf.id.length === 0) {
    return createInvalidResult('Workflow id must be a non-empty string.');
  }

  if (typeof wf.projectId !== 'string' || wf.projectId.length === 0) {
    return createInvalidResult('Workflow projectId must be a non-empty string.');
  }

  const nameResult = validateWorkflowName(wf.name);
  if (!nameResult.valid) {
    return nameResult;
  }

  if (typeof wf.nodes !== 'object' || wf.nodes === null) {
    return createInvalidResult('Workflow nodes must be an object.');
  }

  if (!Array.isArray(wf.connections)) {
    return createInvalidResult('Workflow connections must be an array.');
  }

  const nodesById = new Map(Object.entries(wf.nodes));
  const nodes = Object.values(wf.nodes);
  for (let i = 0; i < nodes.length; i++) {
    const nodeResult = validateNodeData(nodes[i]);
    if (!nodeResult.valid) {
      return createInvalidResult(`nodes[${i}] validation failed: ${nodeResult.message}`);
    }
  }

  for (let i = 0; i < wf.connections.length; i++) {
    const connection = wf.connections[i];
    const connectionResult = validateConnection(connection);
    if (!connectionResult.valid) {
      return createInvalidResult(`connections[${i}] validation failed: ${connectionResult.message}`);
    }

    const sourceNode = nodesById.get(connection.sourceId);
    const targetNode = nodesById.get(connection.targetId);
    if (!sourceNode) {
      return createInvalidResult(`connections[${i}] references a missing source node.`);
    }

    if (!targetNode) {
      return createInvalidResult(`connections[${i}] references a missing target node.`);
    }

    if (connection.type === 'file-reference' && isAINodeData(targetNode) && targetNode.type === 'aiImageGen') {
      const groupHandles = new Set(
        ensureAIImageInputGroups(targetNode.config).map((group) => createGroupPortHandle(group.id, AI_IMAGE_INPUT_PORT_ID))
      );
      const normalizedTargetHandle = normalizeAIImageGenInputHandle(connection.targetHandle ?? undefined, targetNode.config);

      if (!isFileNodeData(sourceNode) || sourceNode.type !== 'image') {
        return createInvalidResult(`connections[${i}] can only connect image nodes into AI image generation groups.`);
      }

      if (typeof normalizedTargetHandle !== 'string' || !groupHandles.has(normalizedTargetHandle)) {
        return createInvalidResult(`connections[${i}] must target a valid AI image generation input group.`);
      }
    }

    if (connection.type === 'file-reference' && isAINodeData(targetNode) && targetNode.type !== 'aiImageGen') {
      if (!isFileNodeData(sourceNode)) {
        return createInvalidResult(`connections[${i}] current stage only allows file nodes to connect into AI nodes.`);
      }
    }

    if (connection.type === 'file-reference' && isAINodeData(targetNode) && targetNode.type === 'aiImageInpaint') {
      if (!isFileNodeData(sourceNode) || sourceNode.type !== 'image') {
        return createInvalidResult(`connections[${i}] can only connect one image node into AI image inpaint.`);
      }

      if (connection.targetHandle !== getAIImageInpaintInputHandle()) {
        return createInvalidResult(`connections[${i}] must target the AI image inpaint source image handle.`);
      }
    }

    if (connection.type === 'output-link' && isAINodeData(sourceNode) && sourceNode.type === 'aiImageGen') {
      const groupHandles = new Set(
        ensureAIImageInputGroups(sourceNode.config).map((group) => createGroupPortHandle(group.id, AI_IMAGE_RESULT_PORT_ID))
      );
      const normalizedSourceHandle = normalizeAIImageGenOutputHandle(connection.sourceHandle ?? undefined, sourceNode.config);

      if (!isFileNodeData(targetNode) || targetNode.type !== 'image') {
        return createInvalidResult(`connections[${i}] AI image generation outputs must point to image nodes.`);
      }

      if (typeof normalizedSourceHandle !== 'string' || !groupHandles.has(normalizedSourceHandle)) {
        return createInvalidResult(`connections[${i}] AI image generation outputs must bind to a valid group handle.`);
      }
    }

    if (connection.type === 'output-link' && isAINodeData(sourceNode) && sourceNode.type === 'aiImageInpaint') {
      if (!isFileNodeData(targetNode) || targetNode.type !== 'image') {
        return createInvalidResult(`connections[${i}] AI image inpaint outputs must point to image nodes.`);
      }

      if (connection.sourceHandle !== getAIImageInpaintOutputHandle()) {
        return createInvalidResult(`connections[${i}] AI image inpaint outputs must bind to the result handle.`);
      }
    }
  }

  for (const node of nodes) {
    if (isAINodeData(node) && node.type === 'aiImageInpaint') {
      const groups = ensureAIImageInputGroups(node.config);
      if (
        groups.length !== 1 ||
        groups[0].id !== AI_IMAGE_INPAINT_GROUP_ID ||
        groups[0].order !== 0
      ) {
        return createInvalidResult(`AI image inpaint node ${node.id.display} must contain exactly one fixed input group.`);
      }

      const incomingConnections = wf.connections.filter((connection) =>
        connection.type === 'file-reference' &&
        connection.targetId === node.id.value &&
        connection.targetHandle === createGroupPortHandle(AI_IMAGE_INPAINT_GROUP_ID, AI_IMAGE_INPAINT_INPUT_PORT_ID)
      );
      if (incomingConnections.length > 1) {
        return createInvalidResult(`AI image inpaint node ${node.id.display} cannot contain more than one source image.`);
      }

      const sourceIds = incomingConnections.map((connection) => connection.sourceId);
      if (new Set(sourceIds).size !== sourceIds.length) {
        return createInvalidResult(`AI image inpaint node ${node.id.display} contains duplicate image connections.`);
      }

      const outgoingConnections = wf.connections.filter((connection) =>
        connection.type === 'output-link' &&
        connection.sourceId === node.id.value &&
        connection.sourceHandle === createGroupPortHandle(AI_IMAGE_INPAINT_GROUP_ID, AI_IMAGE_INPAINT_RESULT_PORT_ID)
      );
      if (outgoingConnections.length > 1) {
        return createInvalidResult(`AI image inpaint node ${node.id.display} cannot bind more than one result output.`);
      }

      continue;
    }

    if (!isAINodeData(node) || node.type !== 'aiImageGen') {
      continue;
    }

    const groups = ensureAIImageInputGroups(node.config);
    if (groups.length > 10) {
      return createInvalidResult(`AI image generation node ${node.id.display} cannot contain more than 10 groups.`);
    }

    const incomingConnections = wf.connections.filter((connection) =>
      connection.type === 'file-reference' && connection.targetId === node.id.value
    );

    for (const group of groups) {
      const groupHandle = createGroupPortHandle(group.id, AI_IMAGE_INPUT_PORT_ID);
      const groupConnections = incomingConnections.filter((connection) =>
        normalizeAIImageGenInputHandle(connection.targetHandle ?? undefined, node.config) === groupHandle
      );
      if (groupConnections.length > 5) {
        return createInvalidResult(`AI image generation node ${node.id.display} group ${group.label} cannot contain more than 5 images.`);
      }

      const sourceIds = groupConnections.map((connection) => connection.sourceId);
      if (new Set(sourceIds).size !== sourceIds.length) {
        return createInvalidResult(`AI image generation node ${node.id.display} group ${group.label} contains duplicate image connections.`);
      }
    }
  }

  const viewportResult = validateViewport(wf.viewport);
  if (!viewportResult.valid) {
    return viewportResult;
  }

  const metadataResult = validateWorkflowMetadata(wf.metadata);
  if (!metadataResult.valid) {
    return metadataResult;
  }

  return createValidResult();
}

function isValidWorkflowRelatedTaskRef(task: unknown): task is WorkflowRelatedTaskRef {
  if (typeof task !== 'object' || task === null) {
    return false;
  }

  const candidate = task as Partial<WorkflowRelatedTaskRef>;
  return (
    typeof candidate.taskId === 'string' &&
    (candidate.taskNo === undefined || typeof candidate.taskNo === 'string') &&
    (candidate.batchId === undefined || typeof candidate.batchId === 'string') &&
    typeof candidate.nodeId === 'string' &&
    typeof candidate.nodeDisplayId === 'string' &&
    typeof candidate.nodeType === 'string'
  );
}

function validateWorkflowMetadata(metadata: WorkflowMetadata | null | undefined): ValidationResult {
  if (typeof metadata !== 'object' || metadata === null) {
    return createInvalidResult('Workflow metadata must be an object.');
  }

  if (typeof metadata.nodeCount !== 'number' || metadata.nodeCount < 0) {
    return createInvalidResult('Workflow metadata nodeCount must be a non-negative number.');
  }

  if (typeof metadata.connectionCount !== 'number' || metadata.connectionCount < 0) {
    return createInvalidResult('Workflow metadata connectionCount must be a non-negative number.');
  }

  if (typeof metadata.lastNodeId !== 'number' || metadata.lastNodeId < 0) {
    return createInvalidResult('Workflow metadata lastNodeId must be a non-negative number.');
  }

  if (typeof metadata.canvasSize !== 'object' || metadata.canvasSize === null) {
    return createInvalidResult('Workflow metadata canvasSize must be an object.');
  }

  if (typeof metadata.canvasSize.width !== 'number' || typeof metadata.canvasSize.height !== 'number') {
    return createInvalidResult('Workflow metadata canvasSize must contain numeric width and height.');
  }

  if (metadata.relatedTasks !== undefined) {
    if (!Array.isArray(metadata.relatedTasks)) {
      return createInvalidResult('Workflow metadata relatedTasks must be an array.');
    }

    if (!metadata.relatedTasks.every((task) => isValidWorkflowRelatedTaskRef(task))) {
      return createInvalidResult('Workflow metadata relatedTasks must contain valid task references only.');
    }
  }

  return createValidResult();
}

function hasInvalidRawRelatedTasks(workflow: unknown): boolean {
  if (typeof workflow !== 'object' || workflow === null) {
    return false;
  }

  const metadata = (workflow as { metadata?: { relatedTasks?: unknown } }).metadata;
  if (!metadata || metadata.relatedTasks === undefined) {
    return false;
  }

  if (!Array.isArray(metadata.relatedTasks)) {
    return true;
  }

  return !metadata.relatedTasks.every((task) => isValidWorkflowRelatedTaskRef(task));
}

export function validateWorkflowState(state: unknown): ValidationResult {
  if (typeof state !== 'object' || state === null) {
    return createInvalidResult('Workflow state must be an object.');
  }

  const s = state as Partial<WorkflowState>;
  if (s.current !== null && typeof s.current !== 'object') {
    return createInvalidResult('Workflow state current must be a workflow object or null.');
  }

  if (!Array.isArray(s.history)) {
    return createInvalidResult('Workflow state history must be an array.');
  }

  if (typeof s.historyIndex !== 'number' || s.historyIndex < 0) {
    return createInvalidResult('Workflow state historyIndex must be a non-negative number.');
  }

  if (typeof s.maxHistorySize !== 'number' || s.maxHistorySize <= 0) {
    return createInvalidResult('Workflow state maxHistorySize must be a positive number.');
  }

  if (s.historyIndex > s.history.length) {
    return createInvalidResult('Workflow state historyIndex cannot exceed history length.');
  }

  if (typeof s.isDirty !== 'boolean') {
    return createInvalidResult('Workflow state isDirty must be a boolean.');
  }

  if (typeof s.isSaving !== 'boolean') {
    return createInvalidResult('Workflow state isSaving must be a boolean.');
  }

  return createValidResult();
}

export function validateHistorySize(size: number, maxSize: number): ValidationResult {
  if (typeof size !== 'number' || size < 0) {
    return createInvalidResult('History size must be a non-negative number.');
  }

  if (size > maxSize) {
    return createInvalidResult(`History size(${size}) exceeds the maximum limit(${maxSize}).`);
  }

  return createValidResult();
}

export function canUndo(state: WorkflowState): ValidationResult {
  if (!state.current) {
    return createInvalidResult('There is no active workflow.');
  }

  if (state.historyIndex <= 0) {
    return createInvalidResult('There is no operation to undo.');
  }

  return createValidResult();
}

export function canRedo(state: WorkflowState): ValidationResult {
  if (!state.current) {
    return createInvalidResult('There is no active workflow.');
  }

  if (state.historyIndex >= state.history.length) {
    return createInvalidResult('There is no operation to redo.');
  }

  return createValidResult();
}

export function validateNodeIdFormat(nodeId: string): ValidationResult {
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    return createInvalidResult('Node id must be a non-empty string.');
  }

  if (!/^\d{1,5}$/.test(nodeId)) {
    return createInvalidResult('Node id must be a 1-5 digit number string.');
  }

  const parsed = parseInt(nodeId, 10);
  if (parsed < 1 || parsed > 99999) {
    return createInvalidResult('Node id must be between 1 and 99999.');
  }

  return createValidResult();
}

export function validateNodeIdDisplay(display: string): ValidationResult {
  if (typeof display !== 'string' || display.length === 0) {
    return createInvalidResult('Node display id must be a non-empty string.');
  }

  if (!/^#\d{5}$/.test(display)) {
    return createInvalidResult('Node display id must use the format #00001.');
  }

  return createValidResult();
}

export function isSimplifiedView(zoom: number): boolean {
  return zoom < CANVAS_DEFAULTS.simplifyThreshold;
}

export function getDefaultAutoSaveConfig(): AutoSaveConfig {
  return { ...AUTO_SAVE_DEFAULTS };
}

export function getDefaultConnectionStyle(): ConnectionStyle {
  return { ...CONNECTION_STYLE_DEFAULTS };
}
