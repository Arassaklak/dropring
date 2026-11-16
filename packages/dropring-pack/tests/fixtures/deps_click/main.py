"""A click command line: options, Unicode values, stderr, exit code. Declared in setup.cfg."""

from importlib.metadata import version

import click


@click.command()
@click.option("--ad", default="dünya")
@click.option("--kez", default=1, type=int)
def main(ad, kez):
    for _ in range(kez):
        click.echo(f"Merhaba {ad}!")
    click.echo(f"click {version('click').split('.')[0]}", err=True)
    raise SystemExit(3)


if __name__ == "__main__":
    main()
