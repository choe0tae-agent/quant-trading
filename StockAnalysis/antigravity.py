# -*- coding: utf-8 -*-
"""
Antigravity UI/Backend Integration Wrapper
- Acts as a custom micro-framework backing the python-based desktop/web stock dashboard.
- Hosts a FastAPI server, WebSocket hub, and launches default browser.
"""

import asyncio
import json
import logging
import os
import webbrowser
from typing import Any, Callable, Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Antigravity")

class Component:
    def __init__(self) -> None:
        self.app: Optional['App'] = None
        self.name: str = self.__class__.__name__

    def set_app(self, app: 'App') -> None:
        self.app = app

    async def emit(self, event_type: str, data: Dict[str, Any]) -> None:
        """Send a component-scoped event to the frontend UI."""
        if self.app:
            await self.app.broadcast({
                "component": self.name,
                "event": event_type,
                "data": data
            })

class GridLayout:
    def __init__(self, rows: int, cols: int) -> None:
        self.rows = rows
        self.cols = cols

class App:
    def __init__(self) -> None:
        self.title: str = "Antigravity App"
        self.layout: Optional[GridLayout] = None
        self.components: Dict[str, Component] = {}
        self.active_connections: List[WebSocket] = []
        self.event_handlers: Dict[str, List[Callable[[Dict[str, Any]], Any]]] = {}
        self.fastapi_app = FastAPI()

    def setup(self) -> None:
        """To be overridden by subclasses to configure components."""
        pass

    def add_component(self, component: Component, row: int, col: int, rowspan: int = 1, colspan: int = 1) -> None:
        component.set_app(self)
        self.components[component.name] = component
        logger.info(f"Registered component: {component.name} at grid row={row}, col={col} (span {rowspan}x{colspan})")

    def register_event(self, event_name: str, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Register a handler callback for incoming frontend websocket events."""
        if event_name not in self.event_handlers:
            self.event_handlers[event_name] = []
        self.event_handlers[event_name].append(handler)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast a message payload to all connected clients."""
        if not self.active_connections:
            return
        
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                dead_connections.append(connection)
                
        for dead in dead_connections:
            if dead in self.active_connections:
                self.active_connections.remove(dead)

    def run(self, host: str = "127.0.0.1", port: int = 5859) -> None:
        """Set up routes, launch FastAPI, run the uvicorn server, and open default browser."""
        self.setup()
        
        @self.fastapi_app.on_event("startup")
        async def startup_event():
            if hasattr(self, "on_startup"):
                if asyncio.iscoroutinefunction(self.on_startup):
                    await self.on_startup()
                else:
                    self.on_startup()
        
        @self.fastapi_app.get("/")
        async def get_index():
            static_dir = os.path.join(os.path.dirname(__file__), "static")
            index_path = os.path.join(static_dir, "index.html")
            if not os.path.exists(index_path):
                return HTMLResponse("<h3>index.html not found in static/ directory.</h3>", status_code=404)
            with open(index_path, "r", encoding="utf-8") as f:
                return HTMLResponse(f.read())

        @self.fastapi_app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()
            self.active_connections.append(websocket)
            logger.info("Frontend WebSocket client connected.")
            
            # Send initial handshaking / system metadata
            try:
                await websocket.send_text(json.dumps({
                    "event": "sys_sync",
                    "data": {
                        "title": self.title,
                        "components": list(self.components.keys())
                    }
                }))
                
                # Command loop
                while True:
                    data = await websocket.receive_text()
                    payload = json.loads(data)
                    event_name = payload.get("event")
                    event_data = payload.get("data", {})
                    
                    if event_name in self.event_handlers:
                        for handler in self.event_handlers[event_name]:
                            if asyncio.iscoroutinefunction(handler):
                                asyncio.create_task(handler(event_data))
                            else:
                                handler(event_data)
            except WebSocketDisconnect:
                logger.info("Frontend WebSocket client disconnected.")
            except Exception as e:
                logger.error(f"WebSocket execution error: {e}")
            finally:
                if websocket in self.active_connections:
                    self.active_connections.remove(websocket)

        # Mount static asset directory
        static_dir = os.path.join(os.path.dirname(__file__), "static")
        if not os.path.exists(static_dir):
            os.makedirs(static_dir, exist_ok=True)
        self.fastapi_app.mount("/static", StaticFiles(directory=static_dir), name="static")

        def open_browser():
            try:
                webbrowser.open(f"http://{host}:{port}")
            except Exception as e:
                logger.error(f"Failed to automatically launch browser: {e}")

        # Schedule automatic browser launch
        loop = asyncio.get_event_loop()
        loop.call_later(1.5, open_browser)
        
        logger.info(f"Starting server on http://{host}:{port} ...")
        config = uvicorn.Config(app=self.fastapi_app, host=host, port=port, log_level="warning")
        server = uvicorn.Server(config)
        loop.run_until_complete(server.serve())
