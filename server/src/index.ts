import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { EV, type FireRequest, type PlayerStateUpdate } from './shared/protocol';
import type { SlotId } from './shared/constants';
import { RoomManager } from './RoomManager';

const PORT = Number(process.env.PORT ?? 3001);

// The client is hosted elsewhere (Vercel), so its origins must be allowed
// explicitly. Comma-separated; '*' opens it up, which is fine for local dev.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

const manager = new RoomManager(io);
manager.start();

// Render pings this to keep the instance healthy; it doubles as a liveness
// probe you can hit from a uptime monitor to stop the free tier idling out.
app.get('/health', (_req, res) => {
  res.json({ ok: true, ...manager.stats() });
});

app.get('/', (_req, res) => {
  res.type('text').send('Spoider Man game server. The client is hosted separately.');
});

io.on('connection', (socket) => {
  socket.on(EV.JOIN, () => {
    // Already in a room? Ignore duplicate joins from a reconnecting client.
    if (manager.roomFor(socket.id)) return;

    const room = manager.assignRoom();
    const player = room.addPlayer(socket.id);
    socket.join(room.id);

    socket.emit(EV.JOINED, {
      selfId: socket.id,
      roomId: room.id,
      name: player.name,
      color: player.color,
      spawn: player.pos,
    });
    room.sendSelf(player);
    console.log(`[join] ${player.name} -> ${room.id} (${room.playerCount}/5)`);
  });

  socket.on(EV.STATE, (update: PlayerStateUpdate) => {
    manager.roomFor(socket.id)?.onState(socket.id, update);
  });

  socket.on(EV.FIRE, (req: FireRequest) => {
    manager.roomFor(socket.id)?.onFire(socket.id, req);
  });

  socket.on(EV.RELOAD, () => {
    manager.roomFor(socket.id)?.onReload(socket.id);
  });

  socket.on(EV.SWITCH, (payload: { slot: SlotId | 'cycle'; pickupId?: string }) => {
    manager.roomFor(socket.id)?.onSwitch(socket.id, payload?.slot ?? 'cycle', payload?.pickupId);
  });

  socket.on(EV.PICKUP, (payload: { id: string }) => {
    if (payload?.id) manager.roomFor(socket.id)?.onPickup(socket.id, payload.id);
  });

  socket.on(EV.FELL, () => {
    manager.roomFor(socket.id)?.onFell(socket.id);
  });

  socket.on('disconnect', () => {
    const room = manager.roomFor(socket.id);
    if (!room) return;
    room.removePlayer(socket.id);
    console.log(`[leave] ${socket.id} left ${room.id} (${room.playerCount}/5)`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Spoider Man server listening on http://localhost:${PORT}`);
});
