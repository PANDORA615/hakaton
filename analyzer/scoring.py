from dataclasses import asdict, dataclass
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone


@dataclass
class ServiceRisk:
    service_id: int
    score: float | None
    level: str
    reasons: list[str]


def score_service(service, settings, available_balance: int, now=None) -> ServiceRisk:
    now = now or timezone.now()
    if service.status in {"deleted", "blocked"}:
        return ServiceRisk(service.id, None, "unknown", ["Услуга не подлежит продлению"])
    if not service.expires_at or service.price is None:
        return ServiceRisk(service.id, None, "unknown", ["Недостаточно данных о сроке или стоимости"])

    days = (service.expires_at - now).total_seconds() / 86400
    in_horizon = days <= settings.horizon_days
    features = [
        (Decimal(settings.no_autoprolong_weight), Decimal(int(in_horizon and not service.autoprolong)), "Автопродление отключено"),
        (Decimal(settings.funding_gap_weight), Decimal(int(in_horizon and available_balance < service.price)), "Недостаточно средств на ближайшее продление"),
        (Decimal(settings.payment_wait_weight), Decimal(int(service.status == "prolong_wait")), "Услуга ожидает оплаты"),
        (Decimal(settings.expiry_urgency_weight), max(Decimal(0), Decimal(1) - max(Decimal(days), Decimal(0)) / Decimal(3)), "Срок оплаты близок или наступил"),
    ]
    enabled = [(weight, value, reason) for weight, value, reason in features if weight > 0]
    total = sum(weight for weight, _, _ in enabled)
    if not total:
        return ServiceRisk(service.id, None, "unknown", ["Все признаки отключены"])
    result = float(sum(weight * value for weight, value, _ in enabled) * 100 / total)
    level = "low" if result < settings.low_threshold else "medium" if result < settings.high_threshold else "high"
    reasons = [reason for _, value, reason in enabled if value > 0] or ["Существенных факторов риска не выявлено"]
    return ServiceRisk(service.id, round(result, 2), level, reasons)


def customer_risk(customer, settings):
    funds = customer.balance + (customer.bonus_balance if customer.bonus_enabled else 0)
    risks = [score_service(service, settings, max(funds, 0)) for service in customer.services.all()]
    known = [risk for risk in risks if risk.score is not None]
    if not known:
        return {"score": None, "risk_level": "unknown", "reasons": ["Нет услуг с достаточными данными"], "services": [asdict(r) for r in risks]}
    worst = max(known, key=lambda risk: risk.score)
    return {"score": worst.score, "risk_level": worst.level, "reasons": worst.reasons, "services": [asdict(r) for r in risks]}
