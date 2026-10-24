"""Official VPS price snapshots. Never infer attributes absent from source pages."""
import html
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json

import httpx
from sqlalchemy import select, insert, update

from . import db

logger = logging.getLogger(__name__)
REFRESH_INTERVAL = timedelta(days=3)
SOURCES = {
    'aeza': ('Aéza', 'https://aeza.ru/virtual-servers'),
    'firstvds': ('FirstVDS', 'https://firstvds.ru/docs/tariffs.html'),
    'ruvds': ('RUVDS', 'https://ruvds.com/ru/vps_start/'),
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

PARSERS = {'aeza': parse_aeza, 'firstvds': parse_firstvds, 'ruvds': parse_ruvds}


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
                plans = PARSERS[provider](self.fetch(url))
                if not plans or any(p['price_rub'] <= 0 for p in plans):
                    raise ValueError('No valid monthly tariff prices found')
                payload = {'plans': plans, 'fetched_at': now.isoformat(), 'attempted_at': now.isoformat(), 'error': None}
            except Exception as exc:
                logger.warning('Tariff refresh failed for %s: %s', provider, exc)
                payload = {'attempted_at': now.isoformat(), 'error': 'Источник временно недоступен или изменил формат'}
                if not row:
                    if provider == 'aeza':
                        # Verified from the official page on 2026-10-24; temporary bootstrap only.
                        payload.update(plans=json.loads((Path(__file__).with_name('aeza_verified_2026-10-24.json')).read_text()),
                                       fetched_at='2026-10-24T00:00:00+00:00')
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
                               next_refresh_at=(datetime.fromisoformat(fetched)+REFRESH_INTERVAL).isoformat() if fetched else None,
                               stale=stale, error=row.get('error'), plans=row.get('plans') or []))
        return {'refresh_interval_hours': 72, 'providers': result}
