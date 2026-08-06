package core

// Position constants for role display/order and legacy event compatibility.
// Positions never participate in authorization.
const (
	//   everyone   = 0
	//   custom     = 1..49 and 51..99
	//   helper     = 50
	//   moderator  = 100
	//   admin      = 900
	//   owner      = 1000
	PositionEveryone    int32 = 0
	PositionCustomFirst int32 = 1
	PositionHelper      int32 = 50
	PositionModerator   int32 = 100
	PositionAdmin       int32 = 900
	PositionOwner       int32 = 1000
)

func isSystemPosition(position int32) bool {
	return position == PositionHelper ||
		position == PositionModerator ||
		position == PositionAdmin ||
		position == PositionOwner
}
