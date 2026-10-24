"""Official CBR display rates. Source and model money remain EUR cents."""
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp'
FALLBACK = {'EUR': 90.2429, 'USD': 80.5381}


class FxCache:
    def __init__(self):
        self.lock = threading.Lock()
        self.value = {'rates_rub': FALLBACK.copy(), 'rate_date': '24.10.2026',
                      'fetched_at': None, 'stale': True, 'source': CBR_URL}
        self.retry_at = 0

    def get(self):
        with self.lock:
            if time.monotonic() < self.retry_at:
                return self.value.copy()
            try:
                request = urllib.request.Request(CBR_URL, headers={'User-Agent': 'AezaRetention/0.8'})
                with urllib.request.urlopen(request, timeout=5) as response:
                    payload = response.read(100_001)
                if len(payload) > 100_000:
                    raise ValueError('CBR response too large')
                root = ET.fromstring(payload)
                rate_date = root.attrib['Date']
                datetime.strptime(rate_date, '%d.%m.%Y')
                rates = {}
                for item in root.findall('Valute'):
                    code = item.findtext('CharCode')
                    if code in ('EUR', 'USD'):
                        value = Decimal(item.findtext('Value').replace(',', '.'))
                        nominal = Decimal(item.findtext('Nominal'))
                        rate = value / nominal
                        if not rate.is_finite() or rate <= 0:
                            raise ValueError('Invalid CBR rate')
                        rates[code] = float(rate)
                if set(rates) != {'EUR', 'USD'}:
                    raise ValueError('CBR response lacks EUR or USD')
                self.value = {'rates_rub': rates, 'rate_date': rate_date,
                              'fetched_at': datetime.now(timezone.utc).isoformat(),
                              'stale': False, 'source': CBR_URL}
                self.retry_at = time.monotonic() + 6 * 3600
            except (OSError, ValueError, ET.ParseError, KeyError, TypeError, InvalidOperation, ZeroDivisionError):
                self.value = {**self.value, 'stale': True}
                self.retry_at = time.monotonic() + 15 * 60
            return self.value.copy()


fx_cache = FxCache()
