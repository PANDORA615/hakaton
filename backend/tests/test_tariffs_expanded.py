"""Price/billing fixtures modeled on each provider's public fixed-plan markup."""
import json

from app.tariffs import parse_adminvps, parse_beget, parse_selectel


def test_selectel_daily_prices_are_explicit_30_day_equivalents():
    specs = [(1, 1, 10, '6,58'), (1, 2, 25, '8,22'), (2, 2, 40, '13,15'),
             (2, 4, 50, '21,37'), (4, 8, 80, '36,16'), (6, 12, 120, '65,75'),
             (8, 16, 160, '98,63')]
    page = ''.join(f'<div class="tariff-card"><h4>VDS {cpu}-{ram}-{disk}</h4><table>'
                   f'<tr><td>vCPU</td><td>{cpu}</td></tr><tr><td>RAM</td><td>{ram}&nbsp;ГБ</td></tr>'
                   f'<tr><td>Диск</td><td>{disk}&nbsp;ГБ</td></tr></table>'
                   f'<b class="tariff-card__bold">{daily}</b> ₽/день</div>'
                   for cpu, ram, disk, daily in specs)
    plans = parse_selectel('<p>3 ТБ внешнего трафика в месяц</p>'+page)
    assert len(plans) == 7
    assert plans[0]['native_price_rub'] == 6.58
    assert plans[0]['price_rub'] == 197.4
    assert plans[-1]['price_rub'] == 2958.9
    assert all(p['billing'] == 'daily_30_day_equivalent' for p in plans)
    assert all(p['traffic_tb'] == 3 for p in plans)
    assert len(parse_selectel(page.rsplit('<div class="tariff-card">', 1)[0])) == 6


def test_adminvps_reads_every_fixed_one_month_plan_without_prepayment_discounts():
    header = '<tr><th>Тариф</th><th>CPU</th><th>RAM</th><th>NVMe</th><th>1 мес.</th><th>6 мес.</th></tr>'
    tables = []
    for family, count in enumerate((7, 7, 4)):
        rows = ''.join(f'<tr><td>{"WIN" if family == 2 else "Plan"}{i}</td><td>{i} x 3,6 ГГц</td>'
                       f'<td>{i} Гб</td><td>{i*15} Гб</td><td>{i*349} ₽</td><td>99 ₽ -90%</td></tr>'
                       for i in range(1, count+1))
        tables.append('<table>'+header+rows+'</table>')
    plans = parse_adminvps(''.join(tables))
    assert len(plans) == 18
    assert plans[0]['price_rub'] == 349
    assert plans[-1]['os_family'] == 'Windows'
    assert all(p['price_rub'] >= 349 for p in plans)


def test_beget_fixed_plans_include_separate_public_ipv4_price():
    data = [None]
    def add(value):
        data.append(value)
        return len(data)-1
    region = add('ru1')
    monthly_ip = add(150)
    pricing = add({'ru1': add({'price_ipv4_per_month': monthly_ip})})
    public_ip = add({'pricing': pricing})
    plan_ids = []
    for i in range(10):
        specs = add({'cpu_cores': add(2), 'memory_size': add(2048), 'disk_size': add(30720)})
        price = add({'month_amount': add(810+i)})
        prices = add({'no_discount': price})
        plan_ids.append(add({'name': add(f'ru1_fixed_{i}'), 'display_name': add(f'Fixed {i}'),
                             'region': region, 'specs': specs, 'prices': prices}))
    refs = add(plan_ids)
    plan_list = add(['Reactive', refs])
    add({'vpsPlanList': plan_list, 'vpsPublicIpInfo': public_ip})
    page = '<link href="https://assets-site.beget.com/ru/vps/_payload.json?version=1">'
    plans = parse_beget(page, lambda url: json.dumps(data))
    assert len(plans) == 10
    assert plans[0]['price_rub'] == 810
    assert plans[0]['ipv4_extra_rub'] == 150
    assert plans[0]['ram_gb'] == 2
    assert plans[0]['disk_gb'] == 30
