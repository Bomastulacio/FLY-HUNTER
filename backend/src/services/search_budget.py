"""Paid searches have one owner and persistent, conservative limits.

The caller must hold the cache transaction through reservation, not network I/O.
GitHub Actions serializes pipeline runs and restores this cache between jobs.
"""
import datetime
import os

_used_this_run = 0


def limit(name, default):
    try:
        return max(0, min(default, int(os.environ.get(name, default))))
    except (TypeError, ValueError):
        return 0  # Invalid configuration cannot increase spend.


def reserve_paid_search(cache, quota, now=None):
    global _used_this_run
    if os.environ.get("SERPAPI_ENABLED", "true").lower() != "true":
        return False
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if not quota.get("available") or quota.get("searches_left", 0) <= 10:
        return False
    cycle = str(quota.get("renew_on") or now.strftime("%Y-%m"))
    day_key, cycle_key = ("paid_day", now.date().isoformat()), ("paid_cycle", cycle)
    with cache.transact():
        daily, monthly = cache.get(day_key, 0), cache.get(cycle_key, 0)
        if (_used_this_run >= limit("SERPAPI_MAX_PER_RUN", 2)
                or daily >= limit("SERPAPI_MAX_PER_DAY", 4)
                or monthly >= limit("SERPAPI_MAX_PER_CYCLE", 220)):
            return False
        # Charge attempts before I/O; an uncertain network outcome is never refunded.
        cache.set(day_key, daily + 1, expire=3 * 86400)
        cache.set(cycle_key, monthly + 1, expire=62 * 86400)
        _used_this_run += 1
        return True
