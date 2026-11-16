"""pydantic v2 (compiled pydantic-core) validates and rejects data; declared in pyproject.toml."""

import json

import pydantic_core
from pydantic import BaseModel, Field, ValidationError


class Kullanici(BaseModel):
    ad: str
    yas: int = Field(ge=0)


ok = Kullanici(ad="Ayşe", yas="30")
try:
    Kullanici(ad="X", yas=-1)
    errors = 0
except ValidationError as exc:
    errors = exc.error_count()

print(json.dumps({
    "ad": ok.ad,
    "yas": ok.yas,
    "errors": errors,
    "core_compiled": pydantic_core._pydantic_core.__file__.endswith((".so", ".pyd")),
}, ensure_ascii=False))
