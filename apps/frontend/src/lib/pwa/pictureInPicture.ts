type PictureInPictureDocument = Document;
type PictureInPictureVideo = HTMLVideoElement;

export function supportsVideoPictureInPicture(
  documentLike: PictureInPictureDocument | undefined = typeof document === 'undefined'
    ? undefined
    : document,
  videoPrototype: Partial<PictureInPictureVideo> | undefined = typeof HTMLVideoElement ===
  'undefined'
    ? undefined
    : HTMLVideoElement.prototype
): boolean {
  return Boolean(
    (documentLike?.pictureInPictureEnabled && videoPrototype?.requestPictureInPicture) ||
    videoPrototype?.webkitSetPresentationMode
  );
}

export async function toggleVideoPictureInPicture(
  video: PictureInPictureVideo,
  documentLike: PictureInPictureDocument = document
): Promise<boolean> {
  try {
    if (documentLike.pictureInPictureEnabled && video.requestPictureInPicture) {
      if (documentLike.pictureInPictureElement === video) {
        await documentLike.exitPictureInPicture?.();
        return false;
      }
      if (documentLike.pictureInPictureElement) await documentLike.exitPictureInPicture?.();
      await video.requestPictureInPicture();
      return true;
    }

    if (
      video.webkitSetPresentationMode &&
      video.webkitSupportsPresentationMode?.('picture-in-picture')
    ) {
      const entering = video.webkitPresentationMode !== 'picture-in-picture';
      video.webkitSetPresentationMode(entering ? 'picture-in-picture' : 'inline');
      return entering;
    }
  } catch {
    // User agents can reject PiP due to permissions, policy, or missing activation.
  }
  return false;
}
