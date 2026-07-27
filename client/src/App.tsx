import { useState, useEffect } from 'react';
import { Whiteboard } from './components/Whiteboard';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { ToolRail } from './components/ToolRail';
import { InspectorPanel } from './components/InspectorPanel';
import { ToastContainer } from './components/Toast';
import { useYjs } from './hooks/useYjs';
import { useStore } from './store/useStore';
import type { CanvasController } from './types/whiteboard';

function App() {
  const [canvasController, setCanvasController] = useState<CanvasController | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const { theme } = useStore();

  // Apply Tailwind dark mode class dynamically to the root DOM node
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);



  const { canvasObjectsMap, collaboration } = useYjs();

  return (
    <div className="app-shell">
      <ToastContainer />
      <WorkspaceHeader controller={canvasController} />
      <div className="workspace-body">
        <ToolRail onClear={() => canvasController?.clear()} />
        <main className="canvas-stage" aria-label="Collaborative whiteboard canvas">
          <Whiteboard
            canvasObjectsMap={canvasObjectsMap}
            collaboration={collaboration}
            registerCanvasController={setCanvasController}
          />
        </main>
        <InspectorPanel isOpen={inspectorOpen} onToggle={() => setInspectorOpen((open) => !open)} />
      </div>
    </div>
  );
}

export default App;
