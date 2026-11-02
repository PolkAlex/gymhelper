const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests',
    testMatch: 'e2e.spec.js',
    workers: 1,
    fullyParallel: false,
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://127.0.0.1:8099',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node tests/server-test.js',
        port: 8099,
        reuseExistingServer: true,
        timeout: 15000
    }
});
