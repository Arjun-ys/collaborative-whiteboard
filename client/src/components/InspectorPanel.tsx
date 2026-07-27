import React from 'react';
import { ChevronRight, Edit3, SlidersHorizontal, X } from 'lucide-react';
import { useStore } from '../store/useStore';

interface InspectorPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

const strokeColors = ['#f8fafc', '#cbd5e1', '#a78bfa', '#60a5fa', '#34d399', '#fb7185', '#fbbf24', '#f472b6', '#1e293b'];
const fillColors = ['transparent', '#fef08a', '#bfdbfe', '#bbf7d0', '#fbcfe8', '#e9d5ff', 'rgba(167, 139, 250, 0.22)', 'rgba(96, 165, 250, 0.22)'];

export const InspectorPanel: React.FC<InspectorPanelProps> = ({ isOpen, onToggle }) => {
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

  const showFill = activeTool !== 'brush' && activeTool !== 'sticky' && !isStickySelected;
  const showFont = activeTool === 'text' || activeTool === 'sticky' || isStickySelected;
  const activeLabel = activeTool === 'select' ? 'Selection' : activeTool[0].toUpperCase() + activeTool.slice(1);

  if (!isOpen) {
    return <button className="inspector-reopen" onClick={onToggle} aria-label="Open settings" title="Open settings"><ChevronRight size={17} /></button>;
  }

  return (
    <aside className="inspector-panel" aria-label="Canvas settings">
      <div className="inspector-drag-handle" aria-hidden="true" />
      <div className="inspector-header">
        <div>
          <div className="eyebrow"><SlidersHorizontal size={13} /> Inspector</div>
          <h2>{activeLabel}</h2>
        </div>
        <button className="icon-button subtle" onClick={onToggle} aria-label="Collapse settings" title="Collapse settings"><X size={16} /></button>
      </div>

      <div className="inspector-body">
        <section className="setting-section">
          <div className="setting-label-row"><span>Stroke</span><code>{strokeColor}</code></div>
          <div className="swatch-grid" role="group" aria-label="Stroke color">
            {strokeColors.map((color) => <button key={color} className={`color-swatch ${strokeColor === color ? 'is-selected' : ''}`} style={{ backgroundColor: color }} onClick={() => setStrokeColor(color)} aria-label={`Set stroke color ${color}`} aria-pressed={strokeColor === color} />)}
          </div>
        </section>

        {showFill && (
          <section className="setting-section">
            <div className="setting-label-row"><span>Fill</span><code>{fillColor === 'transparent' ? 'none' : fillColor}</code></div>
            <div className="swatch-grid" role="group" aria-label="Fill color">
              {fillColors.map((color) => <button key={color} className={`color-swatch ${color === 'transparent' ? 'transparent-swatch' : ''} ${fillColor === color ? 'is-selected' : ''}`} style={{ backgroundColor: color === 'transparent' ? undefined : color }} onClick={() => setFillColor(color)} aria-label={color === 'transparent' ? 'No fill' : `Set fill color ${color}`} aria-pressed={fillColor === color}>{color === 'transparent' && <span />}</button>)}
            </div>
          </section>
        )}

        {activeTool !== 'sticky' && (
          <section className="setting-section slider-section">
            <div className="setting-label-row"><span>Thickness</span><strong>{strokeWidth}px</strong></div>
            <input type="range" min="1" max="30" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} aria-label="Stroke thickness" />
          </section>
        )}

        {showFont && (
          <section className="setting-section slider-section">
            <div className="setting-label-row"><span>Font size</span><strong>{fontSize}px</strong></div>
            <input type="range" min="12" max="72" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="Font size" />
          </section>
        )}
      </div>

      <div className="inspector-footer"><Edit3 size={14} /><span>Click the canvas to create</span></div>
    </aside>
  );
};
