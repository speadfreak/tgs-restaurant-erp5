import { Server } from "socket.io";
import type { Server as HttpServer } from "http";

let _io: Server | null = null;

export function initSocket(httpServer: HttpServer): Server {
  _io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["polling", "websocket"],
  });

  _io.on("connection", (socket) => {
    socket.on("join:branch", (branchId: number) => {
      socket.join(`branch:${branchId}`);
      socket.join(`branch:${branchId}:kitchen`);
      socket.join(`branch:${branchId}:delivery`);
      socket.join(`branch:${branchId}:admin`);
    });
    socket.on("join:user", (userId: number) => {
      socket.join(`user:${userId}`);
    });
    // Public order tracking — customers join a room for their specific order code
    socket.on("join:order", (orderCode: string) => {
      socket.join(`order:${orderCode}`);
    });
  });

  return _io;
}

export function getIO(): Server {
  if (!_io) throw new Error("Socket.IO not initialized — call initSocket first");
  return _io;
}
