import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from 'reactflow';

import type { FileNodeData } from '@/types';

import {
  FileNodeProxySurface,
  FileNodeProxy,
} from './FileNodeProxy';
import {
  resolveFileNodeProxyStatusLabel,
  resolveImageNodeProxyRouting,
} from './file-node-proxy.shared';

function createFileNodeData(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: '701',
      display: '#00701',
    },
    type: 'image',
    position: { x: 80, y: 60 },
    dimensions: { width: 280, height: 180 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'file-701',
    fileName: 'proxy-check.png',
    fileSize: 4096,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 1280,
      height: 720,
    },
    ...overrides,
  };
}

test('resolveImageNodeProxyRouting keeps passive compact image nodes on proxy path', () => {
  const decision = resolveImageNodeProxyRouting({
    nodeType: 'image',
    scheduledRenderTier: 'compact',
    canvasActiveState: 'passive',
  });

  assert.equal(decision.useProxy, true);
  assert.equal(decision.renderTier, 'compact');
  assert.equal(decision.activeState, 'passive');
});

test('resolveImageNodeProxyRouting upgrades active image nodes back to full FileNode', () => {
  const decision = resolveImageNodeProxyRouting({
    nodeType: 'image',
    scheduledRenderTier: 'minimal',
    canvasActiveState: 'active',
  });

  assert.equal(decision.useProxy, false);
  assert.equal(decision.renderTier, 'full');
  assert.equal(decision.activeState, 'active');
});

test('resolveImageNodeProxyRouting never routes video nodes to proxy', () => {
  const decision = resolveImageNodeProxyRouting({
    nodeType: 'video',
    scheduledRenderTier: 'compact',
    canvasActiveState: 'passive',
  });

  assert.equal(decision.useProxy, false);
  assert.equal(decision.renderTier, 'compact');
});

test('resolveFileNodeProxyStatusLabel exposes import and error badges only when needed', () => {
  assert.equal(resolveFileNodeProxyStatusLabel('idle'), undefined);
  assert.equal(resolveFileNodeProxyStatusLabel('processing'), 'IMPORTING');
  assert.equal(resolveFileNodeProxyStatusLabel('error'), 'ERROR');
});

test('FileNodeProxySurface renders compact filename card for passive image nodes', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData({
        thumbnailUrl: 'blob:ready-thumbnail',
      })}
      nodeIcon="IMG"
      renderTier="compact"
    />
  );

  assert.ok(markup.includes('proxy-check.png'));
  assert.ok(markup.includes('IMG'));
  assert.ok(markup.includes('data-file-node-proxy-surface="compact"'));
});

test('FileNodeProxySurface renders compact importing loading card for visible passive imports', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData({
        status: 'processing',
      })}
      nodeIcon="IMG"
      renderTier="compact"
    />
  );

  assert.ok(markup.includes('proxy-check.png'));
  assert.ok(markup.includes('...'));
  assert.ok(markup.includes('IMPORTING'));
  assert.ok(markup.includes('data-file-node-proxy-surface="compact"'));
});

test('FileNodeProxySurface keeps no-preview compact image nodes on stable loading surface', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData()}
      nodeIcon="IMG"
      renderTier="compact"
    />
  );

  assert.ok(markup.includes('...'));
  assert.ok(markup.includes('LOADING'));
  assert.equal(markup.includes('>IMG<'), false);
});

test('FileNodeProxySurface exposes raster layer for compact raster-owned image nodes', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData({
        imageResourceOwner: 'raster',
      })}
      nodeIcon="IMG"
      renderTier="compact"
    />
  );

  assert.ok(markup.includes('data-file-node-proxy-surface="compact"'));
  assert.ok(markup.includes('file-node__image-shell--raster'));
  assert.equal(markup.includes('file-node__tier-card--compact'), false);
  assert.equal(markup.includes('<img'), false);
});

test('FileNodeProxySurface renders importing badge in minimal tier', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData({
        status: 'processing',
      })}
      nodeIcon="IMG"
      renderTier="minimal"
    />
  );

  assert.ok(markup.includes('IMPORTING'));
  assert.ok(markup.includes('data-file-node-proxy-surface="minimal"'));
});

test('FileNodeProxySurface renders full raster shell without DOM image media', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData({
        thumbnailUrl: 'blob:ready-thumbnail',
      })}
      nodeIcon="IMG"
      renderTier="full"
    />
  );

  assert.ok(markup.includes('data-file-node-proxy-surface="full"'));
  assert.ok(markup.includes('file-node__image-shell--raster'));
  assert.equal(markup.includes('<img'), false);
});

test('FileNodeProxySurface renders full loading card before raster image is drawable', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData({
        imageResourceOwner: 'dom',
      })}
      nodeIcon="IMG"
      renderTier="full"
    />
  );

  assert.ok(markup.includes('data-file-node-proxy-surface="full"'));
  assert.ok(markup.includes('file-node__tier-card--full'));
  assert.ok(markup.includes('LOADING'));
  assert.equal(markup.includes('file-node__image-shell--raster'), false);
  assert.equal(markup.includes('<img'), false);
});

test('FileNodeProxySurface lets raster-owned full nodes expose the object layer without thumbnailUrl', () => {
  const markup = renderToStaticMarkup(
    <FileNodeProxySurface
      data={createFileNodeData({
        imageResourceOwner: 'raster',
      })}
      nodeIcon="IMG"
      renderTier="full"
    />
  );

  assert.ok(markup.includes('data-file-node-proxy-surface="full"'));
  assert.ok(markup.includes('file-node__image-shell--raster'));
  assert.equal(markup.includes('LOADING'), false);
  assert.equal(markup.includes('<img'), false);
});

test('FileNodeProxy marks raster-owned image proxy nodes as raster managed', () => {
  const markup = renderToStaticMarkup(
    <ReactFlowProvider>
      <FileNodeProxy
        id="701"
        type="image"
        xPos={0}
        yPos={0}
        zIndex={0}
        selected={false}
        isConnectable={true}
        dragging={false}
        data={createFileNodeData({
          imageResourceOwner: 'raster',
          renderTier: 'compact',
        })}
        renderTier="compact"
      />
    </ReactFlowProvider>
  );

  assert.ok(markup.includes('file-node--proxy'));
  assert.ok(markup.includes('file-node--raster-managed'));
});

test('FileNodeProxy keeps full raster nodes as a lightweight shell', () => {
  const markup = renderToStaticMarkup(
    <ReactFlowProvider>
      <FileNodeProxy
        id="701"
        type="image"
        xPos={0}
        yPos={0}
        zIndex={0}
        selected={false}
        isConnectable={true}
        dragging={false}
        data={createFileNodeData({
          imageResourceOwner: 'raster',
          renderTier: 'full',
          thumbnailUrl: 'blob:ready-thumbnail',
        })}
        renderTier="full"
      />
    </ReactFlowProvider>
  );

  assert.ok(markup.includes('file-node--full-proxy'));
  assert.ok(markup.includes('data-render-tier="full"'));
  assert.ok(markup.includes('data-image-resource-owner="raster"'));
  assert.ok(markup.includes('react-flow__handle'));
  assert.ok(markup.includes('#00701'));
  assert.equal(markup.includes('<img'), false);
});

test('FileNodeProxy keeps importing full raster proxies on visible placeholder chrome', () => {
  const markup = renderToStaticMarkup(
    <ReactFlowProvider>
      <FileNodeProxy
        id="701"
        type="image"
        xPos={0}
        yPos={0}
        zIndex={0}
        selected={false}
        isConnectable={true}
        dragging={false}
        data={createFileNodeData({
          imageResourceOwner: 'raster',
          renderTier: 'full',
          status: 'processing',
        })}
        renderTier="full"
      />
    </ReactFlowProvider>
  );

  assert.ok(markup.includes('file-node--placeholder'));
  assert.ok(markup.includes('file-node__tier-card--full'));
  assert.ok(markup.includes('IMPORTING'));
  assert.ok(markup.includes('#00701'));
  assert.equal(markup.includes('<img'), false);
});

test('FileNodeProxy raster-managed css does not hide full proxy node chrome', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/index.css`,
    'utf8',
  );

  assert.equal(source.includes('.file-node.file-node--proxy.file-node--raster-managed:not(.selected)'), false);
  assert.equal(source.includes('.file-node.file-node--proxy.file-node--full-proxy.file-node--raster-managed:not(.selected)'), false);
  assert.equal(source.includes('.file-node.file-node--proxy.file-node--raster-managed:not(.file-node--placeholder):not(.file-node--error) .file-node__id-badge'), false);
  assert.equal(source.includes('.file-node.file-node--proxy.file-node--raster-managed:not(.file-node--placeholder):not(.file-node--error) .file-node__preview-area'), true);
});
