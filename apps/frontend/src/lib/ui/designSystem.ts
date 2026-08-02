export type DesignSystemModule = '$lib/ui' | '$lib/ui/form';

export type DesignSystemFamily =
  | 'shell'
  | 'layout'
  | 'overlay'
  | 'navigation'
  | 'feedback'
  | 'form';

export type DesignSystemPresentation =
  | 'static'
  | 'native'
  | 'floating'
  | 'modal'
  | 'adaptive';

export type DesignSystemPrimitive = {
  name: string;
  module: DesignSystemModule;
  family: DesignSystemFamily;
  presentation: DesignSystemPresentation;
  useWhen: string;
  avoidWhen: string;
  responsive: string;
  accessibility: string;
  story?: string;
};

export const DESIGN_SYSTEM_FAMILIES: readonly DesignSystemFamily[] = [
  'shell',
  'layout',
  'overlay',
  'navigation',
  'feedback',
  'form'
] as const;

export const DESIGN_SYSTEM_PRIMITIVES: readonly DesignSystemPrimitive[] = [
  {
    name: 'AppHeader',
    module: '$lib/ui',
    family: 'shell',
    presentation: 'static',
    useWhen: 'Rendering the persistent application-level header and its shell controls.',
    avoidWhen: 'A pane or room-local heading is sufficient.',
    responsive: 'Preserve safe-area spacing and compact controls without hiding primary navigation.',
    accessibility: 'Keep the landmark and every icon action explicitly named.'
  },
  {
    name: 'BottomSheet',
    module: '$lib/ui',
    family: 'overlay',
    presentation: 'modal',
    useWhen: 'Presenting touch-first actions or compact content from the bottom edge.',
    avoidWhen: 'Pointer users need a spatially anchored menu or the task needs a full dialog flow.',
    responsive: 'Bind to the visual viewport, respect safe areas, and keep short-height content scrollable.',
    accessibility: 'Provide an accessible name and an explicit close path in addition to drag dismissal.',
    story: './BottomSheet.stories.svelte'
  },
  {
    name: 'ConfirmDialog',
    module: '$lib/ui',
    family: 'overlay',
    presentation: 'modal',
    useWhen: 'Confirming a consequential command with one clearly named action.',
    avoidWhen: 'The action is reversible, low risk, or requires a multi-field form.',
    responsive: 'Keep the consequence and actions visible within bounded dialog geometry.',
    accessibility: 'Use the correct semantic tone, focus order, busy state, and focus restoration.',
    story: './ConfirmDialog.stories.svelte'
  },
  {
    name: 'ContextMenu',
    module: '$lib/ui',
    family: 'overlay',
    presentation: 'adaptive',
    useWhen: 'Offering contextual actions that must become a sheet on touch-primary devices.',
    avoidWhen: 'The action set is persistent navigation or requires a committed form workflow.',
    responsive: 'Choose floating or sheet presentation from input capability rather than width alone.',
    accessibility: 'Name the menu, use menu-item semantics, support Escape, and preserve explicit dismissal.',
    story: './ContextMenu.stories.svelte'
  },
  {
    name: 'Dialog',
    module: '$lib/ui',
    family: 'overlay',
    presentation: 'modal',
    useWhen: 'Displaying focused custom content that does not fit a more specific dialog primitive.',
    avoidWhen: 'FormDialog or ConfirmDialog already expresses the complete interaction.',
    responsive: 'Bound width and dynamic height; promote to a mobile surface only when content requires it.',
    accessibility: 'Provide a visible title or aria label, trap focus, and restore the trigger focus.',
    story: './Dialog.stories.svelte'
  },
  {
    name: 'Divider',
    module: '$lib/ui',
    family: 'layout',
    presentation: 'static',
    useWhen: 'Separating adjacent content groups that already have a clear visual hierarchy.',
    avoidWhen: 'Spacing or a section heading communicates the relationship more clearly.',
    responsive: 'Do not consume scarce mobile space or create repeated visual noise.',
    accessibility: 'Remain decorative unless the separator conveys a semantic boundary.'
  },
  {
    name: 'EmptyState',
    module: '$lib/ui',
    family: 'feedback',
    presentation: 'static',
    useWhen: 'Explaining an empty collection, no-result state, or next available action.',
    avoidWhen: 'Content is still loading or failed and needs a dedicated status or retry state.',
    responsive: 'Keep the message concise and the optional action reachable in narrow containers.',
    accessibility: 'Use meaningful text; decorative icons must not become the only explanation.',
    story: './EmptyState.stories.svelte'
  },
  {
    name: 'FormDialog',
    module: '$lib/ui',
    family: 'form',
    presentation: 'modal',
    useWhen: 'Collecting and submitting a bounded set of fields inside a dialog.',
    avoidWhen: 'The task deserves a route, or no data entry is required.',
    responsive: 'Keep validation and fixed actions reachable with the software keyboard open.',
    accessibility: 'Associate labels, descriptions, errors, busy state, and submit ownership.',
    story: './FormDialog.stories.svelte'
  },
  {
    name: 'FormSection',
    module: '$lib/ui',
    family: 'form',
    presentation: 'static',
    useWhen: 'Grouping related settings or fields under one concise heading.',
    avoidWhen: 'A single field needs no additional hierarchy.',
    responsive: 'Allow content and actions to stack without introducing nested horizontal scrolling.',
    accessibility: 'Use a heading level consistent with the surrounding form structure.'
  },
  {
    name: 'FloatingPopover',
    module: '$lib/ui',
    family: 'overlay',
    presentation: 'floating',
    useWhen: 'Building a low-level anchored or point-positioned overlay in the browser top layer.',
    avoidWhen: 'ContextMenu, HelpTooltip, or another higher-level primitive already owns the semantics.',
    responsive: 'Clamp to every viewport edge and reposition after content-size changes.',
    accessibility: 'The caller owns the correct role, accessible name, keyboard behavior, and focus contract.'
  },
  {
    name: 'FloatingTooltip',
    module: '$lib/ui',
    family: 'feedback',
    presentation: 'floating',
    useWhen: 'Showing brief non-interactive clarification near a trigger.',
    avoidWhen: 'The information is required to complete the task or contains interactive controls.',
    responsive: 'Stay viewport-bounded and avoid obscuring the trigger on compact screens.',
    accessibility: 'Connect the description to the trigger and never make hover the only discovery path.'
  },
  {
    name: 'Frame',
    module: '$lib/ui',
    family: 'layout',
    presentation: 'static',
    useWhen: 'Applying Towk’s canonical framed surface around a coherent content region.',
    avoidWhen: 'The surrounding shell already supplies the same boundary and depth.',
    responsive: 'Preserve concentric radii and remove decorative nesting when space is constrained.',
    accessibility: 'Do not use visual framing as a substitute for headings or landmarks.'
  },
  {
    name: 'HeaderIconButton',
    module: '$lib/ui',
    family: 'navigation',
    presentation: 'static',
    useWhen: 'Placing a compact, named action in a canonical header control group.',
    avoidWhen: 'The action needs a visible text label to remain understandable.',
    responsive: 'Keep the full touch target even when only the glyph is visible.',
    accessibility: 'Require an accessible label, real disabled state, and visible focus treatment.'
  },
  {
    name: 'HelpTooltip',
    module: '$lib/ui',
    family: 'feedback',
    presentation: 'floating',
    useWhen: 'Attaching optional contextual help to a form label or compact control.',
    avoidWhen: 'The explanation is required, lengthy, or should remain visible.',
    responsive: 'Remain operable by touch and keyboard without depending on hover.',
    accessibility: 'Expose the help trigger and associate the tooltip text as a description.'
  },
  {
    name: 'Hint',
    module: '$lib/ui',
    family: 'feedback',
    presentation: 'static',
    useWhen: 'Displaying persistent supporting guidance next to a control or setting.',
    avoidWhen: 'The message is an error, transient notice, or optional tooltip.',
    responsive: 'Wrap naturally and preserve readable line length.',
    accessibility: 'Associate the hint with the control when it changes how the field is understood.'
  },
  {
    name: 'ImageModal',
    module: '$lib/ui',
    family: 'overlay',
    presentation: 'modal',
    useWhen: 'Inspecting an image at a larger scale without leaving the current conversation.',
    avoidWhen: 'The media requires playback controls or a dedicated route.',
    responsive: 'Contain intrinsic media inside the visual viewport and safe areas.',
    accessibility: 'Preserve alternative text, keyboard dismissal, and restored focus.'
  },
  {
    name: 'PaneHeader',
    module: '$lib/ui',
    family: 'navigation',
    presentation: 'static',
    useWhen: 'Heading a navigable pane with consistent title, context, and actions.',
    avoidWhen: 'The content is a small card or inline section.',
    responsive: 'Collapse secondary labels before shrinking action targets or clipping the title.',
    accessibility: 'Use a logical heading and explicitly name every compact action.'
  },
  {
    name: 'Pill',
    module: '$lib/ui',
    family: 'feedback',
    presentation: 'static',
    useWhen: 'Showing a compact status, category, or immutable attribute.',
    avoidWhen: 'The element is interactive or needs checkbox/button semantics.',
    responsive: 'Truncate only when the full value remains available elsewhere.',
    accessibility: 'Do not communicate state by color alone.'
  },
  {
    name: 'ToggleChip',
    module: '$lib/ui',
    family: 'form',
    presentation: 'native',
    useWhen: 'Toggling a compact option where the selected state remains immediately visible.',
    avoidWhen: 'The choice is mutually exclusive across a larger set or needs explanatory copy.',
    responsive: 'Maintain a full touch target and allow labels to wrap without changing meaning.',
    accessibility: 'Expose pressed or checked state and preserve keyboard activation.'
  },
  {
    name: 'TopOverlayNotice',
    module: '$lib/ui',
    family: 'feedback',
    presentation: 'static',
    useWhen: 'Showing a high-priority transient notice above the active application surface.',
    avoidWhen: 'The message belongs inline, needs confirmation, or can be represented by a toast.',
    responsive: 'Stay within safe areas and avoid covering primary navigation or composer controls.',
    accessibility: 'Use an appropriate live-region priority without repeatedly announcing stable content.'
  },
  {
    name: 'Form',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'native',
    useWhen: 'Owning native form submission, validation summary, and related field lifecycle.',
    avoidWhen: 'There is no committed submit action.',
    responsive: 'Keep the submit path visible and usable with a software keyboard.',
    accessibility: 'Retain native form semantics and prevent duplicate submission while busy.'
  },
  {
    name: 'FormField',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'static',
    useWhen: 'Binding a label, description, required state, and validation error to one control.',
    avoidWhen: 'The child is not a form control or already owns the complete association.',
    responsive: 'Allow descriptions and errors to wrap without changing field width.',
    accessibility: 'Generate stable label and description relationships.'
  },
  {
    name: 'TextInput',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'native',
    useWhen: 'Collecting a short single-line value with Towk form semantics.',
    avoidWhen: 'The value is multiline, selected from a constrained list, or security-sensitive without the proper type.',
    responsive: 'Use the available column width and preserve platform zoom-safe font sizing.',
    accessibility: 'Provide autocomplete, input type, label, error, and disabled semantics appropriate to the data.'
  },
  {
    name: 'TextArea',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'native',
    useWhen: 'Collecting bounded multiline text.',
    avoidWhen: 'Rich text, code editing, or a single-line value requires another control.',
    responsive: 'Bound growth and keep actions reachable above the keyboard.',
    accessibility: 'Expose limits, descriptions, errors, and remaining-character behavior when present.'
  },
  {
    name: 'Select',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'native',
    useWhen: 'Choosing one value from a short, static option list.',
    avoidWhen: 'Users need search, freeform entry, rich option content, or a very large data set.',
    responsive: 'Prefer the native platform picker and fill the available form column.',
    accessibility: 'Keep a native label, disabled state, and invalid relationship.'
  },
  {
    name: 'Combobox',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'adaptive',
    useWhen: 'Searching or entering a value while offering a bounded list of suggestions.',
    avoidWhen: 'A static native select or plain text field is sufficient.',
    responsive: 'Keep the anchored list viewport-bounded and avoid fixed widths wider than the form surface.',
    accessibility: 'Maintain input focus, expose the active descendant, and announce loading, empty, and selected states.',
    story: './form/Combobox.stories.svelte'
  },
  {
    name: 'Checkbox',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'native',
    useWhen: 'Selecting an independent boolean option or a set of independent options.',
    avoidWhen: 'The action executes immediately or choices are mutually exclusive.',
    responsive: 'Keep the label and control in one touch target without clipping long translations.',
    accessibility: 'Use the native checked, indeterminate, disabled, label, and description semantics.'
  },
  {
    name: 'Button',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'native',
    useWhen: 'Executing a committed action or presenting an anchor with button emphasis.',
    avoidWhen: 'A passive status, toggle, or unlabeled decorative icon is intended.',
    responsive: 'Use 44 px touch targets where compact surfaces require them and stack only when the container requires it.',
    accessibility: 'Preserve native disabled and busy states, visible focus, and an unambiguous label.',
    story: './form/Button.stories.svelte'
  },
  {
    name: 'FormError',
    module: '$lib/ui/form',
    family: 'feedback',
    presentation: 'static',
    useWhen: 'Displaying a validation or submission error owned by a form region.',
    avoidWhen: 'The status is success, warning, or a global application failure.',
    responsive: 'Wrap the message without causing horizontal overflow.',
    accessibility: 'Associate field errors directly and announce submission errors at the correct priority.'
  },
  {
    name: 'ExpirySelect',
    module: '$lib/ui/form',
    family: 'form',
    presentation: 'native',
    useWhen: 'Selecting one of Towk’s canonical expiry durations.',
    avoidWhen: 'Arbitrary date/time scheduling or a domain-specific duration is required.',
    responsive: 'Fit the containing form and preserve localized option readability.',
    accessibility: 'Retain the underlying select label, description, disabled, and invalid semantics.'
  }
] as const;
