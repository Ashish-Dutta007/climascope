# Repo sync

`climascope` hosts the desktop, wall and shared APIs.
`climascope-immersive` keeps a copy of the wall and shared climate files.

Edit, test and commit in the app checkout. After wall changes, run:

```bash
python3 tools/sync_immersive_repo.py /path/to/climascope-immersive --write
python3 tools/sync_immersive_repo.py /path/to/climascope-immersive --check
```

Commit and push both repos. `SOURCE.json` records the app commit and file hashes.
Desktop-only changes stay in `climascope`. Deploy from the app checkout on retina.
