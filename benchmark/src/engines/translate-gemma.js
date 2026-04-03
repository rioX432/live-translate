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
exports.TranslateGemmaBench = void 0;
var path_1 = require("path");
var url_1 = require("url");
var fs_1 = require("fs");
var __dirname = (0, path_1.dirname)((0, url_1.fileURLToPath)(import.meta.url));
var MODELS_DIR = (0, path_1.join)(__dirname, '..', '..', 'models');
var DEFAULT_MODEL_FILE = 'translategemma-4b-it-Q4_K_M.gguf';
var LANG_MAP = {
    ja: 'Japanese',
    en: 'English'
};
var TranslateGemmaBench = /** @class */ (function () {
    function TranslateGemmaBench(options) {
        var _a, _b;
        this.llama = null;
        this.model = null;
        this.context = null;
        this.session = null;
        var modelFile = (_a = options === null || options === void 0 ? void 0 : options.modelFile) !== null && _a !== void 0 ? _a : DEFAULT_MODEL_FILE;
        this.modelPath = (0, path_1.join)(MODELS_DIR, modelFile);
        this.useGpu = (_b = options === null || options === void 0 ? void 0 : options.useGpu) !== null && _b !== void 0 ? _b : true;
        this.id = this.useGpu ? 'translate-gemma-gpu' : 'translate-gemma-cpu';
        this.label = this.useGpu ? 'TranslateGemma 4B (GPU)' : 'TranslateGemma 4B (CPU)';
    }
    TranslateGemmaBench.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var getLlama, _a, _b, _c, LlamaChatSession;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (this.session)
                            return [2 /*return*/];
                        if (!(0, fs_1.existsSync)(this.modelPath)) {
                            throw new Error("Model file not found: ".concat(this.modelPath, "\n") +
                                'Download from HuggingFace: huggingface-cli download ' +
                                'google/translategemma-4b-it-GGUF translategemma-4b-it-Q4_K_M.gguf ' +
                                "--local-dir ".concat(MODELS_DIR));
                        }
                        console.log("[translate-gemma] Loading model (GPU: ".concat(this.useGpu, ")..."));
                        return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require('node-llama-cpp')); })];
                    case 1:
                        getLlama = (_d.sent()).getLlama;
                        _a = this;
                        return [4 /*yield*/, getLlama({ gpu: this.useGpu ? 'auto' : false })];
                    case 2:
                        _a.llama = _d.sent();
                        _b = this;
                        return [4 /*yield*/, this.llama.loadModel({ modelPath: this.modelPath })];
                    case 3:
                        _b.model = _d.sent();
                        _c = this;
                        return [4 /*yield*/, this.model.createContext()];
                    case 4:
                        _c.context = _d.sent();
                        return [4 /*yield*/, Promise.resolve().then(function () { return __importStar(require('node-llama-cpp')); })];
                    case 5:
                        LlamaChatSession = (_d.sent()).LlamaChatSession;
                        this.session = new LlamaChatSession({ contextSequence: this.context.getSequence() });
                        console.log('[translate-gemma] Model loaded');
                        return [2 /*return*/];
                }
            });
        });
    };
    TranslateGemmaBench.prototype.translate = function (text, direction) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, fromCode, toCode, fromLang, toLang, prompt, response;
            var _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (!text.trim())
                            return [2 /*return*/, ''];
                        if (!this.session) {
                            throw new Error('[translate-gemma] Not initialized');
                        }
                        _a = direction.split('-'), fromCode = _a[0], toCode = _a[1];
                        fromLang = (_b = LANG_MAP[fromCode]) !== null && _b !== void 0 ? _b : fromCode;
                        toLang = (_c = LANG_MAP[toCode]) !== null && _c !== void 0 ? _c : toCode;
                        prompt = "<translate>".concat(text, "</translate>\nTranslate the above text from ").concat(fromLang, " to ").concat(toLang, ".");
                        // Reset session context for each independent translation
                        this.session.resetChatHistory();
                        return [4 /*yield*/, this.session.prompt(prompt)
                            // Strip any XML tags or extra whitespace from the response
                        ];
                    case 1:
                        response = _d.sent();
                        // Strip any XML tags or extra whitespace from the response
                        return [2 /*return*/, response.replace(/<\/?translate>/g, '').trim()];
                }
            });
        });
    };
    TranslateGemmaBench.prototype.dispose = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        this.session = null;
                        if (!this.context) return [3 /*break*/, 2];
                        return [4 /*yield*/, ((_b = (_a = this.context).dispose) === null || _b === void 0 ? void 0 : _b.call(_a))];
                    case 1:
                        _e.sent();
                        this.context = null;
                        _e.label = 2;
                    case 2:
                        if (!this.model) return [3 /*break*/, 4];
                        return [4 /*yield*/, ((_d = (_c = this.model).dispose) === null || _d === void 0 ? void 0 : _d.call(_c))];
                    case 3:
                        _e.sent();
                        this.model = null;
                        _e.label = 4;
                    case 4:
                        this.llama = null;
                        return [2 /*return*/];
                }
            });
        });
    };
    return TranslateGemmaBench;
}());
exports.TranslateGemmaBench = TranslateGemmaBench;
