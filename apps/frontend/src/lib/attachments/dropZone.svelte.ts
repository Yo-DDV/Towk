/**
 * Svelte 5 attachment for handling drag-and-drop file uploads.
 *
 * Usage:
 *   <div {@attach dropZone({ onDrop, onDragStateChange })}>
 *
 * @param options.onDrop - Called with File[] when valid files are dropped
 * @param options.onDragStateChange - Called with boolean when drag enters/leaves
 * @param options.acceptedTypes - MIME types to accept (default: ['image/*'])
 */
export function dropZone(options: {
  onDrop: (files: File[]) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  acceptedTypes?: string[];
}) {
  return (element: HTMLElement) => {
    const acceptedTypes = options.acceptedTypes ?? ['image/*'];

    // Counter to handle nested elements triggering enter/leave
    let dragCounter = 0;

    function isValidDrag(e: DragEvent): boolean {
      // Check if the drag contains files
      return (
        e.dataTransfer?.types.includes('Files') === true || (e.dataTransfer?.files.length ?? 0) > 0
      );
    }

    function matchesMimeType(file: File, patterns: string[]): boolean {
      return patterns.some((pattern) => {
        if (pattern === '*/*') return true;
        if (pattern.endsWith('/*')) {
          // Wildcard match (e.g., 'image/*')
          const prefix = pattern.slice(0, -1);
          return file.type.startsWith(prefix);
        }
        return file.type === pattern;
      });
    }

    function handleDragEnter(e: DragEvent) {
      if (!isValidDrag(e)) return;

      e.preventDefault();
      dragCounter++;

      if (dragCounter === 1) {
        options.onDragStateChange?.(true);
      }
    }

    function handleDragOver(e: DragEvent) {
      if (!isValidDrag(e)) return;

      e.preventDefault();
      // Set dropEffect to indicate this is a valid drop target
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    }

    function handleDragLeave(_e: DragEvent) {
      // Some desktop browsers clear DataTransfer.types on dragleave. The
      // counter itself proves that a file drag entered this zone, while this
      // guard prevents an unmatched leave from poisoning the next drag.
      if (dragCounter === 0) return;

      dragCounter = Math.max(0, dragCounter - 1);

      if (dragCounter === 0) {
        options.onDragStateChange?.(false);
      }
    }

    function handleDrop(e: DragEvent) {
      // Preserve the browser/editor's normal handling for dropped text and
      // URLs. Only a real file drop belongs to this attachment.
      if (!isValidDrag(e)) return;

      e.preventDefault();
      dragCounter = 0;
      options.onDragStateChange?.(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      const validFiles = files.filter((f) => matchesMimeType(f, acceptedTypes));

      if (validFiles.length > 0) {
        options.onDrop(validFiles);
      }
    }

    // Attach event listeners
    element.addEventListener('dragenter', handleDragEnter);
    element.addEventListener('dragover', handleDragOver);
    element.addEventListener('dragleave', handleDragLeave);
    element.addEventListener('drop', handleDrop);

    // Return cleanup function
    return () => {
      element.removeEventListener('dragenter', handleDragEnter);
      element.removeEventListener('dragover', handleDragOver);
      element.removeEventListener('dragleave', handleDragLeave);
      element.removeEventListener('drop', handleDrop);
    };
  };
}
