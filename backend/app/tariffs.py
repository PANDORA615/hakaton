"""Official VPS price snapshots. Never infer attributes absent from source pages."""
import html
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select, insert, update

from . import db

logger = logging.getLogger(__name__)
REFRESH_INTERVAL = timedelta(days=3)
SOURCES = {
    'aeza': ('Aéza', 'https://aeza.ru/virtual-servers'),
    'firstvds': ('FirstVDS', 'https://firstvds.ru/docs/tariffs.html'),
    'ruvds': ('RUVDS', 'https://ruvds.com/ru/vps_start/'),
    'selectel': ('Selectel', 'https://selectel.ru/services/cloud/vps-vds/daily-paid/'),
    'adminvps': ('AdminVPS', 'https://adminvps.ru/vps/vps_linux.php'),
    'beget': ('Beget', 'https://beget.com/ru/vps'),
}


def plain(markup):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', markup)).split())


def number(value):
    return float(value.replace(',', '.'))


def parse_aeza(page):
    plans = []
    for card in re.findall(r'<article\b[^>]*>(.*?)</article>', page, re.S):
        name = re.search(r'<h4\b[^>]*>(CLT-[1-5])</h4>', card)
        if not name:
            continue
        text = plain(card)
        cpu = re.search(r'(\d+) Core', text)
        ram = re.search(r'(\d+) GB RAM', text)
        disk = re.search(r'(\d+) GB NVMe', text)
        monthly = re.search(r'([\d\s]+) ₽ месяц', text)
        if not all((cpu, ram, disk, monthly)):
            raise ValueError(f'Incomplete Aéza plan {name.group(1)}')
        plans.append(dict(id='aeza-'+name.group(1).lower(), name=name.group(1)+' · Dedicated',
                          price_rub=int(monthly.group(1).replace(' ', '')), cpu=int(cpu.group(1)),
                          ram_gb=number(ram.group(1)), disk_gb=int(disk.group(1)), disk_type='NVMe',
                          cpu_class='Dedicated', billing='month', location='Москва'))
    if len(plans) < 5:
        raise ValueError('Aéza page did not provide all five CLT monthly plans')
    return plans


def parse_firstvds(page):
    for table in re.findall(r'<table\b[^>]*>(.*?)</table>', page, re.S):
        rows = [[plain(cell) for cell in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, re.S)]
                for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table, re.S)]
        header = next((r for r in rows if len(r) >= 6 and r[1].startswith('VDS-KVM-NVMe-Прогрев')), None)
        if not header:
            continue
        def find(label):
            return next((r for r in rows if len(r) >= 6 and r[0].startswith(label)), None)
        cpu, ram, disk, price = (find(label) for label in ('Количество процессоров', 'Оперативная память', 'Дисковое пространство', 'Стоимость за период: месяц'))
        if not all((cpu, ram, disk, price)):
            raise ValueError('FirstVDS NVMe table missing resource or monthly price row')
        plans = []
        for i in range(1, 6):
            name = header[i].replace('VDS-KVM-NVMe-', '')
            plans.append(dict(id='firstvds-'+str(i), name=name, price_rub=int(number(re.search(r'[\d.]+', price[i]).group())),
                              cpu=int(re.search(r'\d+', cpu[i]).group()), ram_gb=number(re.search(r'[\d.,]+', ram[i]).group()),
                              disk_gb=int(re.search(r'\d+', disk[i]).group()), disk_type='NVMe',
                              cpu_class=None, billing='month', location=None))
        return plans
    raise ValueError('FirstVDS NVMe tariff table not found')


def parse_ruvds(page):
    plans = []
    for name in ('Старт', 'Старт SSD', 'Старт Хит', 'Старт Хит SSD'):
        match = re.search(r'<h4\b[^>]*>.*?'+re.escape(name)+r'</span></h4>(.*?)(?=<h4\b|</section>|\Z)', page, re.S)
        if not match:
            raise ValueError(f'RUVDS plan {name} not found')
        card = match.group(1)
        attrs = {plain(k): plain(v) for k, v in re.findall(r'<dt>(.*?)</dt>\s*<dd>(.*?)</dd>', card, re.S)}
        price = re.search(r'<span class="price">([\d\s]+)</span>\s*<span class="rub">₽</span>\s*<br\s*/>\s*в месяц', card)
        disk_type = next((kind for kind in ('SSD', 'HDD') if kind in attrs), None)
        if not disk_type or not price or not all(k in attrs for k in ('CPU', 'RAM')):
            raise ValueError(f'Incomplete RUVDS plan {name}')
        ram = number(re.search(r'[\d.,]+', attrs['RAM']).group())
        if 'Мб' in attrs['RAM']:
            ram /= 1024
        plans.append(dict(id='ruvds-'+str(len(plans)+1), name=name, price_rub=int(price.group(1).replace(' ', '')),
                          cpu=int(attrs['CPU']), ram_gb=ram, disk_gb=int(re.search(r'\d+', attrs[disk_type]).group()),
                          disk_type=disk_type, cpu_class=None, billing='month', location=None))
    return plans

def parse_selectel(page):
    plans = []
    traffic = re.search(r'(\d+)\s*ТБ внешнего трафика', plain(page))
    traffic_tb = int(traffic.group(1)) if traffic else None
    cards = re.findall(r'<div class="tariff-card"(.*?)(?=<div class="tariff-card"|\Z)', page, re.S)
    for card in cards:
        name = re.search(r'<h4\b[^>]*>(VDS \d+-\d+-\d+)</h4>', card)
        if not name:
            continue
        rows = {plain(k): plain(v) for k, v in re.findall(r'<td\b[^>]*>(.*?)</td>\s*<td\b[^>]*>(.*?)</td>', card, re.S)}
        daily = re.search(r'<b class="tariff-card__bold"[^>]*>([\d,]+)</b>\s*₽/день', card)
        if not daily or not all(k in rows for k in ('vCPU', 'RAM', 'Диск')):
            raise ValueError(f'Incomplete Selectel plan {name.group(1)}')
        daily_rub = Decimal(daily.group(1).replace(',', '.'))
        plans.append(dict(id='selectel-'+name.group(1).lower().replace(' ', '-'), name=name.group(1),
                          price_rub=float(daily_rub * 30), native_price_rub=float(daily_rub),
                          cpu=int(rows['vCPU']), ram_gb=int(re.search(r'\d+', rows['RAM']).group()),
                          disk_gb=int(re.search(r'\d+', rows['Диск']).group()), disk_type='NVMe',
                          cpu_class=None, billing='daily_30_day_equivalent', location=None,
                          ipv4_extra_rub=0, traffic_tb=traffic_tb))
    expected = len(re.findall(r'<h4\b[^>]*>VDS \d+-\d+-\d+</h4>', page))
    if not plans or len(plans) != expected:
        raise ValueError('Selectel daily VDS plan list is incomplete')
    return plans


def parse_adminvps(page):
    plans = []
    for table in re.findall(r'<table\b[^>]*>(.*?)</table>', page, re.S):
        rows = [[plain(cell) for cell in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, re.S)]
                for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table, re.S)]
        if not rows or '1 мес.' not in rows[0] or not {'CPU', 'RAM', 'NVMe'}.issubset(rows[0]):
            continue
        header = rows[0]
        indexes = {key: header.index(key) for key in ('Тариф', 'CPU', 'RAM', 'NVMe', '1 мес.')}
        family = ('Windows' if len(rows) > 1 and rows[1][0].startswith('WIN') else
                  'Linux 5.0' if len(rows) > 1 and '5,0' in rows[1][header.index('CPU')] else 'Linux 3.6')
        for row in rows[1:]:
            if len(row) <= max(indexes.values()):
                raise ValueError('Incomplete AdminVPS tariff row')
            name = row[indexes['Тариф']]
            price_text = row[indexes['1 мес.']]
            if not name or not re.search(r'\d', price_text):
                raise ValueError('AdminVPS one-month price missing')
            plans.append(dict(id=f'adminvps-{family.lower().replace(" ", "-")}-{name.lower()}', name=f'{family} · {name}',
                              price_rub=int(re.sub(r'\D', '', price_text)),
                              cpu=int(re.search(r'\d+', row[indexes['CPU']]).group()),
                              ram_gb=int(re.search(r'\d+', row[indexes['RAM']]).group()),
                              disk_gb=int(re.search(r'\d+', row[indexes['NVMe']]).group()),
                              disk_type='NVMe', cpu_class=None, billing='month', location=None,
                              os_family='Windows' if family == 'Windows' else 'Linux'))
    if not plans:
        raise ValueError('AdminVPS fixed Linux/Windows plans not found')
    return plans


def parse_beget(page, fetch):
    match = re.search(r'href="(https://assets-site\.beget\.com/ru/vps/_payload\.json[^\"]*)"', page)
    if not match:
        raise ValueError('Beget first-party tariff payload not found')
    payload_url = html.unescape(match.group(1))
    parsed = urlsplit(payload_url)
    if parsed.scheme != 'https' or parsed.netloc != 'assets-site.beget.com' or parsed.path != '/ru/vps/_payload.json':
        raise ValueError('Unexpected Beget tariff payload URL')
    data = json.loads(fetch(payload_url))
    root = next((obj for obj in data if isinstance(obj, dict) and 'vpsPlanList' in obj and 'vpsPublicIpInfo' in obj), None)
    if root is None:
        raise ValueError('Beget VPS catalog missing')
    plan_ref = data[root['vpsPlanList']]
    if not isinstance(plan_ref, list) or len(plan_ref) < 2:
        raise ValueError('Invalid Beget plan list')
    plan_ids = data[plan_ref[1]]
    ip_by_region = data[data[root['vpsPublicIpInfo']]['pricing']]
    plans = []
    for index in plan_ids:
        item = data[index]
        slug, name, region = (data[item[key]] for key in ('name', 'display_name', 'region'))
        specs = data[item['specs']]
        prices = data[data[item['prices']]['no_discount']]
        ip_pricing = data[ip_by_region[region]]
        plans.append(dict(id='beget-'+slug, name=f'{name} · {region.upper()}',
                          price_rub=int(data[prices['month_amount']]),
                          cpu=int(data[specs['cpu_cores']]),
                          ram_gb=data[specs['memory_size']] / 1024,
                          disk_gb=data[specs['disk_size']] / 1024,
                          disk_type='NVMe', cpu_class=None, billing='month', location=region.upper(),
                          ipv4_extra_rub=int(data[ip_pricing['price_ipv4_per_month']])))
    if not plans:
        raise ValueError('Beget catalog did not provide fixed VPS plans')
    return plans


PARSERS = {'aeza': parse_aeza, 'firstvds': parse_firstvds, 'ruvds': parse_ruvds,
           'selectel': parse_selectel, 'adminvps': parse_adminvps}
VERIFIED_BOOTSTRAPS = {
    'aeza': ('aeza_verified_2026-10-24.json', '2026-10-24T00:00:00+00:00'),
    'selectel': ('selectel_verified_2026-10-25.json', '2026-10-25T00:07:00+00:00'),
}


class TariffCatalog:
    def __init__(self, engine, fetch=None):
        self.engine = engine
        self.fetch = fetch or self._fetch

    @staticmethod
    def _fetch(url):
        with httpx.Client(timeout=12, follow_redirects=True, headers={'User-Agent': 'Mozilla/5.0 (compatible; AezaRetentionTariffMonitor/1.0)'}) as client:
            last_error = None
            for _ in range(3):
                try:
                    response = client.get(url)
                    response.raise_for_status()
                    if len(response.content) > 2_000_000:
                        raise ValueError('Tariff page exceeds size limit')
                    return response.text
                except (httpx.HTTPError, ValueError) as exc:
                    last_error = exc
            raise last_error

    def refresh_due(self):
        now = datetime.now(timezone.utc)
        with self.engine.connect() as conn:
            existing = {row['provider']: dict(row) for row in conn.execute(select(db.competitor_tariffs)).mappings()}
        for provider, (_, url) in SOURCES.items():
            row = existing.get(provider)
            # Failed sources retry hourly, while successful sources refresh every 72 hours.
            last_attempt = datetime.fromisoformat(row['attempted_at']) if row and row['attempted_at'] else None
            last_success = datetime.fromisoformat(row['fetched_at']) if row and row['fetched_at'] else None
            if last_attempt and now - last_attempt < (REFRESH_INTERVAL if last_success and last_attempt == last_success else timedelta(hours=1)):
                continue
            try:
                page = self.fetch(url)
                plans = parse_beget(page, self.fetch) if provider == 'beget' else PARSERS[provider](page)
                if not plans or any(p['price_rub'] <= 0 for p in plans):
                    raise ValueError('No valid monthly tariff prices found')
                payload = {'plans': plans, 'fetched_at': now.isoformat(), 'attempted_at': now.isoformat(), 'error': None}
            except Exception as exc:
                logger.warning('Tariff refresh failed for %s: %s', provider, exc)
                payload = {'attempted_at': now.isoformat(), 'error': 'Источник временно недоступен или изменил формат'}
                if not row:
                    if provider in VERIFIED_BOOTSTRAPS:
                        # Dated, official-page snapshot; retry hourly until replaced by a live fetch.
                        filename, verified_at = VERIFIED_BOOTSTRAPS[provider]
                        payload.update(plans=json.loads((Path(__file__).with_name(filename)).read_text()),
                                       fetched_at=verified_at)
                    else:
                        payload.update(plans=[], fetched_at=None)
            with self.engine.begin() as conn:
                if row:
                    conn.execute(update(db.competitor_tariffs).where(db.competitor_tariffs.c.provider == provider).values(**payload))
                else:
                    conn.execute(insert(db.competitor_tariffs).values(provider=provider, **payload))

    def catalog(self):
        with self.engine.connect() as conn:
            rows = {row['provider']: dict(row) for row in conn.execute(select(db.competitor_tariffs)).mappings()}
        now = datetime.now(timezone.utc)
        result = []
        for provider, (name, url) in SOURCES.items():
            row = rows.get(provider, {})
            fetched = row.get('fetched_at')
            stale = not fetched or now - datetime.fromisoformat(fetched) > REFRESH_INTERVAL
            result.append(dict(id=provider, name=name, source_url=url, fetched_at=fetched,
                               attempted_at=row.get('attempted_at'),
                               next_refresh_at=(datetime.fromisoformat(fetched)+REFRESH_INTERVAL).isoformat() if fetched else None,
                               stale=stale, error=row.get('error'), plans=row.get('plans') or []))
        return {'refresh_interval_hours': 72, 'checked_at': now.isoformat(),
                'stale_count': sum(item['stale'] for item in result),
                'failed_count': sum(bool(item['error']) for item in result),
                'providers': result}
