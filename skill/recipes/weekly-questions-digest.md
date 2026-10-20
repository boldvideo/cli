# Weekly questions digest, grouped by video

Requires Bash, Python 3, the insights command, and a secret-injected admin key.
Check `boldvideo --help` before setup. Save the following **whole block** as
`/srv/bold/weekly-questions-digest.sh`; it never writes to Bold. First run it
manually and inspect the result before scheduling it.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /srv/bold
umask 077
mkdir -p digests
boldvideo insights questions --since 7d --limit 100 --json > digests/questions-page-1.json
python3 - <<'PY'
import collections, datetime, json, pathlib, shlex, subprocess

root = pathlib.Path('digests')
page = json.loads((root / 'questions-page-1.json').read_text())
questions = []
seen = set()
while True:
    questions.extend(page['items'])
    if not page['has_more']:
        break
    # CLI-generated next freezes the original time window. No shell eval.
    argv = shlex.split(page['next'])
    assert argv[:3] == ['boldvideo', 'insights', 'questions'], argv
    assert tuple(argv) not in seen, 'Repeated continuation'
    seen.add(tuple(argv))
    page = json.loads(subprocess.check_output(argv, text=True))

def md(value):
    text = ' '.join(str(value).split())
    for char in '\\`*_{}[]()<>#!|~':
        text = text.replace(char, '\\' + char)
    return text

groups = collections.defaultdict(list)
titles = {}
gaps = []
unobserved = []
for q in questions:
    sources = q.get('sources')
    if sources is None:
        unobserved.append(q)
        groups['Unobserved sources'].append(q)
    elif not sources:
        gaps.append(q)
        groups['No sources — content-gap candidates'].append(q)
    else:
        # A multi-source question appears once under each distinct video.
        for video in {s['video_id']: s for s in sources}.values():
            key = video['video_id']
            titles[key] = video.get('title') or key
            groups[key].append(q)
    if sources and q.get('outcome') not in (None, 'answered'):
        gaps.append(q)

lines = ['# Weekly audience questions', '',
         f'{len(questions)} questions; {len(gaps)} content-gap candidates; '
         f'{len(unobserved)} with unobserved sources.', '']
for key, rows in sorted(groups.items()):
    heading = f'{titles[key]} ({key})' if key in titles else key
    lines += ['## ' + md(heading), '']
    for q in rows:
        lines.append(f"- {md(q['asked_at'])}: {md(q['question'])} — {md(q.get('outcome') or 'unknown outcome')}")
    lines.append('')
lines += ['## Content follow-up', '',
          'Review repeated questions, no-source questions and non-answered outcomes.',
          'These are candidates, not proof of missing content: check retrieval, '
          'permissions and ingest readiness before commissioning a recording.',
          'Unobserved sources are not the same as an observed empty source list.', '']
for q in gaps:
    lines.append('- Investigate: ' + md(q['question']))
if not questions:
    lines.append('No audience questions in this window.')
destination = root / (datetime.date.today().isoformat() + '-questions.md')
destination.write_text('\n'.join(lines) + '\n')
print(destination)
PY
```

Monday 09:00 in Europe/Madrid (including daylight saving), on a cron
implementation supporting `CRON_TZ`. Set the host timezone instead if unsupported.
Provide `BOLDVIDEO_API_KEY` through the scheduler's secret environment, never
inline in the crontab; login-shell environment variables are not inherited.
Set PATH to your actual CLI location. The script's redirection truncates the
first-page scratch file each run; the dated digest is written only after all
pages succeed. Restrict access: questions may contain customer information.

```cron
CRON_TZ=Europe/Madrid
PATH=/usr/local/bin:/usr/bin:/bin
0 9 * * 1 /bin/bash /srv/bold/weekly-questions-digest.sh >> /srv/bold/digest.log 2>&1
```
