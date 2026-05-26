import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'GitHub Star Categorizer',
    description: 'Auto-categorize GitHub starred repos with AI',
    version: '0.0.1',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzhG7/mVMAB6aQqa1bt3l1aaYsSKZ0KUZisQUpwGeyK5IcAF17JeLaVs1wHQMLkqWl8XxC9X6JLdGBnQdW6dzEcUS5eGqA6tiX4frV37y7PGNK7tZg8xNpzRfC8E7q/KxJ2o1NSbSHiz5FV/7bRYmajuLN54w2hEE3mlW2ZBf535CDFX4uwlVrBdHCa8Qjlx8VhKcflRN0N2/MO/qTuWGKQ7Wx2G7UrJN6ps/oH1+gse4V/yn2PtKrbzJNsIX1S+gtWU+OY1KADsOhDhwyreXmaaVPLpntpv/pIxa37VdpHDc3k87Qfpap4/x2SO2jGDjAMeaCU8od6bWv7VH6z/pPwIDAQAB',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://github.com/*'],
    action: {},
    background: {
      service_worker: 'background.ts',
    },
  },
});
