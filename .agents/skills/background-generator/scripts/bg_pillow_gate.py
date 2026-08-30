"""Fail closed when Pillow is unavailable."""

try:
    import PIL  # noqa: F401
except ModuleNotFoundError as error:
    raise SystemExit(
        "Pillow is required. The background-generator Skill cannot run until it is available."
    ) from error
