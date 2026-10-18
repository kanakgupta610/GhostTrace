import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build`                    -> normal multi-file build in dist/ (deploy anywhere: Vercel, Netlify, S3)
// `npx vite build --mode single`     -> one self-contained dist-single/index.html (everything inlined, ~2.6 MB)
// `npx vite build --mode artifact`   -> dist-artifact/index.html: app code inlined (~200 KB), large libraries
//                                       loaded from jsDelivr as UMD globals. Used for the hosted demo link.
const CDN_GLOBALS = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
  cytoscape: 'cytoscape',
  'cytoscape-dagre': 'cytoscapeDagre',
  recharts: 'Recharts',
  jspdf: 'jspdf',
}

export default defineConfig(({ mode }) => {
  if (mode === 'single') return { plugins: [react(), viteSingleFile()], build: { outDir: 'dist-single', chunkSizeWarningLimit: 5000 } }
  if (mode === 'artifact') {
    return {
      plugins: [react({ jsxRuntime: 'classic' }), viteSingleFile()],
      build: {
        outDir: 'dist-artifact',
        rollupOptions: { external: Object.keys(CDN_GLOBALS), output: { format: 'iife', globals: CDN_GLOBALS } },
      },
    }
  }
  return { plugins: [react()], build: { chunkSizeWarningLimit: 2000 } }
})
