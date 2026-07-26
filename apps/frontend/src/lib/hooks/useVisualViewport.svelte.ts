const VISUAL_KEYBOARD_OPEN_ATTRIBUTE = 'data-visual-keyboard-open';

/**
 * Handles virtual keyboard and scroll-to-focus fixes for iOS Safari.
 *
 * The body uses `position: fixed; inset: 0` as its normal viewport boundary.
 * Installed WebKit apps can still resolve that layout viewport shorter than the
 * display, so `app.html` supplies a capability-scoped `100vh` and safe-area
 * fallback for standalone mode.
 *
 * iOS Safari does NOT resize the layout viewport when the virtual keyboard
 * opens (and does not support `interactive-widget=resizes-content`). This means
 * the fixed body stays at full height and the keyboard covers bottom content
 * such as the chat composer.
 *
 * This hook detects the keyboard by comparing `visualViewport.height` to a
 * stored reference height (captured when no keyboard is visible). When the
 * keyboard is open, it sets an explicit body height to shrink above the
 * keyboard. iOS may also move the visual viewport while focusing the editor,
 * so the fixed body is aligned with `offsetTop` instead of remaining anchored
 * to the layout viewport. The body attribute also suppresses the standalone
 * safe-area padding that WebKit can keep while the keyboard is visible. When
 * closed, the hook clears the overrides and lets CSS handle sizing.
 *
 * Also counteracts iOS Safari's scroll-to-focus behavior that shifts the
 * document even when the body is `position: fixed`.
 *
 * Call once from the root layout.
 */
export function useVisualViewport() {
  $effect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Reference height = visual viewport height when no keyboard is visible.
    let fullHeight = vv.height;
    let lastWidth = vv.width;

    function update() {
      // After an orientation change, the layout viewport provides the new
      // keyboard-free reference height on iOS. Continue through the normal
      // keyboard check so a keyboard that stayed open remains accounted for.
      if (vv!.width !== lastWidth) {
        fullHeight = document.documentElement.clientHeight || vv!.height;
        lastWidth = vv!.width;
      }

      // Keyboard detection: if visual viewport is significantly shorter than
      // the reference height, the keyboard is open.
      const keyboardLikelyOpen = vv!.height < fullHeight * 0.75;
      document.body.toggleAttribute(VISUAL_KEYBOARD_OPEN_ATTRIBUTE, keyboardLikelyOpen);

      if (keyboardLikelyOpen) {
        // Fill the visual viewport rather than only shortening the body. iOS
        // can shift that viewport during focus, and ignoring the offset leaves
        // the same number of pixels clipped below the keyboard.
        document.body.style.height = `${vv!.height}px`;
        document.body.style.top = `${vv!.offsetTop}px`;
      } else {
        // No keyboard — update reference, clear override, let CSS handle sizing.
        fullHeight = vv!.height;
        document.body.style.height = '';
        document.body.style.top = '';
      }

      // Prevent iOS Safari from scrolling the document when focusing inputs.
      if (vv!.offsetTop > 0) {
        window.scrollTo(0, 0);
      }
    }

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    vv.addEventListener('scrollend', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      vv.removeEventListener('scrollend', update);
      document.body.removeAttribute(VISUAL_KEYBOARD_OPEN_ATTRIBUTE);
      document.body.style.height = '';
      document.body.style.top = '';
    };
  });
}
