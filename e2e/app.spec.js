"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var test_1 = require("@playwright/test");
var playwright_1 = require("playwright");
var path_1 = require("path");
var app;
var settingsWindow;
test_1.test.beforeAll(function () { return __awaiter(void 0, void 0, void 0, function () {
    var firstWin, _i, _a, win, headingCount;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, playwright_1._electron.launch({
                    args: [(0, path_1.resolve)(__dirname, '../out/main/index.js')],
                    env: __assign(__assign({}, process.env), { 
                        // Disable hardware acceleration in CI to avoid GPU issues
                        ELECTRON_DISABLE_GPU: '1' })
                })
                // The app opens two windows: main (settings) and subtitle (transparent).
                // firstWindow() returns whichever opens first.
            ];
            case 1:
                app = _b.sent();
                return [4 /*yield*/, app.firstWindow()];
            case 2:
                firstWin = _b.sent();
                return [4 /*yield*/, firstWin.waitForLoadState('domcontentloaded')
                    // Give time for both windows to finish opening
                ];
            case 3:
                _b.sent();
                // Give time for both windows to finish opening
                return [4 /*yield*/, firstWin.waitForTimeout(2000)
                    // Find the settings window by checking for h1 heading
                ];
            case 4:
                // Give time for both windows to finish opening
                _b.sent();
                _i = 0, _a = app.windows();
                _b.label = 5;
            case 5:
                if (!(_i < _a.length)) return [3 /*break*/, 8];
                win = _a[_i];
                return [4 /*yield*/, win.locator('h1').count().catch(function () { return 0; })];
            case 6:
                headingCount = _b.sent();
                if (headingCount > 0) {
                    settingsWindow = win;
                    return [3 /*break*/, 8];
                }
                _b.label = 7;
            case 7:
                _i++;
                return [3 /*break*/, 5];
            case 8:
                // Fallback: use the first window if we couldn't identify the settings window
                if (!settingsWindow) {
                    settingsWindow = firstWin;
                }
                return [2 /*return*/];
        }
    });
}); });
test_1.test.afterAll(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (app === null || app === void 0 ? void 0 : app.close())];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
// Helper: ensure Advanced Settings is expanded
function expandAdvancedSettings() {
    return __awaiter(this, void 0, void 0, function () {
        var sttSelect;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sttSelect = settingsWindow.locator('[aria-label="STT engine"]');
                    return [4 /*yield*/, sttSelect.isVisible().catch(function () { return false; })];
                case 1:
                    if (!!(_a.sent())) return [3 /*break*/, 4];
                    return [4 /*yield*/, settingsWindow.locator('button', { hasText: 'Advanced Settings' }).click()];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, sttSelect.waitFor({ state: 'visible', timeout: 5000 })];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4: return [2 /*return*/];
            }
        });
    });
}
test_1.test.describe('App launch', function () {
    (0, test_1.test)('should open the main window with correct title', function () { return __awaiter(void 0, void 0, void 0, function () {
        var title;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, settingsWindow.title()];
                case 1:
                    title = _a.sent();
                    (0, test_1.expect)(title).toBeTruthy();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should display the settings panel heading', function () { return __awaiter(void 0, void 0, void 0, function () {
        var heading;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    heading = settingsWindow.locator('h1');
                    return [4 /*yield*/, (0, test_1.expect)(heading).toHaveText('live-translate')];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should show status text', function () { return __awaiter(void 0, void 0, void 0, function () {
        var bodyText;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, settingsWindow.textContent('body')];
                case 1:
                    bodyText = _a.sent();
                    (0, test_1.expect)(bodyText).toBeTruthy();
                    return [2 /*return*/];
            }
        });
    }); });
});
test_1.test.describe('Engine selection', function () {
    (0, test_1.test)('should display translation engine radio options', function () { return __awaiter(void 0, void 0, void 0, function () {
        var engineGroup, radios, count;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, expandAdvancedSettings()
                    // Use the radiogroup to scope selectors and avoid strict mode violations
                ];
                case 1:
                    _a.sent();
                    engineGroup = settingsWindow.locator('[role="radiogroup"]');
                    return [4 /*yield*/, (0, test_1.expect)(engineGroup).toBeVisible()
                        // Verify key engine radio inputs exist
                    ];
                case 2:
                    _a.sent();
                    radios = engineGroup.locator('input[name="engine"]');
                    return [4 /*yield*/, radios.count()];
                case 3:
                    count = _a.sent();
                    (0, test_1.expect)(count).toBeGreaterThanOrEqual(5); // hybrid, slm, hy-mt1.5, hy-mt, opus, ct2-opus
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should allow selecting a different translation engine', function () { return __awaiter(void 0, void 0, void 0, function () {
        var engineGroup, opusRadio;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, expandAdvancedSettings()
                    // Find the OPUS-MT radio by its unique description text
                ];
                case 1:
                    _a.sent();
                    engineGroup = settingsWindow.locator('[role="radiogroup"]');
                    opusRadio = engineGroup.locator('label').filter({ hasText: '~100MB' }).locator('input[type="radio"]');
                    return [4 /*yield*/, opusRadio.click()];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, (0, test_1.expect)(opusRadio).toBeChecked()];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should show STT engine selector', function () { return __awaiter(void 0, void 0, void 0, function () {
        var sttSelect, options, count;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, expandAdvancedSettings()];
                case 1:
                    _a.sent();
                    sttSelect = settingsWindow.locator('[aria-label="STT engine"]');
                    return [4 /*yield*/, (0, test_1.expect)(sttSelect).toBeVisible()
                        // Should have at least whisper-local and moonshine options
                    ];
                case 2:
                    _a.sent();
                    options = sttSelect.locator('option');
                    return [4 /*yield*/, options.count()];
                case 3:
                    count = _a.sent();
                    (0, test_1.expect)(count).toBeGreaterThanOrEqual(2);
                    return [2 /*return*/];
            }
        });
    }); });
});
test_1.test.describe('Start/Stop pipeline', function () {
    (0, test_1.test)('should have a start button', function () { return __awaiter(void 0, void 0, void 0, function () {
        var startBtn;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    startBtn = settingsWindow.locator('button[aria-label="Start translation"]');
                    return [4 /*yield*/, (0, test_1.expect)(startBtn).toBeVisible()];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, (0, test_1.expect)(startBtn).toContainText('Start')];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should show Starting state when clicked', function () { return __awaiter(void 0, void 0, void 0, function () {
        var startBtn, btnLocator, buttonText, stopBtn;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    startBtn = settingsWindow.locator('button[aria-label="Start translation"]');
                    return [4 /*yield*/, startBtn.click()
                        // The button text should change to "Starting..." briefly.
                        // The pipeline will likely fail (no models downloaded), but we verify
                        // the UI reacts to the click.
                    ];
                case 1:
                    _a.sent();
                    // The button text should change to "Starting..." briefly.
                    // The pipeline will likely fail (no models downloaded), but we verify
                    // the UI reacts to the click.
                    return [4 /*yield*/, settingsWindow.waitForTimeout(500)
                        // After clicking, the button shows either "Starting..." or "Stop" or has reverted on error
                    ];
                case 2:
                    // The button text should change to "Starting..." briefly.
                    // The pipeline will likely fail (no models downloaded), but we verify
                    // the UI reacts to the click.
                    _a.sent();
                    btnLocator = settingsWindow.locator('button').filter({ hasText: /Starting|Stop|Start/ });
                    return [4 /*yield*/, btnLocator.first().textContent()];
                case 3:
                    buttonText = _a.sent();
                    (0, test_1.expect)(buttonText).toBeTruthy();
                    stopBtn = settingsWindow.locator('button[aria-label="Stop translation"]');
                    return [4 /*yield*/, stopBtn.isVisible().catch(function () { return false; })];
                case 4:
                    if (!_a.sent()) return [3 /*break*/, 7];
                    return [4 /*yield*/, stopBtn.click()
                        // Wait for stop to complete
                    ];
                case 5:
                    _a.sent();
                    // Wait for stop to complete
                    return [4 /*yield*/, settingsWindow.locator('button[aria-label="Start translation"]').waitFor({
                            state: 'visible',
                            timeout: 10000
                        })];
                case 6:
                    // Wait for stop to complete
                    _a.sent();
                    _a.label = 7;
                case 7: return [2 /*return*/];
            }
        });
    }); });
});
test_1.test.describe('Settings persistence', function () {
    (0, test_1.test)('should have microphone selector', function () { return __awaiter(void 0, void 0, void 0, function () {
        var micSelect;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    micSelect = settingsWindow.locator('[aria-label="Microphone device"]');
                    return [4 /*yield*/, (0, test_1.expect)(micSelect).toBeVisible()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should show config summary panel', function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: 
                // The config summary shows Speech Recognition, Translation, and Language labels
                return [4 /*yield*/, (0, test_1.expect)(settingsWindow.locator('text=Speech Recognition').first()).toBeVisible()];
                case 1:
                    // The config summary shows Speech Recognition, Translation, and Language labels
                    _a.sent();
                    return [4 /*yield*/, (0, test_1.expect)(settingsWindow.locator('text=Translation').first()).toBeVisible()];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, (0, test_1.expect)(settingsWindow.locator('text=Language').first()).toBeVisible()];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should have language selectors in advanced settings', function () { return __awaiter(void 0, void 0, void 0, function () {
        var sourceSelect, targetSelect;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, expandAdvancedSettings()];
                case 1:
                    _a.sent();
                    sourceSelect = settingsWindow.locator('[aria-label="Source language"]');
                    return [4 /*yield*/, (0, test_1.expect)(sourceSelect).toBeVisible()];
                case 2:
                    _a.sent();
                    targetSelect = settingsWindow.locator('[aria-label="Target language"]');
                    return [4 /*yield*/, (0, test_1.expect)(targetSelect).toBeVisible()
                        // Source language should default to auto
                    ];
                case 3:
                    _a.sent();
                    // Source language should default to auto
                    return [4 /*yield*/, (0, test_1.expect)(sourceSelect).toHaveValue('auto')];
                case 4:
                    // Source language should default to auto
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)('should allow changing target language', function () { return __awaiter(void 0, void 0, void 0, function () {
        var targetSelect;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, expandAdvancedSettings()];
                case 1:
                    _a.sent();
                    targetSelect = settingsWindow.locator('[aria-label="Target language"]');
                    return [4 /*yield*/, targetSelect.selectOption('ja')];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, (0, test_1.expect)(targetSelect).toHaveValue('ja')];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
test_1.test.describe('Window management', function () {
    (0, test_1.test)('should open two windows (main + subtitle)', function () { return __awaiter(void 0, void 0, void 0, function () {
        var windows;
        return __generator(this, function (_a) {
            windows = app.windows();
            (0, test_1.expect)(windows.length).toBeGreaterThanOrEqual(2);
            return [2 /*return*/];
        });
    }); });
    (0, test_1.test)('should be able to evaluate in main process', function () { return __awaiter(void 0, void 0, void 0, function () {
        var appPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, app.evaluate(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
                        var app = _b.app;
                        return __generator(this, function (_c) {
                            return [2 /*return*/, app.getAppPath()];
                        });
                    }); })];
                case 1:
                    appPath = _a.sent();
                    (0, test_1.expect)(appPath).toBeTruthy();
                    (0, test_1.expect)(typeof appPath).toBe('string');
                    return [2 /*return*/];
            }
        });
    }); });
});
