import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useStore } from '../store/useStore';

export const useYjs = () => {
  const { roomId, setConnected, setActiveUsers, userName } = useStore();
  const [yDoc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!roomId) return;

    // Backend server will run on port 5000 in Phase 3
    const wsUrl = `ws://${window.location.hostname}:5000`;
    console.log(`[Yjs] Connecting to ${wsUrl} for room ${roomId}...`);
    const wsProvider = new WebsocketProvider(wsUrl, roomId, yDoc);

    setProvider(wsProvider);

    // Sync status handler
    const statusHandler = (event: any) => {
      console.log(`[Yjs] Connection status: ${event.status}`);
      setConnected(event.status === 'connected');
    };
    wsProvider.on('status', statusHandler);

    // Awareness setup
    const awareness = wsProvider.awareness;
    awareness.setLocalStateField('user', {
      name: userName,
    });

    const awarenessHandler = () => {
      const states = Array.from(awareness.getStates().values());
      setActiveUsers(states.length || 1);
    };

    awareness.on('update', awarenessHandler);
    awarenessHandler();

    return () => {
      wsProvider.off('status', statusHandler);
      awareness.off('update', awarenessHandler);
      wsProvider.disconnect();
      yDoc.destroy();
      setConnected(false);
    };
  }, [yDoc, roomId]);

  // Push user name updates to awareness
  useEffect(() => {
    if (provider) {
      provider.awareness.setLocalStateField('user', {
        name: userName,
      });
    }
  }, [userName, provider]);

  return {
    yDoc,
    canvasObjectsMap: yDoc.getMap<any>('canvas-objects'),
    provider,
  };
};
