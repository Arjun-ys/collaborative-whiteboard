import mongoose from 'mongoose';
import * as Y from 'yjs';
import { Board } from '../models/Board';

export const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/collaborative-whiteboard';
  console.log(`[DB] Connecting to MongoDB at ${mongoUri}...`);
  
  try {
    await mongoose.connect(mongoUri);
    console.log('[DB] Connected to MongoDB successfully.');
  } catch (error) {
    console.error('[DB] MongoDB connection failed:', error);
    process.exit(1);
  }
};

// Track pending debounce timeouts per room to avoid memory leaks and double saves
const pendingTimeouts = new Map<string, NodeJS.Timeout>();

// Custom Yjs Persistence interface matching y-websocket expectations
export const mongodbPersistence = {
  bindState: async (docName: string, doc: Y.Doc) => {
    console.log(`[DB-Persistence] Room created for doc "${docName}". Hydrating...`);
    
    // 1. Fetch existing board state from DB
    try {
      const board = await Board.findOne({ boardId: docName });
      if (board && board.yDocState) {
        // Apply the saved binary update to the Yjs doc
        Y.applyUpdate(doc, board.yDocState);
        console.log(`[DB-Persistence] Room "${docName}" successfully hydrated from MongoDB (${board.yDocState.byteLength} bytes).`);
      } else {
        console.log(`[DB-Persistence] Room "${docName}" not found in DB. Started clean session.`);
      }
    } catch (err) {
      console.error(`[DB-Persistence] Failed to hydrate board "${docName}":`, err);
    }

    const saveState = async () => {
      try {
        const update = Y.encodeStateAsUpdate(doc);
        const buffer = Buffer.from(update);
        
        await Board.findOneAndUpdate(
          { boardId: docName },
          { boardId: docName, yDocState: buffer },
          { upsert: true, new: true }
        );
        console.log(`[DB-Persistence] Saved board "${docName}" state to MongoDB (${buffer.byteLength} bytes).`);
      } catch (err) {
        console.error(`[DB-Persistence] Error saving board "${docName}" state:`, err);
      }
    };

    // Add state change listener
    doc.on('update', () => {
      const existingTimeout = pendingTimeouts.get(docName);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const timeoutId = setTimeout(() => {
        saveState();
        pendingTimeouts.delete(docName);
      }, 2500); // 2.5 seconds debounce
      pendingTimeouts.set(docName, timeoutId);
    });
  },

  writeState: async (docName: string, doc: Y.Doc) => {
    console.log(`[DB-Persistence] All users disconnected from room "${docName}". Saving final state...`);
    
    // Clear any pending debounce save to prevent duplicate saves/GC memory issues
    const pendingTimeout = pendingTimeouts.get(docName);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeouts.delete(docName);
    }

    try {
      const update = Y.encodeStateAsUpdate(doc);
      const buffer = Buffer.from(update);
      
      await Board.findOneAndUpdate(
        { boardId: docName },
        { boardId: docName, yDocState: buffer },
        { upsert: true }
      );
      console.log(`[DB-Persistence] Final state saved for room "${docName}". Room cleared from memory.`);
    } catch (err) {
      console.error(`[DB-Persistence] Error saving final state for room "${docName}":`, err);
    }
  }
};
