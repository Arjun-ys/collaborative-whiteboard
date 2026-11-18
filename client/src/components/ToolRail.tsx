import React from 'react';
import {
  Brush,
  Circle,
  MousePointer2,
  PenLine,
  Square,
  StickyNote,
  Trash2,
  Type,
  Hand,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { ToolType } from '../store/useStore';

interface ToolRailProps {
  onClear: () => void;
}

const tools: { type: ToolType; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { type: 'select', icon: <MousePointer2 size={18} />, label: 'Select', shortcut: 'V' },
  { type: 'pan', icon: <Hand size={18} />, label: 'Pan', shortcut: 'H' },
  { type: 'brush', icon: <Brush size={18} />, label: 'Draw', shortcut: 'D' },
  { type: 'rectangle', icon: <Square size={18} />, label: 'Rectangle', shortcut: 'R' },
  { type: 'circle', icon: <Circle size={18} />, label: 'Circle', shortcut: 'C' },
  { type: 'text', icon: <Type size={18} />, label: 'Text', shortcut: 'T' },
  { type: 'sticky', icon: <StickyNote size={18} />, label: 'Sticky note', shortcut: 'N' },
];

export const ToolRail: React.FC<ToolRailProps> = ({ onClear }) => {
  const { activeTool, setActiveTool } = useStore();

  return (
    <aside className="tool-rail" aria-label="Drawing tools">
      <div className="rail-heading">
        <PenLine size={16} />
        <span>Tools</span>
      </div>
      <div className="tool-list">
        {tools.map((tool) => {
          const active = activeTool === tool.type;
          return (
            <button
              key={tool.type}
              className={`tool-button ${active ? 'is-active' : ''}`}
              onClick={() => setActiveTool(tool.type)}
              aria-label={`${tool.label}, shortcut ${tool.shortcut}`}
              aria-pressed={active}
              title={`${tool.label} (${tool.shortcut})`}
            >
              <span className="tool-icon">{tool.icon}</span>
              <span className="tool-label">{tool.label}</span>
              <kbd>{tool.shortcut}</kbd>
            </button>
          );
        })}
      </div>
      <div className="rail-spacer" />
      <button className="tool-button danger-button" onClick={onClear} aria-label="Clear board" title="Clear board">
        <span className="tool-icon"><Trash2 size={18} /></span>
        <span className="tool-label">Clear board</span>
      </button>
      <div className="rail-hint">⌘Z to undo</div>
    </aside>
  );
};
