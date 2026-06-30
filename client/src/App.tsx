import { useState, useEffect } from 'react';
import { Whiteboard } from './components/Whiteboard';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ConnectionStatus } from './components/ConnectionStatus';
import { UserIdentity } from './components/UserIdentity';
import { useYjs } from './hooks/useYjs';
import { useStore } from './store/useStore';

function App() {
  const [clearCanvasFn, setClearCanvasFn] = useState<() => void>(() => {});
  const { setRoomId, theme } = useStore();

  // Apply Tailwind dark mode class dynamically to the root DOM node
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);



  const { canvasObjectsMap } = useYjs();

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white dark:bg-black transition-colors duration-300">
      {/* Floating Top Header Panel bar (Groups stats and user configs without overlap) */}
      <div className="absolute top-6 left-6 z-10 flex flex-wrap items-center gap-3 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2">
          <ConnectionStatus />
        </div>
        <div className="pointer-events-auto">
          <UserIdentity />
        </div>
      </div>

      {/* Shapes and Brush Properties Editor */}
      <PropertiesPanel />

      {/* Responsive Whiteboard Canvas */}
      <Whiteboard
        setClearCanvasFn={setClearCanvasFn}
        canvasObjectsMap={canvasObjectsMap}
      />

      {/* Floating Toolbar Options */}
      <Toolbar onClearCanvas={clearCanvasFn} />
    </div>
  );
}

export default App;
