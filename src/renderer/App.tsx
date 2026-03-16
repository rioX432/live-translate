import { useEffect, useState } from 'react'
import SubtitleOverlay from './components/SubtitleOverlay'
import SettingsPanel from './components/SettingsPanel'

function App(): JSX.Element {
  const [isSubtitleMode, setIsSubtitleMode] = useState(false)

  useEffect(() => {
    // Hash routing: #/subtitle for subtitle overlay window
    setIsSubtitleMode(window.location.hash === '#/subtitle')

    const handleHashChange = (): void => {
      setIsSubtitleMode(window.location.hash === '#/subtitle')
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  if (isSubtitleMode) {
    return <SubtitleOverlay />
  }

  return <SettingsPanel />
}

export default App
