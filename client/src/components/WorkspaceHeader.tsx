import React from 'react';
import {
  Check,
  Download,
  Link2,
  Moon,
  Redo2,
  Sun,
  Undo2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { CanvasController } from '../types/whiteboard';
import { toast } from './Toast';

interface WorkspaceHeaderProps {
  controller: CanvasController | null;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({ controller }) => {
  const {
    connectionState,
    roomId,
    activeUsers,
    theme,
    toggleTheme,
    userName,
    setUserName,
    canUndo,
    canRedo,
  } = useStore();
  const [copied, setCopied] = React.useState(false);

  const connectionCopy = {
    connecting: 'Connecting',
    synced: 'Synced',
    reconnecting: 'Reconnecting',
    offline: 'Offline',
  } as const;
  const isSynced = connectionState === 'synced';

  const copyRoomLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(window.location.href);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = window.location.href;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copiedByFallback = document.execCommand('copy');
        textarea.remove();
        if (!copiedByFallback) throw new Error('Copy is not supported');
      }
      setCopied(true);
      toast.success('Room link copied');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the room link');
    }
  };

  return (
    <header className="workspace-header">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">cw</div>
        <div className="brand-copy">
          <span className="eyebrow">Collaborative</span>
          <span className="brand-name">Whiteboard</span>
        </div>
      </div>

      <div className="header-divider" aria-hidden="true" />

      <div className="room-summary">
        <span className="room-label">Live room</span>
        <span className="room-id">{roomId}</span>
        <span className={`connection-pill ${isSynced ? 'is-connected' : 'is-connecting'} ${connectionState === 'offline' ? 'is-offline' : ''}`}>
          {isSynced ? <Wifi size={13} /> : <WifiOff size={13} />}
          {connectionCopy[connectionState]}
        </span>
      </div>

      <div className="header-actions">
        <div className="history-actions" aria-label="History controls">
          <button className="icon-button" onClick={controller?.undo} disabled={!controller || !canUndo} aria-label="Undo" title="Undo (Ctrl/Cmd + Z)">
            <Undo2 size={17} />
          </button>
          <button className="icon-button" onClick={controller?.redo} disabled={!controller || !canRedo} aria-label="Redo" title="Redo (Ctrl/Cmd + Shift + Z)">
            <Redo2 size={17} />
          </button>
        </div>

        <button className="secondary-button share-button" onClick={copyRoomLink}>
          {copied ? <Check size={15} /> : <Link2 size={15} />}
          <span>{copied ? 'Copied' : 'Share'}</span>
        </button>
        <button className="secondary-button export-button" onClick={controller?.exportPng} disabled={!controller}>
          <Download size={15} />
          <span>Export</span>
        </button>

        <div className="presence-summary" title={`${activeUsers} active collaborator${activeUsers === 1 ? '' : 's'}`}>
          <span className="presence-icon"><Users size={15} /></span>
          <span>{activeUsers}</span>
        </div>

        <div className="header-divider compact" aria-hidden="true" />

        <label className="identity-field">
          <span className="avatar-badge">{(userName || '?').slice(0, 1).toUpperCase()}</span>
          <input value={userName} onChange={(event) => setUserName(event.target.value)} maxLength={15} placeholder="Your name" aria-label="Your display name" />
        </label>

        <button className="icon-button theme-button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </button>
      </div>
    </header>
  );
};
