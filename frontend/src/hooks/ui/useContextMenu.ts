// ==============================================
// 🔒 LOCKED: 右键菜单 Hook
// @module hooks/ui/useContextMenu
// 最后锁定时间：2026-03-25
// 说明：提供右键菜单的显示、隐藏、位置管理等功能
// 依赖层：types (import type), constants, utils
// ==============================================

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Position } from '@/types';
import { createModuleLogger } from '@/utils';

/** 模块日志器 */
const log = createModuleLogger('useContextMenu');

/**
 * 右键菜单动作
 * @description 单个菜单项的配置
 */
export interface ContextMenuAction {
  /** 动作ID */
  id: string;
  /** 显示标签 */
  label: string;
  /** 图标 */
  icon?: ReactNode;
  /** 快捷键提示 */
  shortcut?: string;
  /** 是否为危险操作 */
  danger?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否为分隔线 */
  divider?: boolean;
  /** 子菜单 */
  children?: ContextMenuAction[];
  /** 点击回调 */
  onClick?: () => void;
}

/**
 * 右键菜单状态
 * @description 菜单的当前状态
 */
export interface ContextMenuState {
  /** 是否可见 */
  isVisible: boolean;
  /** 显示位置 */
  position: Position;
  /** 菜单动作列表 */
  actions: ContextMenuAction[];
  /** 上下文数据 */
  context: unknown;
}

/**
 * 右键菜单 Hook 配置选项
 * @description 配置菜单行为和回调
 */
export interface UseContextMenuOptions {
  /** 显示回调 */
  onShow?: (position: Position, context?: unknown) => void;
  /** 隐藏回调 */
  onHide?: () => void;
  /** 动作执行回调 */
  onAction?: (action: ContextMenuAction, context?: unknown) => void;
}

/**
 * 右键菜单 Hook 返回值
 * @description 提供菜单状态和操作方法
 */
export interface UseContextMenuReturn {
  /** 菜单状态 */
  state: ContextMenuState;
  /** 是否可见 */
  isVisible: boolean;
  /** 显示位置 */
  position: Position;
  /** 菜单动作列表 */
  actions: ContextMenuAction[];
  /** 上下文数据 */
  context: unknown;
  /** 显示菜单 */
  show: (position: Position, actions: ContextMenuAction[], context?: unknown) => void;
  /** 隐藏菜单 */
  hide: () => void;
  /** 执行动作 */
  executeAction: (action: ContextMenuAction) => void;
  /** 设置位置 */
  setPosition: (position: Position) => void;
  /** 设置动作列表 */
  setActions: (actions: ContextMenuAction[]) => void;
  /** 设置上下文 */
  setContext: (context: unknown) => void;
}

/**
 * 右键菜单 Hook
 * @description 提供右键菜单的显示、隐藏、位置管理等功能
 * @param options - Hook 配置选项
 * @returns 菜单状态和操作方法
 */
export function useContextMenu(options: UseContextMenuOptions = {}): UseContextMenuReturn {
  // 解构配置选项
  const { onShow, onHide, onAction } = options;

  /** 菜单状态 */
  const [state, setState] = useState<ContextMenuState>({
    isVisible: false,
    position: { x: 0, y: 0 },
    actions: [],
    context: null,
  });

  /**
   * 显示菜单
   * @description 在指定位置显示菜单
   * @param position - 显示位置
   * @param actions - 菜单动作列表
   * @param context - 上下文数据
   */
  const show = useCallback((
    position: Position,
    actions: ContextMenuAction[],
    context?: unknown
  ) => {
    setState({
      isVisible: true,
      position,
      actions,
      context: context ?? null,
    });
    
    onShow?.(position, context);
    log.debug('show', `Context menu shown at (${position.x}, ${position.y})`);
  }, [onShow]);

  /**
   * 隐藏菜单
   * @description 隐藏当前显示的菜单
   */
  const hide = useCallback(() => {
    setState(prev => ({
      ...prev,
      isVisible: false,
    }));
    
    onHide?.();
    log.debug('hide', 'Context menu hidden');
  }, [onHide]);

  /**
   * 执行动作
   * @description 执行菜单动作并隐藏菜单
   * @param action - 要执行的动作
   */
  const executeAction = useCallback((action: ContextMenuAction) => {
    action.onClick?.();
    onAction?.(action, state.context);
    hide();
    log.debug('executeAction', `Action executed: ${action.id}`);
  }, [state.context, onAction, hide]);

  /**
   * 设置位置
   * @description 更新菜单位置
   * @param position - 新位置
   */
  const setPosition = useCallback((position: Position) => {
    setState(prev => ({
      ...prev,
      position,
    }));
  }, []);

  /**
   * 设置动作列表
   * @description 更新菜单动作列表
   * @param actions - 新动作列表
   */
  const setActions = useCallback((actions: ContextMenuAction[]) => {
    setState(prev => ({
      ...prev,
      actions,
    }));
  }, []);

  /**
   * 设置上下文
   * @description 更新上下文数据
   * @param context - 新上下文数据
   */
  const setContext = useCallback((context: unknown) => {
    setState(prev => ({
      ...prev,
      context,
    }));
  }, []);

  // 返回所有状态和方法
  return useMemo(() => ({
    state,
    isVisible: state.isVisible,
    position: state.position,
    actions: state.actions,
    context: state.context,
    show,
    hide,
    executeAction,
    setPosition,
    setActions,
    setContext,
  }), [
    state,
    show,
    hide,
    executeAction,
    setPosition,
    setActions,
    setContext,
  ]);
}
