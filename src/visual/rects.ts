/** 大量の矩形を描くレンダラー（WebGL2、使えなければ Canvas 2D） */
export interface RectRenderer {
  readonly kind: 'webgl2' | 'canvas2d';
  resize(w: number, h: number, dpr: number): void;
  begin(clear: [number, number, number, number]): void;
  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a?: number): void;
  end(): void;
  destroy(): void;
}

const VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 rect;
layout(location=2) in vec4 color;
uniform vec2 res;
out vec4 vColor;
out vec2 vLocal;
out vec2 vSize;
void main(){
  vec2 p = rect.xy + corner * rect.zw;
  vec2 clip = (p / res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vColor = color;
  vLocal = corner * rect.zw;
  vSize = rect.zw;
}`;
const FS = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vLocal;
in vec2 vSize;
out vec4 outColor;
uniform float dpr;
void main(){
  // 角を少し丸め、縁を明るくして立体感を出す
  float edge = min(min(vLocal.x, vSize.x - vLocal.x), min(vLocal.y, vSize.y - vLocal.y));
  float r = min(2.0 * dpr, min(vSize.x, vSize.y) * 0.5);
  vec2 q = abs(vLocal - vSize * 0.5) - (vSize * 0.5 - vec2(r));
  float d = length(max(q, 0.0)) - r;
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  vec3 c = vColor.rgb * (edge < 1.0 * dpr ? 1.25 : 1.0);
  outColor = vec4(c * alpha * vColor.a, alpha * vColor.a);
}`;

class GLRects implements RectRenderer {
  readonly kind = 'webgl2' as const;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private inst: WebGLBuffer;
  private data = new Float32Array(8 * 4096);
  private n = 0;
  private resLoc: WebGLUniformLocation | null;
  private dprLoc: WebGLUniformLocation | null;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private vao: WebGLVertexArrayObject;

  constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    this.resLoc = gl.getUniformLocation(p, 'res');
    this.dprLoc = gl.getUniformLocation(p, 'dpr');
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  resize(w: number, h: number, dpr: number) {
    this.w = Math.max(1, Math.round(w * dpr));
    this.h = Math.max(1, Math.round(h * dpr));
    this.dpr = dpr;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }
  begin(c: [number, number, number, number]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.n = 0;
  }
  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 1) {
    if (this.n * 8 + 8 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data;
    const o = this.n * 8;
    const s = this.dpr;
    d[o] = x * s;
    d[o + 1] = y * s;
    d[o + 2] = w * s;
    d[o + 3] = h * s;
    d[o + 4] = r / 255;
    d[o + 5] = g / 255;
    d[o + 6] = b / 255;
    d[o + 7] = a;
    this.n++;
  }
  end() {
    const gl = this.gl;
    if (!this.n) return;
    gl.useProgram(this.prog);
    gl.uniform2f(this.resLoc, this.w, this.h);
    gl.uniform1f(this.dprLoc, this.dpr);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * 8), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    gl.bindVertexArray(null);
  }
  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

class CanvasRects implements RectRenderer {
  readonly kind = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: true })!;
  }
  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  }
  begin(c: [number, number, number, number]) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (c[3] > 0) {
      ctx.fillStyle = `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},${c[3]})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 1) {
    this.ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    this.ctx.fillRect(x, y, w, h);
  }
  end() {}
  destroy() {}
}

export function createRectRenderer(canvas: HTMLCanvasElement, preferGL = true): RectRenderer {
  if (preferGL) {
    try {
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
      });
      if (gl) return new GLRects(canvas, gl);
    } catch (e) {
      console.warn('WebGL2 unavailable, falling back to Canvas 2D', e);
    }
  }
  return new CanvasRects(canvas);
}
