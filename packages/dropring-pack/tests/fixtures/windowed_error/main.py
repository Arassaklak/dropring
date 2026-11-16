"""Fails on purpose. In a GUI launch (windowed Windows app, macOS app started by Finder or
`open`) the bootstrap must save the traceback to crash.log in the user data folder, and with
DROPRING_PACK_NO_DIALOGS=1 it must not block on an error dialog."""


def load_settings():
    raise RuntimeError("deliberate failure ✓")


load_settings()
