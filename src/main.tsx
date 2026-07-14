import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { fileSystemAccessAvailable } from './lib/file-sink'
import { registerDownloadWorker, swStreamingAvailable } from './lib/sw-download'

// On browsers without File System Access (Firefox/Safari), warm up the streamed
// download worker so a large receive can stream to disk without buffering (§6E).
if (!fileSystemAccessAvailable() && swStreamingAvailable()) {
  registerDownloadWorker()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
