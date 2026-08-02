import { describe, expect, it } from 'vitest';
import { computeUploadProgressPosition } from './uploadProgressPosition';

describe('computeUploadProgressPosition', () => {
  it('centers the island over a desktop composer without exceeding its width', () => {
    expect(
      computeUploadProgressPosition(
        { top: 700, left: 300, width: 720, height: 60 },
        { height: 80 },
        { width: 1440, height: 900 }
      )
    ).toEqual({ top: 612, left: 372, width: 576 });
  });

  it('keeps the island inside a narrow software-keyboard viewport', () => {
    expect(
      computeUploadProgressPosition(
        { top: 330, left: 8, width: 304, height: 60 },
        { height: 92 },
        { width: 320, height: 400 }
      )
    ).toEqual({ top: 230, left: 8, width: 304 });
  });

  it('clamps to the visible top edge when vertical space is constrained', () => {
    expect(
      computeUploadProgressPosition(
        { top: 60, left: 0, width: 280, height: 60 },
        { height: 100 },
        { width: 280, height: 240 }
      )
    ).toEqual({ top: 8, left: 8, width: 264 });
  });
});
