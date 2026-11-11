"""Generate the Shopping Concierge planning scenarios with Python 3."""

import json
from fractions import Fraction
from pathlib import Path

DELIVERY = 3_000
BASKET = 60_000
PAYMENT = BASKET + DELIVERY
# 15% of UGX 3,000 is UGX 450. The default fee step rounds it to UGX 500.
COMMISSION = 500
COLLECTION_COST = PAYMENT * Fraction(3, 100)
PAYOUT_COST = 500
CASH_FEE_RECOVERY = Fraction(95, 100)
VARIABLE_OPERATING_COST = 150


def order_economics(cash_share, commission=COMMISSION):
    digital_share = 1 - cash_share
    collected_fees = commission * (cash_share * CASH_FEE_RECOVERY + digital_share)
    payment_cost = digital_share * (COLLECTION_COST + PAYOUT_COST)
    return {
        "collected_fees": collected_fees,
        "payment_cost": payment_cost,
        "contribution": collected_fees - payment_cost - VARIABLE_OPERATING_COST,
    }


def projection(orders, fixed, cash_share, commission=COMMISSION):
    unit = order_economics(cash_share, commission)
    return {
        "orders": orders,
        "goods_value": orders * BASKET,
        "customer_order_value": orders * PAYMENT,
        "delivery_charges": orders * DELIVERY,
        "platform_fees_assessed": orders * commission,
        "platform_fee_income": orders * unit["collected_fees"],
        "payment_cost": orders * unit["payment_cost"],
        "variable_operating_cost": orders * VARIABLE_OPERATING_COST,
        "contribution": orders * unit["contribution"],
        "fixed_operating_cost": fixed,
        "operating_result": orders * unit["contribution"] - fixed,
    }


def main():
    years = [(6_000, 24_000_000), (18_000, 36_000_000), (36_000, 48_000_000)]
    base = [projection(orders, fixed, Fraction(80, 100)) for orders, fixed in years]
    sensitivities = {
        str(percent): {
            "per_order": order_economics(Fraction(percent, 100)),
            "year_three": projection(*years[-1], Fraction(percent, 100)),
        }
        for percent in (0, 50, 80, 95, 100)
    }
    baseline = projection(*years[-1], Fraction(80, 100), commission=0)
    result = {
        "currency": "UGX",
        "status": "Planning scenarios using code defaults and explicit assumptions",
        "inputs": {
            "goods_basket": BASKET,
            "delivery_fee": DELIVERY,
            "customer_service_and_processing_surcharges": 0,
            "assumed_delivery_commission_percent": 15,
            "rounded_commission": COMMISSION,
            "mobile_money_collection_cost": COLLECTION_COST,
            "digital_payout_allowance": PAYOUT_COST,
            "cash_fee_recovery_rate": CASH_FEE_RECOVERY,
            "variable_operating_cost": VARIABLE_OPERATING_COST,
            "base_cash_share": Fraction(80, 100),
        },
        "base_years": base,
        "cash_share_sensitivity_percent": sensitivities,
        "commission_off_year_three": baseline,
        "cumulative_base_operating_deficit": -sum(row["operating_result"] for row in base),
    }
    Path(__file__).with_name("financial-model.json").write_text(
        json.dumps(result, indent=2, default=float) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
