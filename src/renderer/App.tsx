import React, { useEffect, useState } from 'react'
import SubtitleOverlay from './components/SubtitleOverlay'
import SettingsPanel from './components/SettingsPanel'
import CharacterOverlay from './components/CharacterOverlay'

function App(): React.JSX.Element {
  // Read on first render so an overlay window never mounts the settings panel
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    // Hash routing: #/subtitle and #/character for the overlay windows
    const handleHashChange = (): void => {
      setHash(window.location.hash)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  if (hash === '#/subtitle') {
    return <SubtitleOverlay />
  }
  if (hash === '#/character') {
    return <CharacterOverlay />
  }

  return <SettingsPanel />
}

export default App
