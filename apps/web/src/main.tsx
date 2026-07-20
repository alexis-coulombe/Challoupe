import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import 'antd/dist/reset.css';
import './index.css';
import App from './App';
import { AuthProvider } from './auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#3b82f6',
    colorInfo: '#3b82f6',
    colorBgLayout: '#0b0e14',
    colorBgContainer: '#161c28',
    colorBgElevated: '#1e2530',
    colorBorder: '#2a3441',
    colorBorderSecondary: '#242e3c',
    borderRadius: 8,
  },
  components: {
    Layout: {
      siderBg: '#0e1219',
      headerBg: '#0e1219',
      headerHeight: 64,
    },
    Menu: {
      darkItemBg: '#0e1219',
      darkSubMenuItemBg: '#0e1219',
      darkItemSelectedBg: 'rgba(59, 130, 246, 0.16)',
      darkItemSelectedColor: '#7ab3ff',
    },
    Table: {
      headerBg: '#1b2230',
      rowHoverBg: '#1d2536',
    },
    Card: {
      colorBorderSecondary: '#242e3c',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={enUS} theme={darkTheme}>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
