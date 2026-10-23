"""Deterministic, explainable index. Not a calibrated churn probability."""
from collections import Counter, defaultdict
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from dateutil.relativedelta import relativedelta
from .schemas import Snapshot, Settings
from .features import REGISTRY

# Aéza - это быстрый хостинг
RENEWABLE = {'active', 'suspended', 'prolong_wait'}
CALCULATION_SCHEMA_VERSION = 2


def D(value):
    return Decimal(str(value))


def eur(cents):
    return float((D(cents) / 100).quantize(D('.01'), rounding=ROUND_HALF_UP))


def add_term(value, term, count=1):
    if term == 'hour':
        return value + timedelta(hours=count)
    if term == 'week':
        return value + timedelta(weeks=count)
    return value + relativedelta(months={'month': 1, 'quarter_year': 3, 'half_year': 6, 'year': 12}[term] * count)


def quality(service, now):
    if service.createdAt > now:
        return 'Дата создания услуги позже времени расчёта'
    if service.status == 'prolong_wait':
        overdue = (now - service.expiresAt).total_seconds() / 86400
        if overdue < 0:
            return 'Ожидание оплаты началось до срока окончания услуги'
        if overdue > 5:
            return f'Ожидание оплаты длится {overdue:.1f} дн. при допустимых 5 днях'
    if service.status in {'active', 'suspended'} and service.expiresAt < now:
        return 'Срок услуги истёк, но источник сохраняет действующий статус'
    return None


def schedule(service, now, end):
    if service.status == 'prolong_wait':
        return [(now, service.price)]
    result, n = [], 0
    while True:
        at = add_term(service.expiresAt, service.paymentTerm, n)
        if at > end:
            break
        if at >= now:
            result.append((at, service.price))
        n += 1
    return result


def score_service(service, allocated, settings, now):
    due, unfunded = allocated
    calculated = {f.code: f.calculate(service, due, unfunded, settings, now) for f in REGISTRY}
    values = {code: pair[0] for code, pair in calculated.items()}
    total_weight = sum(D(w) for w in settings.weights.values())
    contributions = {k: D(settings.weights[k]) * D(v) * 100 / total_weight for k, v in values.items()}
    score = sum(contributions.values())
    level = 'high' if score >= D(settings.high_threshold) else 'medium' if score >= D(settings.medium_threshold) else 'low'
    texts = {code: pair[1] for code, pair in calculated.items()}
    reasons = [{'code': k, 'text': texts[k], 'value': v, 'weight': settings.weights[k], 'contribution': round(float(contributions[k]), 2)} for k, v in values.items()]
    reasons.sort(key=lambda r: r['contribution'], reverse=True)
    factor = D(settings.funded_multiplier) + (1 - D(settings.funded_multiplier)) * (D(unfunded) / due if due else 0)
    loss = D(due) * score / 100 * factor
    return dict(score=round(float(score), 2), risk_level=level, reasons=reasons, coverage=1, due_cents=due,
                unfunded_cents=unfunded, loss_cents=float(loss), loss_eur=eur(loss), missing_fields=[])


def calculate(snapshot: Snapshot, settings: Settings, now):
    customers, warnings, end = [], [], now + timedelta(days=settings.horizon_days)
    daily = { (now + timedelta(days=i)).date().isoformat(): {'due_cents': 0, 'payments': 0, 'risk_cents': D(0), 'risk_services': set()} for i in range(settings.horizon_days + 1) }
    by_owner, by_service = defaultdict(list), defaultdict(list)
    for service in snapshot.services:
        by_owner[service.ownerId].append(service)
    for tx in snapshot.transactions:
        by_service[tx.serviceId].append(tx.model_dump(mode='json'))
    total_due, total_unfunded, total_loss, unknown_services = 0, 0, D(0), 0
    for account in snapshot.accounts:
        available = account.balance + (account.bonusBalance if account.bonusState == 'unlocked' else 0)
        payments, allocations, service_rows = [], {}, []
        services = by_owner[account.id]
        errors = {s.id: quality(s, now) for s in services if s.status in RENEWABLE}
        for service in services:
            allocations[service.id] = [0, 0]
            if service.status in RENEWABLE and not errors[service.id]:
                payments.extend((at, service.id, amount) for at, amount in schedule(service, now, end))
        for _, sid, amount in sorted(payments):
            covered = min(available, amount)
            available -= covered
            allocations[sid][0] += amount
            allocations[sid][1] += amount - covered
        payments_by_service = defaultdict(list)
        for at, payment_service_id, amount in payments:
            payments_by_service[payment_service_id].append((at, amount))
            bucket = daily[at.date().isoformat()]
            bucket['due_cents'] += amount
            bucket['payments'] += 1
        for service in services:
            row = service.model_dump(mode='json')
            row['transactions'] = by_service[service.id]
            row['quality_warning'] = errors.get(service.id)
            if service.status not in RENEWABLE or errors[service.id]:
                reason = errors.get(service.id) or ('Услуга удалена' if service.status == 'deleted' else 'Продление заблокировано')
                row.update(score=None, risk_level='unknown', reasons=[{'text': reason}], coverage=0,
                           due_cents=None, unfunded_cents=None, loss_cents=None, loss_eur=None, missing_fields=[])
                if service.status in RENEWABLE:
                    unknown_services += 1
                    warnings.append(dict(service_id=service.id, customer_id=account.id, message=reason))
            else:
                row.update(score_service(service, allocations[service.id], settings, now))
                total_due += row['due_cents']
                total_unfunded += row['unfunded_cents']
                total_loss += D(row['loss_cents'])
                if row['due_cents']:
                    for at, amount in payments_by_service[service.id]:
                        bucket = daily[at.date().isoformat()]
                        bucket['risk_cents'] += D(row['loss_cents']) * D(amount) / D(row['due_cents'])
                        if row['risk_level'] in {'medium', 'high'}:
                            bucket['risk_services'].add(service.id)
            service_rows.append(row)
        eligible = [s for s in service_rows if s['status'] in RENEWABLE]
        scored = [s for s in eligible if s['score'] is not None]
        known = bool(eligible) and len(scored) == len(eligible)
        worst = max(scored, key=lambda s: s['score'], default=None)
        active_reasons = [r['text'] for r in worst['reasons'] if r.get('contribution', 0) > 0] if worst else []
        explanation = ('; '.join(active_reasons[:2]) or 'Ближайшие платежи покрыты, выраженных факторов риска нет') if known else (
            'Нет услуг, доступных для продления' if not eligible else 'Оценка неполная: несогласованные сроки услуг')
        customers.append({**account.model_dump(), 'score': worst['score'] if known else None,
                          'partial_score': worst['score'] if worst else None,
                          'risk_level': worst['risk_level'] if known else 'unknown', 'reason': explanation,
                          'services': service_rows, 'service_count': len(services),
                          'eligible_count': len(eligible), 'scored_count': len(scored),
                          'available_cents': account.balance + (account.bonusBalance if account.bonusState == 'unlocked' else 0),
                          'loss_eur': eur(sum(D(s['loss_cents']) for s in scored)),
                          'due_eur': eur(sum(s['due_cents'] for s in scored)),
                          'unfunded_eur': eur(sum(s['unfunded_cents'] for s in scored)),
                          'money_partial': len(scored) != len(eligible)})
    counts = {k: 0 for k in ('low', 'medium', 'high', 'unknown')}
    counts.update(Counter(c['risk_level'] for c in customers))
    known_scores = [c['score'] for c in customers if c['score'] is not None]
    return {'schema_version': CALCULATION_SCHEMA_VERSION, 'customers': customers, 'summary': {
        'customer_count': len(customers), 'service_count': len(snapshot.services), 'transaction_count': len(snapshot.transactions),
        'risk_counts': counts, 'loss_eur': eur(total_loss), 'due_eur': eur(total_due),
        'unfunded_eur': eur(total_unfunded), 'money_unknown_services': unknown_services, 'money_partial': bool(unknown_services),
        'score_mean': round(sum(known_scores) / len(known_scores), 2) if known_scores else None,
        'scored_customer_count': len(known_scores), 'horizon_days': settings.horizon_days, 'warnings': warnings,
        'renewal_calendar': [{'day': day, 'due_eur': eur(value['due_cents']), 'payments': value['payments'],
                              'risk_eur': eur(value['risk_cents']), 'risk_services': len(value['risk_services'])} for day, value in daily.items()],
    }}
