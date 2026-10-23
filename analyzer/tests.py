from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from .models import Customer, RiskSettings, Service
from .scoring import customer_risk


class RiskScoringTests(TestCase):
    def setUp(self):
        self.settings = RiskSettings.current()

    def test_expiring_unfunded_service_is_high_risk(self):
        customer = Customer.objects.create(external_id="customer-1", balance=0)
        Service.objects.create(
            customer=customer,
            name="Server",
            price=1000,
            expires_at=timezone.now() + timedelta(days=1),
            autoprolong=False,
            status="prolong_wait",
        )

        risk = customer_risk(customer, self.settings)

        self.assertEqual(risk["risk_level"], "high")
        self.assertGreaterEqual(risk["score"], 60)
        self.assertIn("Услуга ожидает оплаты", risk["reasons"])

    def test_missing_price_returns_unknown(self):
        customer = Customer.objects.create(external_id="customer-2", balance=5000)
        Service.objects.create(customer=customer, name="Unknown service", expires_at=timezone.now())

        risk = customer_risk(customer, self.settings)

        self.assertIsNone(risk["score"])
        self.assertEqual(risk["risk_level"], "unknown")
