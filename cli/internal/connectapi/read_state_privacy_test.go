package connectapi

import (
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"

	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

func TestReadReceiptSummarySchemaIsCountOnly(t *testing.T) {
	fields := (&apiv1.ReadReceiptSummary{}).ProtoReflect().Descriptor().Fields()
	for _, name := range []string{"preview_user_ids", "latest_read_at"} {
		if field := fields.ByName(protoreflect.Name(name)); field != nil {
			t.Fatalf("read receipt summary exposes private field %q", field.Name())
		}
	}
}
