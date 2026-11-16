"""Reads stdin to the end and echoes each line in upper case; reports the line count on stderr."""

import sys

lines = sys.stdin.read().splitlines()
for line in lines:
    print(line.upper())
print("%d lines" % len(lines), file=sys.stderr)
