import { SvelteMap } from 'svelte/reactivity';
import {
  panAvatarFrame,
  zoomAvatarFrameAt,
  type AvatarFrameState,
  type AvatarSource
} from '$lib/avatarFraming';

type Point = { x: number; y: number };

type AvatarPointerAccess = {
  source: () => AvatarSource | null;
  stageSize: () => number;
  frame: () => AvatarFrameState;
  setFrame: (frame: AvatarFrameState) => void;
  disabled: () => boolean;
  setInteracting: (interacting: boolean) => void;
};

export class AvatarFramingPointerController {
  readonly #access: AvatarPointerAccess;
  readonly #pointers = new SvelteMap<number, Point>();
  #lastSingle: Point | null = null;
  #pinchDistance = 0;
  #pinchMidpoint: Point = { x: 0, y: 0 };
  #pinchFrame: AvatarFrameState = { mode: 'crop', zoom: 1, offsetX: 0, offsetY: 0 };
  #stage: HTMLElement | null = null;
  #wheelTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(access: AvatarPointerAccess) {
    this.#access = access;
  }

  attachStage(stage: HTMLElement | null): void {
    this.#stage = stage;
  }

  begin = (event: PointerEvent): void => {
    const source = this.#access.source();
    if (!source || this.#access.frame().mode === 'contain' || this.#access.disabled()) return;
    if (event.button !== 0) return;

    const target = event.currentTarget as HTMLElement;
    const point = localPoint(target, event.clientX, event.clientY);
    this.#pointers.set(event.pointerId, point);
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events and older engines may not expose an active native pointer.
    }
    this.#access.setInteracting(true);
    if (this.#pointers.size === 1) this.#lastSingle = point;
    else if (this.#pointers.size === 2) this.#beginPinch();
    event.preventDefault();
  };

  move = (event: PointerEvent): void => {
    const source = this.#access.source();
    if (!source || !this.#pointers.has(event.pointerId) || this.#access.frame().mode === 'contain') return;
    const samples = event.getCoalescedEvents?.() ?? [event];
    const latest = samples[samples.length - 1] ?? event;
    const target = event.currentTarget as HTMLElement;
    this.#pointers.set(event.pointerId, localPoint(target, latest.clientX, latest.clientY));

    if (this.#pointers.size === 1) {
      const point = this.#pointers.values().next().value as Point | undefined;
      if (point && this.#lastSingle) {
        this.#access.setFrame(
          panAvatarFrame(
            source,
            this.#access.stageSize(),
            this.#access.frame(),
            point.x - this.#lastSingle.x,
            point.y - this.#lastSingle.y
          )
        );
      }
      this.#lastSingle = point ?? null;
    } else if (this.#pointers.size >= 2 && this.#pinchDistance > 0) {
      const [first, second] = Array.from(this.#pointers.values()).slice(0, 2);
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const zoomed = zoomAvatarFrameAt(
        source,
        this.#access.stageSize(),
        this.#pinchFrame,
        this.#pinchFrame.zoom * (distance / this.#pinchDistance),
        this.#pinchMidpoint.x,
        this.#pinchMidpoint.y
      );
      this.#access.setFrame(
        panAvatarFrame(
          source,
          this.#access.stageSize(),
          zoomed,
          midpoint.x - this.#pinchMidpoint.x,
          midpoint.y - this.#pinchMidpoint.y
        )
      );
    }
    event.preventDefault();
  };

  finish = (event: PointerEvent): void => {
    const target = event.currentTarget as HTMLElement;
    this.#pointers.delete(event.pointerId);
    if (target.hasPointerCapture(event.pointerId)) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may have already released capture during cancellation.
      }
    }
    this.#syncPointerState();
    event.preventDefault();
  };

  lost = (event: PointerEvent): void => {
    if (!this.#pointers.delete(event.pointerId)) return;
    this.#syncPointerState();
  };

  wheel = (event: WheelEvent): void => {
    const source = this.#access.source();
    const frame = this.#access.frame();
    if (!source || frame.mode === 'contain' || this.#access.disabled()) return;
    const point = localPoint(event.currentTarget as HTMLElement, event.clientX, event.clientY);
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.#access.stageSize()
          : 1;
    this.#access.setFrame(
      zoomAvatarFrameAt(
        source,
        this.#access.stageSize(),
        frame,
        frame.zoom * Math.exp(-event.deltaY * unit * 0.0018),
        point.x,
        point.y
      )
    );
    this.#access.setInteracting(true);
    if (this.#wheelTimer) clearTimeout(this.#wheelTimer);
    this.#wheelTimer = setTimeout(() => {
      this.#wheelTimer = null;
      if (this.#pointers.size === 0) this.#access.setInteracting(false);
    }, 140);
    event.preventDefault();
  };

  clear(): void {
    if (this.#wheelTimer) clearTimeout(this.#wheelTimer);
    this.#wheelTimer = null;
    if (this.#stage) {
      for (const pointerId of this.#pointers.keys()) {
        if (this.#stage.hasPointerCapture(pointerId)) {
          try {
            this.#stage.releasePointerCapture(pointerId);
          } catch {
            // Capture can disappear between the guard and cleanup.
          }
        }
      }
    }
    this.#pointers.clear();
    this.#lastSingle = null;
    this.#pinchDistance = 0;
    this.#access.setInteracting(false);
  }

  #beginPinch(): void {
    const [first, second] = Array.from(this.#pointers.values()).slice(0, 2);
    if (!first || !second) return;
    this.#pinchDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    this.#pinchMidpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    this.#pinchFrame = { ...this.#access.frame() };
    this.#lastSingle = null;
  }

  #syncPointerState(): void {
    if (this.#pointers.size === 0) {
      this.#access.setInteracting(false);
      this.#lastSingle = null;
      this.#pinchDistance = 0;
    } else if (this.#pointers.size === 1) {
      this.#lastSingle = this.#pointers.values().next().value ?? null;
      this.#pinchDistance = 0;
    } else {
      this.#beginPinch();
    }
  }
}

function localPoint(target: HTMLElement, clientX: number, clientY: number): Point {
  const rect = target.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
