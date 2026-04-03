"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeReports = writeReports;
var fs_1 = require("fs");
var path_1 = require("path");
var url_1 = require("url");
var __dirname = (0, path_1.dirname)((0, url_1.fileURLToPath)(import.meta.url));
var RESULTS_DIR = (0, path_1.join)(__dirname, '..', 'results');
function fmt(n, decimals) {
    if (decimals === void 0) { decimals = 0; }
    return n.toFixed(decimals);
}
function buildSummaryTable(summaries) {
    var header = '| Engine | Direction | Avg Latency | Median | P95 Latency | Peak RSS | Errors |';
    var sep = '|---|---|---|---|---|---|---|';
    var rows = summaries.map(function (s) {
        return "| ".concat(s.engineLabel, " | ").concat(s.direction.toUpperCase(), " | ").concat(fmt(s.latency.avg), "ms | ").concat(fmt(s.latency.median), "ms | ").concat(fmt(s.latency.p95), "ms | ").concat(fmt(s.peakRssMB / 1024, 2), "GB | ").concat(s.errors, " |");
    });
    return __spreadArray([header, sep], rows, true).join('\n');
}
function buildBreakdownTable(summaries, groupBy) {
    var groups = new Set();
    for (var _i = 0, summaries_1 = summaries; _i < summaries_1.length; _i++) {
        var s = summaries_1[_i];
        for (var _a = 0, _b = s.results; _a < _b.length; _a++) {
            var r = _b[_a];
            groups.add(r[groupBy]);
        }
    }
    var header = "| Engine | Direction | ".concat(__spreadArray([], groups, true).join(' | '), " |");
    var sep = "|---|---|".concat(__spreadArray([], groups, true).map(function () { return '---'; }).join('|'), "|");
    var rows = summaries.map(function (s) {
        var cells = __spreadArray([], groups, true).map(function (g) {
            var matched = s.results.filter(function (r) { return r[groupBy] === g && !r.error; });
            if (matched.length === 0)
                return 'N/A';
            var avg = matched.reduce(function (acc, r) { return acc + r.latencyMs; }, 0) / matched.length;
            return "".concat(fmt(avg), "ms");
        });
        return "| ".concat(s.engineLabel, " | ").concat(s.direction.toUpperCase(), " | ").concat(cells.join(' | '), " |");
    });
    return __spreadArray([header, sep], rows, true).join('\n');
}
function buildMarkdown(result) {
    var lines = [
        '# Translation Benchmark Results',
        '',
        "Run: ".concat(result.timestamp),
        '',
        '## Summary',
        '',
        buildSummaryTable(result.summaries),
        '',
        '## Latency by Domain',
        '',
        buildBreakdownTable(result.summaries, 'domain'),
        '',
        '## Latency by Length',
        '',
        buildBreakdownTable(result.summaries, 'length'),
        '',
        '## Go/No-Go Recommendation',
        '',
        '> TODO: Fill in after reviewing results and human evaluation scores.',
        '',
        '| Criteria | OPUS-MT | TranslateGemma | Google |',
        '|---|---|---|---|',
        '| Quality (human eval avg) | | | |',
        '| Latency acceptable (<500ms) | | | |',
        '| Memory acceptable (<4GB) | | | |',
        '| Offline capable | Yes | Yes | No |',
        '| Recommendation | | | |',
        ''
    ];
    return lines.join('\n');
}
function buildHumanEvalCSV(result) {
    // Collect all sentence IDs
    var allIds = new Set();
    for (var _i = 0, _a = result.summaries; _i < _a.length; _i++) {
        var s = _a[_i];
        for (var _b = 0, _c = s.results; _b < _c.length; _b++) {
            var r = _c[_b];
            allIds.add(r.id);
        }
    }
    // Build engine output map: id -> engineId -> output
    var outputMap = new Map();
    var referenceMap = new Map();
    for (var _d = 0, _e = result.summaries; _d < _e.length; _d++) {
        var s = _e[_d];
        for (var _f = 0, _g = s.results; _f < _g.length; _f++) {
            var r = _g[_f];
            if (!outputMap.has(r.id))
                outputMap.set(r.id, new Map());
            outputMap.get(r.id).set(s.engineId, r.output);
            if (!referenceMap.has(r.id)) {
                referenceMap.set(r.id, { source: r.source, reference: r.reference });
            }
        }
    }
    var engineIds = __spreadArray([], new Set(result.summaries.map(function (s) { return s.engineId; })), true);
    var outputHeaders = engineIds.map(function (id) { return "".concat(id, "_output"); });
    var scoreHeaders = engineIds.map(function (id) { return "".concat(id, "_score"); });
    var header = __spreadArray(__spreadArray(['id', 'source', 'reference'], outputHeaders, true), scoreHeaders, true).join(',');
    var rows = __spreadArray([], allIds, true).map(function (id) {
        var ref = referenceMap.get(id);
        var outputs = engineIds.map(function (eid) {
            var _a, _b;
            var text = (_b = (_a = outputMap.get(id)) === null || _a === void 0 ? void 0 : _a.get(eid)) !== null && _b !== void 0 ? _b : '';
            return "\"".concat(text.replace(/"/g, '""'), "\"");
        });
        var scores = engineIds.map(function () { return ''; });
        return __spreadArray(__spreadArray([
            id,
            "\"".concat(ref.source.replace(/"/g, '""'), "\""),
            "\"".concat(ref.reference.replace(/"/g, '""'), "\"")
        ], outputs, true), scores, true).join(',');
    });
    return __spreadArray([header], rows, true).join('\n');
}
/** Write all report files to results/ directory */
function writeReports(result) {
    (0, fs_1.mkdirSync)(RESULTS_DIR, { recursive: true });
    var ts = result.timestamp.replace(/[:.]/g, '-').slice(0, 19);
    // Raw JSON
    var jsonPath = (0, path_1.join)(RESULTS_DIR, "benchmark-".concat(ts, ".json"));
    (0, fs_1.writeFileSync)(jsonPath, JSON.stringify(result, null, 2));
    console.log("[report] JSON: ".concat(jsonPath));
    // Markdown summary
    var mdPath = (0, path_1.join)(RESULTS_DIR, "benchmark-".concat(ts, ".md"));
    (0, fs_1.writeFileSync)(mdPath, buildMarkdown(result));
    console.log("[report] Markdown: ".concat(mdPath));
    // Human eval CSV
    var csvPath = (0, path_1.join)(RESULTS_DIR, "human-eval-".concat(ts, ".csv"));
    (0, fs_1.writeFileSync)(csvPath, buildHumanEvalCSV(result));
    console.log("[report] Human eval CSV: ".concat(csvPath));
    return RESULTS_DIR;
}
