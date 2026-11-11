"""Generate the Shopping Concierge pricing and financial scenarios with Python 3."""

import json
from fractions import Fraction
from pathlib import Path

SHOPPING_FEE = 1_000
RIDE_MINIMUM = 2_000
FIRST_BAND_KM = 2
FIRST_BAND_RATE = 1_500
LATER_BAND_RATE = 1_000
PLATFORM_SHARE_PER_SIDE = Fraction(25, 1000)
MOBILE_MONEY_RATE = Fraction(3, 100)
PAYOUT_COST = 500
CASH_RIDER_FEE_RECOVERY = Fraction(95, 100)
VARIABLE_OPERATING_COST = 150


def quote(goods, distance_km):
    # Illustrative marginal distance bands. Example distances are whole kilometres.
    ride = max(
        RIDE_MINIMUM,
        min(distance_km, FIRST_BAND_KM) * FIRST_BAND_RATE
        + max(0, distance_km - FIRST_BAND_KM) * LATER_BAND_RATE,
    )
    delivery = ride + SHOPPING_FEE
    subtotal = goods + delivery
    share = subtotal * PLATFORM_SHARE_PER_SIDE
    return {
        "goods": goods,
        "distance_km": distance_km,
        "ride": ride,
        "shopping": SHOPPING_FEE,
        "delivery": delivery,
        "subtotal": subtotal,
        "customer_share": share,
        "rider_share": share,
        "customer_total": subtotal + share,
        "rider_delivery_earnings": delivery - share,
        "platform_fee_assessed": 2 * share,
    }


def order_economics(pricing, cash_share):
    digital_share = 1 - cash_share
    cash_income = (
        pricing["customer_share"] + pricing["rider_share"] * CASH_RIDER_FEE_RECOVERY
    )
    collected_fees = cash_share * cash_income + digital_share * pricing["platform_fee_assessed"]
    payment_cost = digital_share * (pricing["customer_total"] * MOBILE_MONEY_RATE + PAYOUT_COST)
    return {
        "collected_fees": collected_fees,
        "payment_cost": payment_cost,
        "contribution": collected_fees - payment_cost - VARIABLE_OPERATING_COST,
    }


def projection(pricing, orders, fixed, cash_share):
    unit = order_economics(pricing, cash_share)
    return {
        "orders": orders,
        "goods_value": orders * pricing["goods"],
        "delivery_charges": orders * pricing["delivery"],
        "customer_order_value": orders * pricing["customer_total"],
        "customer_fee_assessed": orders * pricing["customer_share"],
        "rider_fee_assessed": orders * pricing["rider_share"],
        "platform_fees_assessed": orders * pricing["platform_fee_assessed"],
        "platform_fee_income": orders * unit["collected_fees"],
        "payment_cost": orders * unit["payment_cost"],
        "variable_operating_cost": orders * VARIABLE_OPERATING_COST,
        "contribution": orders * unit["contribution"],
        "fixed_operating_cost": fixed,
        "operating_result": orders * unit["contribution"] - fixed,
    }


def main():
    reference = quote(60_000, 1)
    years = [(6_000, 24_000_000), (18_000, 36_000_000), (36_000, 48_000_000)]
    base_cash_share = Fraction(80, 100)
    base = [projection(reference, orders, fixed, base_cash_share) for orders, fixed in years]
    sensitivities = {
        str(percent): {
            "per_order": order_economics(reference, Fraction(percent, 100)),
            "year_three": projection(reference, *years[-1], Fraction(percent, 100)),
        }
        for percent in (0, 50, 80, 95, 100)
    }
    result = {
        "currency": "UGX",
        "status": "Founder pricing policy with illustrative distance bands and planning assumptions",
        "inputs": {
            "ride_minimum": RIDE_MINIMUM,
            "shopping_fee": SHOPPING_FEE,
            "illustrative_first_band_km": FIRST_BAND_KM,
            "illustrative_first_band_ugx_per_km": FIRST_BAND_RATE,
            "illustrative_later_band_ugx_per_km": LATER_BAND_RATE,
            "platform_share_per_side": PLATFORM_SHARE_PER_SIDE,
            "mobile_money_collection_rate": MOBILE_MONEY_RATE,
            "digital_payout_allowance": PAYOUT_COST,
            "cash_rider_fee_recovery_rate": CASH_RIDER_FEE_RECOVERY,
            "variable_operating_cost": VARIABLE_OPERATING_COST,
            "base_cash_share": base_cash_share,
        },
        "example_quotes": [quote(goods, km) for goods, km in
                           [(10_000, 1), (20_000, 2), (40_000, 3), (60_000, 1), (60_000, 5)]],
        "reference_quote": reference,
        "base_years": base,
        "cash_share_sensitivity_percent": sensitivities,
        "cumulative_base_operating_result": sum(row["operating_result"] for row in base),
    }
    Path(__file__).with_name("financial-model.json").write_text(
        json.dumps(result, indent=2, default=float) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
