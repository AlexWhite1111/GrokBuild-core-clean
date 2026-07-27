export function matplotlibInteractivePage(input: {
  runId: string;
  token: string;
  figureId: number;
  detail: boolean;
  animated: boolean;
}): string {
  const runId = JSON.stringify(input.runId);
  const token = JSON.stringify(input.token);
  const figureId = JSON.stringify(input.figureId);
  const detail = JSON.stringify(input.detail);
  const animated = JSON.stringify(input.animated);
  const scriptUrl = `/local-runs/${encodeURIComponent(input.runId)}/interactive/mpl.js?token=${encodeURIComponent(input.token)}`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' http://127.0.0.1:*; style-src 'unsafe-inline'; connect-src http://127.0.0.1:* ws://127.0.0.1:*; img-src data: blob: http://127.0.0.1:*; font-src data: http://127.0.0.1:*; media-src blob: http://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'">
  <style>${MATPLOTLIB_PAGE_STYLE}</style>
  <script src="${scriptUrl}"></script>
</head>
<body>
  <div id="figure" aria-label="Interactive Matplotlib figure"></div>
  <div id="connection" data-state="connecting" aria-live="polite"></div>
  <script>
  (() => {
    const runId = ${runId};
    const token = ${token};
    const figureId = ${figureId};
    const detail = ${detail};
    const initiallyAnimated = ${animated};
    const connection = document.getElementById('connection');
    const svg = (body) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
    const icons = {
      home: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>'),
      back: svg('<path d="m15 18-6-6 6-6"/>'),
      forward: svg('<path d="m9 18 6-6-6-6"/>'),
      pan: svg('<path d="M12 2v20M2 12h20"/><path d="m8 6 4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4"/>'),
      zoom: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7v7M7 10.5h7"/>'),
      play: svg('<path d="m8 5 11 7-11 7Z"/>'),
      pause: svg('<path d="M8 5v14M16 5v14"/>'),
      step: svg('<path d="m6 5 9 7-9 7ZM18 5v14"/>'),
      download: svg('<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/>'),
    };

    mpl.figure.prototype._init_header = function () {
      const title = document.createElement('span');
      title.hidden = true;
      this.root.appendChild(title);
      this.header = title;
    };
    mpl.figure.prototype._root_extra_style = function (root) {
      root.className = 'grok-mpl-root';
      root.style.display = 'flex';
    };
    mpl.figure.prototype._canvas_extra_style = function (canvas) {
      canvas.classList.add('grok-mpl-canvas');
      canvas.style.resize = 'none';
      canvas.style.border = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    };
    mpl.figure.prototype._init_toolbar = function () {
      const fig = this;
      const toolbar = document.createElement('div');
      toolbar.className = 'mpl-toolbar';
      const navigation = document.createElement('div');
      navigation.className = 'mpl-button-group';
      const animation = document.createElement('div');
      animation.className = 'mpl-button-group animation-tools';
      animation.hidden = !initiallyAnimated;
      const output = document.createElement('div');
      output.className = 'mpl-button-group output-tools';
      fig.buttons = {};

      const button = (key, label, icon, action, group = navigation) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'mpl-widget';
        control.title = label;
        control.setAttribute('aria-label', label);
        control.innerHTML = icon;
        control.addEventListener('click', action);
        control.addEventListener('mouseenter', () => { fig.message.textContent = label; });
        control.addEventListener('mouseleave', () => { fig.message.textContent = ''; });
        group.appendChild(control);
        fig.buttons[key] = control;
        return control;
      };
      button('Home', 'Reset view', icons.home, () => fig.send_message('toolbar_button', { name: 'home' }));
      button('Back', 'Previous view', icons.back, () => fig.send_message('toolbar_button', { name: 'back' }));
      button('Forward', 'Next view', icons.forward, () => fig.send_message('toolbar_button', { name: 'forward' }));
      button('Pan', 'Pan', icons.pan, () => fig.send_message('toolbar_button', { name: 'pan' }));
      button('Zoom', 'Box zoom', icons.zoom, () => fig.send_message('toolbar_button', { name: 'zoom' }));
      const play = button('PlayPause', 'Play or pause animation', icons.pause, () => fig.send_message('grok_animation', { action: 'toggle' }), animation);
      play.dataset.playing = 'true';
      button('Step', 'Advance one frame', icons.step, () => fig.send_message('grok_animation', { action: 'step' }), animation);

      const format = document.createElement('select');
      format.className = 'mpl-widget format';
      format.setAttribute('aria-label', 'Export format');
      for (const value of ['png', 'svg', 'pdf']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value.toUpperCase();
        format.appendChild(option);
      }
      output.appendChild(format);
      button('Download', 'Export figure', icons.download, async () => {
        const url = '/local-runs/' + encodeURIComponent(runId) + '/interactive/figures/' + figureId + '/download.' + format.value + '?token=' + encodeURIComponent(token);
        const response = await fetch(url);
        if (!response.ok) return;
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = 'figure-' + figureId + '.' + format.value;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }, output);

      const message = document.createElement('span');
      message.className = 'mpl-message';
      toolbar.append(navigation, animation, message, output);
      fig.root.appendChild(toolbar);
      fig.toolbar = toolbar;
      fig.message = message;
      fig.format_dropdown = format;
      fig.animationTools = animation;
    };
    mpl.figure.prototype.handle_grok_animation_state = function (fig, message) {
      if (fig.animationTools) fig.animationTools.hidden = !message.animated;
      const control = fig.buttons.PlayPause;
      if (!control) return;
      control.dataset.playing = String(Boolean(message.playing));
      control.innerHTML = message.playing ? icons.pause : icons.play;
      control.title = message.playing ? 'Pause animation' : 'Play animation';
      control.setAttribute('aria-label', control.title);
    };

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const websocket = new WebSocket(protocol + '//' + location.host + '/local-runs/' + encodeURIComponent(runId) + '/interactive/figures/' + figureId + '/ws?token=' + encodeURIComponent(token));
    websocket.binaryType = 'blob';
    websocket.addEventListener('open', () => { connection.dataset.state = 'ready'; });
    websocket.addEventListener('close', () => { connection.dataset.state = 'closed'; });
    websocket.addEventListener('error', () => { connection.dataset.state = 'error'; });
    const figure = new mpl.figure(figureId, websocket, (fig, format) => fig.buttons.Download.click(), document.getElementById('figure'));

    addEventListener('wheel', (event) => {
      if (detail || event.ctrlKey || event.metaKey || event.altKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      parent.postMessage({
        channel: 'grok-build-interactive',
        runId,
        type: 'thread-wheel',
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
      }, '*');
    }, { capture: true, passive: false });

    addEventListener('message', (event) => {
      if (event.source !== parent || event.data?.channel !== 'grok-build-interactive-control') return;
      if (event.data.type === 'theme' && event.data.variables) {
        document.documentElement.dataset.appearance = event.data.appearance === 'dark' ? 'dark' : 'light';
        for (const [name, value] of Object.entries(event.data.variables)) document.documentElement.style.setProperty(name, String(value));
      }
    });
    parent.postMessage({ channel: 'grok-build-interactive', runId, type: 'ready' }, '*');
  })();
  </script>
</body>
</html>`;
}

const MATPLOTLIB_PAGE_STYLE = `
:root{color-scheme:light dark;background:transparent;color:var(--color-text,#292620);font-family:var(--font-ui,system-ui,-apple-system,sans-serif)}
*{box-sizing:border-box}
html,body,#figure{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
body{position:relative;min-height:260px}
#figure{padding:0}
.grok-mpl-root{width:100%!important;height:100%!important;min-width:0;flex-direction:column;background:transparent}
.grok-mpl-canvas{order:2;min-width:0!important;min-height:0!important;flex:1;touch-action:none;background:transparent}
.mpl-canvas{max-width:none!important;max-height:none!important}
.mpl-toolbar{position:relative;z-index:4;display:flex;width:100%;min-height:32px;padding:3px 5px;order:1;align-items:center;gap:3px;border:0;background:color-mix(in srgb,var(--color-surface-raised,#f5f0e5) 82%,transparent);box-shadow:var(--shadow-separator-bottom,0 1px rgba(0,0,0,.08));font:11px/1 var(--font-ui,system-ui)}
.mpl-button-group{display:flex;align-items:center;gap:2px}
.mpl-button-group.output-tools{margin-left:auto}
.mpl-widget{display:grid;width:25px;height:25px;margin:0;padding:5px;place-items:center;border:0;border-radius:var(--radius-detail,6px);color:var(--color-text-secondary,#625d55);background:transparent;cursor:pointer}
.mpl-widget:hover,.mpl-widget:focus-visible,.mpl-widget.active{color:var(--color-accent,#9a653f);background:var(--color-control-hover,rgba(120,100,70,.11));outline:0}
.mpl-widget:disabled{opacity:.28;cursor:default;background:transparent}
.mpl-widget svg{display:block;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.mpl-widget.format{display:block;width:auto;min-width:48px;padding:0 4px;color:var(--color-text-muted,#777169);font:10px/1 var(--font-ui,system-ui)}
.mpl-message{min-width:0;max-width:36%;margin-left:5px;overflow:hidden;color:var(--color-text-muted,#777169);text-overflow:ellipsis;white-space:nowrap}
#connection{position:absolute;z-index:5;top:13px;right:8px;width:5px;height:5px;border-radius:50%;background:var(--color-text-muted,#777169);pointer-events:none}
#connection[data-state=ready]{background:var(--color-success,#4f8b62)}
#connection[data-state=error],#connection[data-state=closed]{background:var(--color-danger,#b45454)}
@media(max-width:520px){.mpl-toolbar{gap:1px}.mpl-widget{width:24px}.mpl-message{display:none}.mpl-widget.format{min-width:43px}}
`;
