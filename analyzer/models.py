from django.db import models


class RiskSettings(models.Model):
    no_autoprolong_weight = models.DecimalField(max_digits=6, decimal_places=2, default=25)
    funding_gap_weight = models.DecimalField(max_digits=6, decimal_places=2, default=30)
    payment_wait_weight = models.DecimalField(max_digits=6, decimal_places=2, default=30)
    expiry_urgency_weight = models.DecimalField(max_digits=6, decimal_places=2, default=15)
    horizon_days = models.PositiveIntegerField(default=7)
    low_threshold = models.PositiveIntegerField(default=30)
    high_threshold = models.PositiveIntegerField(default=60)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def current(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Customer(models.Model):
    external_id = models.CharField(max_length=100, unique=True)
    email = models.EmailField(blank=True)
    balance = models.BigIntegerField(default=0, help_text="Еврокопейки")
    bonus_balance = models.BigIntegerField(default=0)
    bonus_enabled = models.BooleanField(default=False)
    total_replenished = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)


class Service(models.Model):
    customer = models.ForeignKey(Customer, related_name="services", on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    price = models.PositiveIntegerField(null=True, blank=True, help_text="Еврокопейки за период")
    expires_at = models.DateTimeField(null=True, blank=True)
    autoprolong = models.BooleanField(default=False)
    status = models.CharField(max_length=32, default="active")
