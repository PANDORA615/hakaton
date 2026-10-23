from typing import Literal

from django.contrib.auth import authenticate, login, logout
from django.db.models import QuerySet
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from .models import Customer, RiskSettings
from .scoring import customer_risk

api = NinjaAPI(title="Aéza Churn Risk Analyzer", version="0.1.0")


def require_user(request):
    if not request.user.is_authenticated:
        raise HttpError(401, "Требуется авторизация")


class LoginIn(Schema):
    username: str
    password: str


class SettingsIn(Schema):
    no_autoprolong_weight: float
    funding_gap_weight: float
    payment_wait_weight: float
    expiry_urgency_weight: float
    horizon_days: int
    low_threshold: int
    high_threshold: int


@api.post("auth/login")
def sign_in(request, payload: LoginIn):
    user = authenticate(request, username=payload.username, password=payload.password)
    if not user:
        raise HttpError(401, "Неверный логин или пароль")
    login(request, user)
    return {"id": user.id, "username": user.username}


@api.get("auth/me")
def me(request):
    require_user(request)
    return {"id": request.user.id, "username": request.user.username}


@api.post("auth/logout")
def sign_out(request):
    require_user(request)
    logout(request)
    return {"ok": True}


@api.get("customers")
def customers(request, ordering: Literal["id", "email", "balance", "total_replenished"] = "id", direction: Literal["asc", "desc"] = "asc"):
    require_user(request)
    fields = {"id": "external_id", "email": "email", "balance": "balance", "total_replenished": "total_replenished"}
    prefix = "-" if direction == "desc" else ""
    settings = RiskSettings.current()
    rows = []
    for customer in Customer.objects.prefetch_related("services").order_by(prefix + fields[ordering]):
        risk = customer_risk(customer, settings)
        rows.append({"id": customer.external_id, "email": customer.email, "balance": customer.balance, "total_replenished": customer.total_replenished, **risk})
    return rows


@api.get("customers/{customer_id}")
def customer(request, customer_id: str):
    require_user(request)
    try:
        item = Customer.objects.prefetch_related("services").get(external_id=customer_id)
    except Customer.DoesNotExist as error:
        raise HttpError(404, "Клиент не найден") from error
    return {"id": item.external_id, "email": item.email, "balance": item.balance, "total_replenished": item.total_replenished, **customer_risk(item, RiskSettings.current())}


@api.get("model/settings")
def get_settings(request):
    require_user(request)
    current = RiskSettings.current()
    return {field: getattr(current, field) for field in SettingsIn.model_fields}


@api.patch("model/settings")
def update_settings(request, payload: SettingsIn):
    require_user(request)
    if payload.low_threshold >= payload.high_threshold or payload.horizon_days < 1 or any(value < 0 for value in payload.dict().values() if isinstance(value, (int, float))):
        raise HttpError(422, "Некорректные пороги, горизонт или веса")
    current = RiskSettings.current()
    for field, value in payload.dict().items():
        setattr(current, field, value)
    current.save()
    return {"ok": True, "settings": get_settings(request)}
