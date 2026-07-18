#!/usr/bin/env python
"""Generate + store PixelLab sprite sheets for people (SAV-61) — MANUAL, costs credits.

Run by hand against the live Mongo to give demo people real AI pixel-art sprites.
Each person costs ``GEN_COST_PER_PERSON`` (3) PixelLab generations, so a ``--limit``
budget guard stops BEFORE it would exceed the cap you pass. Never run in CI/tests.

Examples::

    # All people who don't have a sprite yet, spending at most 12 generations:
    uv run python scripts/gen_sprites.py --all --limit 12

    # Specific people (regenerate even if they already have a sprite):
    uv run python scripts/gen_sprites.py demo-alex demo-vic --force

Config (env, ``SAVEPOINT_`` prefix): ``SAVEPOINT_PIXELLAB_API_KEY`` (required),
``SAVEPOINT_SPRITES_DIR`` (where PNGs land), ``SAVEPOINT_MONGO_URI`` /
``SAVEPOINT_MONGO_DB`` (which database to write back to).
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from savepoint_server.core.config import get_settings
from savepoint_server.db import Repositories, get_repositories
from savepoint_server.db.mongo import close_client, get_db
from savepoint_server.models import Person
from savepoint_server.services.pixellab import (
    GEN_COST_PER_PERSON,
    PixelLabClient,
    generate_person_sprite,
)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "local_ids",
        nargs="*",
        help="Specific people to generate for; omit (or use --all) for everyone missing a sprite.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Generate for every person missing a sprite (default when no ids are given).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate even for people who already have a sprite.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Max PixelLab generations to spend; stops before exceeding it "
        f"({GEN_COST_PER_PERSON} per person).",
    )
    return parser.parse_args(argv)


async def _resolve_targets(repos: Repositories, args: argparse.Namespace) -> list[Person]:
    """Resolve the people to generate for, honoring explicit ids / --all / --force."""
    if args.local_ids:
        targets: list[Person] = []
        for local_id in args.local_ids:
            person = await repos.people.get_by_local_id(local_id)
            if person is None:
                print(f"  ! no person with local_id={local_id!r}; skipping", file=sys.stderr)
                continue
            targets.append(person)
        return targets
    # --all / default: everyone, filtered to those missing a sprite unless --force.
    everyone = await repos.people.list({}, limit=500)
    if args.force:
        return everyone
    return [p for p in everyone if p.sprite is None]


async def _print_balance(client: PixelLabClient, prefix: str) -> None:
    try:
        balance = await client.get_balance()
        print(f"{prefix} balance: {balance:.0f} generations remaining")
    except Exception as exc:  # balance is informational only; never abort a run over it
        print(f"{prefix} balance: unavailable ({exc})")


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    if not settings.pixellab_api_key:
        print("SAVEPOINT_PIXELLAB_API_KEY is not set — cannot generate sprites.", file=sys.stderr)
        return 2

    client = PixelLabClient(api_key=settings.pixellab_api_key)
    repos = get_repositories(get_db())
    try:
        targets = await _resolve_targets(repos, args)
        if not targets:
            print("Nothing to do — no matching people missing a sprite.")
            return 0

        print(f"Generating sprites for {len(targets)} person(s) into {settings.sprites_dir}")
        await _print_balance(client, "start")

        spent = 0
        done = 0
        for person in targets:
            if person.sprite is not None and not args.force:
                print(f"- {person.local_id}: already has a sprite; skipping (use --force to redo)")
                continue
            if args.limit is not None and spent + GEN_COST_PER_PERSON > args.limit:
                print(
                    f"- stopping: next person would spend {spent + GEN_COST_PER_PERSON} "
                    f"generations, over the --limit {args.limit}."
                )
                break

            print(f"- {person.local_id}: generating ({GEN_COST_PER_PERSON} generations)...")
            manifest = await generate_person_sprite(
                person.local_id,
                person.avatar_params,
                client=client,
                sprites_dir=settings.sprites_dir,
            )
            current = await repos.people.get_by_local_id(person.local_id)
            if current is not None:
                await repos.people.upsert(current.model_copy(update={"sprite": manifest}))
            spent += GEN_COST_PER_PERSON
            done += 1
            print(f"  ok: {len(manifest['walk']['east'])} walk frames, tile {manifest['tile']}")
            await _print_balance(client, "  ")

        print(f"Done: {done} sprite(s) generated, ~{spent} generations spent.")
        await _print_balance(client, "final")
        return 0
    finally:
        close_client()


def main() -> None:
    raise SystemExit(asyncio.run(_run(_parse_args())))


if __name__ == "__main__":
    main()
