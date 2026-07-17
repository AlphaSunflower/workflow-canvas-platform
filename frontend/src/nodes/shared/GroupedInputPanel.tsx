import React from 'react';

export interface GroupedInputPanelProps {
  className?: string;
  regionProps?: React.HTMLAttributes<HTMLDivElement>;
  panelLayerClassName?: string;
  groupLayerClassName?: string;
  toolbar?: React.ReactNode;
  panels?: React.ReactNode;
  groups: React.ReactNode;
}

export interface GroupedInputItemChromeProps extends React.HTMLAttributes<HTMLDivElement> {
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  disabled?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  sortable?: boolean;
  children: React.ReactNode;
}

export interface GroupedInputActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
}

export interface GroupedDualInputPanelSide<TSide extends string> {
  side: TSide;
  panelLabel: string;
  slotLabel: string;
  panelClassName?: string;
  sideClassName?: string;
  slotClassName?: string;
  emptyAriaLabel?: string;
}

export interface GroupedDualInputPanelSlotTargetProps {
  'data-node-dropzone': 'group';
  'data-node-id': string;
  'data-group-id': string;
  'data-drop-scope': 'slot';
  'data-drop-port-id': string;
  'data-drop-side'?: string;
}

export interface GroupedDualInputPanelPanelTargetProps {
  'data-node-dropzone': 'group';
  'data-node-id': string;
  'data-group-id': string;
  'data-drop-scope': 'panel';
  'data-drop-side': string;
  'data-panel-label'?: string;
}

export interface GroupedDualInputPanelSlot {
  groupId: string;
  portId: string;
  content: React.ReactNode | null | undefined;
}

export interface GroupedDualInputPanelGroup<TSide extends string> {
  key: React.Key;
  slots: Record<TSide, GroupedDualInputPanelSlot>;
  render: (slotGrid: React.ReactNode) => React.ReactNode;
}

export interface GroupedDualInputPanelProps<TSide extends string> {
  nodeId: string;
  className?: string;
  regionProps?: React.HTMLAttributes<HTMLDivElement>;
  panelLayerClassName?: string;
  groupsWrapperClassName?: string;
  toolbar?: React.ReactNode;
  panelTargetClassName?: string;
  slotGridClassName?: string;
  slotContainerClassName?: string;
  slotTargetClassName?: string;
  filledSlotClassName?: string;
  emptySlotClassName?: string;
  groupLayerRef?: React.Ref<HTMLDivElement>;
  sides: GroupedDualInputPanelSide<TSide>[];
  groups: GroupedDualInputPanelGroup<TSide>[];
  getPanelTargetProps: (options: {
    nodeId: string;
    side: TSide;
    panelLabel?: string;
  }) => GroupedDualInputPanelPanelTargetProps & React.HTMLAttributes<HTMLElement>;
  getSlotTargetProps: (options: {
    nodeId: string;
    groupId: string;
    portId: string;
    side?: string;
  }) => GroupedDualInputPanelSlotTargetProps & React.HTMLAttributes<HTMLElement>;
}

export function GroupedInputPanel({
  className,
  regionProps,
  panelLayerClassName,
  groupLayerClassName,
  toolbar,
  panels,
  groups,
}: GroupedInputPanelProps): JSX.Element {
  return (
    <div
      className={['grouped-input-panel', className].filter(Boolean).join(' ')}
      {...regionProps}
    >
      {panels ? (
        <div
          className={[
            'grouped-drop-panel-layer',
            'grouped-input-panel__panel-layer',
            panelLayerClassName,
          ].filter(Boolean).join(' ')}
          aria-hidden="true"
        >
          {panels}
        </div>
      ) : null}

      <div
        className={[
          'grouped-input-panel__group-layer',
          'grouped-drop-slot-group-layer',
          groupLayerClassName,
        ].filter(Boolean).join(' ')}
      >
        {groups}
      </div>

      {toolbar ? (
        <div className="grouped-input-panel__toolbar">
          {toolbar}
        </div>
      ) : null}
    </div>
  );
}

export function GroupedInputItemChrome({
  className,
  badge,
  actions,
  disabled = false,
  dragging = false,
  dropTarget = false,
  sortable = false,
  children,
  ...rest
}: GroupedInputItemChromeProps): JSX.Element {
  return (
    <div
      className={[
        'grouped-input-item',
        sortable ? 'grouped-input-item--sortable' : '',
        disabled ? 'grouped-input-item--disabled' : '',
        dragging ? 'grouped-input-item--dragging' : '',
        dropTarget ? 'grouped-input-item--drop-target' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {badge ? (
        <div className="grouped-input-item__badge">
          {badge}
        </div>
      ) : null}
      {actions ? (
        <div className="grouped-input-item__topbar">
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function GroupedInputActionButton({
  className,
  icon = 'x',
  type = 'button',
  children,
  ...rest
}: GroupedInputActionButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={[
        'grouped-input-item__action',
        'nodrag',
        'nopan',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children ?? icon}
    </button>
  );
}

export function GroupedDualInputPanel<TSide extends string>({
  nodeId,
  className,
  regionProps,
  panelLayerClassName,
  groupsWrapperClassName,
  toolbar,
  panelTargetClassName,
  slotGridClassName,
  slotContainerClassName,
  slotTargetClassName,
  filledSlotClassName,
  emptySlotClassName,
  groupLayerRef,
  sides,
  groups,
  getPanelTargetProps,
  getSlotTargetProps,
}: GroupedDualInputPanelProps<TSide>): JSX.Element {
  return (
    <GroupedInputPanel
      className={className}
      regionProps={regionProps}
      panelLayerClassName={panelLayerClassName}
      toolbar={toolbar}
      panels={sides.map((side) => (
        <div
          key={side.side}
          className={[
            'grouped-drop-panel-target',
            panelTargetClassName,
            side.panelClassName,
          ].filter(Boolean).join(' ')}
          {...getPanelTargetProps({
            nodeId,
            side: side.side,
            panelLabel: side.panelLabel,
          })}
        />
      ))}
      groups={(
        <div ref={groupLayerRef} className={groupsWrapperClassName}>
          {groups.map((group) => {
            const slotGrid = (
              <div
                className={slotGridClassName}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${sides.length}, minmax(0, 1fr))`,
                  gap: 10,
                  alignItems: 'stretch',
                }}
              >
                {sides.map((side) => {
                  const slot = group.slots[side.side];
                  const isFilled = slot.content !== null && slot.content !== undefined;
                  return (
                    <div
                      key={side.side}
                      className={[slotContainerClassName, side.sideClassName].filter(Boolean).join(' ')}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0,
                        minHeight: '100%',
                      }}
                    >
                      <div className="ai-image-gen-node__label ai-image-gen-node__label--compact">
                        {side.slotLabel}
                      </div>
                      {isFilled ? (
                        <div
                          className={[
                            'grouped-drop-slot-target',
                            'grouped-drop-slot-surface',
                            slotTargetClassName,
                            filledSlotClassName,
                            side.slotClassName,
                          ].filter(Boolean).join(' ')}
                          {...getSlotTargetProps({
                            nodeId,
                            groupId: slot.groupId,
                            portId: slot.portId,
                            side: side.side,
                          })}
                        >
                          {slot.content}
                        </div>
                      ) : (
                        <div
                          className={[
                            'grouped-drop-slot-target',
                            'grouped-drop-slot-surface',
                            slotTargetClassName,
                            emptySlotClassName,
                            side.slotClassName,
                          ].filter(Boolean).join(' ')}
                          aria-label={side.emptyAriaLabel}
                          {...getSlotTargetProps({
                            nodeId,
                            groupId: slot.groupId,
                            portId: slot.portId,
                            side: side.side,
                          })}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );

            return (
              <React.Fragment key={group.key}>
                {group.render(slotGrid)}
              </React.Fragment>
            );
          })}
        </div>
      )}
    />
  );
}
