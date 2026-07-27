import React from 'react';
import { MousePointer, Brush, Square, Circle, Type, StickyNote, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { ToolType } from '../store/useStore';

interface ToolbarProps {
  onClearCanvas: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onClearCanvas }) => {
  const { activeTool, setActiveTool } = useStore();

  const tools: { type: ToolType; icon: React.ReactNode; label: string; tooltip: string }[] = [
    { type: 'select', icon: <MousePointer size={18} />, label: 'Select', tooltip: 'Select & Move (V)' },
    { type: 'brush', icon: <Brush size={18} />, label: 'Draw', tooltip: 'Freehand Paint (D)' },
    { type: 'rectangle', icon: <Square size={18} />, label: 'Rectangle', tooltip: 'Rectangle (R)' },
    { type: 'circle', icon: <Circle size={18} />, label: 'Circle', tooltip: 'Circle (C)' },
    { type: 'text', icon: <Type size={18} />, label: 'Text', tooltip: 'Text (T)' },
    { type: 'sticky', icon: <StickyNote size={18} />, label: 'Sticky Note', tooltip: 'Sticky Note (N)' },
  ];

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 p-2 rounded-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/50 dark:border-slate-800/50 shadow-2xl">
      {tools.map((tool) => {
        const isActive = activeTool === tool.type;
        return (
          <div key={tool.type} className="relative group">
            <button
              onClick={() => setActiveTool(tool.type)}
              className={`p-3 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 ${
                isActive
                  ? 'bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400 border border-purple-200/30 dark:border-purple-800/35 shadow-md shadow-purple-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-800 dark:hover:text-slate-100'
              }`}
              aria-label={tool.label}
            >
              {tool.icon}
            </button>
            {/* Tooltip */}
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white border border-slate-700/30 dark:border-slate-700/50 text-[10px] font-semibold tracking-wide whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:translate-y-[-4px] transition-all duration-200">
              {tool.tooltip}
            </div>
          </div>
        );
      })}
      
      <div className="h-5 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />

      {/* Clear Button */}
      <div className="relative group">
        <button
          onClick={onClearCanvas}
          className="p-3 rounded-xl flex items-center justify-center text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/30 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200 hover:scale-105 active:scale-95"
          aria-label="Clear Canvas"
        >
          <Trash2 size={18} />
        </button>
        {/* Tooltip */}
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white border border-slate-700/30 dark:border-slate-700/50 text-[10px] font-semibold tracking-wide whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:translate-y-[-4px] transition-all duration-200">
          Clear Board
        </div>
      </div>
    </div>
  );
};
