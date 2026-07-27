import { create } from 'zustand';
import { swapThemeColor } from '../utils/themeColors';
import { createId } from '../utils/id';
import type { ConnectionState } from '../types/collaboration';

export type ToolType = 'select' | 'brush' | 'rectangle' | 'circle' | 'text' | 'sticky';

interface WhiteboardState {
  activeTool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  roomId: string;
  connectionState: ConnectionState;
  userId: string;
  userName: string;
  activeUsers: number;
  theme: 'light' | 'dark';
  isStickySelected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  
  setActiveTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setFontSize: (size: number) => void;
  setRoomId: (id: string) => void;
  setConnectionState: (status: ConnectionState) => void;
  setUserId: (id: string) => void;
  setUserName: (name: string) => void;
  setActiveUsers: (count: number) => void;
  toggleTheme: () => void;
  setIsStickySelected: (val: boolean) => void;
  setHistoryState: (state: { canUndo: boolean; canRedo: boolean }) => void;
}

// Generate a random username if not set
const adjectives = ['Sparkling', 'Silent', 'Swift', 'Bright', 'Clever', 'Creative', 'Nimble', 'Bold'];
const nouns = ['Fox', 'Panda', 'Koala', 'Owl', 'Tiger', 'Eagle', 'Dolphin', 'Otter'];
const getRandomName = () => {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
};

// Synchronously initialize the room ID from URL search query params
const getInitialRoomId = () => {
  if (typeof window === 'undefined') return 'default-room';
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room) return room;
  const randomRoom = Math.random().toString(36).substring(2, 9);
  window.history.replaceState({}, '', `?room=${randomRoom}`);
  return randomRoom;
};

export const useStore = create<WhiteboardState>((set) => ({
  activeTool: 'select',
  strokeColor: '#f3f4f6', // light gray — visible on dark default background
  fillColor: 'transparent',
  strokeWidth: 4,
  fontSize: 24,
  roomId: getInitialRoomId(),
  connectionState: 'connecting',
  userId: createId(),
  userName: getRandomName(),
  activeUsers: 1,
  theme: 'dark', // default theme is dark
  isStickySelected: false,
  canUndo: false,
  canRedo: false,

  setActiveTool: (tool) => set({ activeTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setFontSize: (size) => set({ fontSize: size }),
  setRoomId: (id) => set({ roomId: id }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setUserId: (id) => set({ userId: id }),
  setUserName: (name) => set({ userName: name }),
  setActiveUsers: (count) => set({ activeUsers: count }),
  setIsStickySelected: (val) => set({ isStickySelected: val }),
  setHistoryState: (historyState) => set(historyState),
  
  // Swap pairs are imported from utils/themeColors (single source of truth — AGENTS.md Rule #4)
  toggleTheme: () => set((state) => {
    const nextTheme = state.theme === 'light' ? 'dark' : 'light';

    const swap = (color: string): string => {
      return swapThemeColor(color, nextTheme) ?? color;
    };

    return {
      theme: nextTheme,
      strokeColor: swap(state.strokeColor),
      fillColor:   swap(state.fillColor),
    };
  }),
}));
