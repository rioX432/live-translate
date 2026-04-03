"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var test_1 = require("@playwright/test");
exports.default = (0, test_1.defineConfig)({
    testDir: './e2e',
    timeout: 60000,
    retries: 0,
    workers: 1,
    reporter: 'list',
    use: {
        trace: 'on-first-retry'
    }
});
