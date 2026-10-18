import capRuntime from './scripts/cap-runtime.mjs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react(), capRuntime()] })
