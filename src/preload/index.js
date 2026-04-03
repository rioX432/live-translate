"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    // Pipeline control
    pipelineStart: function (config) { return electron_1.ipcRenderer.invoke('pipeline-start', config); },
    pipelineStop: function () { return electron_1.ipcRenderer.invoke('pipeline-stop'); },
    processAudio: function (audioData) { return electron_1.ipcRenderer.invoke('process-audio', audioData); },
    processAudioStreaming: function (audioData) { return electron_1.ipcRenderer.invoke('process-audio-streaming', audioData); },
    finalizeStreaming: function (audioData) { return electron_1.ipcRenderer.invoke('finalize-streaming', audioData); },
    // Translation results
    onTranslationResult: function (callback) {
        var handler = function (_event, data) { return callback(data); };
        electron_1.ipcRenderer.on('translation-result', handler);
        return function () { return electron_1.ipcRenderer.off('translation-result', handler); };
    },
    onInterimResult: function (callback) {
        var handler = function (_event, data) { return callback(data); };
        electron_1.ipcRenderer.on('interim-result', handler);
        return function () { return electron_1.ipcRenderer.off('interim-result', handler); };
    },
    // Draft result from hybrid translation (#235)
    onDraftResult: function (callback) {
        var handler = function (_event, data) { return callback(data); };
        electron_1.ipcRenderer.on('draft-result', handler);
        return function () { return electron_1.ipcRenderer.off('draft-result', handler); };
    },
    // Status updates from main process
    onStatusUpdate: function (callback) {
        var handler = function (_event, message) { return callback(message); };
        electron_1.ipcRenderer.on('status-update', handler);
        return function () { return electron_1.ipcRenderer.off('status-update', handler); };
    },
    // Session info
    getSessionStartTime: function () { return electron_1.ipcRenderer.invoke('get-session-start-time'); },
    // Display management
    getDisplays: function () { return electron_1.ipcRenderer.invoke('get-displays'); },
    moveSubtitleToDisplay: function (displayId) {
        return electron_1.ipcRenderer.send('move-subtitle-to-display', displayId);
    },
    // Settings persistence (#49)
    getSettings: function () { return electron_1.ipcRenderer.invoke('get-settings'); },
    saveSettings: function (settings) {
        return electron_1.ipcRenderer.invoke('save-settings', settings);
    },
    // Crash recovery (#54)
    getCrashedSession: function () { return electron_1.ipcRenderer.invoke('get-crashed-session'); },
    // Session management (#121)
    listSessions: function () { return electron_1.ipcRenderer.invoke('list-sessions'); },
    loadSession: function (id) { return electron_1.ipcRenderer.invoke('load-session', id); },
    searchSessions: function (query) { return electron_1.ipcRenderer.invoke('search-sessions', query); },
    deleteSession: function (id) { return electron_1.ipcRenderer.invoke('delete-session', id); },
    exportSession: function (id, format) { return electron_1.ipcRenderer.invoke('export-session', id, format); },
    // GGUF model management (#133)
    getGgufVariants: function (modelSize) { return electron_1.ipcRenderer.invoke('get-gguf-variants', modelSize); },
    // Plugin management (#127)
    listPlugins: function () { return electron_1.ipcRenderer.invoke('list-plugins'); },
    // Session logs (#116)
    getSessionLogs: function () { return electron_1.ipcRenderer.invoke('get-session-logs'); },
    // Meeting summary (#124)
    generateSummary: function (transcriptPath) {
        return electron_1.ipcRenderer.invoke('generate-summary', transcriptPath);
    },
    // GPU detection (#132)
    detectGpu: function () { return electron_1.ipcRenderer.invoke('detect-gpu'); },
    // Subtitle settings (#118)
    saveSubtitleSettings: function (settings) {
        return electron_1.ipcRenderer.invoke('save-subtitle-settings', settings);
    },
    onSubtitleSettingsChanged: function (callback) {
        var handler = function (_event, settings) { return callback(settings); };
        electron_1.ipcRenderer.on('subtitle-settings-changed', handler);
        return function () { return electron_1.ipcRenderer.off('subtitle-settings-changed', handler); };
    },
    // Glossary management (#240)
    saveGlossary: function (terms) {
        return electron_1.ipcRenderer.invoke('save-glossary', terms);
    },
    // #238: Check if draft model (4B) is available for speculative decoding
    isDraftModelAvailable: function () { return electron_1.ipcRenderer.invoke('is-draft-model-available'); },
    // #261: Whisper model variant info
    getWhisperVariants: function () { return electron_1.ipcRenderer.invoke('get-whisper-variants'); },
    // #260: Moonshine model variant info
    getMoonshineVariants: function () { return electron_1.ipcRenderer.invoke('get-moonshine-variants'); },
    // #243: Platform detection for hiding platform-specific options
    getPlatform: function () { return electron_1.ipcRenderer.invoke('get-platform'); },
    // Display change notifications (#192)
    onDisplaysChanged: function (callback) {
        var handler = function () { return callback(); };
        electron_1.ipcRenderer.on('displays-changed', handler);
        return function () { return electron_1.ipcRenderer.off('displays-changed', handler); };
    },
    // WebSocket audio server for Chrome extension (#264)
    wsAudioStart: function (port) { return electron_1.ipcRenderer.invoke('ws-audio-start', port); },
    wsAudioStop: function () { return electron_1.ipcRenderer.invoke('ws-audio-stop'); },
    wsAudioGetStatus: function () { return electron_1.ipcRenderer.invoke('ws-audio-get-status'); },
    onWsAudioStatus: function (callback) {
        var handler = function (_event, status) { return callback(status); };
        electron_1.ipcRenderer.on('ws-audio-status', handler);
        return function () { return electron_1.ipcRenderer.off('ws-audio-status', handler); };
    },
    // Global keyboard shortcuts (#551)
    getShortcutLabels: function () { return electron_1.ipcRenderer.invoke('get-shortcut-labels'); },
    onShortcutAction: function (callback) {
        var handler = function (_event, action) { return callback(action); };
        electron_1.ipcRenderer.on('shortcut-action', handler);
        return function () { return electron_1.ipcRenderer.off('shortcut-action', handler); };
    },
    onLanguageSwitched: function (callback) {
        var handler = function (_event, data) { return callback(data); };
        electron_1.ipcRenderer.on('language-switched', handler);
        return function () { return electron_1.ipcRenderer.off('language-switched', handler); };
    }
});
