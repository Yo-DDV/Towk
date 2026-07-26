package connectapi

import (
	"testing"

	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

func TestReadReceiptSummarySchemaDoesNotExposeReaderIdentities(t *testing.T) {
	fields := (&apiv1.ReadReceiptSummary{}).ProtoReflect().Descriptor().Fields()
	if field := fields.ByName("preview_user_ids"); field != nil {
		t.Fatalf("read receipt summary exposes identity field %q", field.Name())
	}
}
