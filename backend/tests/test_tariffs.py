from datetime import datetime, timedelta, timezone
from sqlalchemy import update

from app import db
from app.tariffs import TariffCatalog, parse_aeza, parse_firstvds, parse_ruvds


def test_official_page_parsers_extract_monthly_prices():
    aeza = ''.join(f'<article><h4>CLT-{i}</h4><p>{i} Core</p><p>{i*2} GB RAM</p><p>{i*30} GB NVMe</p><p>2 ₽ час</p><p>{i*849} ₽ месяц</p></article>' for i in range(1, 6))
    assert [p['price_rub'] for p in parse_aeza(aeza)] == [849, 1698, 2547, 3396, 4245]
    row = lambda name, vals: '<tr><td>'+name+'</td>'+''.join(f'<td>{v}</td>' for v in vals)+'</tr>'
    first = '<table>'+row('Тариф', [f'VDS-KVM-NVMe-{name}-10.0' for name in ('Прогрев', 'Старт', 'Разгон', 'Отрыв', 'Улёт')])+row('Количество процессоров', ['1 шт.']*5)+row('Оперативная память', ['2 ГБ.']*5)+row('Дисковое пространство', ['40 ГБ.']*5)+row('Стоимость за период: месяц', ['599.00 р.']*5)+'</table>'
    assert len(parse_firstvds(first)) == 5
    assert parse_firstvds(first)[0]['price_rub'] == 599
    cards = ''.join(f'<h4><span>{name}</span></h4><dl><dt>CPU</dt><dd>1</dd><dt>RAM</dt><dd>512 Мб</dd><dt>SSD</dt><dd>10 Гб</dd></dl><span class="price">{price}</span><span class="rub">₽</span><br />в месяц' for name, price in [('Старт',149), ('Старт SSD',219), ('Старт Хит',279), ('Старт Хит SSD',349)])
    assert [p['price_rub'] for p in parse_ruvds(cards)] == [149, 219, 279, 349]


def test_refresh_retains_last_good_snapshot_and_marks_stale():
    engine = db.make_engine('sqlite:///:memory:')
    db.metadata.create_all(engine)
    pages = {'aeza': ''.join(f'<article><h4>CLT-{i}</h4><p>{i} Core</p><p>2 GB RAM</p><p>30 GB NVMe</p><p>849 ₽ месяц</p></article>' for i in range(1, 6))}
    catalog = TariffCatalog(engine, fetch=lambda url: pages.get('aeza') if 'aeza.ru' in url else '')
    catalog.refresh_due()
    first = catalog.catalog()['providers'][0]
    assert len(first['plans']) == 5 and first['fetched_at'] and not first['stale']
    old = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    with engine.begin() as conn:
        conn.execute(update(db.competitor_tariffs).where(db.competitor_tariffs.c.provider == 'aeza').values(fetched_at=old, attempted_at=old))
    catalog.fetch = lambda _: (_ for _ in ()).throw(TimeoutError('down'))
    catalog.refresh_due()
    after = catalog.catalog()['providers'][0]
    assert after['plans'] == first['plans']
    assert after['stale'] and after['error'] and after['fetched_at'] == old
    health = catalog.catalog()
    assert health['failed_count'] >= 1 and health['stale_count'] >= 1
    assert after['attempted_at'] and health['checked_at']
    engine.dispose()


def test_selectel_official_snapshot_is_labeled_when_live_source_fails():
    engine = db.make_engine('sqlite:///:memory:')
    db.metadata.create_all(engine)
    catalog = TariffCatalog(engine, fetch=lambda _: (_ for _ in ()).throw(TimeoutError('source offline')))
    catalog.refresh_due()
    selectel = next(p for p in catalog.catalog()['providers'] if p['id'] == 'selectel')
    assert len(selectel['plans']) == 7
    assert selectel['error']
    assert selectel['fetched_at'].startswith('2026-10-25')
    engine.dispose()
