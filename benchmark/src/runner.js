"use strict";
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
exports.runBenchmark = runBenchmark;
var fs_1 = require("fs");
var path_1 = require("path");
var url_1 = require("url");
var metrics_js_1 = require("./metrics.js");
var __dirname = (0, path_1.dirname)((0, url_1.fileURLToPath)(import.meta.url));
var TESTSET_PATH = (0, path_1.join)(__dirname, '..', 'testset', 'ja-en-100.jsonl');
var WARMUP_COUNT = 3;
/** Load test sentences from JSONL file */
function loadTestSet(path) {
    var content = (0, fs_1.readFileSync)(path, 'utf-8');
    return content
        .split('\n')
        .filter(function (line) { return line.trim(); })
        .map(function (line) { return JSON.parse(line); });
}
/** Run a single engine against the full testset */
function runEngine(engine, sentences, direction) {
    return __awaiter(this, void 0, void 0, function () {
        var filtered, memBefore, peakRss, warmupSentences, _i, warmupSentences_1, s, _a, results, _loop_1, i, latencies, errors;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    filtered = sentences.filter(function (s) { return s.direction === direction; });
                    console.log("\n[runner] ".concat(engine.label, " (").concat(direction, "): ").concat(filtered.length, " sentences"));
                    // Initialize
                    console.log("[runner] Initializing ".concat(engine.label, "..."));
                    return [4 /*yield*/, engine.initialize()];
                case 1:
                    _b.sent();
                    (0, metrics_js_1.tryGC)();
                    memBefore = (0, metrics_js_1.snapshotMemory)();
                    peakRss = memBefore.rssMB;
                    warmupSentences = filtered.slice(0, WARMUP_COUNT);
                    console.log("[runner] Warmup: ".concat(warmupSentences.length, " sentences"));
                    _i = 0, warmupSentences_1 = warmupSentences;
                    _b.label = 2;
                case 2:
                    if (!(_i < warmupSentences_1.length)) return [3 /*break*/, 7];
                    s = warmupSentences_1[_i];
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, engine.translate(s.source, direction)];
                case 4:
                    _b.sent();
                    return [3 /*break*/, 6];
                case 5:
                    _a = _b.sent();
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 2];
                case 7:
                    (0, metrics_js_1.tryGC)();
                    results = [];
                    _loop_1 = function (i) {
                        var sentence, progress, _c, output, ms, err_1, errorMsg, mem;
                        return __generator(this, function (_d) {
                            switch (_d.label) {
                                case 0:
                                    sentence = filtered[i];
                                    progress = "[".concat(i + 1, "/").concat(filtered.length, "]");
                                    _d.label = 1;
                                case 1:
                                    _d.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, (0, metrics_js_1.measureLatency)(function () {
                                            return engine.translate(sentence.source, direction);
                                        })];
                                case 2:
                                    _c = _d.sent(), output = _c.result, ms = _c.ms;
                                    results.push({
                                        id: sentence.id,
                                        source: sentence.source,
                                        reference: sentence.reference,
                                        output: output,
                                        direction: sentence.direction,
                                        domain: sentence.domain,
                                        length: sentence.length,
                                        latencyMs: ms
                                    });
                                    if ((i + 1) % 10 === 0) {
                                        console.log("  ".concat(progress, " ").concat(ms.toFixed(0), "ms"));
                                    }
                                    return [3 /*break*/, 4];
                                case 3:
                                    err_1 = _d.sent();
                                    errorMsg = err_1 instanceof Error ? err_1.message : String(err_1);
                                    console.error("  ".concat(progress, " ERROR: ").concat(errorMsg));
                                    results.push({
                                        id: sentence.id,
                                        source: sentence.source,
                                        reference: sentence.reference,
                                        output: '',
                                        direction: sentence.direction,
                                        domain: sentence.domain,
                                        length: sentence.length,
                                        latencyMs: 0,
                                        error: errorMsg
                                    });
                                    return [3 /*break*/, 4];
                                case 4:
                                    mem = (0, metrics_js_1.snapshotMemory)();
                                    if (mem.rssMB > peakRss)
                                        peakRss = mem.rssMB;
                                    return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _b.label = 8;
                case 8:
                    if (!(i < filtered.length)) return [3 /*break*/, 11];
                    return [5 /*yield**/, _loop_1(i)];
                case 9:
                    _b.sent();
                    _b.label = 10;
                case 10:
                    i++;
                    return [3 /*break*/, 8];
                case 11:
                    latencies = results.filter(function (r) { return !r.error; }).map(function (r) { return r.latencyMs; });
                    errors = results.filter(function (r) { return r.error; }).length;
                    return [2 /*return*/, {
                            engineId: engine.id,
                            engineLabel: engine.label,
                            direction: direction,
                            totalSentences: filtered.length,
                            errors: errors,
                            latency: (0, metrics_js_1.computeStats)(latencies),
                            peakRssMB: peakRss,
                            results: results
                        }];
            }
        });
    });
}
/** Run the full benchmark suite */
function runBenchmark(engines_1) {
    return __awaiter(this, arguments, void 0, function (engines, directions) {
        var sentences, summaries, _i, engines_2, engine, _a, directions_1, direction, summary, err_2, err_3;
        if (directions === void 0) { directions = ['ja-en', 'en-ja']; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    sentences = loadTestSet(TESTSET_PATH);
                    console.log("[runner] Loaded ".concat(sentences.length, " test sentences"));
                    summaries = [];
                    _i = 0, engines_2 = engines;
                    _b.label = 1;
                case 1:
                    if (!(_i < engines_2.length)) return [3 /*break*/, 12];
                    engine = engines_2[_i];
                    _a = 0, directions_1 = directions;
                    _b.label = 2;
                case 2:
                    if (!(_a < directions_1.length)) return [3 /*break*/, 11];
                    direction = directions_1[_a];
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 5, 6, 10]);
                    return [4 /*yield*/, runEngine(engine, sentences, direction)];
                case 4:
                    summary = _b.sent();
                    summaries.push(summary);
                    return [3 /*break*/, 10];
                case 5:
                    err_2 = _b.sent();
                    console.error("[runner] Fatal error with ".concat(engine.label, " (").concat(direction, "):"), err_2);
                    return [3 /*break*/, 10];
                case 6:
                    _b.trys.push([6, 8, , 9]);
                    return [4 /*yield*/, engine.dispose()];
                case 7:
                    _b.sent();
                    return [3 /*break*/, 9];
                case 8:
                    err_3 = _b.sent();
                    console.error("[runner] Dispose error for ".concat(engine.label, ":"), err_3);
                    return [3 /*break*/, 9];
                case 9:
                    (0, metrics_js_1.tryGC)();
                    return [7 /*endfinally*/];
                case 10:
                    _a++;
                    return [3 /*break*/, 2];
                case 11:
                    _i++;
                    return [3 /*break*/, 1];
                case 12: return [2 /*return*/, {
                        timestamp: new Date().toISOString(),
                        summaries: summaries
                    }];
            }
        });
    });
}
