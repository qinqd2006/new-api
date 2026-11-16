package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/QuantumNous/new-api/setting/system_setting"
)

func paymentReturnPath(suffix string) string {
	base := strings.TrimRight(common.PublicWebURL(system_setting.ServerAddress), "/")
	return base + suffix
}
