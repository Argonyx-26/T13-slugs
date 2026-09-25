"""Start the orchestrator inside a Kaggle notebook - no nest_asyncio, no blocked cell.

uvicorn runs in a background thread with its own event loop, so the notebook stays
usable (check /ready, run nvidia-smi) and the "event loop already running" error
from kaggle_stack.md cannot happen. The ngrok static dev domain keeps the public
URL identical across restarts, so the Flutter app never needs a new URL.

Notebook cell:
    import os, sys
    sys.path.insert(0, "/kaggle/working/<repo>/backend")
    os.chdir("/kaggle/working/<repo>/backend")
    from scripts.kaggle_launch import start, stop
    server, url = start()                 # prints the public URL
"""
import os
import threading
import time


def start(port: int = 8000, open_tunnel: bool = True, startup_timeout_s: float = 1800):
    from app.main import app              # env vars must be set before this import
    import uvicorn

    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="uvicorn", daemon=True)
    thread.start()

    t0 = time.time()
    while not server.started:             # lifespan (model loading) must finish first
        if not thread.is_alive():
            raise RuntimeError("Server stopped during startup - read the log lines above.")
        if time.time() - t0 > startup_timeout_s:
            raise TimeoutError("Server did not finish starting.")
        time.sleep(0.5)

    url = f"http://127.0.0.1:{port}"
    if open_tunnel:
        from pyngrok import ngrok
        if os.environ.get("NGROK_AUTHTOKEN"):
            ngrok.set_auth_token(os.environ["NGROK_AUTHTOKEN"])
        domain = os.environ.get("NGROK_DOMAIN")          # e.g. "your-name.ngrok-free.app"
        tunnel = ngrok.connect(addr=str(port), proto="http", **({"domain": domain} if domain else {}))
        url = tunnel.public_url
    print(f"Orchestrator is up: {url}   (docs: {url}/docs)")
    return server, url


def stop(server) -> None:
    server.should_exit = True
    try:
        from pyngrok import ngrok
        ngrok.kill()
    except Exception:
        pass
