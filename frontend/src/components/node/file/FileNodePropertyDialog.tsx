import { memo, useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { FileNodeData } from '@/types';
import { Button, Modal } from '@/components/ui/primitives';
import { browserFileService } from '@/services/browser-file';
import type { BrowserFileSystemFileHandleLike } from '@/services/local-file-source-store';
import {
  buildFileNodePropertySections,
  type PropertySection,
} from './file-node-property-sections';

interface FileNodePropertyDialogProps {
  node: FileNodeData | null;
  isOpen: boolean;
  onClose: () => void;
  onRebindLocalFile?: (
    nodeId: string,
    file: File,
    options?: {
      localSourceHandle?: BrowserFileSystemFileHandleLike;
    },
  ) => Promise<unknown>;
}

interface PropertyFieldProps {
  label: string;
  value?: string | null;
  multiline?: boolean;
}

const EMPTY_VALUE = '\u672a\u8bb0\u5f55';

const PropertyField = memo<PropertyFieldProps>(({ label, value, multiline = false }) => (
  <div className={`file-node-property-dialog__field ${multiline ? 'file-node-property-dialog__field--multiline' : ''}`}>
    <span className="file-node-property-dialog__label">{label}</span>
    <span className="file-node-property-dialog__value" title={value ?? EMPTY_VALUE}>
      {value ?? EMPTY_VALUE}
    </span>
  </div>
));

PropertyField.displayName = 'PropertyField';

export const FileNodePropertyDialog = memo<FileNodePropertyDialogProps>(({
  node,
  isOpen,
  onClose,
  onRebindLocalFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isRebinding, setIsRebinding] = useState(false);
  const sections = useMemo<PropertySection[]>(() => buildFileNodePropertySections(node), [node]);
  const canRebindLocalFile = node?.type === 'image' && Boolean(onRebindLocalFile);

  const handlePickRebindFile = useCallback(() => {
    if (!node || !onRebindLocalFile || isRebinding) {
      return;
    }

    if (!browserFileService.supportsFileSystemAccessFilePicker()) {
      fileInputRef.current?.click();
      return;
    }

    void (async (): Promise<void> => {
      const picked = await browserFileService.pickFilesWithHandles({
        multiple: false,
        types: [
          {
            description: 'Image files',
            accept: {
              'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'],
            },
          },
        ],
      });

      if (!picked.success) {
        fileInputRef.current?.click();
        return;
      }

      const selected = picked.data?.[0];
      if (!selected) {
        return;
      }

      setIsRebinding(true);
      await onRebindLocalFile(node.id.value, selected.file, {
        localSourceHandle: selected.handle,
      }).finally(() => {
        setIsRebinding(false);
      });
    })();
  }, [isRebinding, node, onRebindLocalFile]);

  const handlePickRebindFileFallback = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRebindFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!node || !file || isRebinding || !onRebindLocalFile) {
      return;
    }

    setIsRebinding(true);
    void onRebindLocalFile(node.id.value, file).finally(() => {
      setIsRebinding(false);
    });
  }, [isRebinding, node, onRebindLocalFile]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={node ? `${node.fileName} · \u5c5e\u6027` : '\u6587\u4ef6\u5c5e\u6027'}
      size="sm"
      footer={node ? (
        <div className="file-node-property-dialog__actions">
          <input
            ref={fileInputRef}
            className="file-node-property-dialog__file-input"
            type="file"
            accept={node.type === 'image' ? 'image/*' : undefined}
            onChange={handleRebindFileChange}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={isRebinding}
            disabled={!canRebindLocalFile}
            onClick={canRebindLocalFile ? handlePickRebindFile : handlePickRebindFileFallback}
            title={canRebindLocalFile ? '选择本地原图并重新关联当前节点' : '当前节点类型不支持重新关联本地原图'}
          >
            重新关联本地文件
          </Button>
        </div>
      ) : undefined}
    >
      <div className="file-node-property-dialog">
        {sections.map((section) => (
          <section key={section.title} className="file-node-property-dialog__section">
            <h3 className="file-node-property-dialog__section-title">{section.title}</h3>
            <div className="file-node-property-dialog__section-content">
              {section.items.map((item) => (
                <PropertyField
                  key={`${section.title}-${item.label}`}
                  label={item.label}
                  value={item.value}
                  multiline={item.multiline}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
});

FileNodePropertyDialog.displayName = 'FileNodePropertyDialog';
