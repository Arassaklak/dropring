"""PyYAML with its libyaml C extension; `import yaml` maps to the PyYAML distribution through
the known-packages list (nothing is declared)."""

import json

import yaml

data = yaml.safe_load("şehir: İzmir\nsayılar: [1, 2, 3]\n")
dumped = yaml.safe_dump(data, allow_unicode=True, sort_keys=True)
print(json.dumps({
    "sehir": data["şehir"],
    "toplam": sum(data["sayılar"]),
    "libyaml": bool(yaml.__with_libyaml__),
    "roundtrip": yaml.safe_load(dumped) == data,
}, ensure_ascii=False))
