import { Maximize, Minus, Plus, RotateCcw } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { CanvasController } from '../types/whiteboard';

export const ViewportControls = ({ controller }: { controller: CanvasController | null }) => {
  const zoom = useStore((state) => state.zoom);
  return <div className="viewport-controls" role="group" aria-label="Canvas navigation">
    <button className="icon-button" disabled={!controller} onClick={controller?.zoomOut} aria-label="Zoom out" title="Zoom out"><Minus size={16} /></button>
    <span className="zoom-level" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span>
    <button className="icon-button" disabled={!controller} onClick={controller?.zoomIn} aria-label="Zoom in" title="Zoom in"><Plus size={16} /></button>
    <button className="icon-button" disabled={!controller} onClick={controller?.fitToContent} aria-label="Fit all content" title="Fit all content"><Maximize size={16} /></button>
    <button className="icon-button" disabled={!controller} onClick={controller?.resetView} aria-label="Reset view" title="Reset view"><RotateCcw size={15} /></button>
  </div>;
};
