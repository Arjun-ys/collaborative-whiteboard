import * as Y from 'yjs';

interface Storage {
  load: (name: string) => Promise<Uint8Array | null>;
  save: (name: string, state: Uint8Array) => Promise<void>;
}

interface Options {
  createDoc?: (name: string) => Y.Doc;
  disposeDoc?: (name: string, doc: Y.Doc) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  retryMs?: number;
  onError?: (error: unknown, name: string) => void;
}

interface Room {
  name: string;
  doc: Y.Doc;
  ready: Promise<void>;
  references: number;
  version: number;
  savedVersion: number;
  writes: Promise<void>;
  debounce?: NodeJS.Timeout;
  deadline?: NodeJS.Timeout;
  retry?: NodeJS.Timeout;
  onUpdate: () => void;
}

// Keep a room alive until its last snapshot is durable. Immediate rejoin uses
// this document even while its final write is still pending.
export class RoomPersistence {
  private readonly rooms = new Map<string, Room>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly retryMs: number;

  constructor(private readonly storage: Storage, private readonly options: Options = {}) {
    this.debounceMs = options.debounceMs ?? 2500;
    this.maxWaitMs = options.maxWaitMs ?? 10_000;
    this.retryMs = options.retryMs ?? 2500;
  }

  async acquire(name: string): Promise<{ doc: Y.Doc; release: () => Promise<void> }> {
    let room = this.rooms.get(name);
    if (!room) {
      const doc = this.options.createDoc?.(name) ?? new Y.Doc();
      room = {
        name, doc, ready: Promise.resolve(), references: 0,
        version: 0, savedVersion: 0, writes: Promise.resolve(), onUpdate: () => {},
      };
      const current = room;
      current.onUpdate = () => {
        current.version += 1;
        this.schedule(current);
      };
      this.rooms.set(name, current);
      current.ready = (async () => {
        const state = await this.storage.load(name);
        if (state) Y.applyUpdate(doc, state);
        // Connections await ready, so edits cannot bypass this listener.
        doc.on('update', current.onUpdate);
      })();
    }
    room.references += 1;
    try {
      await room.ready;
    } catch (error) {
      room.references -= 1;
      if (room.references === 0) this.dispose(room);
      throw error;
    }
    let released = false;
    return {
      doc: room.doc,
      release: async () => {
        if (released) return;
        released = true;
        room.references -= 1;
        if (room.references === 0) await this.saveAndCollect(room);
      },
    };
  }

  private cancelTimers(room: Room) {
    clearTimeout(room.debounce);
    clearTimeout(room.deadline);
    clearTimeout(room.retry);
    room.debounce = room.deadline = room.retry = undefined;
  }

  private schedule(room: Room) {
    clearTimeout(room.debounce);
    room.debounce = setTimeout(() => void this.saveAndCollect(room), this.debounceMs);
    room.deadline ??= setTimeout(() => void this.saveAndCollect(room), this.maxWaitMs);
  }

  private flush(room: Room): Promise<void> {
    this.cancelTimers(room);
    // Encode at execution time; serialize writes without poisoning the queue
    // on a failed operation.
    const write = room.writes.catch(() => {}).then(async () => {
      if (room.savedVersion === room.version) return;
      const version = room.version;
      await this.storage.save(room.name, Y.encodeStateAsUpdate(room.doc));
      room.savedVersion = version;
    });
    room.writes = write;
    return write;
  }

  private async saveAndCollect(room: Room): Promise<void> {
    if (this.rooms.get(room.name) !== room) return;
    try {
      await this.flush(room);
      if (this.rooms.get(room.name) === room && room.references === 0 && room.savedVersion === room.version) this.dispose(room);
    } catch (error) {
      this.options.onError?.(error, room.name);
      room.retry ??= setTimeout(() => {
        room.retry = undefined;
        void this.saveAndCollect(room);
      }, this.retryMs);
    }
  }

  private dispose(room: Room) {
    if (this.rooms.get(room.name) !== room) return;
    this.cancelTimers(room);
    room.doc.off('update', room.onUpdate);
    this.rooms.delete(room.name);
    this.options.disposeDoc?.(room.name, room.doc);
    room.doc.destroy();
  }

  async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.rooms.values(), async (room) => {
      await room.ready;
      do { await this.flush(room); } while (room.savedVersion !== room.version);
    }));
  }

  get pendingRooms(): number {
    return Array.from(this.rooms.values()).filter((room) => room.version !== room.savedVersion).length;
  }
}
