// Name: Graphs
// ID: omniGraphs
// Description: Display bar, line, and pie charts.
// By: supervoidcoder
// License: MIT

// Note: This extension was AI-generated and has been reviewed by humans.

((Scratch) => {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Graphs extension must be run unsandboxed");
  }

  const vm = Scratch.vm;
  const runtime = vm.runtime;

  // ── Custom skin (renders onto the main stage canvas) ─────────────────────
  // TurboWarp's PenSkin uses a WebGL framebuffer — it has no backing _canvas.
  // We create our own skin class (same pattern as Xeltalliv/simple3D.js) that
  // owns a 2D canvas and uploads it as a WebGL texture each frame.
  // Charts are composited into the WebGL scene so MediaRecorder captures them
  // and they can't float over editor modals/menus.
  const renderer = runtime.renderer;

  // Guard against environments where the required renderer internals are absent
  // (e.g., a hypothetical future packager that strips private APIs). Failing
  // early with a clear message is better than a cryptic TypeError later.
  if (
    !renderer ||
    !renderer._gl ||
    !renderer.exports ||
    !renderer.exports.Skin
  ) {
    throw new Error(
      "Graphs extension requires a TurboWarp/OmniBlocks renderer with WebGL and Skin exports."
    );
  }

  /** 2D canvas we draw charts onto. */
  const graphsCanvas = document.createElement("canvas");
  /**
   * Sync graphsCanvas to the actual GL canvas pixel dimensions.
   * Called by the ResizeObserver so we always read the *current* pixel size,
   * not a size that may be stale at the moment NativeSizeChanged fires.
   */
  const syncCanvasSize = () => {
    const glCanvas = renderer._gl.canvas;
    graphsCanvas.width = glCanvas.width;
    graphsCanvas.height = glCanvas.height;
  };
  syncCanvasSize();
  let graphsCanvasDirty = false;

  class GraphsSkin extends renderer.exports.Skin {
    constructor(id, rndr) {
      super(id, rndr);
      const gl = rndr.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this._texture = tex;
      this._nativeSize = rndr.getNativeSize();
      this._rotationCenter = [this._nativeSize[0] / 2, this._nativeSize[1] / 2];
      this._onNativeResize = this._handleNativeSizeChanged.bind(this);
      rndr.on("NativeSizeChanged", this._onNativeResize);

      // Watch the GL canvas for any pixel-dimension change — this covers both
      // stage-dimension changes (NativeSizeChanged may fire before the GL canvas
      // has actually been resized, creating a timing race) and HQ-render toggles
      // (canvas.width/height change without a CSS layout change).
      //
      // "device-pixel-content-box" reports dimensions in device pixels so it
      // fires even when only canvas.width/height change while the CSS size stays
      // fixed (HQ mode). It is supported in Chrome 84+ / Firefox 93+, which
      // covers all realistic TurboWarp/OmniBlocks deployment targets.
      // If the browser is too old to support that box type, fall back to
      // observing the CSS content-box (catches stage resize at minimum) while
      // keeping the UseHighQualityRenderChanged event for HQ toggles.
      this._glCanvasObserver = new ResizeObserver(() => {
        syncCanvasSize();
        scheduleRedraw();
      });
      this._onQualityChange = () => {
        syncCanvasSize();
        scheduleRedraw();
      };
      try {
        this._glCanvasObserver.observe(gl.canvas, {
          box: "device-pixel-content-box",
        });
      } catch (_) {
        // Older browser: fall back to CSS-box observation + explicit quality event
        this._glCanvasObserver.observe(gl.canvas);
        rndr.on("UseHighQualityRenderChanged", this._onQualityChange);
        this._usingQualityFallback = true;
      }
    }
    dispose() {
      this._renderer.removeListener("NativeSizeChanged", this._onNativeResize);
      if (this._usingQualityFallback) {
        this._renderer.removeListener(
          "UseHighQualityRenderChanged",
          this._onQualityChange
        );
      }
      this._glCanvasObserver.disconnect();
      if (this._texture) {
        const gl = this._renderer.gl;
        if (gl) gl.deleteTexture(this._texture);
        this._texture = null;
      }
      super.dispose();
    }
    get size() { return this._nativeSize; }
    getTexture() { return this._texture || super.getTexture(); }
    /** Upload the 2D canvas to the GPU texture. */
    updateContent() {
      const gl = this._renderer.gl;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.bindTexture(gl.TEXTURE_2D, this._texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, graphsCanvas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (this._silhouette) this._silhouette.update(graphsCanvas);
      this.emitWasAltered();
    }
    _handleNativeSizeChanged(event) {
      // Update the logical stage size (used for coordinate mapping and skin
      // coverage). The physical canvas resize is handled by the ResizeObserver
      // so there is no ordering dependency between this event and the GL
      // canvas actually changing its pixel dimensions.
      this._nativeSize = event.newSize;
      this._rotationCenter = [this._nativeSize[0] / 2, this._nativeSize[1] / 2];
      scheduleRedraw();
    }
  }

  const graphsSkinId = renderer._nextSkinId++;
  const graphsSkin = new GraphsSkin(graphsSkinId, renderer);
  renderer._allSkins[graphsSkinId] = graphsSkin;

  const graphsDrawableId = renderer.createDrawable("pen");
  renderer.updateDrawableSkinId(graphsDrawableId, graphsSkinId);
  if (renderer.markDrawableAsNoninteractive) {
    renderer.markDrawableAsNoninteractive(graphsDrawableId);
  }

  // Patch renderer.draw to flush the 2D canvas to the GPU before each frame.
  // Scratch extensions cannot be unloaded at runtime (they persist for the page
  // lifetime), so the permanent patch here is intentional and acceptable.
  const _origDraw = renderer.draw.bind(renderer);
  renderer.draw = function () {
    if (graphsCanvasDirty) {
      graphsSkin.updateContent();
      graphsCanvasDirty = false;
    }
    _origDraw();
  };

  // ── Graph store ───────────────────────────────────────────────────────────
  /** @type {Map<string, GraphData>} */
  const graphs = new Map();

  /**
   * @typedef {Object} GraphData
   * @property {string}   type       - "bar" | "line" | "pie"
   * @property {string[]} labels
   * @property {number[]} values
   * @property {number[]} animated   - current animated values (lerped toward `values`)
   * @property {boolean}  visible
   * @property {number}   centerX      - centre X in Scratch units
   * @property {number}   centerY      - centre Y in Scratch units
   * @property {number}   width
   * @property {number}   height
   * @property {string}   title
   * @property {string[]} palette      - colours for data series
   * @property {string}   bgColor
   * @property {string}   textColor
   * @property {boolean}  shadow       - whether to draw a drop shadow
   * @property {number}   animDuration - animation duration in ms
   * @property {number[]} animStartVals  - animated value at the start of each point's animation
   * @property {number[]} animStartTimes - DOMHighResTimeStamp when each point's animation began
   */

  /** Return coordinates scaled from Scratch stage units to graphsCanvas pixels. */
  const stageToCanvas = (sx, sy) => {
    const sw = runtime.stageWidth || 480;
    const sh = runtime.stageHeight || 360;
    const scaleX = graphsCanvas.width / sw;
    const scaleY = graphsCanvas.height / sh;
    // Scratch origin is centre; canvas origin is top-left
    return {
      x: (sx + sw / 2) * scaleX,
      y: (sh / 2 - sy) * scaleY,
    };
  };

  // Default palette using OmniBlocks' GUI colors (from scratch-gui).
  const DEFAULT_PALETTE = [
    "hsla(180, 85%, 65%, 1)",   // extensions-primary
    "hsla(180, 85%, 40%, 1)",   // extensions-tertiary
    "#59C0C0",                   // motion-primary
    "#389499",                   // motion-tertiary
    "hsla(180, 42%, 51%, 1)",   // looks-secondary-dark
    "hsla(180, 57%, 85%, 1)",   // extensions-light
    "#66BBCC",                   // drop-highlight
    "hsla(180, 85%, 65%, 0.7)", // extensions-primary (muted)
    "hsla(180, 85%, 40%, 0.7)", // extensions-tertiary (muted)
    "#59C0C0",                   // motion-primary (repeat for overflow)
  ];

  /** Create a fresh GraphData object. */
  const makeGraph = (type) => ({
    type,
    labels: [],
    values: [],
    animated: [],
    animStartVals: [],
    animStartTimes: [],
    animDuration: 500,
    visible: true,
    centerX: 0,
    centerY: 0,
    width: 240,
    height: 160,
    title: "",
    palette: [...DEFAULT_PALETTE],
    bgColor: "rgba(255,255,255,0.92)",
    textColor: "#333333",
    shadow: false,
  });

  // ── Animation loop ────────────────────────────────────────────────────────
  let rafId = null;
  let needsRedraw = false;

  /** Smooth ease-in-out cubic: slow start, fast middle, slow end. */
  const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /** Start the RAF loop only if it is not already running. */
  const startRAF = () => {
    if (!rafId) rafId = requestAnimationFrame(animationStep);
  };

  const animationStep = (timestamp) => {
    rafId = null; // allow startRAF to reschedule if still needed
    let stillAnimating = false;
    for (const g of graphs.values()) {
      if (!g.visible) continue;
      for (let i = 0; i < g.values.length; i++) {
        const target = g.values[i];
        const startVal = g.animStartVals[i] ?? target;
        const startTime = g.animStartTimes[i] ?? timestamp;
        const t =
          g.animDuration > 0
            ? Math.min(1, (timestamp - startTime) / g.animDuration)
            : 1;
        g.animated[i] = startVal + (target - startVal) * easeInOutCubic(t);
        if (t < 1) stillAnimating = true;
      }
    }

    if (needsRedraw || stillAnimating) {
      redrawAll();
      needsRedraw = false;
    }

    // Keep looping only while animations are in progress; idle frames stop here.
    if (stillAnimating) startRAF();
  };

  // Make sure the loop restarts after project reload.
  runtime.on("PROJECT_STOP_ALL", () => {
    scheduleRedraw();
  });

  const scheduleRedraw = () => {
    needsRedraw = true;
    startRAF();
  };

  // ── Rendering helpers ─────────────────────────────────────────────────────

  /**
   * Draw a rounded rectangle path.
   * @param {CanvasRenderingContext2D} c
   */
  /** Truncate a label string to fit inside a bar or point. */
  const truncateLabel = (str, maxLen) =>
    str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;

  const roundRect = (c, x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  };

  const drawBarChart = (c, g, x, y, W, H) => {
    const { animated, labels, palette, textColor } = g;

    const PADDING_TOP = g.title ? 30 : 12;
    const PADDING_BOTTOM = 30;
    const PADDING_LEFT = 40;
    const PADDING_RIGHT = 12;

    const chartW = Math.max(0, W - PADDING_LEFT - PADDING_RIGHT);
    const chartH = Math.max(0, H - PADDING_TOP - PADDING_BOTTOM);

    const n = animated.length;
    if (n === 0 || chartW === 0 || chartH === 0) return;

    const maxVal = Math.max(...animated, 0) || 1;
    const minVal = Math.min(...animated, 0);
    const range = maxVal - minVal || 1;

    const barSpacing = chartW / n;
    const barW = Math.max(1, barSpacing * 0.6);

    // Pre-compute the Y position of the zero baseline once.
    const zeroY = y + PADDING_TOP + chartH - (-minVal / range) * chartH;

    // Y-axis
    c.strokeStyle = "rgba(0,0,0,0.2)";
    c.lineWidth = 1;
    const GRID_LINES = 4;
    c.fillStyle = "rgba(0,0,0,0.4)";
    c.font = `${Math.max(9, Math.min(11, H * 0.05))}px sans-serif`;
    c.textAlign = "right";
    c.textBaseline = "middle";
    for (let i = 0; i <= GRID_LINES; i++) {
      const ratio = i / GRID_LINES;
      const val = minVal + range * ratio;
      const gy = y + PADDING_TOP + chartH * (1 - ratio);
      c.beginPath();
      c.moveTo(x + PADDING_LEFT, gy);
      c.lineTo(x + PADDING_LEFT + chartW, gy);
      c.stroke();
      c.fillText(val.toFixed(1), x + PADDING_LEFT - 4, gy);
    }

    // Bars
    for (let i = 0; i < n; i++) {
      const val = animated[i];
      const barX = x + PADDING_LEFT + i * barSpacing + (barSpacing - barW) / 2;
      const barY = val >= 0 ? y + PADDING_TOP + chartH - (val - minVal) / range * chartH : zeroY;
      const actualBarH =
        val >= 0 ? (val - Math.max(0, minVal)) / range * chartH :
          Math.abs(val) / range * chartH;

      c.fillStyle = palette[i % palette.length];
      roundRect(c, barX, barY, barW, Math.max(1, actualBarH), 3);
      c.fill();

      // Label
      if (labels[i]) {
        const fontSize = Math.max(8, Math.min(11, barSpacing * 0.4));
        c.font = `${fontSize}px sans-serif`;
        c.fillStyle = textColor;
        c.textAlign = "center";
        c.textBaseline = "top";
        const labelY = y + PADDING_TOP + chartH + 4;
        c.fillText(truncateLabel(labels[i], 8), barX + barW / 2, labelY);
      }
    }
  };

  const drawLineChart = (c, g, x, y, W, H) => {
    const { animated, labels, palette, textColor } = g;

    const PADDING_TOP = g.title ? 30 : 12;
    const PADDING_BOTTOM = 30;
    const PADDING_LEFT = 40;
    const PADDING_RIGHT = 12;

    const chartW = Math.max(0, W - PADDING_LEFT - PADDING_RIGHT);
    const chartH = Math.max(0, H - PADDING_TOP - PADDING_BOTTOM);

    const n = animated.length;
    if (n === 0 || chartW === 0 || chartH === 0) return;

    const maxVal = Math.max(...animated, 0) || 1;
    const minVal = Math.min(...animated, 0);
    const range = maxVal - minVal || 1;

    /** X coordinate for data point at index i. */
    const pointX = (i) =>
      x + PADDING_LEFT + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);

    // Grid lines
    c.strokeStyle = "rgba(0,0,0,0.2)";
    c.lineWidth = 1;
    const GRID_LINES = 4;
    c.fillStyle = "rgba(0,0,0,0.4)";
    c.font = `${Math.max(9, Math.min(11, H * 0.05))}px sans-serif`;
    c.textAlign = "right";
    c.textBaseline = "middle";
    for (let i = 0; i <= GRID_LINES; i++) {
      const ratio = i / GRID_LINES;
      const val = minVal + range * ratio;
      const gy = y + PADDING_TOP + chartH * (1 - ratio);
      c.beginPath();
      c.moveTo(x + PADDING_LEFT, gy);
      c.lineTo(x + PADDING_LEFT + chartW, gy);
      c.stroke();
      c.fillText(val.toFixed(1), x + PADDING_LEFT - 4, gy);
    }

    // Fill area under line (only meaningful with 2+ points)
    if (n > 1) {
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const px = pointX(i);
        const py =
          y + PADDING_TOP + chartH * (1 - (animated[i] - minVal) / range);
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.lineTo(x + PADDING_LEFT + chartW, y + PADDING_TOP + chartH);
      c.lineTo(x + PADDING_LEFT, y + PADDING_TOP + chartH);
      c.closePath();
      // Use the line colour at reduced opacity for the fill area
      c.globalAlpha = 0.2;
      c.fillStyle = palette[0];
      c.fill();
      c.globalAlpha = 1;
    }

    // Line
    c.beginPath();
    c.strokeStyle = palette[0];
    c.lineWidth = 2.5;
    c.lineJoin = "round";
    c.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const px = pointX(i);
      const py =
        y + PADDING_TOP + chartH * (1 - (animated[i] - minVal) / range);
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.stroke();

    // Dots + labels
    for (let i = 0; i < n; i++) {
      const px = pointX(i);
      const py =
        y + PADDING_TOP + chartH * (1 - (animated[i] - minVal) / range);

      c.beginPath();
      c.arc(px, py, 4, 0, Math.PI * 2);
      c.fillStyle = palette[0];
      c.fill();
      c.strokeStyle = "#fff";
      c.lineWidth = 1.5;
      c.stroke();

      if (labels[i]) {
        const fontSize = Math.max(8, Math.min(10, chartW / (n * 1.5)));
        c.font = `${fontSize}px sans-serif`;
        c.fillStyle = textColor;
        c.textAlign = "center";
        c.textBaseline = "top";
        c.fillText(truncateLabel(labels[i], 8), px, y + PADDING_TOP + chartH + 4);
      }
    }
  };

  const drawPieChart = (c, g, x, y, W, H) => {
    const { animated, labels, palette } = g;

    const PADDING = g.title ? 36 : 16;
    const legendH = 16 * Math.ceil(animated.length / 2);
    const availH = H - PADDING - legendH - 8;
    const radius = Math.max(0, Math.min(W - PADDING * 2, availH) / 2);

    if (radius === 0) return;

    const cx = x + W / 2;
    const cy = y + PADDING + radius;

    const total = animated.reduce((s, v) => s + Math.max(0, v), 0) || 1;

    let startAngle = -Math.PI / 2;
    for (let i = 0; i < animated.length; i++) {
      const share = Math.max(0, animated[i]) / total;
      const sliceAngle = share * 2 * Math.PI;

      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
      c.closePath();
      c.fillStyle = palette[i % palette.length];
      c.fill();
      c.strokeStyle = "#fff";
      c.lineWidth = 2;
      c.stroke();

      // Percent label inside slice (only if slice is big enough)
      if (share > 0.07) {
        const midAngle = startAngle + sliceAngle / 2;
        const lx = cx + Math.cos(midAngle) * radius * 0.65;
        const ly = cy + Math.sin(midAngle) * radius * 0.65;
        c.fillStyle = "#fff";
        c.font = `bold ${Math.max(8, Math.min(12, radius * 0.2))}px sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(Math.round(share * 100) + "%", lx, ly);
      }

      startAngle += sliceAngle;
    }

    // Legend
    const legendX = x + 8;
    const legendY = y + PADDING + radius * 2 + 12;
    const cols = 2;
    c.font = `${Math.max(9, Math.min(11, W * 0.045))}px sans-serif`;
    c.textBaseline = "middle";
    for (let i = 0; i < animated.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = legendX + col * (W / cols);
      const ly = legendY + row * 16;
      c.fillStyle = palette[i % palette.length];
      c.fillRect(lx, ly - 5, 10, 10);
      c.fillStyle = g.textColor;
      c.textAlign = "left";
      const label = (labels[i] || `#${i + 1}`).slice(0, 12);
      c.fillText(label, lx + 14, ly);
    }
  };

  /** Draw one graph onto graphsCanvas. */
  const drawGraph = (c, g) => {
    const { centerX, centerY, width: W, height: H, bgColor, textColor, title, type } = g;

    // Scale graph dimensions with the stage, just like positions
    const sw = runtime.stageWidth || 480;
    const sh = runtime.stageHeight || 360;
    const sW = W * (graphsCanvas.width / sw);
    const sH = H * (graphsCanvas.height / sh);

    // Convert center from Scratch units to canvas pixels
    const centerPos = stageToCanvas(centerX, centerY);
    const x = centerPos.x - sW / 2;
    const y = centerPos.y - sH / 2;

    // Background card
    if (g.shadow) {
      c.shadowColor = "rgba(0,0,0,0.18)";
      c.shadowBlur = 8;
      c.shadowOffsetY = 2;
    }
    roundRect(c, x, y, sW, sH, 8);
    c.fillStyle = bgColor;
    c.fill();
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;

    // Border
    c.strokeStyle = "rgba(0,0,0,0.1)";
    c.lineWidth = 1;
    c.stroke();

    // Clip to card
    c.save();
    roundRect(c, x + 1, y + 1, sW - 2, sH - 2, 7);
    c.clip();

    // Title
    if (title) {
      c.fillStyle = textColor;
      c.font = `bold ${Math.max(10, Math.min(14, sW * 0.055))}px sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "top";
      c.fillText(title.length > 30 ? title.slice(0, 29) + "…" : title, x + sW / 2, y + 8);
    }

    if (g.animated.length > 0) {
      if (type === "bar") drawBarChart(c, g, x, y, sW, sH);
      else if (type === "line") drawLineChart(c, g, x, y, sW, sH);
      else if (type === "pie") drawPieChart(c, g, x, y, sW, sH);
    } else {
      // Empty state
      c.fillStyle = "rgba(0,0,0,0.25)";
      c.font = `${Math.max(10, Math.min(13, sW * 0.05))}px sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(
        Scratch.translate("No data"),
        x + sW / 2,
        y + sH / 2
      );
    }

    c.restore();
  };

  const redrawAll = () => {
    const W = graphsCanvas.width;
    const H = graphsCanvas.height;
    if (!W || !H) return;
    const c = graphsCanvas.getContext("2d");
    c.clearRect(0, 0, W, H);
    for (const g of graphs.values()) {
      if (g.visible) drawGraph(c, g);
    }
    // Mark the canvas dirty so the draw hook uploads it to the GPU texture.
    graphsCanvasDirty = true;
  };

  // ── Utility: parse JSON arrays from block arguments ───────────────────────

  const parseArray = (str) => {
    try {
      const v = JSON.parse(str);
      return Array.isArray(v) ? v : [v];
    } catch (_e) {
      // Treat comma-separated plain strings as an array
      return String(str)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  };

  const parseNumbers = (str) => {
    const arr = parseArray(str);
    return arr.map((v) => {
      const n = Number(v);
      return isFinite(n) ? n : 0;
    });
  };

  // ── Extension class ───────────────────────────────────────────────────────

  const MENU_ICON =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+DQogIDwhLS0gWSBheGlzIC0tPg0KICA8bGluZSB4MT0iNSIgeTE9IjMiIHgyPSI1IiB5Mj0iMzUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPg0KICA8IS0tIFggYXhpcyAtLT4NCiAgPGxpbmUgeDE9IjQiIHkxPSIzNSIgeDI9IjM3IiB5Mj0iMzUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPg0KICA8IS0tIEJhcnMgKHNob3J0LCB0YWxsLCBtZWRpdW0pIC0tPg0KICA8cmVjdCB4PSI4IiAgeT0iMjQiIHdpZHRoPSI3IiBoZWlnaHQ9IjExIiByeD0iMS41IiBmaWxsPSIjZmZmIiBvcGFjaXR5PSIwLjk1Ii8+DQogIDxyZWN0IHg9IjE4IiB5PSIxMyIgd2lkdGg9IjciIGhlaWdodD0iMjIiIHJ4PSIxLjUiIGZpbGw9IiNmZmYiIG9wYWNpdHk9IjAuOTUiLz4NCiAgPHJlY3QgeD0iMjgiIHk9IjE4IiB3aWR0aD0iNyIgaGVpZ2h0PSIxNyIgcng9IjEuNSIgZmlsbD0iI2ZmZiIgb3BhY2l0eT0iMC45NSIvPg0KPC9zdmc+";

  class GraphsExtension {
    getInfo() {
      return {
        id: "omniGraphs",
        name: Scratch.translate("Graphs"),
        color1: "#4e79a7",
        color2: "#3d6185",
        color3: "#2c4a63",
        menuIconURI: MENU_ICON,
        blockIconURI: MENU_ICON,

        blocks: [
          // ── Graph lifecycle ───────────────────────────────────────────
          {
            opcode: "createGraph",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "create [TYPE] graph named [NAME]"
            ),
            arguments: {
              TYPE: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "bar",
                menu: "chartTypes",
              },
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
          {
            opcode: "deleteGraph",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate("delete graph [NAME]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
          "---",
          // ── Visibility ────────────────────────────────────────────────
          {
            opcode: "showGraph",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate("show graph [NAME]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
          {
            opcode: "hideGraph",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate("hide graph [NAME]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
          "---",
          // ── Data ──────────────────────────────────────────────────────
          {
            opcode: "setData",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set graph [NAME] labels [LABELS] values [VALUES]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              LABELS: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: '["A","B","C"]',
              },
              VALUES: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "[10,20,15]",
              },
            },
          },
          {
            opcode: "addDataPoint",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "add to graph [NAME] label [LABEL] value [VALUE]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              LABEL: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "D",
              },
              VALUE: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 25,
              },
            },
          },
          {
            opcode: "updateDataPoint",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set value of [LABEL] in graph [NAME] to [VALUE]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              LABEL: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "A",
              },
              VALUE: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 30,
              },
            },
          },
          {
            opcode: "removeDataPoint",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "remove [LABEL] from graph [NAME]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              LABEL: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "A",
              },
            },
          },
          {
            opcode: "clearData",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate("clear data in graph [NAME]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
          "---",
          // ── Appearance ────────────────────────────────────────────────
          {
            opcode: "setTitle",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate("set title of graph [NAME] to [TITLE]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              TITLE: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "My Chart",
              },
            },
          },
          {
            opcode: "setPosition",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set position of graph [NAME] to x [X] y [Y]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              X: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: -200,
              },
              Y: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 100,
              },
            },
          },
          {
            opcode: "setSize",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set size of graph [NAME] to width [WIDTH] height [HEIGHT]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              WIDTH: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 240,
              },
              HEIGHT: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 160,
              },
            },
          },
          {
            opcode: "setColors",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set colors of graph [NAME] to [COLORS]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              COLORS: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: '["#4e79a7","#f28e2b","#e15759"]',
              },
            },
          },
          {
            opcode: "setBackgroundColor",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set background of graph [NAME] to [COLOR]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              COLOR: {
                type: Scratch.ArgumentType.COLOR,
                defaultValue: "#ffffff",
              },
            },
          },
          {
            opcode: "setAnimDuration",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set animation duration of graph [NAME] to [MS] ms"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              MS: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 500,
              },
            },
          },
          {
            opcode: "setShadow",
            blockType: Scratch.BlockType.COMMAND,
            text: Scratch.translate(
              "set shadow of graph [NAME] to [ENABLED]"
            ),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              ENABLED: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "on",
                menu: "onOff",
              },
            },
          },
          "---",
          // ── Reporters ─────────────────────────────────────────────────
          {
            opcode: "getValueByLabel",
            blockType: Scratch.BlockType.REPORTER,
            text: Scratch.translate("value of [LABEL] in graph [NAME]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
              LABEL: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "A",
              },
            },
          },
          {
            opcode: "getAllLabels",
            blockType: Scratch.BlockType.REPORTER,
            text: Scratch.translate("labels in graph [NAME]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
          {
            opcode: "getAllValues",
            blockType: Scratch.BlockType.REPORTER,
            text: Scratch.translate("values in graph [NAME]"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
          {
            opcode: "graphExists",
            blockType: Scratch.BlockType.BOOLEAN,
            text: Scratch.translate("graph [NAME] exists?"),
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "myGraph",
              },
            },
          },
        ],

        menus: {
          chartTypes: {
            acceptReporters: true,
            items: [
              {
                text: Scratch.translate("bar"),
                value: "bar",
              },
              {
                text: Scratch.translate("line"),
                value: "line",
              },
              {
                text: Scratch.translate("pie"),
                value: "pie",
              },
            ],
          },
          onOff: {
            acceptReporters: true,
            items: [
              { text: Scratch.translate("on"), value: "on" },
              { text: Scratch.translate("off"), value: "off" },
            ],
          },
        },
      };
    }

    // ── Block implementations ───────────────────────────────────────────────

    createGraph({ TYPE, NAME }) {
      const name = String(NAME);
      const type = ["bar", "line", "pie"].includes(String(TYPE))
        ? String(TYPE)
        : "bar";
      graphs.set(name, makeGraph(type));
      scheduleRedraw();
    }

    deleteGraph({ NAME }) {
      graphs.delete(String(NAME));
      scheduleRedraw();
    }

    showGraph({ NAME }) {
      const g = graphs.get(String(NAME));
      if (g) {
        g.visible = true;
        scheduleRedraw();
      }
    }

    hideGraph({ NAME }) {
      const g = graphs.get(String(NAME));
      if (g) {
        g.visible = false;
        scheduleRedraw();
      }
    }

    setData({ NAME, LABELS, VALUES }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      const labels = parseArray(String(LABELS)).map(String);
      const values = parseNumbers(String(VALUES));
      const len = Math.min(labels.length, values.length);
      const now = performance.now();
      const newValues = values.slice(0, len);
      g.labels = labels.slice(0, len);
      // For existing points keep the current animated position as the start; new points grow from 0.
      g.animStartVals = newValues.map((_, i) =>
        g.animated[i] !== undefined ? g.animated[i] : 0
      );
      g.animated = g.animStartVals.slice();
      g.animStartTimes = newValues.map(() => now);
      g.values = newValues;
      scheduleRedraw();
    }

    addDataPoint({ NAME, LABEL, VALUE }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      const label = String(LABEL);
      const value = Scratch.Cast.toNumber(VALUE);
      const idx = g.labels.indexOf(label);
      const now = performance.now();
      if (idx >= 0) {
        g.animStartVals[idx] = g.animated[idx] ?? g.values[idx];
        g.animStartTimes[idx] = now;
        g.values[idx] = value;
      } else {
        g.labels.push(label);
        g.values.push(value);
        g.animated.push(0);
        g.animStartVals.push(0);
        g.animStartTimes.push(now);
      }
      scheduleRedraw();
    }

    updateDataPoint({ NAME, LABEL, VALUE }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      const label = String(LABEL);
      const value = Scratch.Cast.toNumber(VALUE);
      const idx = g.labels.indexOf(label);
      if (idx >= 0) {
        g.animStartVals[idx] = g.animated[idx] ?? g.values[idx];
        g.animStartTimes[idx] = performance.now();
        g.values[idx] = value;
        scheduleRedraw();
      }
    }

    removeDataPoint({ NAME, LABEL }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      const label = String(LABEL);
      const idx = g.labels.indexOf(label);
      if (idx >= 0) {
        g.labels.splice(idx, 1);
        g.values.splice(idx, 1);
        g.animated.splice(idx, 1);
        g.animStartVals.splice(idx, 1);
        g.animStartTimes.splice(idx, 1);
        scheduleRedraw();
      }
    }

    clearData({ NAME }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      g.labels = [];
      g.values = [];
      g.animated = [];
      g.animStartVals = [];
      g.animStartTimes = [];
      scheduleRedraw();
    }

    setTitle({ NAME, TITLE }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      g.title = String(TITLE);
      scheduleRedraw();
    }

    setPosition({ NAME, X, Y }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      // Store the center position in Scratch units
      g.centerX = Scratch.Cast.toNumber(X);
      g.centerY = Scratch.Cast.toNumber(Y);
      scheduleRedraw();
    }

    setSize({ NAME, WIDTH, HEIGHT }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      g.width = Math.max(60, Scratch.Cast.toNumber(WIDTH));
      g.height = Math.max(40, Scratch.Cast.toNumber(HEIGHT));
      scheduleRedraw();
    }

    setColors({ NAME, COLORS }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      const colors = parseArray(String(COLORS)).map(String).filter(Boolean);
      if (colors.length > 0) g.palette = colors;
      scheduleRedraw();
    }

    setBackgroundColor({ NAME, COLOR }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      g.bgColor = String(COLOR);
      scheduleRedraw();
    }

    setAnimDuration({ NAME, MS }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      g.animDuration = Math.max(0, Scratch.Cast.toNumber(MS));
      scheduleRedraw();
    }

    setShadow({ NAME, ENABLED }) {
      const g = graphs.get(String(NAME));
      if (!g) return;
      g.shadow = String(ENABLED) !== "off";
      scheduleRedraw();
    }

    getValueByLabel({ NAME, LABEL }) {
      const g = graphs.get(String(NAME));
      if (!g) return 0;
      const idx = g.labels.indexOf(String(LABEL));
      return idx >= 0 ? g.values[idx] : 0;
    }

    getAllLabels({ NAME }) {
      const g = graphs.get(String(NAME));
      return g ? JSON.stringify(g.labels) : "[]";
    }

    getAllValues({ NAME }) {
      const g = graphs.get(String(NAME));
      return g ? JSON.stringify(g.values) : "[]";
    }

    graphExists({ NAME }) {
      return graphs.has(String(NAME));
    }
  }

  Scratch.extensions.register(new GraphsExtension());
})(Scratch);