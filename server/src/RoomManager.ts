import type { Server } from 'socket.io';
import { ROOM_GRACE_MS, SERVER_TICK_HZ } from './shared/constants';
import { Room } from './Room';

/**
 * Capacity-based room assignment — no matchmaking, first room with a free slot
 * wins. All state is in-memory for the life of the process.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private nextRoomNumber = 1;
  private timer: NodeJS.Timeout | null = null;

  constructor(private io: Server) {}

  start(): void {
    if (this.timer) return;
    const interval = Math.round(1000 / SERVER_TICK_HZ);
    this.timer = setInterval(() => this.tick(), interval);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** First room under capacity, or a brand new one. */
  assignRoom(): Room {
    for (const room of this.rooms.values()) {
      if (!room.isFull) return room;
    }
    const id = `room-${this.nextRoomNumber++}`;
    const room = new Room(id, this.io);
    this.rooms.set(id, room);
    console.log(`[rooms] created ${id}`);
    return room;
  }

  roomFor(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.getPlayer(socketId)) return room;
    }
    return undefined;
  }

  private tick(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      room.tick();
      // Empty rooms linger briefly, then their state is dropped entirely.
      if (room.playerCount === 0 && room.emptySince !== null && now - room.emptySince > ROOM_GRACE_MS) {
        this.rooms.delete(id);
        console.log(`[rooms] tore down ${id}`);
      }
    }
  }

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const room of this.rooms.values()) players += room.playerCount;
    return { rooms: this.rooms.size, players };
  }
}
