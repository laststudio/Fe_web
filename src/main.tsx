import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/tokens.css'
import './index.css'
import App from './App.tsx'
import NavigationTransition from './navigation/NavigationTransition.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, color: '#64748b' }}>正在加载 Fe Web…</main>}>
      <ErrorBoundary>
        <NavigationTransition><App /></NavigationTransition>
      </ErrorBoundary>
    </Suspense>
  </StrictMode>,
)
