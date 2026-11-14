"""Run the HTTP server and JS IndexedDB tests together; only synthetic data."""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
with tempfile.TemporaryDirectory() as tmp:
    env={**os.environ,'TB_BROWSER_DB':str(Path(tmp)/'synthetic.db')}
    server=subprocess.Popen([sys.executable,'-m','tests.browser_server'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if server.poll() is not None:raise RuntimeError('Local test server failed')
            try:
                urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=.2).close();break
            except OSError:time.sleep(.05)
        else:raise RuntimeError('Local test server not reachable')
        result=subprocess.run(['node','--test','--test-concurrency=1','tests/ui.test.cjs','tests/sync.test.cjs'])
    finally:
        server.terminate();server.wait(timeout=10)
    sys.exit(result.returncode)
