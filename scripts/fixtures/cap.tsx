import { createRoot } from 'react-dom/client'
import CapVerification from '../../src/CapVerification'
import { Dialog } from '../../src/ui'
import '../../src/index.css'
import '../../src/App.css'

declare global {
  interface Window {
    __capHarness: { token: string; errors: string[] }
  }
}

window.__capHarness = { token: '', errors: [] }
createRoot(document.getElementById('root')!).render(
  <Dialog title="自动完成 · 安全人机验证" onClose={() => {}} width={480}>
    <div className="fe-cap-modal-body">
      <p>开启自动完成前需完成安全人机验证</p>
      <CapVerification
        onError={(message) => window.__capHarness.errors.push(message)}
        onToken={(token) => { window.__capHarness.token = token }}
      />
    </div>
  </Dialog>,
)
