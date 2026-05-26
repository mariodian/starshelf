import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'GitHub Star Categorizer',
    description: 'Auto-categorize GitHub starred repos with AI',
    version: '0.0.1',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://github.com/*'],
    action: {},
    background: {
      service_worker: 'background.ts',
    },
  },
});
