import React from 'react';
import { useStore } from '../store/useStore';
import { Sun, Moon, Link } from 'lucide-react';
import { toast } from '../utils/notifications';

export const ConnectionStatus: React.FC = () => {
  const { connectionState, roomId, activeUsers, theme, toggleTheme } = useStore();
  const connected = connectionState === 'synced';

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Room link copied to clipboard!');
  };

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/70 dark:bg-zinc-950/75 backdrop-blur-md border border-slate-200/50 dark:border-zinc-800/60 shadow-xl text-slate-800 dark:text-slate-200">
        {/* Status Dot */}
        <div className="relative flex h-2 w-2">
          {connected ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </>
          ) : (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </>
          )}
        </div>

        {/* Room Info */}
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
          <span className="text-slate-400 dark:text-slate-500 font-medium">Room:</span>
          <span className="text-slate-800 dark:text-slate-100 font-bold">{roomId}</span>
        </div>

        {/* Action Copy Link */}
        <button
          onClick={copyRoomLink}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-150"
          title="Copy room link to share"
        >
          <Link size={14} />
        </button>

        <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800" />

        {/* Active Users Count */}
        <div className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          {activeUsers} active
        </div>
      </div>

      {/* Theme Toggle Button */}
      <button
        onClick={toggleTheme}
        className="p-2.5 rounded-2xl bg-white/70 dark:bg-zinc-950/75 backdrop-blur-md border border-slate-200/50 dark:border-zinc-800/60 shadow-xl text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 hover:scale-105 active:scale-95 transition-all duration-200"
        aria-label="Toggle Theme"
        title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
      >
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>
    </>
  );
};
