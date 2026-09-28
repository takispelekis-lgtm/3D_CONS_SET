import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Cache εκτός Dropbox, ώστε ο συγχρονισμός να μην κλειδώνει τα αρχεία (EBUSY)
  cacheDir: path.join(os.tmpdir(), 'vite-3d_cons'),
})
