import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import { redis } from "~/redis.server";

let io: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return io;
}

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*", // Storefront widgets need cross-origin access
      methods: ["GET", "POST"],
    },
    path: "/socket.io/",
    transports: ["websocket", "polling"],
  });

  // Wire the Redis adapter so `io.to(room).emit(...)` is fanned out to every
  // PM2 cluster instance via Redis pub/sub. Without this, emitting from one
  // instance only reaches sockets connected to that same process.
  //
  // The adapter needs a dedicated pub and sub client — duplicate() reuses the
  // connection settings (REDIS_URL, auth) without sharing the command stream.
  try {
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    console.log("🔗 Socket.io Redis adapter connected");
  } catch (err) {
    console.error(
      "⚠️  Failed to attach Socket.io Redis adapter — running in single-instance mode:",
      err
    );
  }

  // Storefront namespace — FOMO popups
  io.on("connection", (socket) => {
    const shopId = socket.handshake.query.shopId as string;

    if (!shopId) {
      socket.disconnect();
      return;
    }

    // Join the shop's storefront room
    socket.join(`storefront:${shopId}`);

    socket.on("disconnect", () => {
      // Cleanup handled automatically by Socket.io
    });
  });

  console.log("🔌 Socket.io server initialized");
  return io;
}

/**
 * Emit a FOMO event to all connected storefront clients for a shop.
 * With the Redis adapter, this reaches every PM2 cluster instance.
 */
export function emitFomoEvent(
  shopId: string,
  event: {
    buyerName: string;
    productTitle: string;
    productId?: string;
    timestamp: string;
  },
) {
  if (!io) return;
  io.to(`storefront:${shopId}`).emit("fomo:purchase", event);
}

/**
 * Nginx WebSocket Configuration (for Task 20):
 *
 * The following Nginx configuration is required for WebSocket upgrade
 * on the /socket.io/ path:
 *
 * ```nginx
 * location /socket.io/ {
 *     proxy_pass http://127.0.0.1:3000;
 *     proxy_http_version 1.1;
 *     proxy_set_header Upgrade $http_upgrade;
 *     proxy_set_header Connection "upgrade";
 *     proxy_set_header Host $host;
 *     proxy_set_header X-Real-IP $remote_addr;
 *     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 *     proxy_set_header X-Forwarded-Proto $scheme;
 *     proxy_read_timeout 86400;
 * }
 * ```
 */
