import * as m from '$lib/i18n/messages';

import { MAX_DISPLAY_NAME_LENGTH } from './displayName';
import { MAX_LOGIN_LENGTH, MIN_LOGIN_LENGTH } from './login';
import type { ValidationErrorCode } from './displayName';

export function validationErrorMessage(code: ValidationErrorCode | undefined): string | null {
  switch (code) {
    case 'display_name_empty':
      return m['settings.profile.validation.display_name_empty']();
    case 'display_name_too_long':
      return m['settings.profile.validation.display_name_too_long']({
        max: MAX_DISPLAY_NAME_LENGTH
      });
    case 'display_name_consecutive_spaces':
      return m['settings.profile.validation.display_name_consecutive_spaces']();
    case 'display_name_invalid_start':
      return m['settings.profile.validation.display_name_invalid_start']();
    case 'display_name_control_characters':
      return m['settings.profile.validation.display_name_control_characters']();
    case 'display_name_invisible_characters':
      return m['settings.profile.validation.display_name_invisible_characters']();
    case 'display_name_invalid_characters':
      return m['settings.profile.validation.display_name_invalid_characters']();
    case 'username_empty':
      return m['settings.profile.validation.username_empty']();
    case 'username_too_short':
      return m['settings.profile.validation.username_too_short']({ min: MIN_LOGIN_LENGTH });
    case 'username_too_long':
      return m['settings.profile.validation.username_too_long']({ max: MAX_LOGIN_LENGTH });
    case 'username_invalid_start':
      return m['settings.profile.validation.username_invalid_start']();
    case 'username_invalid_characters':
      return m['settings.profile.validation.username_invalid_characters']();
    default:
      return null;
  }
}
