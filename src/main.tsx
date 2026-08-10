import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import NavigationTransition from './navigation/NavigationTransition.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavigationTransition><App /></NavigationTransition>
  </StrictMode>,
)
