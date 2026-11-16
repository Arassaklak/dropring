"""Imports a package that is neither standard library nor on the known-packages list and has
no declared dependencies. The build must refuse instead of guessing a PyPI name."""

import totally_unknown_dropring_pkg  # noqa: F401

print("unreachable")
