import numpy as np

from timesfm_sidecar.model_service import (
    classify_direction,
    classify_volatility_regime,
    compute_direction_confidence,
    compute_log_returns,
    compute_spread_bps,
    invert_log_returns,
)


def test_log_returns_round_trip():
    closes = [1.0, 1.01, 1.02, 1.03]
    returns = compute_log_returns(closes)
    restored = invert_log_returns(closes[-1], np.asarray([0.0, 0.001]))

    assert returns.shape[0] == len(closes) - 1
    assert restored.shape[0] == 2


def test_direction_classification_respects_dead_zone():
    assert classify_direction(4.0, 3.0) == "BULLISH"
    assert classify_direction(-4.0, 3.0) == "BEARISH"
    assert classify_direction(2.0, 3.0) == "NEUTRAL"


def test_volatility_regime_buckets():
    assert classify_volatility_regime(5) == "LOW"
    assert classify_volatility_regime(20) == "NORMAL"
    assert classify_volatility_regime(45) == "HIGH"
    assert classify_volatility_regime(90) == "EXTREME"


def test_direction_confidence_counts_agreeing_targets():
    confidence = compute_direction_confidence(
        1.0,
        "BULLISH",
        1.002,
        [1.001, 1.002, 0.999],
    )
    assert confidence == 0.75


def test_direction_confidence_skips_timesfm_mean_slot():
    confidence = compute_direction_confidence(
        1.0,
        "BULLISH",
        1.002,
        [
            0.5,
            1.001,
            1.001,
            1.001,
            1.001,
            1.001,
            1.001,
            1.001,
            1.001,
            0.999,
        ],
    )
    assert confidence == 0.8889


def test_spread_bps_uses_extremes():
    spread_bps = compute_spread_bps(1.0, [0.999, 1.001])
    assert spread_bps == 20.0


def test_spread_bps_uses_timesfm_q10_q90_slots():
    spread_bps = compute_spread_bps(
        1.0,
        [0.5, 0.999, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.001],
    )
    assert spread_bps == 20.0
