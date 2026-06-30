import { create } from 'zustand';

export type ToolType = 'select' | 'brush' | 'rectangle' | 'circle' | 'text' | 'sticky';

interface WhiteboardState {
  activeTool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  roomId: string;
  connected: boolean;
  userId: string;
  userName: string;
  activeUsers: number;
  theme: 'light' | 'dark';
  isStickySelected: boolean;
  
  setActiveTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setFontSize: (size: number) => void;
  setRoomId: (id: string) => void;
  setConnected: (status: boolean) => void;
  setUserId: (id: string) => void;
  setUserName: (name: string) => void;
  setActiveUsers: (count: number) => void;
  toggleTheme: () => void;
  setIsStickySelected: (val: boolean) => void;
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
  connected: false,
  userId: crypto.randomUUID(),
  userName: getRandomName(),
  activeUsers: 1,
  theme: 'dark', // default theme is dark
  isStickySelected: false,

  setActiveTool: (tool) => set({ activeTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setFontSize: (size) => set({ fontSize: size }),
  setRoomId: (id) => set({ roomId: id }),
  setConnected: (status) => set({ connected: status }),
  setUserId: (id) => set({ userId: id }),
  setUserName: (name) => set({ userName: name }),
  setActiveUsers: (count) => set({ activeUsers: count }),
  setIsStickySelected: (val) => set({ isStickySelected: val }),
  
  toggleTheme: () => set((state) => {
    const nextTheme = state.theme === 'light' ? 'dark' : 'light';

    // Pairs of [darkModeColor, lightModeColor] to swap when toggling
    const swapPairs: [string, string][] = [
      ['#ffffff', '#000000'],   // pure white ↔ pure black
      ['#f3f4f6', '#1e293b'],   // light gray ↔ dark slate (primary ink pair)
      ['#f8fafc', '#0f172a'],   // near-white ↔ near-black
      ['#e2e8f0', '#334155'],   // cool gray ↔ slate-700
    ];

    const swap = (color: string): string => {
      for (const [dark, light] of swapPairs) {
        if (nextTheme === 'light' && color === dark) return light;
        if (nextTheme === 'dark'  && color === light) return dark;
      }
      return color; // any other color (purple, red, etc.) is left unchanged
    };

    return {
      theme: nextTheme,
      strokeColor: swap(state.strokeColor),
      fillColor:   swap(state.fillColor),
    };
  }),
}));
