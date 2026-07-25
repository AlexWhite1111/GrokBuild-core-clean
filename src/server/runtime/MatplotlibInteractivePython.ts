export function usesInteractiveMatplotlib(code: string): boolean {
  return /(?:^|\n)\s*(?:import\s+matplotlib(?:\.|\s|$)|from\s+matplotlib(?:\.|\s)|import\s+[^\n]*\bpyplot\b)|\bplt\.(?:show|figure|subplots?|axes|plot|imshow|scatter|bar|hist|contour|animation)\b|\bFuncAnimation\s*\(/m.test(code);
}

export const MATPLOTLIB_INTERACTIVE_BACKEND = `from matplotlib.backend_bases import _Backend
from matplotlib.backends.backend_webagg_core import FigureCanvasWebAggCore, FigureManagerWebAgg, NavigationToolbar2WebAgg

class FigureManager(FigureManagerWebAgg):
    _toolbar2_class = NavigationToolbar2WebAgg

class FigureCanvas(FigureCanvasWebAggCore):
    manager_class = FigureManager

@_Backend.export
class _BackendGrokInteractive(_Backend):
    FigureCanvas = FigureCanvas
    FigureManager = FigureManager
`;

export const MATPLOTLIB_INTERACTIVE_BOOTSTRAP = `import asyncio
import io
import json
import os
import runpy
import signal
import struct
import sys
import threading
import traceback
import warnings

RUN_DIR = os.environ["GROK_RUN_DIR"]
sys.path.insert(0, RUN_DIR)

import matplotlib
matplotlib.use("module://grok_interactive_backend", force=True)
warnings.filterwarnings("ignore", message="Animation was deleted without rendering anything.*", category=UserWarning, module="matplotlib.animation")

from matplotlib._pylab_helpers import Gcf
from matplotlib.animation import Animation

bridge_in = os.fdopen(int(os.environ["GROK_INTERACTIVE_INPUT_FD"]), "r", encoding="utf-8", buffering=1)
bridge_out = os.fdopen(int(os.environ["GROK_INTERACTIVE_OUTPUT_FD"]), "wb", buffering=0)
write_lock = threading.Lock()
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
stopping = False
manager_sockets = {}
animations = []
animation_playing = {}
resume_on_attach = set()

def send(header, body=b""):
    metadata = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with write_lock:
        bridge_out.write(struct.pack(">II", len(metadata), len(body)))
        bridge_out.write(metadata)
        if body:
            bridge_out.write(body)
        bridge_out.flush()

class BridgeSocket:
    supports_binary = True

    def __init__(self, figure_id):
        self.figure_id = figure_id

    def send_json(self, content):
        send({"kind": "figure-json", "figureId": self.figure_id, "payload": content})

    def send_binary(self, blob):
        send({"kind": "figure-binary", "figureId": self.figure_id}, bytes(blob))

def collect_animations(value, found, visited, depth=0):
    identity = id(value)
    if identity in visited or depth > 3:
        return
    visited.add(identity)
    if isinstance(value, Animation):
        found.append(value)
        return
    if isinstance(value, dict):
        for item in value.values():
            collect_animations(item, found, visited, depth + 1)
    elif isinstance(value, (list, tuple, set)):
        for item in value:
            collect_animations(item, found, visited, depth + 1)

def figure_animations(figure_id):
    return [item for item in animations if getattr(getattr(item, "_fig", None), "number", None) == figure_id]

def publish_animation_state(figure_id):
    matching = figure_animations(figure_id)
    send({
        "kind": "figure-json",
        "figureId": figure_id,
        "payload": {
            "type": "grok_animation_state",
            "animated": bool(matching),
            "playing": any(animation_playing.get(id(item), True) for item in matching),
        },
    })

def animation_command(figure_id, action):
    matching = figure_animations(figure_id)
    for item in matching:
        if action == "pause":
            item.pause()
            animation_playing[id(item)] = False
        elif action == "play":
            item.resume()
            animation_playing[id(item)] = True
        elif action == "toggle":
            if animation_playing.get(id(item), True):
                item.pause()
                animation_playing[id(item)] = False
            else:
                item.resume()
                animation_playing[id(item)] = True
        elif action == "step":
            item.pause()
            animation_playing[id(item)] = False
            item._step()
    publish_animation_state(figure_id)

def handle(message):
    kind = message.get("kind")
    figure_id = int(message.get("figureId", 0) or 0)
    manager = Gcf.get_fig_manager(figure_id) if figure_id else None
    if kind == "attach" and manager is not None:
        socket = manager_sockets.get(figure_id)
        if socket is None:
            socket = BridgeSocket(figure_id)
            manager_sockets[figure_id] = socket
            manager.add_web_socket(socket)
        for item in figure_animations(figure_id):
            if id(item) in resume_on_attach:
                item.resume()
                animation_playing[id(item)] = True
                resume_on_attach.discard(id(item))
        publish_animation_state(figure_id)
    elif kind == "detach" and manager is not None:
        socket = manager_sockets.pop(figure_id, None)
        if socket is not None:
            manager.remove_web_socket(socket)
        for item in figure_animations(figure_id):
            if animation_playing.get(id(item), True):
                item.pause()
                animation_playing[id(item)] = False
                resume_on_attach.add(id(item))
    elif kind == "event" and manager is not None:
        event = message.get("event") or {}
        event_type = event.get("type")
        if event_type == "supports_binary":
            return
        if event_type == "grok_animation":
            animation_command(figure_id, event.get("action", "toggle"))
        else:
            manager.handle_json(event)
    elif kind == "export" and manager is not None:
        request_id = str(message.get("requestId", ""))
        format_name = str(message.get("format", "png")).lower()
        if format_name not in {"png", "svg", "pdf"}:
            format_name = "png"
        try:
            output = io.BytesIO()
            manager.canvas.figure.savefig(output, format=format_name, bbox_inches="tight")
            send({"kind": "export", "requestId": request_id, "format": format_name}, output.getvalue())
        except BaseException as error:
            send({"kind": "export-error", "requestId": request_id, "message": str(error)})
    elif kind == "stop":
        loop.stop()

def read_commands():
    try:
        for line in bridge_in:
            try:
                message = json.loads(line)
            except Exception:
                continue
            loop.call_soon_threadsafe(handle, message)
    finally:
        loop.call_soon_threadsafe(loop.stop)

def save_final_figures():
    try:
        import matplotlib.pyplot as plt
        for index, number in enumerate(plt.get_fignums(), 1):
            plt.figure(number).savefig(f"figure-{index}.png", dpi=160, bbox_inches="tight")
    except Exception:
        traceback.print_exc()

def request_stop(_signal=None, _frame=None):
    global stopping
    stopping = True
    if loop.is_running():
        loop.call_soon_threadsafe(loop.stop)
    else:
        raise SystemExit(0)

signal.signal(signal.SIGTERM, request_stop)
signal.signal(signal.SIGINT, request_stop)

namespace = {}
try:
    namespace = runpy.run_path(os.environ["GROK_MAIN_FILE"], run_name="__main__")
    collect_animations(namespace, animations, set())
    for item in animations:
        animation_playing[id(item)] = True
    managers = sorted(
        [item for item in Gcf.get_all_fig_managers() if hasattr(item, "add_web_socket") and hasattr(item, "get_javascript")],
        key=lambda item: item.num,
    )
    if not managers:
        send({"kind": "ready", "figureIds": [], "animatedFigureIds": []})
    else:
        web_directory = os.path.join(RUN_DIR, "web")
        os.makedirs(web_directory, mode=0o700, exist_ok=True)
        with open(os.path.join(web_directory, "mpl.js"), "w", encoding="utf-8") as output:
            output.write(managers[0].get_javascript())
        animated_ids = sorted({getattr(getattr(item, "_fig", None), "number", 0) for item in animations} - {0})
        send({"kind": "ready", "figureIds": [item.num for item in managers], "animatedFigureIds": animated_ids})
        threading.Thread(target=read_commands, name="grok-matplotlib-bridge", daemon=True).start()
        loop.run_forever()
except SystemExit:
    pass
except BaseException:
    traceback.print_exc()
    raise
finally:
    for figure_id, socket in list(manager_sockets.items()):
        manager = Gcf.get_fig_manager(figure_id)
        if manager is not None:
            manager.remove_web_socket(socket)
    save_final_figures()
    try:
        loop.close()
    except Exception:
        pass
`;
