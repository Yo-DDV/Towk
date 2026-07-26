import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../app.css';
import ScreenShareSparkline from './ScreenShareSparkline.svelte';

describe('ScreenShareSparkline', () => {
  it('draws a visible horizontal trend for a single stable sample', () => {
    const { container } = render(ScreenShareSparkline, {
      props: {
        label: 'Media bitrate',
        value: '328 kb/s',
        points: [{ collectedAt: 10_000, value: 328_000 }],
        targetValue: 410_000
      }
    });

    const paths = Array.from(container.querySelectorAll('svg path'))
      .map((path) => path.getAttribute('d'))
      .filter(Boolean);

    expect(paths.some((path) => path!.includes(' H 236'))).toBe(true);
  });
});
