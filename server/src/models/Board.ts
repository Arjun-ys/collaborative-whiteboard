import { Schema, model } from 'mongoose';

export interface IBoard {
  boardId: string;
  yDocState: Buffer;
  createdAt?: Date;
  updatedAt?: Date;
}

const BoardSchema = new Schema<IBoard>(
  {
    boardId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    yDocState: {
      type: Schema.Types.Buffer as any,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Board = model<IBoard>('Board', BoardSchema);
