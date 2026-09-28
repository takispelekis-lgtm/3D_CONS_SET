import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Στο GitHub Pages η εφαρμογή σερβίρεται από https://<user>.github.io/3D_CONS_SET/
  base: command === 'build' ? '/3D_CONS_SET/' : '/',
  // Cache εκτός Dropbox, ώστε ο συγχρονισμός να μην κλειδώνει τα αρχεία (EBUSY)
  cacheDir: path.join(os.tmpdir(), 'vite-3d_cons'),
}))
