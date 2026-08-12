<script lang="ts">
  import * as m from '$lib/i18n/messages';
  import './ImageModal.css';
  import {
    IMAGE_ZOOM_STEP,
    MAX_IMAGE_SCALE,
    MIN_IMAGE_SCALE,
    clampImageTransform,
    fitImageWithinViewport,
    panImageTransform,
    zoomImageTransformAtPoint,
    type ImageViewerPoint,
    type ImageViewerSize,
    type ImageViewerTransform
  } from './imageViewerTransform';

  export type ImageItem = {
    id?: string;
    src: string;
    originalSrc?: string;
    alt?: string;
    filename?: string;
  };

  type PointerSample = {
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    pointerType: string;
    moved: boolean;
    startedOnStage: boolean;
  };

  type PinchSnapshot = {
    distance: number;
    midpoint: ImageViewerPoint;
  };

  let {
    items,
    index = $bindable(0),
    onclose
  }: {
    items: ImageItem[];
    index?: number;
    onclose: () => void;
  } = $props();

  const STAGE_GUTTER = 32;
  const KEYBOARD_PAN_STEP = 48;
  const DOUBLE_TAP_DELAY_MS = 320;
  const DOUBLE_TAP_DISTANCE = 28;
  const POINTER_MOVE_THRESHOLD = 6;
  const SYNTHETIC_CLICK_GUARD_MS = 350;
  const TOUCH_DOUBLE_CLICK_GUARD_MS = 500;
  const WHEEL_IDLE_MS = 140;

  let stageNode: HTMLDivElement | null = null;
  let transform = $state<ImageViewerTransform>({ scale: MIN_IMAGE_SCALE, x: 0, y: 0 });
  let naturalSize = $state<ImageViewerSize>({ width: 0, height: 0 });
  let fittedSize = $state<ImageViewerSize>({ width: 0, height: 0 });
  let detailReady = $state(false);
  let detailFailed = $state(false);
  let previewFailed = $state(false);
  let gestureActive = $state(false);
  let wheelActive = $state(false);
  let closing = $state(false);
  let selectedIndex = $state<number | null>(null);
  let selectedId = $state<string | null>(null);

  let currentIndex = $derived(clampItemIndex(selectedIndex ?? index, items.length));
  let current = $derived(items[currentIndex]);
  let hasMultiple = $derived(items.length > 1);
  let previewSrc = $derived(usableSource(current?.src));
  let detailSrc = $derived.by(() => {
    const original = usableSource(current?.originalSrc);
    return original && original !== previewSrc ? original : null;
  });
  let imageAlt = $derived(
    current?.alt ?? current?.filename ?? m['ui.image_modal.fallback_alt']()
  );
  let measurementSrc = $derived(
    previewSrc && !previewFailed
      ? previewSrc
      : detailSrc && !detailFailed
        ? detailSrc
        : null
  );
  let mediaUnavailable = $derived(
    (!previewSrc || previewFailed) && (!detailSrc || detailFailed)
  );
  let currentIdentity = $derived(
    `${currentIndex}:${current?.id ?? current?.filename ?? current?.alt ?? ''}`
  );
  let currentSourceKey = $derived(`${previewSrc ?? ''}\u0000${detailSrc ?? ''}`);
  let zoomPercent = $derived(Math.round(transform.scale * 100));
  let mediaStyle = $derived(
    [
      `width: ${fittedSize.width}px`,
      `height: ${fittedSize.height}px`,
      `left: calc(50% - ${fittedSize.width / 2}px + ${transform.x}px)`,
      `top: calc(50% - ${fittedSize.height / 2}px + ${transform.y}px)`,
      `transform: scale(${transform.scale})`
    ].join('; ')
  );

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointer tracking is imperative gesture state
  const activePointers = new Map<number, PointerSample>();
  let pinchSnapshot: PinchSnapshot | null = null;
  let resizeFrame: number | null = null;
  let lastTapAt = 0;
  let lastTapPoint: ImageViewerPoint | null = null;
  let suppressMouseDoubleClickUntil = 0;
  let suppressNextStageClick = false;
  let suppressClickResetTimer: number | null = null;
  let wheelIdleTimer: number | null = null;
  let previousItems: ImageItem[] | null = null;
  let previousPropIndex: number | null = null;

  // Signed-URL refreshes replace the items array and may replay the original
  // history index. Preserve the currently selected attachment by stable ID
  // when it still exists; honor a true external index change otherwise.
  $effect(() => {
    const length = items.length;
    const requestedIndex = clampItemIndex(index, length);
    const itemsChanged = items !== previousItems;
    const propIndexChanged = index !== previousPropIndex;
    previousItems = items;
    previousPropIndex = index;

    if (length === 0) {
      selectedIndex = null;
      selectedId = null;
      return;
    }

    const identityIndex = selectedId
      ? items.findIndex((item) => item.id === selectedId)
      : -1;
    const nextIndex =
      itemsChanged && identityIndex >= 0
        ? identityIndex
        : propIndexChanged
          ? requestedIndex
          : identityIndex >= 0
            ? identityIndex
            : clampItemIndex(selectedIndex ?? requestedIndex, length);
    const nextId = items[nextIndex]?.id ?? null;

    if (selectedIndex !== nextIndex) selectedIndex = nextIndex;
    if (selectedId !== nextId) selectedId = nextId;
    if (index !== nextIndex) index = nextIndex;
  });

  // A different gallery item starts fitted and centered. Signed URL refreshes
  // for the same attachment are handled by the source effect below so a ticket
  // renewal can retry without discarding the user's zoom and pan position.
  $effect(() => {
    const itemKey = currentIdentity;
    void itemKey;
    detailReady = false;
    detailFailed = false;
    previewFailed = false;
    naturalSize = { width: 0, height: 0 };
    fittedSize = { width: 0, height: 0 };
    resetTransform();
    resetInteractionState();

    return resetInteractionState;
  });

  // A refreshed source URL for the same item must retry a previous load error.
  // Keep the measured geometry and transform because the underlying asset is
  // immutable and only its access ticket changed.
  $effect(() => {
    const sourceKey = currentSourceKey;
    void sourceKey;
    detailReady = false;
    detailFailed = false;
    previewFailed = false;
  });

  function usableSource(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  function clampItemIndex(value: number, length: number): number {
    if (length <= 0) return 0;
    const integer = Number.isFinite(value) ? Math.trunc(value) : 0;
    return Math.min(Math.max(integer, 0), length - 1);
  }

  function showDialog(node: HTMLDialogElement) {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!node.open) node.showModal();
    const focusFrame = requestAnimationFrame(() => stageNode?.focus({ preventScroll: true }));

    return () => {
      cancelAnimationFrame(focusFrame);
      if (!previousFocus?.isConnected) return;
      requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
    };
  }

  function close() {
    if (closing) return;
    closing = true;
    resetInteractionState();
    try {
      onclose();
    } catch (error) {
      closing = false;
      throw error;
    }
  }

  function navigate(direction: -1 | 1) {
    if (items.length === 0 || closing) return;
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    selectedIndex = nextIndex;
    selectedId = items[nextIndex]?.id ?? null;
    index = nextIndex;
  }

  function resetTransform() {
    transform = { scale: MIN_IMAGE_SCALE, x: 0, y: 0 };
  }

  function viewportSize(): ImageViewerSize {
    return {
      width: stageNode?.clientWidth ?? 0,
      height: stageNode?.clientHeight ?? 0
    };
  }

  function measureFittedSize() {
    const viewport = viewportSize();
    fittedSize = fitImageWithinViewport(naturalSize, {
      width: Math.max(0, viewport.width - STAGE_GUTTER),
      height: Math.max(0, viewport.height - STAGE_GUTTER)
    });
    transform = clampImageTransform(transform, fittedSize, viewport);
  }

  function scheduleMeasure() {
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      measureFittedSize();
    });
  }

  function observeStage(node: HTMLDivElement) {
    stageNode = node;
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(node);
    window.addEventListener('resize', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
      if (stageNode === node) stageNode = null;
    };
  }

  function sourceEventIsCurrent(
    image: HTMLImageElement,
    expected: string | null,
    active: string | null
  ): expected is string {
    return Boolean(expected && expected === active && image.dataset.viewerSource === expected);
  }

  function setNaturalSize(image: HTMLImageElement, prefer: boolean) {
    if (!prefer && naturalSize.width > 0 && naturalSize.height > 0) return;
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    naturalSize = { width: image.naturalWidth, height: image.naturalHeight };
    scheduleMeasure();
  }

  function handlePreviewLoad(event: Event, expected: string | null) {
    if (!(event.currentTarget instanceof HTMLImageElement)) return;
    if (!sourceEventIsCurrent(event.currentTarget, expected, previewSrc)) return;
    previewFailed = false;
    setNaturalSize(event.currentTarget, !detailReady);
  }

  function handlePreviewError(event: Event, expected: string | null) {
    if (!(event.currentTarget instanceof HTMLImageElement)) return;
    if (!sourceEventIsCurrent(event.currentTarget, expected, previewSrc)) return;
    previewFailed = true;
  }

  function handleDetailLoad(event: Event, expected: string | null) {
    if (!(event.currentTarget instanceof HTMLImageElement)) return;
    if (!sourceEventIsCurrent(event.currentTarget, expected, detailSrc)) return;
    detailReady = true;
    detailFailed = false;
    setNaturalSize(event.currentTarget, true);
  }

  function handleDetailError(event: Event, expected: string | null) {
    if (!(event.currentTarget instanceof HTMLImageElement)) return;
    if (!sourceEventIsCurrent(event.currentTarget, expected, detailSrc)) return;
    detailReady = false;
    detailFailed = true;
  }

  function handleMeasurementLoad(event: Event, expected: string | null) {
    if (!(event.currentTarget instanceof HTMLImageElement)) return;
    if (!sourceEventIsCurrent(event.currentTarget, expected, measurementSrc)) return;
    if (event.currentTarget.dataset.viewerRole === 'detail') {
      detailReady = true;
      detailFailed = false;
    } else {
      previewFailed = false;
    }
    setNaturalSize(event.currentTarget, true);
  }

  function handleMeasurementError(event: Event, expected: string | null) {
    if (!(event.currentTarget instanceof HTMLImageElement)) return;
    if (!sourceEventIsCurrent(event.currentTarget, expected, measurementSrc)) return;
    if (event.currentTarget.dataset.viewerRole === 'detail') {
      detailReady = false;
      detailFailed = true;
    } else {
      previewFailed = true;
    }
  }

  function focalPoint(clientX: number, clientY: number): ImageViewerPoint {
    const rect = stageNode?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2
    };
  }

  function changeZoom(nextScale: number, focal: ImageViewerPoint = { x: 0, y: 0 }) {
    transform = zoomImageTransformAtPoint(
      transform,
      nextScale,
      focal,
      fittedSize,
      viewportSize()
    );
  }

  function zoomBy(step: number) {
    changeZoom(transform.scale + step);
  }

  function toggleZoomAt(clientX: number, clientY: number) {
    if (transform.scale > MIN_IMAGE_SCALE + 0.01) {
      resetTransform();
      return;
    }
    changeZoom(2, focalPoint(clientX, clientY));
  }

  function beginWheelInteraction() {
    wheelActive = true;
    if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer);
    wheelIdleTimer = window.setTimeout(() => {
      wheelIdleTimer = null;
      wheelActive = false;
    }, WHEEL_IDLE_MS);
  }

  function clearWheelInteraction() {
    if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer);
    wheelIdleTimer = null;
    wheelActive = false;
  }

  function handleWheel(event: WheelEvent) {
    if (closing) return;
    event.preventDefault();
    beginWheelInteraction();
    const viewport = viewportSize();
    const normalizedDelta =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * Math.max(viewport.height, 1)
          : event.deltaY;
    const factor = Math.exp(-normalizedDelta * 0.0025);
    changeZoom(transform.scale * factor, focalPoint(event.clientX, event.clientY));
  }

  function handleDoubleClick(event: MouseEvent) {
    if (closing || performance.now() < suppressMouseDoubleClickUntil) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    event.preventDefault();
    toggleZoomAt(event.clientX, event.clientY);
  }

  function pointerDistance(first: PointerSample, second: PointerSample): number {
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function pointerMidpoint(first: PointerSample, second: PointerSample): ImageViewerPoint {
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2
    };
  }

  function beginPinch() {
    const [first, second] = Array.from(activePointers.values());
    if (!first || !second) {
      pinchSnapshot = null;
      return;
    }
    first.moved = true;
    second.moved = true;
    pinchSnapshot = {
      distance: Math.max(pointerDistance(first, second), 1),
      midpoint: pointerMidpoint(first, second)
    };
  }

  function handlePointerDown(event: PointerEvent) {
    if (closing || activePointers.size >= 2) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    event.preventDefault();
    clearWheelInteraction();
    stageNode?.focus({ preventScroll: true });
    try {
      stageNode?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events and some interrupted browser gestures cannot be captured.
    }
    activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pointerType: event.pointerType,
      moved: false,
      startedOnStage: event.target === event.currentTarget
    });
    gestureActive = true;
    if (activePointers.size === 2) beginPinch();
  }

  function handlePointerMove(event: PointerEvent) {
    const sample = activePointers.get(event.pointerId);
    if (!sample || closing) return;
    event.preventDefault();

    sample.lastX = sample.x;
    sample.lastY = sample.y;
    sample.x = event.clientX;
    sample.y = event.clientY;
    if (
      Math.hypot(sample.x - sample.startX, sample.y - sample.startY) > POINTER_MOVE_THRESHOLD
    ) {
      sample.moved = true;
    }

    if (activePointers.size === 2) {
      const [first, second] = Array.from(activePointers.values());
      if (!first || !second) return;
      if (!pinchSnapshot) beginPinch();
      if (!pinchSnapshot) return;

      const nextDistance = Math.max(pointerDistance(first, second), 1);
      const nextMidpoint = pointerMidpoint(first, second);
      const previousMidpoint = pinchSnapshot.midpoint;
      const previousFocal = focalPoint(previousMidpoint.x, previousMidpoint.y);
      let next = zoomImageTransformAtPoint(
        transform,
        transform.scale * (nextDistance / pinchSnapshot.distance),
        previousFocal,
        fittedSize,
        viewportSize()
      );
      next = panImageTransform(
        next,
        {
          x: nextMidpoint.x - previousMidpoint.x,
          y: nextMidpoint.y - previousMidpoint.y
        },
        fittedSize,
        viewportSize()
      );
      transform = next;
      first.moved = true;
      second.moved = true;
      pinchSnapshot = { distance: nextDistance, midpoint: nextMidpoint };
      return;
    }

    if (transform.scale > MIN_IMAGE_SCALE) {
      transform = panImageTransform(
        transform,
        { x: sample.x - sample.lastX, y: sample.y - sample.lastY },
        fittedSize,
        viewportSize()
      );
    }
  }

  function armSyntheticClickGuard() {
    suppressNextStageClick = true;
    if (suppressClickResetTimer !== null) window.clearTimeout(suppressClickResetTimer);
    suppressClickResetTimer = window.setTimeout(() => {
      suppressClickResetTimer = null;
      suppressNextStageClick = false;
    }, SYNTHETIC_CLICK_GUARD_MS);
  }

  function clearSyntheticClickGuard() {
    if (suppressClickResetTimer !== null) window.clearTimeout(suppressClickResetTimer);
    suppressClickResetTimer = null;
    suppressNextStageClick = false;
  }

  function finishPointer(event: PointerEvent, allowTap: boolean) {
    const sample = activePointers.get(event.pointerId);
    if (!sample) return;
    activePointers.delete(event.pointerId);
    try {
      if (stageNode?.hasPointerCapture(event.pointerId)) {
        stageNode.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may have already released capture during cancellation.
    }

    pinchSnapshot = null;
    const remaining = Array.from(activePointers.values())[0];
    if (remaining) {
      remaining.lastX = remaining.x;
      remaining.lastY = remaining.y;
    }

    if (sample.moved) armSyntheticClickGuard();

    if (allowTap && sample.pointerType === 'touch' && !sample.moved && activePointers.size === 0) {
      if (sample.startedOnStage && transform.scale === MIN_IMAGE_SCALE) {
        lastTapAt = 0;
        lastTapPoint = null;
        close();
        return;
      }

      const now = performance.now();
      const point = { x: sample.x, y: sample.y };
      if (
        lastTapPoint &&
        now - lastTapAt <= DOUBLE_TAP_DELAY_MS &&
        Math.hypot(point.x - lastTapPoint.x, point.y - lastTapPoint.y) <= DOUBLE_TAP_DISTANCE
      ) {
        toggleZoomAt(point.x, point.y);
        suppressMouseDoubleClickUntil = now + TOUCH_DOUBLE_CLICK_GUARD_MS;
        lastTapAt = 0;
        lastTapPoint = null;
      } else {
        lastTapAt = now;
        lastTapPoint = point;
      }
    }

    gestureActive = activePointers.size > 0;
  }

  function handlePointerUp(event: PointerEvent) {
    finishPointer(event, true);
  }

  function handlePointerCancel(event: PointerEvent) {
    finishPointer(event, false);
  }

  function resetInteractionState() {
    for (const pointerId of activePointers.keys()) {
      try {
        if (stageNode?.hasPointerCapture(pointerId)) {
          stageNode.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer capture can already be gone after navigation or teardown.
      }
    }
    activePointers.clear();
    pinchSnapshot = null;
    gestureActive = false;
    lastTapAt = 0;
    lastTapPoint = null;
    suppressMouseDoubleClickUntil = 0;
    clearSyntheticClickGuard();
    clearWheelInteraction();
  }

  function handleStageClick(event: MouseEvent) {
    if (closing) return;
    if (suppressNextStageClick) {
      clearSyntheticClickGuard();
      return;
    }
    if (
      event.target === event.currentTarget &&
      transform.scale === MIN_IMAGE_SCALE &&
      !gestureActive
    ) {
      close();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (closing || event.target instanceof HTMLButtonElement) return;

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(IMAGE_ZOOM_STEP);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomBy(-IMAGE_ZOOM_STEP);
      return;
    }
    if (event.key === '0' || event.key === 'Home') {
      event.preventDefault();
      resetTransform();
      return;
    }
    if (event.key === 'PageUp' && hasMultiple) {
      event.preventDefault();
      navigate(-1);
      return;
    }
    if (event.key === 'PageDown' && hasMultiple) {
      event.preventDefault();
      navigate(1);
      return;
    }

    if (event.key.startsWith('Arrow')) {
      if (transform.scale > MIN_IMAGE_SCALE) {
        event.preventDefault();
        const multiplier = event.shiftKey ? 3 : 1;
        const delta = KEYBOARD_PAN_STEP * multiplier;
        const movement: Record<string, ImageViewerPoint> = {
          ArrowLeft: { x: delta, y: 0 },
          ArrowRight: { x: -delta, y: 0 },
          ArrowUp: { x: 0, y: delta },
          ArrowDown: { x: 0, y: -delta }
        };
        transform = panImageTransform(
          transform,
          movement[event.key] ?? { x: 0, y: 0 },
          fittedSize,
          viewportSize()
        );
      } else if (event.key === 'ArrowLeft' && hasMultiple) {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === 'ArrowRight' && hasMultiple) {
        event.preventDefault();
        navigate(1);
      }
    }
  }
</script>

<dialog
  {@attach showDialog}
  onclose={close}
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  onkeydown={handleKeydown}
  onclick={(event) => {
    if (event.target === event.currentTarget) close();
  }}
  class="image-modal-dialog fixed inset-0 m-0 overflow-hidden border-none backdrop:bg-transparent"
  aria-label={current?.filename ?? imageAlt}
  aria-busy={closing}
  data-mobile-navigation-swipe="ignore"
>
  <header class="image-modal-header">
    <div class="min-w-0 flex-1">
      <div class="image-modal-filename" title={current?.filename ?? imageAlt}>
        {current?.filename ?? imageAlt}
      </div>
      {#if hasMultiple}
        <div class="image-modal-counter" aria-live="polite">
          {currentIndex + 1} / {items.length}
        </div>
      {/if}
    </div>

    {#if detailSrc && !detailReady && !detailFailed}
      <div class="image-modal-loading" aria-live="polite">
        <span class="image-modal-spinner" aria-hidden="true"></span>
        <span class="sr-only">{m['common.loading']()}</span>
      </div>
    {/if}

    <button
      type="button"
      onclick={close}
      class="image-modal-control image-modal-close"
      aria-label={m['ui.close']()}
      title={m['ui.close']()}
      disabled={closing}
    >
      <span class="iconify text-2xl uil--times" aria-hidden="true"></span>
    </button>
  </header>

  <div
    {@attach observeStage}
    class:viewer-can-pan={transform.scale > MIN_IMAGE_SCALE}
    class:viewer-is-interacting={gestureActive || wheelActive}
    class="image-modal-stage"
    role="application"
    tabindex="0"
    aria-label={imageAlt}
    aria-roledescription={m['ui.image_modal.fallback_alt']()}
    data-testid="image-modal-stage"
    onwheel={handleWheel}
    ondblclick={handleDoubleClick}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
    onlostpointercapture={handlePointerCancel}
    onclick={handleStageClick}
    onkeydown={(event) => {
      if (event.target instanceof HTMLButtonElement) return;
      event.stopPropagation();
      handleKeydown(event);
    }}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#if mediaUnavailable}
      <div class="image-modal-empty-fallback" aria-hidden="true">
        <span class="iconify text-4xl mdi--file-image-outline" aria-hidden="true"></span>
      </div>
    {:else if fittedSize.width > 0 && fittedSize.height > 0}
      <div
        class="image-modal-media"
        style={mediaStyle}
        data-testid="image-modal-media"
        aria-busy={Boolean(detailSrc) && !detailReady && !detailFailed}
      >
        {#if previewSrc && !previewFailed}
          {#key previewSrc}
            <img
              src={previewSrc}
              alt=""
              aria-hidden="true"
              draggable="false"
              decoding="async"
              fetchpriority="high"
              data-viewer-source={previewSrc}
              class="image-modal-image image-modal-preview"
              class:image-modal-preview-hidden={detailReady}
              data-testid="image-modal-preview-image"
              onload={(event) => handlePreviewLoad(event, previewSrc)}
              onerror={(event) => handlePreviewError(event, previewSrc)}
            />
          {/key}
        {/if}

        {#if detailSrc && !detailFailed}
          {#key detailSrc}
            <img
              src={detailSrc}
              alt=""
              aria-hidden="true"
              draggable="false"
              decoding="async"
              fetchpriority="low"
              data-viewer-source={detailSrc}
              class="image-modal-image image-modal-detail"
              class:image-modal-detail-ready={detailReady}
              data-testid="image-modal-detail-image"
              onload={(event) => handleDetailLoad(event, detailSrc)}
              onerror={(event) => handleDetailError(event, detailSrc)}
            />
          {/key}
        {/if}
      </div>
    {:else if measurementSrc}
      {#key measurementSrc}
        <img
          src={measurementSrc}
          alt=""
          aria-hidden="true"
          draggable="false"
          decoding="async"
          fetchpriority={measurementSrc === previewSrc ? 'high' : 'low'}
          data-viewer-source={measurementSrc}
          data-viewer-role={measurementSrc === detailSrc ? 'detail' : 'preview'}
          class="image-modal-measurement"
          data-testid="image-modal-measurement-image"
          onload={(event) => handleMeasurementLoad(event, measurementSrc)}
          onerror={(event) => handleMeasurementError(event, measurementSrc)}
        />
      {/key}
      <div class="image-modal-stage-loading" aria-hidden="true">
        <span class="image-modal-spinner"></span>
      </div>
    {/if}

  </div>

  {#if current}
    <footer class="image-modal-footer" data-testid="image-modal-footer">
      {#if hasMultiple}
        <button
          type="button"
          onclick={() => navigate(-1)}
          class="image-modal-control image-modal-nav image-modal-nav-previous"
          aria-label={m['ui.image_modal.previous']()}
          title={m['ui.image_modal.previous']()}
          disabled={closing}
        >
          <span class="iconify text-2xl uil--angle-left-b" aria-hidden="true"></span>
        </button>
      {/if}

      <div class="image-modal-zoom" role="group" aria-label={`${imageAlt} ${zoomPercent}%`}>
        <button
          type="button"
          onclick={() => zoomBy(-IMAGE_ZOOM_STEP)}
          class="image-modal-control image-modal-zoom-button image-modal-zoom-out"
          aria-label={`−${Math.round(IMAGE_ZOOM_STEP * 100)}%`}
          title={`−${Math.round(IMAGE_ZOOM_STEP * 100)}%`}
          disabled={closing || transform.scale <= MIN_IMAGE_SCALE}
          data-testid="image-modal-zoom-out"
        >
          <span class="iconify text-xl uil--minus" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          onclick={resetTransform}
          class="image-modal-zoom-level"
          aria-label="100%"
          title="100%"
          disabled={
            closing ||
            (transform.scale === MIN_IMAGE_SCALE && transform.x === 0 && transform.y === 0)
          }
          data-testid="image-modal-zoom-reset"
        >
          <output aria-live="polite">{zoomPercent}%</output>
        </button>
        <button
          type="button"
          onclick={() => zoomBy(IMAGE_ZOOM_STEP)}
          class="image-modal-control image-modal-zoom-button image-modal-zoom-in"
          aria-label={`+${Math.round(IMAGE_ZOOM_STEP * 100)}%`}
          title={`+${Math.round(IMAGE_ZOOM_STEP * 100)}%`}
          disabled={closing || transform.scale >= MAX_IMAGE_SCALE}
          data-testid="image-modal-zoom-in"
        >
          <span class="iconify text-xl uil--plus" aria-hidden="true"></span>
        </button>
      </div>

      {#if hasMultiple}
        <button
          type="button"
          onclick={() => navigate(1)}
          class="image-modal-control image-modal-nav image-modal-nav-next"
          aria-label={m['ui.image_modal.next']()}
          title={m['ui.image_modal.next']()}
          disabled={closing}
        >
          <span class="iconify text-2xl uil--angle-right-b" aria-hidden="true"></span>
        </button>
      {/if}
    </footer>
  {/if}
</dialog>
