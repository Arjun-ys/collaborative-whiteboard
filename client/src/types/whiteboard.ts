import type { fabric } from 'fabric';

export type SerializedCanvasObject = Record<string, any>;

export interface CanvasController {
  undo: () => void;
  redo: () => void;
  exportPng: () => Promise<void>;
  clear: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  fitToContent: () => void;
}

export interface CanvasControllerRegistration {
  (controller: CanvasController | null): void;
}

export type CanvasObjectEvent = {
  target?: fabric.Object;
};
