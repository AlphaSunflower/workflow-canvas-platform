import { clearBackendFileBindingCache } from '@/services/backendFileService';
import { clearExecutionOutputRuntimeResources } from '@/services/execution-output-runtime-sync';
import { clearAllImageResources } from '@/services/image/image-node';
import { clearProtectedResourceSessionCache } from '@/services/protected-resource';
import { fileManifestStore } from './file-manifest-store';
import { fileResourceLeaseManager } from './resource-lease-manager';

export function clearFileResourceSessionState(): void {
  clearExecutionOutputRuntimeResources({ force: true });
  clearProtectedResourceSessionCache();
  clearBackendFileBindingCache();
  clearAllImageResources({
    forceOriginals: true,
  });
  fileResourceLeaseManager.clear();
  fileManifestStore.clear();
}
