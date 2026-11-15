"""Echoes its arguments and exits with the code given as the first argument."""

import sys

print(" | ".join(sys.argv[1:]))
sys.stdout.flush()
print("to stderr", file=sys.stderr)
sys.exit(int(sys.argv[1]) if len(sys.argv) > 1 else 0)
