import React from 'react';
import { useStore } from '../store/useStore';
import { Edit3 } from 'lucide-react';

export const PropertiesPanel: React.FC = () => {
  const {
    strokeColor,
    setStrokeColor,
    fillColor,
    setFillColor,
    strokeWidth,
    setStrokeWidth,
    fontSize,
    setFontSize,
    activeTool,
    isStickySelected,
  } = useStore();

  const strokeColors = [
    '#ffffff', // Pure White
    '#f3f4f6', // Light gray
    '#c084fc', // Purple
    '#60a5fa', // Blue
    '#34d399', // Green
    '#fb7185', // Rose
    '#fbbf24', // Amber
    '#f472b6', // Pink
    '#a78bfa', // Lavender
    '#1e293b', // Dark Slate
  ];

  const fillColors = [
    'transparent',
    '#fef08a', // Pastel Yellow
    '#bfdbfe', // Pastel Blue
    '#bbf7d0', // Pastel Green
    '#fbcfe8', // Pastel Pink
    '#e9d5ff', // Pastel Purple
    'rgba(192, 132, 252, 0.2)', // Trans Purple
    'rgba(96, 165, 250, 0.2)',  // Trans Blue
    '#c084fc', // Solid Purple
    '#60a5fa', // Solid Blue
  ];

  return (
    <div className="absolute top-6 right-6 z-10 w-64 p-5 rounded-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/50 dark:border-slate-800/50 shadow-2xl flex flex-col gap-5 text-slate-800 dark:text-slate-200">
      <div className="text-xs font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase border-b border-slate-200/50 dark:border-slate-800/50 pb-2 flex items-center gap-1.5">
        <Edit3 size={14} />
        <span>Canvas Settings</span>
      </div>

      {/* Stroke Color */}
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between items-center text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span>Stroke Color</span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/50 border border-slate-200/20 dark:border-slate-800/30">
            {strokeColor}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {strokeColors.map((color) => (
            <button
              key={color}
              className={`h-7 w-7 rounded-lg border-2 hover:scale-105 transition-all duration-100 cursor-pointer ${
                strokeColor === color
                  ? 'border-purple-500 scale-105 shadow-md shadow-purple-500/20'
                  : 'border-transparent hover:border-slate-300 dark:hover:border-slate-700'
              }`}
              style={{ backgroundColor: color }}
              onClick={() => setStrokeColor(color)}
              title={color}
            />
          ))}
        </div>
      </div>

      {/* Fill Color (Hidden for sticky notes since color is locked) */}
      {activeTool !== 'brush' && activeTool !== 'sticky' && !isStickySelected && (
        <div className="flex flex-col gap-2.5">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Fill / Note Color</span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/50 border border-slate-200/20 dark:border-slate-800/30">
              {fillColor === 'transparent' ? 'none' : fillColor}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {fillColors.map((color, index) => (
              <button
                key={index}
                className={`h-7 w-7 rounded-lg border-2 relative overflow-hidden hover:scale-105 transition-all duration-100 cursor-pointer flex items-center justify-center ${
                  fillColor === color
                    ? 'border-purple-500 scale-105 shadow-md shadow-purple-500/20'
                    : 'border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                }`}
                style={{
                  backgroundColor: color === 'transparent' ? 'transparent' : color,
                  borderStyle: color === 'transparent' ? 'dashed' : 'solid',
                  borderColor: color === 'transparent' ? 'rgba(156,163,175,0.4)' : undefined,
                }}
                onClick={() => setFillColor(color)}
                title={color === 'transparent' ? 'Transparent' : color}
              >
                {color === 'transparent' && (
                  <div className="w-8 h-[1px] bg-red-500 absolute rotate-45" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="h-[1px] bg-slate-200/50 dark:bg-slate-800/50 my-1" />

      {/* Stroke Width Slider */}
      {activeTool !== 'sticky' && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Stroke Thickness</span>
            <span className="font-mono text-purple-600 dark:text-purple-400 font-bold">{strokeWidth}px</span>
          </div>
          <input
            type="range"
            min="1"
            max="30"
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
            className="w-full mt-1.5"
          />
        </div>
      )}

      {/* Font Size Slider */}
      {(activeTool === 'text' || activeTool === 'sticky') && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Font Size</span>
            <span className="font-mono text-purple-600 dark:text-purple-400 font-bold">{fontSize}px</span>
          </div>
          <input
            type="range"
            min="12"
            max="72"
            value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value))}
            className="w-full mt-1.5"
          />
        </div>
      )}
    </div>
  );
};
