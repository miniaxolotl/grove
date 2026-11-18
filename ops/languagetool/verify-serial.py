"""Synthetic LT-only regression. Run on the disposable Compose project's private network."""
import json
import math
import threading
import time
from collections import Counter
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen


origin = 'http://languagetool:8081'
rules = 'YOUR_YOU_2,WHO_S_NN_VB,ITS_TO_IT_S,IT_IS,FEWER_LESS,BETWEEN_YOU_AND_I,MORFOLOGIK_RULE_EN_US'
sizes = (200, 1000, 1500)
times = {n: [] for n in sizes}
checks, probes = Counter(), Counter()
stop = threading.Event()


def failure(exc):
    return str(exc.code) if isinstance(exc, HTTPError) else type(exc).__name__


def check_readiness():
    # Independent probes, never a retry of a failed check. Each urllib call
    # opens a fresh connection, as does each serial POST below.
    while not stop.is_set():
        try:
            with urlopen(origin + '/ready', timeout=2) as response:
                probes[str(response.status)] += 1
        except OSError as exc:
            probes[failure(exc)] += 1
        stop.wait(.05)


probe = threading.Thread(target=check_readiness)
probe.start()
try:
    for i in range(300):
        size = sizes[i % 3]
        prefix = f'I hope your well. This is sample {i + 1}. '
        filler = 'The team wrote the report before lunch. '
        text = (prefix + filler * size)[:size]
        data = urlencode(dict(language='en-US', level='default', enabledOnly='true',
                              enabledRules=rules, text=text)).encode()
        started = time.monotonic()
        try:
            with urlopen(origin + '/v2/check', data=data, timeout=12) as response:
                result = json.load(response)
                assert response.status == 200 and result['software']['version'] == '6.8'
                assert not result['warnings']['incompleteResults']
                assert any(m['rule']['id'] == 'YOUR_YOU_2' and m['offset'] == 7 and
                           m['length'] == 4 and m['replacements'][0]['value'] == "you're"
                           for m in result['matches']), 'Known correction missing'
            times[size].append((time.monotonic() - started) * 1000)
            checks['200'] += 1
        except OSError as exc:
            checks[failure(exc)] += 1
finally:
    stop.set()
    probe.join()


def latency(values):
    ordered = sorted(values)
    return {k: round(ordered[math.ceil(len(ordered) * p) - 1], 1)
            for k, p in [('p50', .5), ('p95', .95)]} if ordered else {}


print(json.dumps(dict(checks=checks, probes=probes, latency_ms={
    **{n: latency(times[n]) for n in sizes}, 'all': latency(sum(times.values(), []))})))
assert checks == {'200': 300}, checks
assert probes['200'] and len(probes) == 1, probes
