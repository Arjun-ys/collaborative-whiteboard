import React from 'react';
import { useStore } from '../store/useStore';
import { User } from 'lucide-react';

export const UserIdentity: React.FC = () => {
  const { userName, setUserName } = useStore();

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/70 dark:bg-zinc-950/75 backdrop-blur-md border border-slate-200/50 dark:border-zinc-800/60 shadow-xl text-slate-800 dark:text-slate-200">
      <User size={14} className="text-slate-400 dark:text-slate-500" />
      <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">As:</span>
      <input
        type="text"
        className="bg-transparent border-b border-dashed border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:border-purple-500 dark:focus:border-purple-400 focus:outline-none w-24 text-center transition-colors duration-150"
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        placeholder="Nickname"
        maxLength={15}
      />
    </div>
  );
};
