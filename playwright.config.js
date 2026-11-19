const { defineConfig, devices } = require('@playwright/test');

const TEST_PORT = Number(process.env.GYM_TEST_PORT) || 8099;

module.exports = defineConfig({
    testDir: 'tests',
    testMatch: 'e2e.spec.js',
    workers: 1,
    fullyParallel: false,
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://127.0.0.1:' + TEST_PORT,
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node tests/server-test.js',
        port: TEST_PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 15000
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
        { name: 'iphone13', use: { ...devices['iPhone 13'] } },
        { name: 'pixel7', use: { ...devices['Pixel 7'] } },
        { name: 'android360', use: { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }
    ]
});
