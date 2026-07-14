export type CallJoinAction = {
  expectedCallId: string | null;
  nextUrl: string;
};

const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Consumes the one-shot join parameter while preserving unrelated navigation
// state. Invalid identifiers are stripped without reaching the backend.
export function callJoinActionFromURL(url: URL): CallJoinAction | null {
  if (!url.searchParams.has('joinCall')) return null;

  const expectedCallId = url.searchParams.get('joinCall') ?? '';
  const next = new URL(url);
  next.searchParams.delete('joinCall');
  return {
    expectedCallId: CALL_ID_PATTERN.test(expectedCallId) ? expectedCallId : null,
    nextUrl: `${next.pathname}${next.search}${next.hash}`
  };
}
