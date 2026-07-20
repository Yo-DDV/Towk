import { timestampDate, type Timestamp } from '@bufbuild/protobuf/wkt';

export function protobufTimestampToISOString(value: Timestamp | undefined): string | undefined {
  return value ? timestampDate(value).toISOString() : undefined;
}
