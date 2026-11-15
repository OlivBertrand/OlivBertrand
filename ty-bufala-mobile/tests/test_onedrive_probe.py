"""Regression: session-level conflict must release the other test participant."""
import threading
import pytest
from tools import onedrive_probe as probe_module
from server.onedrive import GraphError


@pytest.mark.parametrize('conflict_phase', ['session', 'upload'])
def test_concurrent_probe_handles_both_conflict_phases(monkeypatch, conflict_phase):
    lock = threading.Lock()
    sessions, contents = set(), {}

    class FakeGraph:
        def __init__(self, token):
            pass

        def call(self, path, method='GET', body=None):
            if path == 'me/drive/special/approot':
                return {'id': 'root', 'parentReference': {'driveId': 'drive'}}
            if path.endswith('/children'):
                return {'id': 'folder'}
            if path.endswith('/createUploadSession'):
                with lock:
                    if path in sessions and conflict_phase == 'session':
                        raise GraphError(409)
                    sessions.add(path)
                return {'id': 'session'}
            raise AssertionError('unexpected path')

        def upload_new(self, drive, folder, name, content):
            self.call(name + '/createUploadSession', 'POST')
            with lock:
                if name in contents:
                    raise GraphError(409)
                contents[name] = content
            return {'id': name}

        def download(self, drive, item):
            return contents[item], {'id': item}

    monkeypatch.setattr(probe_module, 'Graph', FakeGraph)
    monkeypatch.setattr(probe_module, 'LocalTokenProvider', lambda path: lambda: 'not-a-real-token')
    result = probe_module.probe('not-a-real-file')
    assert result['status'] == 'synthetic_trial_passed'
    assert result['production_ready'] is False
    assert sorted(row['status'] for row in result['results']) == ['conflict', 'created']
    assert next(row for row in result['results'] if row['status'] == 'conflict')['phase'] == conflict_phase
