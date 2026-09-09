"""Small in-process event broker for dashboard WebSocket updates."""
 
import asyncio

from fastapi import WebSocket  # type: ignore[reportMissingImports]


class RealtimeConnectionManager:
    def __init__(self):
        self.connections: set[WebSocket] = set()
        self._event_loop: asyncio.AbstractEventLoop | None = None
 
    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._event_loop = asyncio.get_running_loop()
        self.connections.add(websocket)
 
    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)
 
    async def broadcast(self, event: dict) -> None:
        stale_connections = []
        for websocket in tuple(self.connections):
            try:
                await websocket.send_json(event)
            except Exception:
                stale_connections.append(websocket)
        for websocket in stale_connections:
            self.disconnect(websocket)
 
    def publish(self, event: dict) -> None:
        """Publish safely from FastAPI's synchronous route handlers."""
        if self._event_loop and self._event_loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(event), self._event_loop)
 
 
realtime_connections = RealtimeConnectionManager()
 
 