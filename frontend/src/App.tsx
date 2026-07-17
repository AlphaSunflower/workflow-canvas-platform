import React, { useCallback, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { Canvas } from './components/canvas';
import { CanvasSideNav } from './components/canvas/CanvasSideNav';
import { WorkflowProvider } from './components/context/WorkflowContext';
import { UserManagementModal } from './components/user/UserManagementModal';
import { Toolbar } from './components/workflow';
import { useAuth } from './auth';
import './index.css';
import './components/user/UserManagementModal.css';

const App: React.FC = () => {
  const [showToolbar, setShowToolbar] = useState(true);
  const [showHints, setShowHints] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showTaskHistory, setShowTaskHistory] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const { status } = useAuth();

  const handleToggleToolbar = useCallback(() => {
    setShowToolbar((current) => !current);
  }, []);

  const handleToggleHints = useCallback(() => {
    setShowHints((current) => !current);
  }, []);

  const handleToggleMinimap = useCallback(() => {
    setShowMinimap((current) => !current);
  }, []);

  const handleToggleTaskHistory = useCallback(() => {
    setShowTaskHistory((current) => !current);
  }, []);

  const handleOpenUserModal = useCallback(() => {
    setIsUserModalOpen(true);
  }, []);

  const handleCloseUserModal = useCallback(() => {
    setIsUserModalOpen(false);
  }, []);

  const shouldRenderToolbar = showToolbar;
  return (
    <WorkflowProvider>
      <ReactFlowProvider>
        <div
          className="app"
          data-app-view="canvas"
          data-toolbar-visible={showToolbar ? 'true' : 'false'}
          data-hints-visible={showHints ? 'true' : 'false'}
          data-minimap-visible={showMinimap ? 'true' : 'false'}
          data-task-history-visible={showTaskHistory ? 'true' : 'false'}
          data-user-modal-open={isUserModalOpen ? 'true' : 'false'}
          data-auth-status={status}
        >
          <Canvas
            projectId="default"
            showToolbar={showToolbar}
            showHints={showHints}
            showMinimap={showMinimap}
            showTaskHistory={showTaskHistory}
          />
          <CanvasSideNav
            showToolbar={showToolbar}
            showHints={showHints}
            showMinimap={showMinimap}
            showTaskHistory={showTaskHistory}
            onToggleToolbar={handleToggleToolbar}
            onToggleHints={handleToggleHints}
            onToggleMinimap={handleToggleMinimap}
            onToggleTaskHistory={handleToggleTaskHistory}
            onOpenUserManagement={handleOpenUserModal}
          />
          <UserManagementModal
            isOpen={isUserModalOpen}
            onClose={handleCloseUserModal}
          />
          {shouldRenderToolbar ? <Toolbar /> : null}
        </div>
      </ReactFlowProvider>
    </WorkflowProvider>
  );
};

export default App;
