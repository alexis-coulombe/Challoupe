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
import { HostProvider } from './hosts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const lightTheme = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#f53838',
    colorInfo: '#3b82f6',
    colorLink: '#1c1a22',
    colorLinkHover: '#f53838',
    colorLinkActive: '#d01f1f',
    colorBgLayout: '#ffffff',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#f1e3e8',
    colorBorderSecondary: '#f1e3e8',
    colorText: '#1c1a22',
    borderRadius: 12,
  },
  components: {
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
      headerHeight: 64,
    },
    // Selection/hover read through background + weight, not red text — red stays
    // reserved for errors and primary actions so it doesn't get lost among nav noise.
    Menu: {
      itemBg: '#ffffff',
      subMenuItemBg: '#ffffff',
      itemSelectedBg: '#ffe1e1',
      itemSelectedColor: '#1c1a22',
      itemHoverBg: '#fdf1f4',
      itemHoverColor: '#1c1a22',
    },
    Table: {
      headerBg: '#fbf5f7',
      rowHoverBg: '#fdf1f4',
    },
    Card: {
      colorBorderSecondary: '#f1e3e8',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={enUS} theme={lightTheme}>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <HostProvider>
                <App />
              </HostProvider>
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
