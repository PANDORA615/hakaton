from datetime import datetime, timezone
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, field_serializer, model_validator
from .features import FEATURE_METADATA, DEFAULT_WEIGHTS

Money = Annotated[StrictInt, Field(ge=0, le=9223372036854775807)]
Id = Annotated[StrictInt, Field(gt=0, le=9223372036854775807)]


class DTO(BaseModel):
    model_config = ConfigDict(extra='forbid')

    @field_serializer('*', when_used='json', check_fields=False)
    def serialize_datetime(self, value):
        if isinstance(value, datetime):
            return value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        return value


class Account(DTO):
    id: Id
    email: str = Field(min_length=3, max_length=320)
    balance: Money
    withdrawBalance: Money
    totalReplenished: Money
    bonusBalance: Money
    bonusState: Literal['locked', 'unlocked']

    @field_validator('email')
    @classmethod
    def email_valid(cls, v):
        if '@' not in v or any(c.isspace() for c in v):
            raise ValueError('Некорректный email')
        return v


class Service(DTO):
    id: Id
    name: str = Field(pattern=r'^[A-Za-z0-9-]+$', max_length=255)
    ownerId: Id
    paymentTerm: Literal['hour', 'week', 'month', 'quarter_year', 'half_year', 'year']
    autoProlong: StrictBool
    createdAt: datetime
    expiresAt: datetime
    status: Literal['active', 'blocked', 'deleted', 'suspended', 'prolong_wait']
    price: Money

    @model_validator(mode='after')
    def dates_valid(self):
        if self.createdAt.tzinfo is None or self.expiresAt.tzinfo is None:
            raise ValueError('Даты должны содержать часовой пояс')
        if self.expiresAt < self.createdAt:
            raise ValueError('expiresAt раньше createdAt')
        return self


class Transaction(DTO):
    id: Id
    amount: Annotated[StrictInt, Field(ge=0, le=1000)]
    status: Literal['performed', 'not_performed']
    performedAt: datetime | None
    createdAt: datetime
    type: Literal['order', 'prolong']
    serviceId: Id

    @model_validator(mode='after')
    def dates_valid(self):
        if self.createdAt.tzinfo is None or (self.performedAt and self.performedAt.tzinfo is None):
            raise ValueError('Даты должны содержать часовой пояс')
        if (self.status == 'performed') != (self.performedAt is not None):
            raise ValueError('performedAt не соответствует статусу')
        if self.performedAt and self.performedAt < self.createdAt:
            raise ValueError('performedAt раньше createdAt')
        return self


class Snapshot(DTO):
    accounts: list[Account] = Field(max_length=100000)
    services: list[Service] = Field(max_length=300000)
    transactions: list[Transaction] = Field(max_length=1000000)

    @model_validator(mode='after')
    def relations_valid(self):
        for rows in (self.accounts, self.services, self.transactions):
            if len({r.id for r in rows}) != len(rows):
                raise ValueError('Повторяющийся ID')
        if len({a.email for a in self.accounts}) != len(self.accounts):
            raise ValueError('Повторяющийся email')
        aids = {a.id for a in self.accounts}
        sids = {s.id for s in self.services}
        if any(s.ownerId not in aids for s in self.services):
            raise ValueError('Не найден ownerId услуги')
        if any(t.serviceId not in sids for t in self.transactions):
            raise ValueError('Не найден serviceId транзакции')
        return self


FEATURES = FEATURE_METADATA


class Settings(DTO):
    weights: dict[str, float] = Field(default_factory=lambda: DEFAULT_WEIGHTS.copy())
    horizon_days: int = Field(default=7, ge=1, le=30, strict=True)
    urgency_days: int = Field(default=3, ge=1, le=30, strict=True)
    medium_threshold: float = Field(default=30, gt=0, lt=100, allow_inf_nan=False)
    high_threshold: float = Field(default=60, gt=0, le=100, allow_inf_nan=False)
    coverage_threshold: float = Field(default=.75, gt=0, le=1, allow_inf_nan=False)
    funded_multiplier: float = Field(default=.5, ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode='after')
    def configuration_valid(self):
        import math
        if set(self.weights) != set(FEATURES):
            raise ValueError('Набор весов должен совпадать с реестром признаков')
        if any(not math.isfinite(w) or w < 0 or w > 10000 for w in self.weights.values()) or sum(self.weights.values()) <= 0:
            raise ValueError('Веса должны быть конечными, неотрицательными, хотя бы один положительный')
        if self.medium_threshold >= self.high_threshold:
            raise ValueError('Средний порог должен быть ниже высокого')
        if self.urgency_days > self.horizon_days:
            raise ValueError('Окно срочности не может превышать горизонт')
        return self
