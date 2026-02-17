class MzaCarousel {
  constructor(root, opts = {}) {
    this.root = root;
    this.viewport = root.querySelector(".mzaCarousel-viewport");
    this.track = root.querySelector(".mzaCarousel-track");
    this.slides = Array.from(root.querySelectorAll(".mzaCarousel-slide"));
    this.prevBtn = root.querySelector(".mzaCarousel-prev");
    this.nextBtn = root.querySelector(".mzaCarousel-next");
    this.pagination = root.querySelector(".mzaCarousel-pagination");
    this.progressBar = root.querySelector(".mzaCarousel-progressBar");
    this.isFF = typeof InstallTrigger !== "undefined";
    this.n = this.slides.length;
    this.state = {
      index: 0,
      pos: 0,
      width: 0,
      gap: 28,
      dragging: false,
      pointerId: null,
      x0: 0,
      v: 0,
      t0: 0,
      animating: false,
      hovering: false,
      startTime: 0,
      pausedAt: 0,
      rafId: 0
    };
    this.opts = Object.assign(
      {
        gap: 28,
        peek: 0.15,
        rotateY: 34,
        zDepth: 150,
        scaleDrop: 0.09,
        blurMax: 2.0,
        activeLeftBias: 0,
        interval: 4500,
        transitionMs: 900,
        keyboard: true,
        breakpoints: [
          { mq: "(max-width: 1200px)", gap: 24, peek: 0.12, rotateY: 28, zDepth: 120, scaleDrop: 0.08, activeLeftBias: 0 },
          { mq: "(max-width: 1000px)", gap: 18, peek: 0.09, rotateY: 22, zDepth: 90, scaleDrop: 0.07, activeLeftBias: 0 },
          { mq: "(max-width: 768px)", gap: 14, peek: 0.06, rotateY: 16, zDepth: 70, scaleDrop: 0.06, activeLeftBias: 0 },
          { mq: "(max-width: 560px)", gap: 12, peek: 0.05, rotateY: 12, zDepth: 60, scaleDrop: 0.05, activeLeftBias: 0 }
        ]
      },
      opts
    );

    if (this.isFF) {
      this.opts.rotateY = 10;
      this.opts.zDepth = 0;
      this.opts.blurMax = 0;
    }

    this._init();
  }

  _init() {
    if (!this.root || this.n === 0) return;
    this._setupDots();
    this._bind();
    this._preloadImages();
    this._measure();
    this.goTo(0, false);
    this._startCycle();
    this._loop();
  }

  _preloadImages() {
    this.slides.forEach((slide) => {
      const card = slide.querySelector(".mzaCard");
      if (!card) return;
      const bg = getComputedStyle(card).getPropertyValue("--mzaCard-bg");
      const match = /url\((?:'|")?([^'")]+)(?:'|")?\)/.exec(bg);
      if (match && match[1]) {
        const img = new Image();
        img.src = match[1];
      }
    });
  }

  _setupDots() {
    if (!this.pagination) return;
    this.pagination.innerHTML = "";
    this.dots = this.slides.map((_, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mzaCarousel-dot";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-label", `Go to slide ${i + 1}`);
      button.addEventListener("click", () => this.goTo(i));
      this.pagination.appendChild(button);
      return button;
    });
  }

  _bind() {
    if (this.prevBtn) this.prevBtn.addEventListener("click", () => this.prev());
    if (this.nextBtn) this.nextBtn.addEventListener("click", () => this.next());

    if (this.opts.keyboard) {
      this.root.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") this.prev();
        if (event.key === "ArrowRight") this.next();
      });
    }

    this.viewport.addEventListener("pointerdown", (event) => this._onDragStart(event));
    this.viewport.addEventListener("pointermove", (event) => this._onDragMove(event));
    this.viewport.addEventListener("pointerup", (event) => this._onDragEnd(event));
    this.viewport.addEventListener("pointercancel", (event) => this._onDragEnd(event));

    this.root.addEventListener("mouseenter", () => {
      this.state.hovering = true;
      this.state.pausedAt = performance.now();
    });

    this.root.addEventListener("mouseleave", () => {
      if (this.state.pausedAt) {
        this.state.startTime += performance.now() - this.state.pausedAt;
        this.state.pausedAt = 0;
      }
      this.state.hovering = false;
    });

    this.ro = new ResizeObserver(() => this._measure());
    this.ro.observe(this.viewport);

    this.opts.breakpoints.forEach((bp) => {
      const media = window.matchMedia(bp.mq);
      const apply = () => {
        Object.keys(bp).forEach((key) => {
          if (key !== "mq") this.opts[key] = bp[key];
        });
        this._measure();
        this._render();
      };
      if (media.addEventListener) media.addEventListener("change", apply);
      else media.addListener(apply);
      if (media.matches) apply();
    });

    this.viewport.addEventListener("pointermove", (event) => this._onTilt(event));
  }

  _measure() {
    const viewRect = this.viewport.getBoundingClientRect();
    this.state.width = viewRect.width;
    this.state.gap = this.opts.gap;
    this.slideW = Math.min(880, this.state.width * (1 - this.opts.peek * 2));
  }

  _onTilt(event) {
    const rect = this.viewport.getBoundingClientRect();
    const mx = (event.clientX - rect.left) / rect.width - 0.5;
    const my = (event.clientY - rect.top) / rect.height - 0.5;
    this.root.style.setProperty("--mzaTiltX", (my * -6).toFixed(3));
    this.root.style.setProperty("--mzaTiltY", (mx * 6).toFixed(3));
  }

  _onDragStart(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.state.dragging = true;
    this.state.pointerId = event.pointerId;
    this.viewport.setPointerCapture(event.pointerId);
    this.state.x0 = event.clientX;
    this.state.t0 = performance.now();
    this.state.v = 0;
    this.state.pausedAt = performance.now();
  }

  _onDragMove(event) {
    if (!this.state.dragging || event.pointerId !== this.state.pointerId) return;
    const dx = event.clientX - this.state.x0;
    const dt = Math.max(16, performance.now() - this.state.t0);
    this.state.v = dx / dt;
    const slideSpan = this.slideW + this.state.gap;
    this.state.pos = this._mod(this.state.index - dx / slideSpan, this.n);
    this._render();
  }

  _onDragEnd(event) {
    if (!this.state.dragging || (event && event.pointerId !== this.state.pointerId)) return;
    this.state.dragging = false;
    try {
      if (this.state.pointerId != null) this.viewport.releasePointerCapture(this.state.pointerId);
    } catch (_) {}
    this.state.pointerId = null;

    if (this.state.pausedAt) {
      this.state.startTime += performance.now() - this.state.pausedAt;
      this.state.pausedAt = 0;
    }

    const velocity = this.state.v;
    const threshold = 0.18;
    let target = Math.round(
      this.state.pos - Math.sign(velocity) * (Math.abs(velocity) > threshold ? 0.5 : 0)
    );
    this.goTo(this._mod(target, this.n));
  }

  _startCycle() {
    this.state.startTime = performance.now();
    this._renderProgress(0);
  }

  _loop() {
    const step = (time) => {
      if (!this.state.dragging && !this.state.hovering && !this.state.animating) {
        const elapsed = time - this.state.startTime;
        const progress = Math.min(1, elapsed / this.opts.interval);
        this._renderProgress(progress);
        if (elapsed >= this.opts.interval) this.next();
      }
      this.state.rafId = requestAnimationFrame(step);
    };
    this.state.rafId = requestAnimationFrame(step);
  }

  _renderProgress(progress) {
    if (!this.progressBar) return;
    this.progressBar.style.transform = `scaleX(${progress})`;
  }

  prev() {
    this.goTo(this._mod(this.state.index - 1, this.n));
  }

  next() {
    this.goTo(this._mod(this.state.index + 1, this.n));
  }

  goTo(index, animate = true) {
    const start = this.state.pos || this.state.index;
    const end = this._nearest(start, index);
    const duration = animate ? this.opts.transitionMs : 0;
    const startTime = performance.now();
    const ease = (x) => 1 - Math.pow(1 - x, 4);
    this.state.animating = true;

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const p = duration ? ease(t) : 1;
      this.state.pos = start + (end - start) * p;
      this._render();
      if (t < 1) requestAnimationFrame(step);
      else this._afterSnap(index);
    };
    requestAnimationFrame(step);
  }

  _afterSnap(index) {
    this.state.index = this._mod(Math.round(this.state.pos), this.n);
    this.state.pos = this.state.index;
    this.state.animating = false;
    this._render(true);
    this._startCycle();
  }

  _nearest(from, target) {
    let d = target - Math.round(from);
    if (d > this.n / 2) d -= this.n;
    if (d < -this.n / 2) d += this.n;
    return Math.round(from) + d;
  }

  _mod(i, n) {
    return ((i % n) + n) % n;
  }

  _render(markActive = false) {
    const span = this.slideW + this.state.gap;
    const tiltX = parseFloat(this.root.style.getPropertyValue("--mzaTiltX") || 0);
    const tiltY = parseFloat(this.root.style.getPropertyValue("--mzaTiltY") || 0);

    for (let i = 0; i < this.n; i++) {
      let d = i - this.state.pos;
      if (d > this.n / 2) d -= this.n;
      if (d < -this.n / 2) d += this.n;

      const weight = Math.max(0, 1 - Math.abs(d) * 2);
      const biasActive = -this.slideW * this.opts.activeLeftBias * weight;
      // Center the slide by subtracting half its width (since left is 50%)
      const tx = d * span + biasActive - (this.slideW / 2);
      const depth = -Math.abs(d) * this.opts.zDepth;
      const rot = -d * this.opts.rotateY;
      const scale = 1 - Math.min(Math.abs(d) * this.opts.scaleDrop, 0.42);
      const blur = Math.min(Math.abs(d) * this.opts.blurMax, this.opts.blurMax);
      const z = Math.round(1000 - Math.abs(d) * 10);
      const slide = this.slides[i];

      if (this.isFF) {
        slide.style.transform = `translate(${tx}px, -50%) scale(${scale})`;
        slide.style.filter = "none";
      } else {
        slide.style.transform = `translate3d(${tx}px, -50%, ${depth}px) rotateY(${rot}deg) scale(${scale})`;
        slide.style.filter = `blur(${blur}px)`;
      }

      slide.style.zIndex = z;
      if (markActive) slide.dataset.state = Math.round(this.state.index) === i ? "active" : "rest";

      const card = slide.querySelector(".mzaCard");
      if (!card) continue;
      const parBase = Math.max(-1, Math.min(1, -d));
      const parX = parBase * 48 + tiltY * 2.0;
      const parY = tiltX * -1.5;
      const bgX = parBase * -64 + tiltY * -2.4;
      card.style.setProperty("--mzaParX", `${parX.toFixed(2)}px`);
      card.style.setProperty("--mzaParY", `${parY.toFixed(2)}px`);
      card.style.setProperty("--mzaParBgX", `${bgX.toFixed(2)}px`);
      card.style.setProperty("--mzaParBgY", `${(parY * 0.35).toFixed(2)}px`);
    }

    const active = this._mod(Math.round(this.state.pos), this.n);
    if (this.dots) {
      this.dots.forEach((dot, i) => dot.setAttribute("aria-selected", i === active ? "true" : "false"));
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("portfolioCarousel");
  if (!root) return;
  new MzaCarousel(root, { transitionMs: 900, activeLeftBias: 0 });
});
