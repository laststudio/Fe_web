import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/tokens.css'
import './index.css'
import App from './App.tsx'
import NavigationTransition from './navigation/NavigationTransition.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NavigationTransition><App /></NavigationTransition>
    </ErrorBoundary>
  </StrictMode>,
)
