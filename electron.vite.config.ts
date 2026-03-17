import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Intercept ONNX Runtime .mjs dynamic imports at the module resolution level.
// ONNX Runtime loads /vad/ort-wasm-simd-threaded.mjs via dynamic import(),
// which Vite tries to transform. We resolve it to the actual file in node_modules
// and load it directly, bypassing Vite's transform pipeline.
function serveOrtWasm(): Plugin {
  const ortDist = resolve(__dirname, 'node_modules', 'onnxruntime-web', 'dist')
  return {
    name: 'serve-ort-wasm',
    enforce: 'pre',
    resolveId(id) {
      // Match /vad/ort-wasm-*.mjs (with or without ?import query)
      const cleanId = id.split('?')[0]
      if (cleanId.startsWith('/vad/') && cleanId.endsWith('.mjs')) {
        const fileName = cleanId.split('/').pop()!
        return resolve(ortDist, fileName)
      }
    },
    load(id) {
      // Serve ORT files from node_modules as-is without transformation
      if (id.startsWith(ortDist) && id.endsWith('.mjs')) {
        return readFileSync(id, 'utf-8')
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store', '@huggingface/transformers'] })],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      serveOrtWasm(),
      react()
    ],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
