from django.contrib import admin

from .models import Customer, RiskSettings, Service

admin.site.register((Customer, Service, RiskSettings))
