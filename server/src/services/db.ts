import mongoose from 'mongoose';
import { Board } from '../models/Board';

export const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/collaborative-whiteboard';
  console.log('[DB] Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('[DB] Connected to MongoDB.');
};

export const boardStorage = {
  load: async (boardId: string): Promise<Uint8Array | null> => {
    const board = await Board.findOne({ boardId });
    return board?.yDocState ?? null;
  },
  save: async (boardId: string, state: Uint8Array): Promise<void> => {
    await Board.findOneAndUpdate(
      { boardId },
      { boardId, yDocState: Buffer.from(state) },
      { upsert: true },
    );
  },
};
