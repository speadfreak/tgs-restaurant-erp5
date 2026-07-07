import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

// In production the frontend (static site) and API live on different domains.
// VITE_API_URL is the full URL of the API service; fall back to same-origin
// for local dev where the Vite proxy forwards /api → localhost:8080.
// Treat an empty/whitespace value the same as unset.
const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const apiBase: string = rawApiUrl || window.location.origin;

let _socket: Socket | null = null;

function getSocket(): Socket {
  if (!_socket) {
    _socket = io(apiBase, {
      path: "/api/socket.io",
      transports: ["polling", "websocket"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      withCredentials: true,
    });
  }
  return _socket;
}

export function useSocket(options?: { branchId?: number; userId?: number }) {
  const socketRef = useRef<Socket>(getSocket());

  useEffect(() => {
    const s = socketRef.current;

    function doJoin() {
      if (options?.branchId) s.emit("join:branch", options.branchId);
      if (options?.userId) s.emit("join:user", options.userId);
    }

    // Re-join rooms on every connect (initial + every reconnect after server restart)
    s.on("connect", doJoin);

    if (!s.connected) {
      s.connect();
    } else {
      doJoin();
    }

    return () => {
      s.off("connect", doJoin);
    };
  }, [options?.branchId, options?.userId]);

  return socketRef.current;
}
