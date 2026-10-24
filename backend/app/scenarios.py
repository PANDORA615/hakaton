"""Explicit synthetic additions. Never edits original rows."""
from copy import deepcopy
from datetime import timedelta


def demo_snapshot(original, now):
    result = deepcopy(original)
    definitions = [
        (1001, 'growth-studio', 0, False, 'prolong_wait', -1, 12500, 'locked', 0),
        (1002, 'cloud-lab', 1500, False, 'active', 1, 10000, 'locked', 0),
        (1003, 'north-team', 80000, True, 'active', 4, 24000, 'unlocked', 5000),
        (1004, 'design-bureau', 0, False, 'active', 2, 6000, 'unlocked', 10000),
        (1005, 'shared-balance', 8000, True, 'active', 1, 7000, 'locked', 0),
        (1006, 'bonus-locked', 0, True, 'prolong_wait', -2, 18000, 'locked', 30000),
    ]
    for id_, name, balance, auto, status, days, price, bonus_state, bonus in definitions:
        if any(a['id'] == id_ for a in result['accounts']):
            continue
        result['accounts'].append(dict(id=id_, email=f'demo-{name}@example.test', balance=balance, withdrawBalance=0,
                                       totalReplenished=120000 + id_, bonusBalance=bonus, bonusState=bonus_state))
        result['services'].append(dict(id=id_, name=f'demo-{name}', ownerId=id_, paymentTerm='month', autoProlong=auto,
            createdAt=(now - timedelta(days=30)).isoformat(), expiresAt=(now + timedelta(days=days)).isoformat(), status=status, price=price))
        if id_ == 1005:
            result['services'].append(dict(id=2005, name='demo-shared-second', ownerId=id_, paymentTerm='month', autoProlong=True,
                createdAt=(now-timedelta(days=30)).isoformat(), expiresAt=(now+timedelta(days=2)).isoformat(), status='active', price=7000))
    return result
