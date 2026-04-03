"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var runner_js_1 = require("./src/runner.js");
var report_js_1 = require("./src/report.js");
var AVAILABLE_ENGINES = ['google', 'opus-mt', 'translate-gemma', 'translate-gemma-cpu'];
function parseArgs() {
    var args = process.argv.slice(2);
    var engines = [];
    var directions = ['ja-en', 'en-ja'];
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg === '--engines' && args[i + 1]) {
            engines = args[i + 1].split(',').map(function (e) {
                var trimmed = e.trim();
                if (!AVAILABLE_ENGINES.includes(trimmed)) {
                    console.error("Unknown engine: ".concat(trimmed));
                    console.error("Available: ".concat(AVAILABLE_ENGINES.join(', ')));
                    process.exit(1);
                }
                return trimmed;
            });
            i++;
        }
        else if (arg === '--direction' && args[i + 1]) {
            directions = [args[i + 1]];
            i++;
        }
        else if (arg === '--help' || arg === '-h') {
            console.log('Usage: npx tsx --expose-gc run.ts [options]');
            console.log('');
            console.log('Options:');
            console.log("  --engines <list>     Comma-separated engines (".concat(AVAILABLE_ENGINES.join(', '), ")"));
            console.log('  --direction <dir>    ja-en or en-ja (default: both)');
            console.log('  --help               Show this help');
            process.exit(0);
        }
    }
    if (engines.length === 0) {
        engines = ['google', 'opus-mt', 'translate-gemma', 'translate-gemma-cpu'];
    }
    return { engines: engines, directions: directions };
}
function createEngine(id) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, GoogleTranslateBench, OpusMTBench, TranslateGemmaBench, TranslateGemmaBench;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = id;
                    switch (_a) {
                        case 'google': return [3 /*break*/, 1];
                        case 'opus-mt': return [3 /*break*/, 3];
                        case 'translate-gemma': return [3 /*break*/, 5];
                        case 'translate-gemma-cpu': return [3 /*break*/, 7];
                    }
                    return [3 /*break*/, 9];
                case 1: return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require('./src/engines/google-translate.js')); })];
                case 2:
                    GoogleTranslateBench = (_b.sent()).GoogleTranslateBench;
                    return [2 /*return*/, new GoogleTranslateBench()];
                case 3: return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require('./src/engines/opus-mt.js')); })];
                case 4:
                    OpusMTBench = (_b.sent()).OpusMTBench;
                    return [2 /*return*/, new OpusMTBench()];
                case 5: return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require('./src/engines/translate-gemma.js')); })];
                case 6:
                    TranslateGemmaBench = (_b.sent()).TranslateGemmaBench;
                    return [2 /*return*/, new TranslateGemmaBench({ useGpu: true })];
                case 7: return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require('./src/engines/translate-gemma.js')); })];
                case 8:
                    TranslateGemmaBench = (_b.sent()).TranslateGemmaBench;
                    return [2 /*return*/, new TranslateGemmaBench({ useGpu: false })];
                case 9: return [2 /*return*/];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var _a, engineIds, directions, engines, _i, engineIds_1, id, _b, _c, err_1, result, outputDir;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _a = parseArgs(), engineIds = _a.engines, directions = _a.directions;
                    console.log('=== Translation Quality Benchmark ===');
                    console.log("Engines: ".concat(engineIds.join(', ')));
                    console.log("Directions: ".concat(directions.join(', ')));
                    console.log('');
                    engines = [];
                    _i = 0, engineIds_1 = engineIds;
                    _d.label = 1;
                case 1:
                    if (!(_i < engineIds_1.length)) return [3 /*break*/, 6];
                    id = engineIds_1[_i];
                    _d.label = 2;
                case 2:
                    _d.trys.push([2, 4, , 5]);
                    _c = (_b = engines).push;
                    return [4 /*yield*/, createEngine(id)];
                case 3:
                    _c.apply(_b, [_d.sent()]);
                    return [3 /*break*/, 5];
                case 4:
                    err_1 = _d.sent();
                    console.error("[main] Failed to create engine '".concat(id, "':"), err_1);
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6:
                    if (engines.length === 0) {
                        console.error('No engines available. Exiting.');
                        process.exit(1);
                    }
                    return [4 /*yield*/, (0, runner_js_1.runBenchmark)(engines, directions)];
                case 7:
                    result = _d.sent();
                    outputDir = (0, report_js_1.writeReports)(result);
                    console.log("\nDone. Results written to ".concat(outputDir));
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (err) {
    console.error('Fatal error:', err);
    process.exit(1);
});
