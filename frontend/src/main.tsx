import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'reactflow/dist/style.css';
import { httpClient, websocketClient } from './api';
import App from './App';
import { AuthProvider } from './auth';
import './index.css';
import './components/file/FileComponents.css';

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envBaseUrl) {
    return envBaseUrl;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.origin;
}

function resolveWebSocketUrl(): string {
  const envWebSocketUrl = import.meta.env.VITE_WS_URL?.trim();
  if (envWebSocketUrl) {
    return envWebSocketUrl;
  }
  return '';
}

const apiBaseUrl = resolveApiBaseUrl();
httpClient.setBaseURL(apiBaseUrl);
websocketClient.setConfig({
  url: resolveWebSocketUrl(),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
