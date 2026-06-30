import React, { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useStore } from '../store/useStore';

interface WhiteboardProps {
  setClearCanvasFn: (fn: () => void) => void;
  canvasObjectsMap?: any; // Y.Map<any>
  onLocalObjectAdded?: (obj: fabric.Object) => void;
  onLocalObjectModified?: (obj: fabric.Object) => void;
  onLocalObjectRemoved?: (obj: fabric.Object) => void;
  registerCanvasRef?: (canvas: fabric.Canvas | null) => void;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({
  setClearCanvasFn,
  canvasObjectsMap,
  onLocalObjectAdded,
  onLocalObjectModified,
  onLocalObjectRemoved,
  registerCanvasRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);

  const {
    activeTool,
    setActiveTool,
    strokeColor,
    fillColor,
    strokeWidth,
    fontSize,
    userId,
    theme,
    setIsStickySelected,
  } = useStore();

  // Internal states for shape creation
  const isDrawingRef = useRef(false);
  const startPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeShapeRef = useRef<fabric.Object | null>(null);

  // Echo cancellation lock
  const isUpdatingFromYjsRef = useRef(false);

  // References to keep event handlers current without re-binding Fabric events
  const stateRef = useRef({
    activeTool,
    strokeColor,
    fillColor,
    strokeWidth,
    fontSize,
    userId,
    theme,
  });

  useEffect(() => {
    stateRef.current = {
      activeTool,
      strokeColor,
      fillColor,
      strokeWidth,
      fontSize,
      userId,
      theme,
    };
  }, [activeTool, strokeColor, fillColor, strokeWidth, fontSize, userId, theme]);

  // Initial Setup & Canvas Lifecycle
  useEffect(() => {
    if (!canvasRef.current) return;

    // Create Fabric Canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: theme === 'light' ? '#ffffff' : '#000000',
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;
    if (registerCanvasRef) {
      registerCanvasRef(canvas);
    }

    // Set clear function in parent
    setClearCanvasFn(() => {
      if (window.confirm('Are you sure you want to clear the canvas?')) {
        if (canvasObjectsMap) {
          canvasObjectsMap.doc.transact(() => {
            canvasObjectsMap.forEach((_: any, key: string) => {
              canvasObjectsMap.delete(key);
            });
          });
        } else {
          canvas.clear();
          const bg = stateRef.current.theme === 'light' ? '#ffffff' : '#000000';
          canvas.setBackgroundColor(bg, canvas.renderAll.bind(canvas));
        }
      }
    });

    // Handle Window Resize
    const handleResize = () => {
      canvas.setWidth(window.innerWidth);
      canvas.setHeight(window.innerHeight);
      canvas.renderAll();
    };
    window.addEventListener('resize', handleResize);

    // Event listeners with Yjs syncing & state lock guards
    canvas.on('object:added', (e) => {
      if (isUpdatingFromYjsRef.current) return;
      const obj = e.target;
      if (!obj) return;

      // Inject metadata
      if (!obj.id) {
        obj.id = crypto.randomUUID();
      }
      if (!obj.creatorId) {
        obj.creatorId = stateRef.current.userId;
      }

      console.log(`[Canvas] Object added locally: ${obj.type} (ID: ${obj.id})`);
      if (canvasObjectsMap) {
        canvasObjectsMap.set(obj.id, obj.toObject(['id', 'creatorId', 'backgroundColor', 'padding', 'shadow']));
      }
      if (onLocalObjectAdded) {
        onLocalObjectAdded(obj);
      }
    });

    canvas.on('object:modified', (e) => {
      if (isUpdatingFromYjsRef.current) return;
      const obj = e.target;
      if (!obj) return;
      console.log(`[Canvas] Object modified locally: ${obj.type} (ID: ${obj.id})`);
      if (canvasObjectsMap) {
        canvasObjectsMap.set(obj.id, obj.toObject(['id', 'creatorId', 'backgroundColor', 'padding', 'shadow']));
      }
      if (onLocalObjectModified) {
        onLocalObjectModified(obj);
      }
    });

    canvas.on('object:removed', (e) => {
      if (isUpdatingFromYjsRef.current) return;
      const obj = e.target;
      if (!obj) return;
      console.log(`[Canvas] Object removed locally: ${obj.type} (ID: ${obj.id})`);
      if (canvasObjectsMap) {
        canvasObjectsMap.delete(obj.id);
      }
      if (onLocalObjectRemoved) {
        onLocalObjectRemoved(obj);
      }
    });

    // Path creation stamps
    canvas.on('path:created', (e: any) => {
      const path = e.path;
      if (!path) return;
      if (!path.id) {
        path.id = crypto.randomUUID();
      }
      if (!path.creatorId) {
        path.creatorId = stateRef.current.userId;
      }
    });

    // Bake sticky note scale AFTER the drag ends (object:scaling mid-drag resets break the handle)
    canvas.on('object:scaled', (e) => {
      const obj = e.target;
      if (!obj || obj.type !== 'textbox') return;

      const textbox = obj as fabric.Textbox;
      const scaleX = textbox.scaleX ?? 1;
      const scaleY = textbox.scaleY ?? 1;
      // Use the larger axis so the note stays roughly square
      const scale = Math.max(scaleX, scaleY);

      const baseFontSize = textbox.fontSize ?? 16;
      const newFontSize = Math.max(10, Math.round(baseFontSize * scale));
      const newWidth   = Math.round((textbox.width  ?? 200) * scaleX);
      const newHeight  = Math.round((textbox.height ?? 200) * scaleY);

      textbox.set({
        fontSize: newFontSize,
        width:    newWidth,
        height:   newHeight,
        scaleX:   1,
        scaleY:   1,
      });
      textbox.setCoords();
      canvas.requestRenderAll();

      // Push the resized note dimensions to Yjs so collaborators see the change
      canvas.fire('object:modified', { target: textbox });
    });

    // Track selections to show/hide PropertiesPanel fill options dynamically
    const updateSelectionState = () => {
      const activeObj = canvas.getActiveObject();
      setIsStickySelected(!!(activeObj && activeObj.type === 'textbox'));
    };
    canvas.on('selection:created', updateSelectionState);
    canvas.on('selection:updated', updateSelectionState);
    canvas.on('selection:cleared', () => setIsStickySelected(false));

    // Mouse events for shape creation
    canvas.on('mouse:down', (options) => {
      const { activeTool: currentTool, strokeColor: currentStroke, fillColor: currentFill, strokeWidth: currentWidth, fontSize: currentFontSize, userId: currentUserId } = stateRef.current;

      if (currentTool === 'select') return;

      const pointer = canvas.getPointer(options.e);
      startPointerRef.current = pointer;

      if (currentTool === 'brush') return;

      isDrawingRef.current = true;

      if (currentTool === 'rectangle') {
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          stroke: currentStroke,
          fill: currentFill,
          strokeWidth: currentWidth,
          selectable: false,
          hasControls: false,
          id: crypto.randomUUID(),
          creatorId: currentUserId,
        });
        activeShapeRef.current = rect;
        canvas.add(rect);
        canvas.setActiveObject(rect);
      } else if (currentTool === 'circle') {
        const circle = new fabric.Circle({
          left: pointer.x,
          top: pointer.y,
          radius: 0,
          stroke: currentStroke,
          fill: currentFill,
          strokeWidth: currentWidth,
          selectable: false,
          hasControls: false,
          id: crypto.randomUUID(),
          creatorId: currentUserId,
        });
        activeShapeRef.current = circle;
        canvas.add(circle);
        canvas.setActiveObject(circle);
      } else if (currentTool === 'text') {
        const text = new fabric.IText('Double-click to edit', {
          left: pointer.x,
          top: pointer.y,
          fill: currentStroke,
          fontSize: currentFontSize,
          fontFamily: 'Inter, sans-serif',
          id: crypto.randomUUID(),
          creatorId: currentUserId,
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        canvas.renderAll();
        
        setTimeout(() => {
          text.enterEditing();
          text.selectAll();
          canvas.renderAll();
        }, 50);

        setActiveTool('select');
        isDrawingRef.current = false;
      } else if (currentTool === 'sticky') {
        const sticky = new fabric.Textbox('Write note...', {
          left: pointer.x,
          top: pointer.y,
          width: 200,
          height: 200,
          fontSize: 16,
          fontFamily: 'Inter, sans-serif',
          fill: '#1e293b',
          backgroundColor: '#fef08a',
          padding: 20,
          splitByGrapheme: true,
          lockScalingFlip: true,
          shadow: new fabric.Shadow({
            color: 'rgba(0,0,0,0.1)',
            blur: 10,
            offsetX: 4,
            offsetY: 4,
          }),
          id: crypto.randomUUID(),
          creatorId: currentUserId,
        });

        canvas.add(sticky);
        canvas.setActiveObject(sticky);
        canvas.renderAll();

        setTimeout(() => {
          sticky.enterEditing();
          sticky.selectAll();
          canvas.renderAll();
        }, 50);

        setActiveTool('select');
        isDrawingRef.current = false;
      }
    });

    canvas.on('mouse:move', (options) => {
      if (!isDrawingRef.current || !startPointerRef.current || !activeShapeRef.current) return;

      const pointer = canvas.getPointer(options.e);
      const startPointer = startPointerRef.current;
      const activeShape = activeShapeRef.current;
      const { activeTool: currentTool } = stateRef.current;

      if (currentTool === 'rectangle') {
        const rect = activeShape as fabric.Rect;
        const left = Math.min(startPointer.x, pointer.x);
        const top = Math.min(startPointer.y, pointer.y);
        const width = Math.abs(startPointer.x - pointer.x);
        const height = Math.abs(startPointer.y - pointer.y);

        rect.set({ left, top, width, height });
      } else if (currentTool === 'circle') {
        const circle = activeShape as fabric.Circle;
        const width = Math.abs(startPointer.x - pointer.x);
        const height = Math.abs(startPointer.y - pointer.y);
        const radius = Math.max(width, height) / 2;

        const left = startPointer.x + (pointer.x > startPointer.x ? 0 : -radius * 2);
        const top = startPointer.y + (pointer.y > startPointer.y ? 0 : -radius * 2);

        circle.set({ left, top, radius });
      }

      activeShape.setCoords();
      canvas.requestRenderAll();
    });

    canvas.on('mouse:up', () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;

      const activeShape = activeShapeRef.current;
      if (activeShape) {
        const isTooSmall = 
          (activeShape.type === 'rect' && ((activeShape.width || 0) < 5 || (activeShape.height || 0) < 5)) ||
          (activeShape.type === 'circle' && (activeShape as fabric.Circle).radius! < 3);

        if (isTooSmall) {
          canvas.remove(activeShape);
        } else {
          activeShape.set({
            selectable: true,
            hasControls: true,
          });
          activeShape.setCoords();
          // Fire added event to sync with Yjs
          canvas.fire('object:added', { target: activeShape });
        }
      }

      activeShapeRef.current = null;
      startPointerRef.current = null;
      canvas.requestRenderAll();
    });

    // Delete keys
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObj = canvas.getActiveObject();
        if (activeObj && (activeObj as any).isEditing) {
          return;
        }

        const activeObjects = canvas.getActiveObjects();
        if (activeObjects && activeObjects.length > 0) {
          activeObjects.forEach((obj) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose();
      fabricCanvasRef.current = null;
      if (registerCanvasRef) {
        registerCanvasRef(null);
      }
    };
  }, [canvasObjectsMap]);

  // Synchronize Yjs Map -> Fabric Canvas (Remote changes observer)
  useEffect(() => {
    if (!canvasObjectsMap || !fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;

    console.log('[Yjs-Sync] Initializing Y.Doc map observer...');

    // Synchronize initial Y.Doc state to canvas
    isUpdatingFromYjsRef.current = true;
    
    // Clear local objects that are not in the Yjs map
    canvas.getObjects().forEach((obj) => {
      if (obj.id && !canvasObjectsMap.has(obj.id)) {
        canvas.remove(obj);
      }
    });

    const initialKeys = Array.from(canvasObjectsMap.keys());
    initialKeys.forEach((key: any) => {
      const val = canvasObjectsMap.get(key);
      const existing = canvas.getObjects().find((o) => o.id === key);
      
      if (existing) {
        existing.set(val);
        existing.setCoords();
      } else {
        fabric.util.enlivenObjects([val], (enlivened) => {
          const newObj = enlivened[0];
          if (!newObj) return;
          newObj.id = key;
          newObj.creatorId = val.creatorId;
          
          const dup = canvas.getObjects().find((o) => o.id === key);
          if (!dup) {
            canvas.add(newObj);
            canvas.renderAll();
          }
        });
      }
    });

    isUpdatingFromYjsRef.current = false;
    canvas.renderAll();

    // Map Event Listener for remote updates
    const observer = (event: any) => {
      // Ignore if transaction is local
      if (event.transaction.local) return;

      console.log('[Yjs-Sync] Remote update detected. Applying changes...');
      isUpdatingFromYjsRef.current = true;

      event.keys.forEach((change: any, key: string) => {
        if (change.action === 'add' || change.action === 'update') {
          const val = canvasObjectsMap.get(key);
          if (!val) return;

          const existing = canvas.getObjects().find((o) => o.id === key);
          if (existing) {
            existing.set(val);
            existing.setCoords();
            canvas.renderAll();
          } else {
            fabric.util.enlivenObjects([val], (enlivened) => {
              const newObj = enlivened[0];
              newObj.id = key;
              newObj.creatorId = val.creatorId;

              const dup = canvas.getObjects().find((o) => o.id === key);
              if (!dup) {
                canvas.add(newObj);
              } else {
                dup.set(val);
                dup.setCoords();
              }
              canvas.renderAll();
            });
          }
        } else if (change.action === 'delete') {
          const existing = canvas.getObjects().find((o) => o.id === key);
          if (existing) {
            canvas.remove(existing);
            canvas.renderAll();
          }
        }
      });

      isUpdatingFromYjsRef.current = false;
    };

    canvasObjectsMap.observe(observer);

    return () => {
      canvasObjectsMap.unobserve(observer);
    };
  }, [canvasObjectsMap]);

  // Handle active tool updates
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    if (activeTool === 'brush') {
      canvas.isDrawingMode = true;
      if (!canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      }
      canvas.freeDrawingBrush.color = strokeColor;
      canvas.freeDrawingBrush.width = strokeWidth;
    } else {
      canvas.isDrawingMode = false;
    }

    const isSelectMode = activeTool === 'select';
    canvas.forEachObject((obj) => {
      obj.selectable = isSelectMode;
      obj.hoverCursor = isSelectMode ? 'move' : 'crosshair';
    });

    if (!isSelectMode) {
      canvas.discardActiveObject();
    }

    canvas.requestRenderAll();
  }, [activeTool, strokeColor, strokeWidth]);

  // Handle dynamic theme changes
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const bg = theme === 'light' ? '#ffffff' : '#000000';
    canvas.setBackgroundColor(bg, () => {
      canvas.renderAll();
    });
  }, [theme]);

  // Sync strokeColor, fillColor, strokeWidth, and fontSize updates dynamically to selected canvas elements
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const activeObj = canvas.getActiveObject();
    if (activeObj) {
      let changed = false;

      // Handle Sticky Notes (Textbox) properties (locked yellow background)
      if (activeObj.type === 'textbox') {
        if (activeObj.fontSize !== fontSize) {
          activeObj.set('fontSize', fontSize);
          changed = true;
        }
      } else if (activeObj.type === 'i-text') {
        // Text values: fill controls color
        if (activeObj.fill !== strokeColor) {
          activeObj.set('fill', strokeColor);
          changed = true;
        }
        if (activeObj.fontSize !== fontSize) {
          activeObj.set('fontSize', fontSize);
          changed = true;
        }
      } else {
        // Shapes values
        if (activeObj.stroke !== strokeColor) {
          activeObj.set('stroke', strokeColor);
          changed = true;
        }
        if (activeObj.fill !== fillColor) {
          activeObj.set('fill', fillColor);
          changed = true;
        }
        if (activeObj.strokeWidth !== strokeWidth) {
          activeObj.set('strokeWidth', strokeWidth);
          changed = true;
        }
      }

      if (changed) {
        activeObj.setCoords();
        canvas.renderAll();
        canvas.fire('object:modified', { target: activeObj });
      }
    }
  }, [strokeColor, fillColor, strokeWidth, fontSize]);

  return (
    <div className="canvas-wrapper">
      <canvas ref={canvasRef} id="fabric-canvas" />
    </div>
  );
};
