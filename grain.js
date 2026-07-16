/* =============================================================================
 * grain.js - RCS Film Grain, drop-in for websites
 * Red Coral Studios - MIT. https://github.com/pg0/rcs-film-grain
 *
 * Applies real film grain to images on your page. Tag an image and it gets
 * grained automatically - no build step, no dependencies, ~one WebGL context
 * shared across every image on the page.
 *
 *   <img src="photo.jpg" grain>            <!-- default stock (config.stock) -->
 *   <img src="photo.jpg" grain="65mm">     <!-- per-image stock -->
 *   <img src="photo.jpg" class="grain">    <!-- CSS class works too -->
 *   <img ... data-grain-stock="super8" data-grain-intensity="0.5">
 *
 *   <script src="grain.js"></script>
 *   <script>Grain.init({ stock: '35mm' });</script>
 *
 * Two modes:
 *   opt-in  (default)      only tagged images:  Grain.init()
 *   opt-out Grain.init({ all:true })  grains EVERY <img> except
 *           <img grain="false">  or  <img class="nograin">
 *
 * Stocks: super8 | 16mm | 35mm | 65mm  (physically-grounded presets), or set
 * intensity/size directly per image or in config. Grain auto-scales with the
 * displayed image height (reference 1080px) so it reads consistently.
 *
 * Notes / limits:
 *  - Cross-origin images need CORS headers (crossorigin="anonymous") to be
 *    graind; otherwise that image is skipped (logged, not fatal).
 *  - Overlay assumes the image fills its box (no object-fit: contain/cover crop).
 *  - Call Grain.refresh() after injecting new images into the DOM.
 * ========================================================================== */
(function (global) {
  'use strict';

  // ---- physically-grounded stock presets (see FILM-STOCK-RESEARCH.md) --------
  // values are the effective { intensity, size } - same numbers the app fills in.
  var STOCKS = {
    super8: { i: 0.64, s: 6.1 },
    '16mm': { i: 0.40, s: 3.44 },
    '35mm': { i: 0.20, s: 1.6 },
    '65mm': { i: 0.09, s: 0.8 }
  };
  var ALIAS = { '8mm': 'super8', 's8': 'super8', '16': '16mm', '35': '35mm', '65': '65mm' };

  var CFG = {
    // Two modes:
    //  opt-in  (default): only images matching `selector` get grain.
    //  opt-out (all:true): EVERY <img> gets grain except those matching `exclude`.
    all: false,
    selector: '[grain], img.grain',
    exclude: '[grain="false"], [grain="0"], .nograin',
    stock: '35mm',
    intensity: null,     // override stock intensity (null = use stock)
    size: null,          // override stock size (null = use stock)
    softness: 0.25,
    roughness: 0.35,
    shadows: 1.0, midtones: 1.0, highlights: 0.55,
    referenceHeight: 1080, // grain authored at this px height; scales with display
    animate: false,        // per-frame reshuffle (costs a rAF loop)
    dpr: true              // render at devicePixelRatio for crisp grain
  };

  // ---- shared WebGL2 context (offscreen), reused for every image -------------
  var gl, prog, U, glCanvas, ready = false;
  var instances = [];   // { img, wrap, canvas, ctx, seed }
  var rafId = 0;

  var VERT =
    '#version 300 es\nin vec2 pos;out vec2 uv;' +
    'void main(){uv=pos*0.5+0.5;gl_Position=vec4(pos,0.,1.);}';

  var FRAG =
    '#version 300 es\nprecision highp float;\n' +
    'in vec2 uv;out vec4 outColor;\n' +
    'uniform sampler2D uImg;uniform vec2 uRes;\n' +
    'uniform float uInt,uSize,uSoft,uRough,uSh,uMid,uHi,uSeed,uRef;\n' +
    'float hashI(float x,float y,float s){' +
    ' uint h=uint(int(floor(x)))*0x9E3779B1u^uint(int(floor(y)))*0x85EBCA77u^uint(int(floor(s)))*0xC2B2AE3Du;' +
    ' h^=h>>16;h*=0x7FEB352Du;h^=h>>15;h*=0x846CA68Bu;h^=h>>16;return float(h&0x00FFFFFFu)/16777216.0;}' +
    'float sm(float t){return t*t*(3.0-2.0*t);}' +
    'float fade5(float t){return t*t*t*(t*(t*6.0-15.0)+10.0);}' +
    'float gdot(float cx,float cy,float dx,float dy,float s){float a=hashI(cx,cy,s)*6.2831853;return cos(a)*dx+sin(a)*dy;}' +
    'float gn(float x,float y,float s){float ix=floor(x),iy=floor(y),fx=x-ix,fy=y-iy;' +
    ' float a=gdot(ix,iy,fx,fy,s),b=gdot(ix+1.,iy,fx-1.,fy,s),c=gdot(ix,iy+1.,fx,fy-1.,s),d=gdot(ix+1.,iy+1.,fx-1.,fy-1.,s);' +
    ' float ux=fade5(fx),uy=fade5(fy);return mix(mix(a,b,ux),mix(c,d,ux),uy)*1.6;}' +
    'vec2 rot2(float x,float y,float a){float s=sin(a),c=cos(a);return vec2(x*c-y*s,x*s+y*c);}' +
    'float grain(float x,float y,float px,float py,float s,float rough,float soft){' +
    ' vec2 a=rot2(x,y,0.7),b=rot2(x,y,2.4),c=rot2(x,y,3.9);' +
    ' float n=gn(a.x,a.y,s)+gn(b.x*2.1,b.y*2.1,s+31.0)*0.55+gn(c.x*0.53,c.y*0.53,s+71.0)*0.35;n*=0.84;' +
    ' float fine=hashI(px,py,s*1.7)*2.0-1.0;float g=mix(n,fine,rough*rough);' +
    ' float shape=mix(0.55,1.0,soft);g=sign(g)*pow(abs(g),shape);' +
    ' float lo=gn(x*0.35,y*0.35,s-9.1);g=mix(g,lo,soft*0.35);return g;}' +
    'void main(){vec3 src=texture(uImg,uv).rgb;' +
    ' float px=uv.x*uRes.x,py=uv.y*uRes.y;' +
    ' float resScale=uRes.y/uRef;' +
    ' float size=max(0.30,uSize*resScale);float fx=px/size,fy=py/size;' +
    ' float L=dot(src,vec3(0.2126,0.7152,0.0722));float Lc=clamp(L,0.0,1.0);' +
    ' float wSh=sm(clamp(1.0-Lc*2.0,0.0,1.0)),wHi=sm(clamp((Lc-0.5)*2.0,0.0,1.0)),wMi=sm(clamp(1.0-abs(Lc-0.45)*2.2,0.0,1.0));' +
    ' float gate=pow(clamp(4.0*Lc*(1.0-Lc),0.0,1.0),0.35);' +
    ' float lumaAmt=(uSh*wSh+uMid*wMi+uHi*wHi)*gate;float amt=uInt*lumaAmt*0.15;' +
    ' float g=grain(fx,fy,px,py,uSeed,uRough,uSoft);' +
    ' outColor=vec4(clamp(src+g*amt,0.0,1.0),1.0);}';

  function makeShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('grain.js shader:', gl.getShaderInfoLog(s)); }
    return s;
  }

  function boot() {
    if (ready) return true;
    glCanvas = document.createElement('canvas');
    gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) { console.warn('grain.js: WebGL2 not available - grain disabled.'); return false; }
    prog = gl.createProgram();
    gl.attachShader(prog, makeShader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, makeShader(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'pos');
    gl.linkProgram(prog); gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    U = {};
    ['uImg', 'uRes', 'uInt', 'uSize', 'uSoft', 'uRough', 'uSh', 'uMid', 'uHi', 'uSeed', 'uRef']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    ready = true;
    return true;
  }

  // resolve which stock + params an image should use
  function paramsFor(img) {
    var attr = (img.getAttribute('grain') || '').trim().toLowerCase();
    var dataStock = (img.dataset.grainStock || img.dataset.stock || '').trim().toLowerCase();
    var name = dataStock || (attr && attr !== 'true' && attr !== '' ? attr : CFG.stock);
    name = ALIAS[name] || name;
    var st = STOCKS[name] || STOCKS[CFG.stock] || STOCKS['35mm'];
    var i = img.dataset.grainIntensity != null ? +img.dataset.grainIntensity : (CFG.intensity != null ? CFG.intensity : st.i);
    var s = img.dataset.grainSize != null ? +img.dataset.grainSize : (CFG.size != null ? CFG.size : st.s);
    return { i: i, s: s };
  }

  function renderInstance(inst) {
    var img = inst.img;
    if (!img.naturalWidth) return;
    var rect = img.getBoundingClientRect();
    var scale = CFG.dpr ? (global.devicePixelRatio || 1) : 1;
    var w = Math.max(1, Math.round(rect.width * scale));
    var h = Math.max(1, Math.round(rect.height * scale));
    if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
    if (inst.canvas.width !== w || inst.canvas.height !== h) { inst.canvas.width = w; inst.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    try {
      gl.bindTexture(gl.TEXTURE_2D, inst.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (e) {
      console.warn('grain.js: could not read image (CORS?) - skipped:', img.currentSrc || img.src);
      inst.dead = true; inst.canvas.style.display = 'none'; return;
    }
    var p = paramsFor(img);
    gl.uniform1i(U.uImg, 0);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uInt, p.i);
    gl.uniform1f(U.uSize, p.s);
    gl.uniform1f(U.uSoft, CFG.softness);
    gl.uniform1f(U.uRough, CFG.roughness);
    gl.uniform1f(U.uSh, CFG.shadows);
    gl.uniform1f(U.uMid, CFG.midtones);
    gl.uniform1f(U.uHi, CFG.highlights);
    gl.uniform1f(U.uSeed, inst.seed);
    gl.uniform1f(U.uRef, CFG.referenceHeight * scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    inst.ctx.clearRect(0, 0, w, h);
    inst.ctx.drawImage(glCanvas, 0, 0);
  }

  function wrapImage(img) {
    if (img.__grain) return img.__grain;
    var cs = global.getComputedStyle(img);
    var wrap = document.createElement('span');
    wrap.className = 'grain-wrap';
    wrap.style.cssText = 'position:relative;display:' +
      (cs.display === 'block' || cs.display === 'flex' ? 'block' : 'inline-block') +
      ';line-height:0;max-width:100%';
    var cv = document.createElement('canvas');
    cv.className = 'grain-canvas';
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    wrap.appendChild(cv);
    var inst = { img: img, wrap: wrap, canvas: cv, ctx: cv.getContext('2d'), tex: gl.createTexture(), seed: 0, dead: false };
    img.__grain = inst;
    instances.push(inst);
    // re-render when the image resizes
    if (global.ResizeObserver) { new ResizeObserver(function () { if (!inst.dead) renderInstance(inst); }).observe(img); }
    return inst;
  }

  function process(img) {
    var inst = wrapImage(img);
    if (img.complete && img.naturalWidth) renderInstance(inst);
    else img.addEventListener('load', function () { renderInstance(inst); }, { once: true });
  }

  // which images to grain, honouring mode + exclude list
  function isExcluded(img) { try { return img.matches(CFG.exclude); } catch (e) { return false; } }
  function collect() {
    var list = document.querySelectorAll(CFG.all ? 'img' : CFG.selector);
    var out = [];
    list.forEach(function (img) { if (img.tagName === 'IMG' && !isExcluded(img)) out.push(img); });
    return out;
  }

  function animLoop() {
    var any = false;
    for (var k = 0; k < instances.length; k++) {
      var inst = instances[k];
      if (inst.dead) continue;
      any = true; inst.seed += 1.0; renderInstance(inst);
    }
    if (CFG.animate && any) rafId = global.requestAnimationFrame(animLoop);
  }

  // ---- public API ------------------------------------------------------------
  var Grain = {
    init: function (opts) {
      for (var k in (opts || {})) if (opts.hasOwnProperty(k)) CFG[k] = opts[k];
      if (opts && opts.stocks) for (var s in opts.stocks) STOCKS[s.toLowerCase()] = opts.stocks[s];
      if (!boot()) return this;
      var run = function () {
        collect().forEach(process);
        if (CFG.animate) { if (rafId) global.cancelAnimationFrame(rafId); rafId = global.requestAnimationFrame(animLoop); }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
      else run();
      return this;
    },
    // re-scan the DOM for newly added images
    refresh: function () {
      if (!ready) return this;
      collect().forEach(function (img) { if (!img.__grain) process(img); });
      return this;
    },
    // grain a single element on demand
    apply: function (img) { if (ready && img && img.tagName === 'IMG') process(img); return this; },
    stocks: STOCKS,
    config: CFG
  };

  global.Grain = Grain;
})(window);
