"""Feature registry: a new rule is a function and one registration."""
from dataclasses import dataclass
from typing import Callable, Any


@dataclass(frozen=True)
class Feature:
    code: str
    label: str
    description: str
    default_weight: float
    calculate: Callable[[Any, int, int, Any, Any], tuple[float, str]]


def no_autoprolong(service, due, unfunded, settings, now):
    value = float(not service.autoProlong and due > 0)
    text = 'Автопродление отключено для предстоящего платежа' if value else ('Автопродление включено' if service.autoProlong else 'В горизонте нет платежей для продления')
    return value, text


def funding_gap(service, due, unfunded, settings, now):
    return unfunded / due if due else 0, f'Не покрыто балансом: {unfunded/100:.2f} EUR'


def payment_wait(service, due, unfunded, settings, now):
    waiting = service.status == 'prolong_wait'
    return float(waiting), 'Услуга ожидает оплаты' if waiting else 'Ожидания оплаты нет'


def expiry_urgency(service, due, unfunded, settings, now):
    days = (service.expiresAt - now).total_seconds() / 86400
    text = f'До срока оплаты: {days:.1f} дн.' if days >= 0 else f'Просрочка оплаты: {-days:.1f} дн.'
    return max(0, 1 - max(days, 0) / settings.urgency_days), text


REGISTRY = (
    Feature('no_autoprolong', 'Автопродление отключено', 'Ближайший платёж требует ручного действия', 25, no_autoprolong),
    Feature('funding_gap', 'Недостаток средств', 'Доля платежей, не покрытых общим балансом', 30, funding_gap),
    Feature('payment_wait', 'Ожидание оплаты', 'Услуга находится в пятидневном окне prolong_wait', 30, payment_wait),
    Feature('expiry_urgency', 'Близость срока оплаты', 'Срочность платежа в выбранном окне', 15, expiry_urgency),
)
FEATURE_METADATA = {f.code: {'label': f.label, 'description': f.description} for f in REGISTRY}
DEFAULT_WEIGHTS = {f.code: f.default_weight for f in REGISTRY}
