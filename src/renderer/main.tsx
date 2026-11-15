import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-600.css'
import '@fontsource/noto-sans/latin-700.css'
import '@fontsource/atkinson-hyperlegible/latin-400.css'
import '@fontsource/atkinson-hyperlegible/latin-400-italic.css'
import '@fontsource/atkinson-hyperlegible/latin-700.css'
import '@fontsource/atkinson-hyperlegible/latin-700-italic.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
